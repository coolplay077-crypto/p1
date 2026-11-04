/* torn-capture — report §6.1–§6.2, Eq. (10): torn high/low capture at a group boundary and unit-aware correction.
 *
 * Idealized behavioural model (T0 = 1, NOT a circuit or chip specification):
 *   - raw CK0 rising edges at t = k (k integer). Edge k = 0 ("E") is the group boundary: the count after edge k is
 *     N_k = M(C+1) + k, so N_{-1} = MC + M − 1 (legal old state) and N_0 = M(C+1) (legal new state).
 *   - low group: residue q = N mod M plus a 2-bit wrap_tag = (wraps mod 4) = C mod 4 kept in the fast domain and
 *     reset together with C; the tuple (q, wrap_tag) updates d_low after EVERY CK0 edge and is captured atomically
 *     as one legal-coded tuple (code-level effects are the subject of the low-state-encoding widget).
 *   - high group C (slow /M domain) updates d_high after each carry edge (the edge where q wraps M−1 → 0).
 *   - every update is uncertain over [k + d − Δd/2, k + d + Δd/2] (min/max delay spread, hatched).
 *   - a sampler at time s needs its input stable over [s − t_su, s + t_h]; if an update window overlaps that
 *     aperture the flop may resolve to the old or the new value — both are enumerated (no resolution-time model).
 *   - the snapshot samples the low tuple at t_S,low and the high group at t_S,high.
 *   Captured tuples are classified against the legal state of the low capture's epoch; Eq. (10) correctors are
 *   evaluated on them; the κ_C timing bound is derived analytically over all REF phases (see bound()).
 */
(function () {
  'use strict';
  const TSU = 0.06, TH = 0.04, EPS = 1e-9;
  const CSS = `
.tc-h { margin: 16px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.tc-h .w-ctl { font-weight: 400; }
.tc-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.tc-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; font-variant-numeric: tabular-nums; margin: 0; }
.tc-tbl th, .tc-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
.tc-tbl th { background: var(--surface-2); font-weight: 650; white-space: nowrap; position: static; }
.tc-tbl td.n, .tc-tbl th.n { text-align: right; font-family: var(--mono); white-space: nowrap; }
.tc-tbl tr:last-child td { border-bottom: 0; }
.tc-tbl tr.hit td { background: var(--accent-wash); }
.tc-tbl td.st { white-space: nowrap; }
.tc-tbl td.mean { min-width: 11em; }
.tc-tbl td.now { text-align: center; font-weight: 700; color: var(--accent-ink); white-space: nowrap; }
.tc-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: 10px; }
.tc-card { border: 1px solid var(--border); border-top: 4px solid var(--c); border-radius: 10px; padding: 8px 10px 9px; background: var(--surface); font-size: .78rem; line-height: 1.5; min-width: 0; }
.tc-card .hd { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; font-family: var(--mono); font-weight: 700; color: var(--fg); }
.tc-card .cls { margin: 4px 0 2px; }
.tc-card .err { color: var(--fg-2); }
.tc-card .cr { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); }
.tc-card .cr b { color: var(--fg); font-weight: 650; }
.tc-card .tex { overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
.tc-bound { margin-top: 8px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); font-size: .8rem; color: var(--fg-2); }
.tc-bound .tex { overflow-x: auto; overflow-y: hidden; }
.tc-bound .katex-display { margin: .35em 0; }
.tc-mono { font-family: var(--mono); }
`;
  let uid = 0;
  const sgn = (v) => (v >= 0 ? '+' + v : '−' + Math.abs(v));
  const texS = (v) => (v >= 0 ? '{+}' + v : '{-}' + Math.abs(v));
  const rng = (b) => `[${b.Gb ? '−' + b.Gb : '0'}, ${b.Gf ? '+' + b.Gf : '0'}]`; // proven ΔC range as text
  const rngT = (b) => `[${b.Gb ? '-' + b.Gb : '0'},\\,${b.Gf ? '+' + b.Gf : '0'}]`;

  // ------------------------------------------------------------------ model (DOM-free)
  function model(P) {
    const M = P.M, C = P.C, half = P.sp / 2;
    const Nk = (k) => M * (C + 1) + k;
    const qv = (k) => W.mod(Nk(k), M);
    const Cv = (k) => Math.floor(Nk(k) / M);
    const tagv = (k) => W.mod(Cv(k), 4);
    // low tuple sampled at s: list of possible captured edge indices
    function capLow(s) {
      const kS = Math.floor(s - TSU - P.dL - half + EPS); // last update surely complete before the aperture
      const kN = kS + 1;
      return (kN + P.dL - half < s + TH - EPS) ? [kS, kN] : [kS];
    }
    // high group sampled at s: list of possible captured C values (only carries change C)
    function capHigh(s) {
      const kS = M * Math.floor((s - TSU - P.dH - half) / M + EPS);
      const kN = kS + M;
      return (kN + P.dH - half < s + TH - EPS) ? [Cv(kS), Cv(kN)] : [Cv(kS)];
    }
    function outcomes(sL, sH) {
      const out = [];
      for (const kL of capLow(sL)) for (const c of capHigh(sH)) {
        const q = qv(kL), dC = c - Cv(kL);
        out.push({ kL, c, q, tag: tagv(kL), N: M * c + q, Nlow: Nk(kL), dC });
      }
      return out;
    }
    // Proven bound on ΔC = C_cap − C(low epoch) over ALL REF phases (sampling instants shifted together):
    // the low capture reflects some edge kL ∈ [⌊a_L − t_su − Δd/2⌋, ⌈a_L + t_h + Δd/2⌉ − 1] with a_L = t_S,low − d_low,
    // the high capture some kH in the same form with a_H = t_S,high − d_high; sup(kH − kL) = ⌈D + w⌉ with
    // D = a_H − a_L, w = t_su + t_h + Δd, and an integer span of n edges holds at most ⌈n/M⌉ carries.
    function bound(sL, sH) {
      const D = (sH - P.dH) - (sL - P.dL), w = TSU + TH + P.sp;
      const g = (x) => (x > EPS ? Math.ceil(x / M - EPS) : 0);
      return { D, w, Gf: g(D + w), Gb: g(-D + w) };
    }
    return { M, C, Nk, qv, Cv, tagv, capLow, capHigh, outcomes, bound, old: Nk(-1), nw: Nk(0) };
  }

  function classify(o, m) {
    if (o.dC === 0) {
      if (o.Nlow === m.old) return { k: 'old', color: 'var(--good)', lab: ['合法旧状态', 'legal old state'] };
      if (o.Nlow === m.nw) return { k: 'new', color: 'var(--good)', lab: ['合法新状态', 'legal new state'] };
      return { k: 'legal', color: 'var(--good)', lab: ['合法（另一 epoch）', 'legal (another epoch)'] };
    }
    if (o.dC === -1) return { k: 'ohnl', color: 'var(--critical)', lab: ['撕裂：旧高位 + 新低位', 'torn: old high + new low'] };
    if (o.dC === 1) return { k: 'nhol', color: 'var(--critical)', lab: ['撕裂：新高位 + 旧低位', 'torn: new high + old low'] };
    return { k: 'multi', color: 'var(--critical)', lab: [`撕裂：高位相差 ${sgn(o.dC)} 组`, `torn: high off by ${sgn(o.dC)} groups`] };
  }

  // ------------------------------------------------------------------ correctors
  function correctRaw(o) {
    // raw-cycle corrector: κ_C ≡ 0, κ_N ∈ {−1,0,+1}; detector = raw parity bit captured with q.
    const det = W.mod(o.N, 2) !== W.mod(o.Nlow, 2); // never true for even M (Eq. 11)
    const kN = det ? W.clamp(o.Nlow - o.N, -1, 1) : 0;
    const out = o.N + kN;
    return { kC: 0, kN, out, det, ok: out === o.Nlow };
  }
  function correctUnit(o, b, M, policy) {
    const resid = W.mod(o.c - o.tag, 4); // (C_cap − wrap_tag) mod 4
    let r;
    if (policy === 'trust') { // assume κ_C ∈ {−1,0,+1} without a timing proof; out-of-set residue truncated
      const s = resid === 3 ? -1 : resid; // [-1, 2]
      r = Math.min(1, s);
      const out = M * (o.c - r) + o.q;
      return { kC: -r, out, ok: out === o.Nlow, truncated: s !== r };
    }
    if (policy === 'gate') {
      if (b.Gf > 1 || b.Gb > 1) return { invalid: true, why: 'bound' };
      r = resid === 3 ? -1 : resid;
      if (r === 2) return { invalid: true, why: 'resid' };
    } else { // 'extend': correction set = proven range, resolvable by a 2-bit tag if it spans ≤ 4 values
      if (b.Gf + b.Gb + 1 > 4) return { invalid: true, why: 'width' };
      r = null;
      for (let v = -b.Gb; v <= b.Gf; v++) if (W.mod(v, 4) === resid) r = v;
      if (r == null) return { invalid: true, why: 'resid' };
    }
    const out = M * (o.c - r) + o.q;
    return { kC: -r, out, ok: out === o.Nlow };
  }

  Book.registerWidget({
    id: 'torn-capture',
    group: 'epoch',
    title: { zh: '跨组撕裂捕获与带单位的修正（式 10）', en: 'Torn capture at a group boundary and unit-aware correction (Eq. 10)' },
    summary: {
      zh: '从原始 CK0 边沿出发建模：低位 q（及快域 wrap_tag）在每个边沿后 d_low 更新，高位 C 在 q 回绕后 d_high 更新；snapshot 分别在 t_S,low、t_S,high 采样。观察何时得到合法旧/新状态，何时得到 ±M 的撕裂字，并比较“只修 ±1 raw cycle”与“按组单位修正 + 时序上界”的修正器。',
      en: 'Built from raw CK0 edges: the low residue q (plus a fast-domain wrap_tag) updates d_low after every edge, the high count C updates d_high after the wrap; the snapshot samples them at t_S,low and t_S,high. See when you get the legal old/new state and when a ±M torn word appears, and compare a "±1 raw-cycle" corrector with a group-unit corrector gated by a proven timing bound.',
    },
    sections: ['r-6-1', 'r-6-2'],
    eqs: ['10'],
    keywords: ['torn word', 'epoch', 'kappa_C', 'kappa_N', 'wrap_tag', 'snapshot', '撕裂', '跨组', '修正', 'block correction', 'INVALID'],
    _model: model, _correctRaw: correctRaw, _correctUnit: correctUnit, // DOM-free, for independent re-checks
    mount(root, api) {
      if (!document.getElementById('tc-css')) { const s = document.createElement('style'); s.id = 'tc-css'; s.textContent = CSS; document.head.appendChild(s); }
      const hatchId = 'tc-hatch-' + (++uid);
      const S = { M: 8, C: 10, dL: 0.3, dH: 2.5, sp: 0.1, sL: 0.6, skew: 0, single: true, policy: 'gate' };
      let sweepDir = 1;

      // ---------------------------------------------------------------- controls
      const loop = api.loop((dt) => {
        const lo = -1.5, hi = Math.max(S.dL, S.dH) + 1.2;
        S.sL += sweepDir * dt * 0.7;
        if (S.sL > hi) { S.sL = hi; sweepDir = -1; }
        if (S.sL < lo) { S.sL = lo; sweepDir = 1; }
        ctl.sL.value = +S.sL.toFixed(2);
        draw();
      });
      const play = W.playButton(loop, api);
      play.title = '扫描采样时刻 / Sweep the sampling instant';
      const stop = () => { if (loop.running) { loop.stop(); play.sync(); } };
      const ctl = {};
      ctl.M = W.seg({ label: ['分组倍率 M', 'Group ratio M'], options: [{ value: 4, label: '4' }, { value: 8, label: '8' }], value: S.M, onChange: (v) => { S.M = +v; schedule(); } });
      ctl.C = W.slider({ label: ['旧高位 C', 'Old high C'], min: 2, max: 60, step: 1, value: S.C, onInput: (v) => { S.C = v; schedule(); } });
      ctl.dL = W.slider({ label: ['低位延迟 d_low', 'Low delay d_low'], min: 0.05, max: 0.9, step: 0.05, value: S.dL, fmt: (v) => W.fmt(v, 2) + ' T₀', onInput: (v) => { S.dL = v; schedule(); } });
      ctl.dH = W.slider({ label: ['高位延迟 d_high', 'High delay d_high'], min: 0.05, max: 10, step: 0.05, value: S.dH, fmt: (v) => W.fmt(v, 2) + ' T₀', onInput: (v) => { S.dH = v; schedule(); } });
      ctl.sp = W.slider({ label: ['min–max 展宽 Δd', 'min–max spread Δd'], min: 0, max: 0.4, step: 0.05, value: S.sp, fmt: (v) => W.fmt(v, 2) + ' T₀', onInput: (v) => { S.sp = v; schedule(); } });
      ctl.sL = W.slider({ label: ['低位采样 t_S,low', 'Low sample t_S,low'], min: -2, max: 12, step: 0.05, value: S.sL, fmt: (v) => W.fmt(v, 2) + ' T₀', onInput: (v) => { stop(); S.sL = v; schedule(); } });
      ctl.single = W.toggle({ label: ['单一采样时刻（t_S,high = t_S,low）', 'Single sampling instant (t_S,high = t_S,low)'], value: S.single, onChange: (v) => { S.single = v; syncSkew(); schedule(); } });
      ctl.skew = W.slider({ label: ['高位采样偏移 t_S,high − t_S,low', 'High-sample skew t_S,high − t_S,low'], min: -6, max: 18, step: 0.05, value: S.skew, fmt: (v) => W.fmt(v, 2) + ' T₀', onInput: (v) => { S.skew = v; schedule(); } });
      function syncSkew() { ctl.skew.input.disabled = S.single; ctl.skew.style.opacity = S.single ? 0.5 : 1; }
      syncSkew();
      const stepBtn = W.button(['单步 +0.05 T₀', 'Step +0.05 T₀'], () => { stop(); S.sL = Math.min(12, +(S.sL + 0.05).toFixed(2)); ctl.sL.value = S.sL; schedule(); });

      const PRESETS = [
        { lab: ['① 87 合法旧', '① 87 legal old'], p: { M: 8, C: 10, dL: 0.3, dH: 2.5, sp: 0.1, sL: -0.5, single: true, skew: 0 } },
        { lab: ['② 88 合法新（匹配采样）', '② 88 legal new (matched sampling)'], p: { M: 8, C: 10, dL: 0.3, dH: 2.5, sp: 0.1, sL: 0.55, single: false, skew: 2.2 } },
        { lab: ['③ 80 旧高 + 新低', '③ 80 old high + new low'], p: { M: 8, C: 10, dL: 0.3, dH: 2.5, sp: 0.1, sL: 0.6, single: true, skew: 0 } },
        { lab: ['④ 95 新高 + 旧低', '④ 95 new high + old low'], p: { M: 8, C: 10, dL: 0.3, dH: 2.5, sp: 0.1, sL: -0.5, single: false, skew: 3.5 } },
        { lab: ['⑤ 采样落在两组更新窗内：四种全出现', '⑤ Sample inside both update windows: all four'], p: { M: 8, C: 10, dL: 0.4, dH: 0.4, sp: 0.2, sL: 0.42, single: true, skew: 0 } },
        { lab: ['⑥ 高位采样晚两组 → 必须 INVALID', '⑥ High sampled two groups late → must be INVALID'], p: { M: 8, C: 10, dL: 0.3, dH: 2.5, sp: 0.1, sL: -0.5, single: false, skew: 11.3 }, policy: 'gate' },
      ];
      function applyPreset(pr) {
        stop();
        Object.assign(S, pr.p);
        if (pr.policy) S.policy = pr.policy;
        ctl.M.value = S.M; ctl.C.value = S.C; ctl.dL.value = S.dL; ctl.dH.value = S.dH; ctl.sp.value = S.sp;
        ctl.sL.value = S.sL; ctl.single.value = S.single; ctl.skew.value = S.skew; ctlPolicy.value = S.policy;
        syncSkew(); schedule();
      }
      const presetRow = W.h('div', { class: 'w-controls' }, W.h('span', { class: 'w-ctl' }, W.L('场景：', 'Scenarios:')), PRESETS.map((pr) => W.button(pr.lab, () => applyPreset(pr))));

      const svgHost = W.h('div');
      const legend = W.legend([
        { color: 'var(--sig-clk)', label: ['CK₀ 原始时钟', 'CK₀ raw clock'] },
        { color: 'var(--sig-low)', label: ['低位 q / wrap_tag（快域）', 'low q / wrap_tag (fast domain)'] },
        { color: 'var(--sig-high)', label: ['高位 C（/M 慢域）', 'high C (/M slow domain)'] },
        { color: 'var(--sig-ref)', label: ['snapshot 采样时刻与 setup/hold 窗', 'snapshot instants and setup/hold aperture'] },
        { color: 'var(--fg-2)', dash: true, label: ['斜线：更新不确定窗（min–max 延迟）', 'hatch: update uncertainty (min–max delay)'] },
      ]);
      const legend2 = W.legend([
        { color: 'var(--good)', label: ['一致（合法）', 'coherent (legal)'] },
        { color: 'var(--warning)', label: ['可能撕裂（落在更新窗内）', 'may tear (inside an update window)'] },
        { color: 'var(--critical)', label: ['必然撕裂', 'torn'] },
      ]);
      const read = W.readout([
        { key: 'set', label: ['可能的捕获值 M·C_cap+q_cap', 'Possible captures M·C_cap+q_cap'] },
        { key: 'low', label: ['低位捕获所属 epoch（目标值）', 'Epoch of the low capture (target)'] },
        { key: 'bd', label: ['有效偏移 D（原周期）', 'Effective skew D (raw cycles)'] },
        { key: 'g', label: ['已证明的 ΔC 范围', 'Proven ΔC range'] },
      ]);
      const tblHost = W.h('div', { class: 'tc-tblw' });
      const ctlPolicy = W.select({
        label: ['κ_C 策略', 'κ_C policy'],
        options: [
          { value: 'gate', label: ['已证上界 ≤1 组，否则 INVALID', 'proven ≤1 group, else INVALID'] },
          { value: 'extend', label: ['按已证范围扩展修正集合', 'extend set to proven range'] },
          { value: 'trust', label: ['未证明，默认 ±1（截断）', 'no proof, assume ±1 (truncate)'] },
        ],
        value: S.policy,
        onChange: (v) => { S.policy = v; schedule(); },
      });
      const cardsHost = W.h('div', { class: 'tc-cards' });
      const boundHost = W.h('div', { class: 'tc-bound' });
      const eqGeneral = W.h('div', { class: 'tc-bound' },
        W.L('式 (10)：κ_C 以“组”（M 个原周期）为单位，κ_N 以原周期为单位；本模型中 q_corr = q_cap、κ_N 由 raw-cycle 修正器给出。', 'Eq. (10): κ_C counts groups (M raw cycles), κ_N counts raw cycles; in this model q_corr = q_cap and κ_N comes from the raw-cycle corrector.'),
        W.h('div', { class: 'tex' }, W.tex('N_{\\mathrm{corr}}=M\\,(C_{\\mathrm{cap}}+\\kappa_C)+q_{\\mathrm{corr}}+\\kappa_N', true)));

      root.append(
        presetRow,
        W.controls(play, stepBtn, ctl.M, ctl.C),
        W.controls(ctl.dL, ctl.dH, ctl.sp),
        W.controls(ctl.sL, ctl.single, ctl.skew),
        svgHost, legend, legend2, read.el,
        W.h('div', { class: 'tc-h' }, W.L('§6.1 表：边界附近的两个合法数与两个撕裂数（由模型计算）', '§6.1 table: two legal and two torn values around the boundary (computed by the model)')),
        tblHost,
        W.h('div', { class: 'tc-h' }, W.L('捕获结果与式 (10) 修正', 'Captured tuples and Eq. (10) correction'), ctlPolicy),
        eqGeneral,
        cardsHost,
        boundHost,
        W.note(['要点：高低字撕裂的误差单位是整组 ±M（相对另一侧合法锚点也可能表现为 ±(M−1)，所以必须先指定应关联的旧/新 epoch）。只允许 ±1 raw cycle 的修正器既检测不到（式 (11)：raw parity 不变），也修不到。式 (10) 把 κ_C（组）与 κ_N（原周期）分开；κ_C ∈ {−1,0,+1} 只有在采样与同步延迟已证明最多跨一组时才成立——超出时要么按时序上界扩展修正集合，要么判 INVALID，绝不能截断成 ±1。',
          'Key point: a high/low torn word is off by a whole group ±M (and relative to the legal anchor on the other side it may look like ±(M−1), so the intended old/new epoch must be specified first). A corrector limited to ±1 raw cycle can neither detect it (Eq. 11: raw parity is unchanged) nor reach it. Eq. (10) keeps κ_C (groups) and κ_N (raw cycles) separate; κ_C ∈ {−1,0,+1} holds only if the sampling and synchronisation delay is proven to span at most one group — beyond that, extend the correction set from the timing bound or declare INVALID, never truncate to ±1.'], 'good'),
        W.note(['理想化示意模型：T₀ = 1 的理想 CK₀；固定延迟加 min–max 展宽；采样窗内的更新可解析为旧值或新值（不建模亚稳态解析时间与传播）；(q, wrap_tag) 作为一个合法编码元组原子捕获。这是式 (1) 下的故障注入推导，不是任何专利电路或芯片参数。',
          'Idealized illustration: ideal CK₀ with T₀ = 1; fixed delays plus a min–max spread; an update inside the sampling aperture may resolve to the old or the new value (metastability resolution time and propagation are not modelled); (q, wrap_tag) is captured atomically as one legal-coded tuple. This is a fault-injection derivation under Eq. (1), not any patent circuit or chip parameter.'], 'warn'),
      );

      // ---------------------------------------------------------------- drawing
      let raf = 0;
      function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
      const vw = () => Math.round(W.clamp(root.clientWidth || 700, 340, 760));
      let lastSig = '';

      function draw() {
        const m = model(S), M = S.M;
        const VW = vw(), narrow = VW < 520;
        const PADL = narrow ? 62 : 100, PADR = 12;
        const skew = S.single ? 0 : S.skew;
        const sL = S.sL, sH = S.sL + skew;
        let t0 = -2.5 + Math.min(0, skew), t1 = Math.max(3, S.dH + 2, S.dL + 2) + Math.max(0, skew);
        t0 = Math.min(t0, sL - 1, sH - 1); t1 = Math.max(t1, sL + 1, sH + 1);
        const x = W.scale([t0, t1], [PADL, VW - PADR]);
        const pxT = (VW - PADL - PADR) / (t1 - t0);
        const Y = { lab: 12, clk: 42, N: 74, q: 108, tag: 140, C: 174, map: 208, axis: 222 };
        const VH = 246;
        const svg = W.svg(VW, VH);
        svg.appendChild(W.s('defs', null, W.s('pattern', { id: hatchId, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
          W.s('line', { x1: 0, y1: 0, x2: 0, y2: 5, style: 'stroke:var(--fg-2);stroke-width:1.4' }))));
        // grid at CK0 edges, boundary edge E emphasised
        for (let k = Math.ceil(t0); k <= t1; k++) {
          const isWrap = W.mod(k, M) === 0;
          svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: 26, y2: Y.axis, class: 'grid', style: isWrap ? 'stroke:var(--axis);stroke-width:1.5' + (k === 0 ? ';stroke-dasharray:4 3' : '') : '' }));
        }
        // row labels
        const lab = (zh, en, y) => svg.appendChild(W.sL(zh, en, { x: 6, y: y + 4, class: 'lbl' }));
        lab('CK₀', 'CK₀', Y.clk);
        lab(narrow ? 'N 逻辑' : 'N（逻辑值）', narrow ? 'N logic' : 'N (logical)', Y.N);
        lab(narrow ? 'q 低位' : 'q（低位寄存）', narrow ? 'q low' : 'q (low reg.)', Y.q);
        lab('wrap_tag', 'wrap_tag', Y.tag);
        lab(narrow ? 'C 高位' : 'C（高位寄存）', narrow ? 'C high' : 'C (high reg.)', Y.C);
        lab(narrow ? '分类' : 'S 在此时的分类', narrow ? 'class' : 'class if S here', Y.map);
        // CK0
        const clkTop = Y.clk - 8, clkBot = Y.clk + 8;
        svg.appendChild(W.s('path', { d: W.digitalPath(W.clockEdges(1, 0, t0, t1), 0, x, clkTop, clkBot, t0, t1), fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
        // logical N (ideal, no delay)
        const segN = [];
        for (let k = Math.floor(t0) - 1; k <= t1; k++) segN.push({ t0: Math.max(t0, k), t1: Math.min(t1, k + 1), label: m.Nk(k), stroke: 'var(--fg-2)' });
        svg.appendChild(W.busGroup(segN.filter((sg) => sg.t1 > sg.t0), x, Y.N, 16, { minLabelW: 17 }));
        // registered buses with update-uncertainty windows
        const half = S.sp / 2;
        function bus(y, h, d, isCarry, valOf, color) {
          const segs = [], wins = [], step = isCarry ? M : 1;
          let k = isCarry ? M * Math.floor((t0 - d - half - 1) / M) : Math.floor(t0 - d - half - 1);
          let val = valOf(k - step), cur = t0;
          for (; ; k += step) {
            const a = k + d - half, b = k + d + half;
            if (a >= t1) break;
            if (b <= t0) { val = valOf(k); continue; }
            if (a > cur) segs.push({ t0: cur, t1: a, label: val, fill: color, stroke: color });
            if (b > a) wins.push([Math.max(a, t0), Math.min(b, t1)]);
            cur = Math.max(cur, b); val = valOf(k);
          }
          if (cur < t1) segs.push({ t0: cur, t1, label: val, fill: color, stroke: color });
          const g = W.busGroup(segs, x, y, h, { minLabelW: 13 });
          for (const [a, b] of wins) g.appendChild(W.s('rect', { x: x(a), y: y - h / 2, width: Math.max(0.8, x(b) - x(a)), height: h, fill: `url(#${hatchId})`, stroke: color, 'stroke-width': 0.8 }));
          svg.appendChild(g);
        }
        bus(Y.q, 20, S.dL, false, (k) => m.qv(k), 'var(--sig-low)');
        // wrap_tag only changes at wraps: draw with carry windows but low delay
        bus(Y.tag, 16, S.dL, true, (k) => m.tagv(k), 'var(--sig-low)');
        bus(Y.C, 20, S.dH, true, (k) => m.Cv(k), 'var(--sig-high)');
        // class map: classification of the outcome set if S_low were at this instant (skew fixed)
        const stepPx = 2;
        let run = null;
        const runs = [];
        for (let px = PADL; px <= VW - PADR; px += stepPx) {
          const s = x.invert(px);
          const os = m.outcomes(s, s + skew);
          const nT = os.filter((o) => o.dC !== 0).length;
          const cls = nT === 0 ? 'good' : nT === os.length ? 'critical' : 'warning';
          if (run && run.cls === cls) run.b = px + stepPx; else { run = { cls, a: px, b: px + stepPx }; runs.push(run); }
        }
        for (const r of runs) svg.appendChild(W.s('rect', { x: r.a, y: Y.map - 6, width: Math.min(VW - PADR, r.b) - r.a, height: 12, style: `fill:var(--${r.cls});fill-opacity:.6` }));
        // sampling instants and apertures
        const ap = (s, yA, yB) => svg.appendChild(W.s('rect', { x: x(s - TSU), y: yA, width: Math.max(1.5, x(s + TH) - x(s - TSU)), height: yB - yA, style: 'fill:var(--sig-ref);fill-opacity:.22' }));
        const vline = (s, yA, yB) => svg.appendChild(W.s('line', { x1: x(s), x2: x(s), y1: yA, y2: yB, style: 'stroke:var(--sig-ref);stroke-width:1.8' }));
        const dot = (s, y) => svg.appendChild(W.s('circle', { cx: x(s), cy: y, r: 3.2, style: 'fill:var(--sig-ref);stroke:var(--surface);stroke-width:1' }));
        if (S.single) {
          ap(sL, Y.q - 14, Y.C + 14); vline(sL, 18, Y.C + 16); dot(sL, Y.q); dot(sL, Y.tag); dot(sL, Y.C);
          svg.appendChild(W.sL('S（单次采样）', 'S (single instant)', { x: x(sL), y: Y.lab, 'text-anchor': anchorAt(x(sL)), style: 'font-size:11px;font-weight:650;fill:var(--fg)' }));
        } else {
          ap(sL, Y.q - 14, Y.tag + 12); vline(sL, 18, Y.tag + 14); dot(sL, Y.q); dot(sL, Y.tag);
          ap(sH, Y.C - 14, Y.C + 14); vline(sH, 18, Y.C + 16); dot(sH, Y.C);
          const xl = x(sL), xh = x(sH), close = Math.abs(xl - xh) < 70;
          svg.appendChild(W.s('text', { x: xl, y: Y.lab, 'text-anchor': anchorAt(xl), style: 'font-size:11px;font-weight:650;fill:var(--fg)' }, 'S_low'));
          svg.appendChild(W.s('text', { x: xh, y: close ? Y.lab + 11 : Y.lab, 'text-anchor': anchorAt(xh), style: 'font-size:11px;font-weight:650;fill:var(--fg)' }, 'S_high'));
        }
        // marker of current S_low on the class map
        svg.appendChild(W.s('path', { d: `M${x(sL) - 5},${Y.map + 11}L${x(sL) + 5},${Y.map + 11}L${x(sL)},${Y.map + 5}Z`, style: 'fill:var(--fg)' }));
        // time axis
        svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: Y.axis, y2: Y.axis, class: 'axis' }));
        const every = pxT >= 26 ? 1 : pxT >= 12 ? 2 : 5;
        for (let k = Math.ceil(t0); k <= t1; k++) {
          if (k !== 0 && W.mod(k, every) !== 0) continue;
          svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: Y.axis, y2: Y.axis + 4, class: 'axis' }));
          svg.appendChild(W.s('text', { x: x(k), y: Y.axis + 15, 'text-anchor': 'middle', style: k === 0 ? 'font-weight:700;fill:var(--fg)' : '' }, k === 0 ? 'E' : String(k)));
        }
        svg.appendChild(W.sL('t / T₀', 't / T₀', { x: 6, y: Y.axis + 15, style: 'font-size:10px' }));
        W.clear(svgHost).appendChild(svg);

        // ---------------------------------------------------------------- readouts + panels
        const outs = m.outcomes(sL, sH);
        const b = m.bound(sL, sH);
        const uniqN = [...new Set(outs.map((o) => o.N))];
        read.set('set', uniqN.join(' / '));
        const lows = [...new Set(outs.map((o) => o.Nlow))];
        read.set('low', lows.map((n) => `N = ${n}`).join(' | '));
        read.set('bd', `D = ${W.fmt(b.D, 2)}, w = ${W.fmt(b.w, 2)}`);
        read.set('g', `ΔC ∈ ${rng(b)}`);
        const sig = JSON.stringify([S.M, S.C, S.policy, outs, b.Gf, b.Gb, W.fmt(b.D, 2)]);
        if (sig !== lastSig) { lastSig = sig; panels(m, outs, b); }
      }
      const anchorAt = (px) => (px < 60 ? 'start' : px > vw() - 60 ? 'end' : 'middle');

      function panels(m, outs, b) {
        const M = m.M, C = m.C;
        // §6.1 table
        const rows = [
          { st: ['跨组前', 'Before the boundary'], c: C, q: M - 1, dC: 0, kL: -1, mean: ['合法旧状态', 'Legal old state'] },
          { st: ['跨组后', 'After the boundary'], c: C + 1, q: 0, dC: 0, kL: 0, mean: ['合法新状态', 'Legal new state'] },
          { st: ['旧高位 + 新低位', 'Old high + new low'], c: C, q: 0, dC: -1, kL: 0, mean: [`相对新状态 ${m.nw} 错 −${M}`, `Off by −${M} relative to the new state ${m.nw}`] },
          { st: ['新高位 + 旧低位', 'New high + old low'], c: C + 1, q: M - 1, dC: 1, kL: -1, mean: [`相对旧状态 ${m.old} 错 +${M}`, `Off by +${M} relative to the old state ${m.old}`] },
        ];
        const hit = (r) => outs.some((o) => o.c === r.c && o.q === r.q && o.dC === r.dC);
        const extra = outs.filter((o) => !rows.some((r) => o.c === r.c && o.q === r.q && o.dC === r.dC));
        const tb = W.h('tbody');
        for (const r of rows) {
          tb.appendChild(W.h('tr', { class: hit(r) ? 'hit' : '' }, W.h('td', { class: 'st' }, W.lbl(r.st)), W.h('td', { class: 'n' }, r.c), W.h('td', { class: 'n' }, r.q), W.h('td', { class: 'n' }, M * r.c + r.q), W.h('td', { class: 'mean' }, W.lbl(r.mean)), W.h('td', { class: 'now' }, hit(r) ? '●' : '')));
        }
        for (const o of extra) {
          const cl = classify(o, m);
          const mean = o.dC === 0 ? [`合法状态 N = ${o.Nlow}`, `Legal state N = ${o.Nlow}`] : [`相对低位 epoch ${o.Nlow} 错 ${sgn(M * o.dC)}`, `Off by ${sgn(M * o.dC)} relative to the low epoch ${o.Nlow}`];
          tb.appendChild(W.h('tr', { class: 'hit' }, W.h('td', { class: 'st' }, W.lbl(cl.lab)), W.h('td', { class: 'n' }, o.c), W.h('td', { class: 'n' }, o.q), W.h('td', { class: 'n' }, o.N), W.h('td', { class: 'mean' }, W.lbl(mean)), W.h('td', { class: 'now' }, '●')));
        }
        W.clear(tblHost).appendChild(W.h('table', { class: 'tc-tbl' },
          W.h('thead', null, W.h('tr', null, W.h('th', null, W.L('状态', 'State')), W.h('th', { class: 'n' }, W.L('高位 C', 'High C')), W.h('th', { class: 'n' }, W.L('低位 q', 'Low q')), W.h('th', { class: 'n' }, `${M}C+q`), W.h('th', null, W.L('含义', 'Meaning')), W.h('th', null, W.L('当前捕获', 'Captured now')))),
          tb));

        // outcome cards
        W.clear(cardsHost);
        for (const o of outs) {
          const cl = classify(o, m);
          const A = correctRaw(o);
          const B = correctUnit(o, b, M, S.policy);
          const errLines = [];
          if (o.dC !== 0) {
            const other = o.dC > 0 ? M * o.c : M * o.c + M - 1; // nearest legal state of C_cap's own epoch
            errLines.push(W.h('div', { class: 'err' }, W.L(`相对低位 epoch ${o.Nlow}：${sgn(o.N - o.Nlow)}（= ${sgn(o.dC)}·M）`, `vs low epoch ${o.Nlow}: ${sgn(o.N - o.Nlow)} (= ${sgn(o.dC)}·M)`)));
            errLines.push(W.h('div', { class: 'err' }, W.L(`相对另一侧合法锚点 ${other}：${sgn(o.N - other)}`, `vs the other legal anchor ${other}: ${sgn(o.N - other)}`)));
          } else {
            errLines.push(W.h('div', { class: 'err' }, W.L('C_cap 与低位捕获属于同一 epoch，无需修正', 'C_cap and the low capture belong to the same epoch: nothing to correct')));
          }
          const vA = A.ok ? W.status('good', ['✓ 正确', '✓ correct']) : W.status('bad', [`✗ 静默错误 ${sgn(A.out - o.Nlow)}`, `✗ silent error ${sgn(A.out - o.Nlow)}`]);
          const vB = B.invalid ? W.status('warn', ['INVALID（安全）', 'INVALID (safe)']) : B.ok ? W.status('good', ['✓ 正确', '✓ correct']) : W.status('bad', [`✗ 静默错误 ${sgn(B.out - o.Nlow)}`, `✗ silent error ${sgn(B.out - o.Nlow)}`]);
          const whyB = B.invalid
            ? (B.why === 'bound' ? W.L(`已证 ΔC ∈ ${rng(b)} 超出 {−1,0,+1}`, `proven ΔC ∈ ${rng(b)} exceeds {−1,0,+1}`)
              : B.why === 'width' ? W.L(`已证范围含 ${b.Gf + b.Gb + 1} 个值，2 位 wrap_tag 无法唯一区分`, `proven range has ${b.Gf + b.Gb + 1} values: a 2-bit wrap_tag cannot resolve it`)
                : W.L('wrap_tag 残差不在已证集合内', 'wrap_tag residue outside the proven set'))
            : W.h('span', { class: 'tex' }, W.tex(`N_{\\mathrm{corr}}=${M}(${o.c}${texS(B.kC)})+${o.q}+0=${B.out}`));
          cardsHost.appendChild(W.h('div', { class: 'tc-card', style: { '--c': cl.color } },
            W.h('div', { class: 'hd' }, W.h('span', null, `(C, q) = (${o.c}, ${o.q})`), W.h('span', null, `N_cap = ${o.N}`)),
            W.h('div', { class: 'cls' }, W.status(o.dC === 0 ? 'good' : 'bad', cl.lab), ' ', W.h('span', { class: 'tc-mono err' }, `wrap_tag = ${o.tag}`)),
            errLines,
            W.h('div', { class: 'cr' }, W.h('b', null, W.L('A. 只修 ±1 raw cycle', 'A. ±1 raw-cycle corrector')), ' ', vA,
              W.h('div', { class: 'err' }, W.L(`raw parity 检测：${A.det ? '不一致' : '一致（式 11）'} → κ_N = ${A.kN}，κ_C ≡ 0 → ${A.out}`, `raw-parity check: ${A.det ? 'mismatch' : 'match (Eq. 11)'} → κ_N = ${A.kN}, κ_C ≡ 0 → ${A.out}`)),
              o.dC !== 0 ? W.h('div', { class: 'err' }, W.L(`即使已知误差，|κ_N| ≤ 1 也只剩 ${sgn(o.N + W.clamp(o.Nlow - o.N, -1, 1) - o.Nlow)}`, `even if told the error, |κ_N| ≤ 1 still leaves ${sgn(o.N + W.clamp(o.Nlow - o.N, -1, 1) - o.Nlow)}`)) : null),
            W.h('div', { class: 'cr' }, W.h('b', null, W.L('B. 按组单位：wrap_tag → κ_C', 'B. Group-unit: wrap_tag → κ_C')), ' ', vB,
              W.h('div', { class: 'err' }, W.L(`(C_cap − wrap_tag) mod 4 = ${W.mod(o.c - o.tag, 4)}`, `(C_cap − wrap_tag) mod 4 = ${W.mod(o.c - o.tag, 4)}`), B.invalid ? null : W.L(` → κ_C = ${B.kC}${B.truncated ? '（已截断）' : ''}`, ` → κ_C = ${B.kC}${B.truncated ? ' (truncated)' : ''}`)),
              W.h('div', { class: 'err' }, whyB))));
        }

        // timing bound panel
        const okSet = b.Gf <= 1 && b.Gb <= 1;
        W.clear(boundHost).append(
          W.h('div', null, W.L('时序上界（对任意 REF 相位成立，由延迟、展宽、setup/hold 与采样偏移推出）：', 'Timing bound (holds for every REF phase; derived from delays, spread, setup/hold and sampling skew):')),
          W.h('div', { class: 'tex' }, W.tex(`D=(t_{S,high}-d_{high})-(t_{S,low}-d_{low})=${W.fmt(b.D, 2)}`, true)),
          W.h('div', { class: 'tex' }, W.tex(`w=t_{su}+t_h+\\Delta d=${W.fmt(b.w, 2)}`, true)),
          W.h('div', { class: 'tex' }, W.tex(`G_f=\\max\\!\\big(0,\\lceil (D+w)/M\\rceil\\big)=${b.Gf}`, true)),
          W.h('div', { class: 'tex' }, W.tex(`G_b=\\max\\!\\big(0,\\lceil (w-D)/M\\rceil\\big)=${b.Gb}`, true)),
          W.h('div', { class: 'tex' }, W.tex(`\\Rightarrow\\ \\Delta C=C_{\\mathrm{cap}}-C_{\\mathrm{low\\,epoch}}\\in[-G_b,\\,G_f]=${rngT(b)}`, true)),
          W.h('div', null, okSet
            ? W.status('good', ['延迟最多跨一组：κ_C ∈ {−1,0,+1} 成立', 'delay spans at most one group: κ_C ∈ {−1,0,+1} is valid'])
            : W.status('bad', [`延迟可能跨 ${Math.max(b.Gf, b.Gb)} 组：κ_C ∈ {−1,0,+1} 不成立`, `delay may span ${Math.max(b.Gf, b.Gb)} groups: κ_C ∈ {−1,0,+1} is NOT valid`]),
          ' ', W.h('span', null, W.L(`（t_su = ${TSU}，t_h = ${TH} T₀；ΔC 由 2 位 wrap_tag 识别）`, `(t_su = ${TSU}, t_h = ${TH} T₀; ΔC identified by a 2-bit wrap_tag)`))));
      }

      draw();
      const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { lastSig = ''; schedule(); }) : null;
      if (ro) ro.observe(root);
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      return { destroy() { loop.stop(); if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); } };
    },
  });
})();
