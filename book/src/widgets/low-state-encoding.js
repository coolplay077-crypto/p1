/* low-state-encoding — report §6.5 (and §4.2 Xu/Lindfors shift state): what a capture during a transition can
 * return for binary, Gray, Johnson and one-hot/shift-ring low states (M = 4 / 8).
 *
 * Idealized digital model (NOT a transistor/metastability model):
 *   - the low state is a register of nb flip-flops holding code(q); at a CK0 edge it moves to code(q+1).
 *   - the bits that toggle in that transition switch at individually skewed times (unknown, PVT/routing);
 *     a sampler whose aperture [t_s − t_su, t_s + t_h] overlaps a bit's switching time may resolve that bit to
 *     the old or the new value. Over all skews and resolutions EVERY combination of toggling bits is possible,
 *     so the reachable set is { base with any subset of the toggling bits flipped } (2^k codes).
 *   - optional: the sampling uncertainty spans two consecutive transitions (fast state vs aperture budget).
 *   - optional: the high-count LSB c0 (toggles at the wrap M−1 → 0) is captured in the same word and used to
 *     decode N = M·C + q (shows the ±M tear at the group boundary, cf. §6.1).
 *   - decoders: binary = identity; Gray = XOR chain; Johnson = lookup with legality check; one-hot = a generic
 *     OR-type one-hot→binary encoder (illustration, not the Xu/Lindfors truth table), with or without a
 *     popcount = 1 legality check (EventFrame field encoding_invalid, §10.1).
 */
(function () {
  'use strict';
  const TSU = 0.05, TH = 0.03, D0 = 0.08, C_OLD = 10;
  const CSS = `
.lse-h { margin: 16px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.lse-h .w-ctl { font-weight: 400; }
.lse-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.lse-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; font-variant-numeric: tabular-nums; margin: 0; }
.lse-tbl th, .lse-tbl td { padding: 3px 7px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; white-space: nowrap; }
.lse-tbl th { background: var(--surface-2); font-weight: 650; position: static; }
.lse-tbl th.sel { color: var(--accent-ink); }
.lse-tbl tr:last-child td { border-bottom: 0; }
.lse-tbl td.code { font-family: var(--mono); letter-spacing: .04em; }
.lse-tbl td.code .tg { color: var(--sig-err); font-weight: 700; text-decoration: underline; }
.lse-tbl td.code .un { color: var(--sig-err); font-weight: 700; }
.lse-tbl td.code.sel { background: var(--accent-wash); }
.lse-tbl td.hd { text-align: center; font-weight: 700; font-size: .72rem; }
.lse-tbl td.hd.good { color: var(--good-ink); }
.lse-tbl td.hd.warn { color: #a86500; }
.lse-tbl td.hd.bad { color: var(--critical-ink); background: color-mix(in srgb, var(--critical) 10%, transparent); }
.lse-tbl tr.selrow td { box-shadow: inset 0 0 0 9999px var(--accent-wash); }
.lse-tbl tr.click { cursor: pointer; }
.lse-tbl tr.click:hover td { background: var(--surface-2); }
.lse-tbl tr.insp td { background: var(--accent-wash); }
.lse-tbl tr.insp td:first-child { box-shadow: inset 4px 0 0 var(--accent); }
.lse-wrap { flex-wrap: wrap; }
.lse-wrap .w-seg { flex-wrap: wrap; }
.lse-wrap .w-seg button { white-space: nowrap; }
.lse-tbl td.now { text-align: center; color: var(--accent-ink); font-weight: 700; }
.lse-tbl td.cls { white-space: normal; min-width: 12em; }
.lse-dec { margin-top: 8px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); font-size: .8rem; color: var(--fg-2); }
.lse-dec .tex { overflow-x: auto; overflow-y: hidden; }
`;
  const ENC = {
    bin: { name: ['二进制', 'Binary'], nb: (M) => Math.log2(M), code: (q) => q },
    gray: { name: ['Gray 码', 'Gray'], nb: (M) => Math.log2(M), code: (q) => q ^ (q >> 1) },
    john: { name: ['Johnson（扭环）', 'Johnson (twisted ring)'], nb: (M) => M / 2, code: (q, M) => { const h = M / 2; return q < h ? (1 << q) - 1 : ((1 << h) - 1) ^ ((1 << (q - h)) - 1); } },
    onehot: { name: ['one-hot / 移位环', 'one-hot / shift ring'], nb: (M) => M, code: (q) => 1 << q },
  };
  const ENC_IDS = ['bin', 'gray', 'john', 'onehot'];
  const popcount = (v) => { let n = 0; while (v) { n += v & 1; v >>= 1; } return n; };
  const orEnc = (v, M) => { let out = 0; for (let i = 0; i < M; i++) if ((v >> i) & 1) out |= i; return out; };
  const bits = (v, n) => { let s = ''; for (let b = n - 1; b >= 0; b--) s += (v >> b) & 1; return s; };

  function decoder(enc, M) {
    const map = new Map();
    for (let q = 0; q < M; q++) map.set(ENC[enc].code(q, M), q);
    return (c) => (map.has(c) ? map.get(c) : null);
  }
  // Enumerate every capture reachable when sampling during `span` transitions starting at state q.
  function enumerate(enc, M, q, span, hi, ohCheck) {
    const E = ENC[enc], nb = E.nb(M), dec = decoder(enc, M);
    const seq = []; for (let i = 0; i <= span; i++) seq.push(W.mod(q + i, M));
    const codes = seq.map((v) => E.code(v, M));
    const wraps = []; for (let i = 0; i < span; i++) if (seq[i] === M - 1) wraps.push(i);
    const c0old = C_OLD & 1;
    let mask = 0; for (let i = 0; i < span; i++) mask |= codes[i] ^ codes[i + 1];
    const cmask = hi && wraps.length ? 1 : 0;
    const Nseq = seq.map((v, i) => M * C_OLD + q + i);
    const ub = []; for (let b = 0; b < nb; b++) if ((mask >> b) & 1) ub.push(b);
    const nU = ub.length + (cmask ? 1 : 0);
    const out = [];
    for (let s = 0; s < (1 << nU); s++) {
      let low = codes[0] & ~mask;
      ub.forEach((b, j) => { if ((s >> j) & 1) low |= 1 << b; });
      const c0 = cmask ? (s >> ub.length) & 1 : c0old;
      const d = dec(low);
      const o = { low, c0, legal: d != null, dec: d, nb, hi };
      if (d == null) {
        if (enc === 'onehot' && !ohCheck) {
          o.dec = orEnc(low, M); o.viaOr = true;
          o.cls = seq.includes(o.dec) && (!hi || Nseq.includes(M * ((C_OLD & ~1) | c0) + o.dec)) ? 'or-ok' : 'silent';
        } else o.cls = 'illegal';
      } else if (hi) {
        o.N = M * ((C_OLD & ~1) | c0) + d;
        const i = Nseq.indexOf(o.N);
        o.cls = i === 0 ? 'old' : i === span ? 'new' : i > 0 ? 'mid' : seq.includes(d) ? 'torn' : 'silent';
      } else {
        const i = seq.indexOf(d);
        o.cls = i === 0 ? 'old' : i === span ? 'new' : i > 0 ? 'mid' : 'silent';
      }
      if (o.viaOr && hi) o.N = M * ((C_OLD & ~1) | c0) + o.dec;
      out.push(o);
    }
    return { seq, codes, mask, cmask, nb, out, wraps, Nseq, k: nU };
  }
  const SEV = { old: 0, new: 0, mid: 0, 'or-ok': 1, illegal: 1, torn: 2, silent: 2 };
  const worst = (r) => Math.max(...r.out.map((o) => SEV[o.cls]));
  const CLS = {
    old: ['good', ['旧值', 'old value']],
    new: ['good', ['新值', 'new value']],
    mid: ['good', ['中间值（窗口内相邻）', 'intermediate value (in-window, adjacent)']],
    illegal: ['warn', ['非法码 → encoding_invalid（可检测）', 'illegal code → encoding_invalid (detectable)']],
    'or-ok': ['warn', ['非法码，未检查的 OR 编码器碰巧读成相邻值', 'illegal code; the unchecked OR encoder happens to read an adjacent value']],
    torn: ['bad', ['高位 LSB 与低位撕裂：±M 静默错误', 'torn against the high LSB: silent ±M error']],
    silent: ['bad', ['合法但错误的值：静默错误', 'legal but wrong value: silent error']],
  };

  Book.registerWidget({
    id: 'low-state-encoding',
    group: 'epoch',
    title: { zh: '低位状态编码：在跳变中采样会得到什么', en: 'Low-state encodings: what a capture during a transition can return' },
    summary: {
      zh: '比较 M = 4/8 的二进制、Gray、Johnson 与 one-hot/移位环低位状态。状态表给出每次跳变的汉明距离；在跳变中采样时，翻转的位各自可能取旧值或新值，模型枚举全部可能的捕获码并解码，区分“旧/新相邻值”“可检测的非法码”和“静默错码”。',
      en: 'Compare binary, Gray, Johnson and one-hot/shift-ring low states for M = 4/8. The state table gives the Hamming distance of every transition; when sampling during a transition each toggling bit may resolve old or new, and the model enumerates and decodes every possible capture, separating "old/new adjacent", "detectable illegal code" and "silent wrong code".',
    },
    sections: ['r-6-5', 'r-4-2'],
    eqs: [],
    keywords: ['Gray', 'Johnson', 'one-hot', 'shift state', 'encoder', 'metastability', 'Hamming distance', '格雷码', '亚稳态', '编码', 'encoding_invalid', 'Xu', 'Lindfors'],
    _enumerate: enumerate, _ENC: ENC, // DOM-free, for independent re-checks
    mount(root, api) {
      if (!document.getElementById('lse-css')) { const s = document.createElement('style'); s.id = 'lse-css'; s.textContent = CSS; document.head.appendChild(s); }
      const S = { M: 8, enc: 'bin', q: 3, span: 1, hi: false, oh: 'checked', skew: 0.35, ts: 0.25, seed: 5, insp: null };
      let dir = 1;
      let skewU = [];
      function reroll() { const r = W.rng(S.seed * 7919 + 13); skewU = []; for (let i = 0; i < 9; i++) skewU.push(r()); }
      reroll();

      // ---------------------------------------------------------------- controls
      const loop = api.loop((dt) => {
        const lo = -0.4, hi = S.span + 0.5;
        S.ts += dir * dt * 0.35;
        if (S.ts > hi) { S.ts = hi; dir = -1; }
        if (S.ts < lo) { S.ts = lo; dir = 1; }
        ctl.ts.value = +S.ts.toFixed(2);
        draw();
      });
      const play = W.playButton(loop, api);
      const stop = () => { if (loop.running) { loop.stop(); play.sync(); } };
      const ctl = {};
      ctl.M = W.seg({ label: ['M', 'M'], options: [{ value: 4, label: '4' }, { value: 8, label: '8' }], value: S.M, onChange: (v) => { S.M = +v; S.q = Math.min(S.q, S.M - 1); ctl.q.input.max = S.M - 1; ctl.q.value = S.q; S.insp = null; schedule(); } });
      ctl.enc = W.seg({ label: ['编码', 'Encoding'], options: ENC_IDS.map((id) => ({ value: id, label: ENC[id].name })), value: S.enc, onChange: (v) => { S.enc = v; S.insp = null; schedule(); } });
      ctl.q = W.slider({ label: ['跳变 q → q+1', 'Transition q → q+1'], min: 0, max: S.M - 1, step: 1, value: S.q, fmt: (v) => `${v} → ${W.mod(v + 1, S.M)}`, onInput: (v) => { S.q = v; S.insp = null; schedule(); } });
      ctl.span = W.seg({ label: ['采样不确定窗覆盖', 'Uncertainty spans'], options: [{ value: 1, label: ['1 次跳变', '1 transition'] }, { value: 2, label: ['2 次跳变', '2 transitions'] }], value: S.span, onChange: (v) => { S.span = +v; S.insp = null; schedule(); } });
      ctl.hi = W.toggle({ label: ['同时捕获高位 LSB c₀ 并解码 N = M·C + q', 'Also capture the high LSB c₀ and decode N = M·C + q'], value: S.hi, onChange: (v) => { S.hi = v; S.insp = null; schedule(); } });
      ctl.oh = W.select({ label: ['one-hot 编码器', 'one-hot encoder'], options: [{ value: 'checked', label: ['OR 编码 + popcount=1 检查', 'OR encoder + popcount = 1 check'] }, { value: 'or', label: ['仅 OR 编码器（不检查）', 'plain OR encoder (unchecked)'] }], value: S.oh, onChange: (v) => { S.oh = v; schedule(); } });
      ctl.skew = W.slider({ label: ['逐位翻转时刻离散', 'Per-bit switching skew'], min: 0, max: 0.6, step: 0.05, value: S.skew, fmt: (v) => W.fmt(v, 2) + ' T₀', onInput: (v) => { S.skew = v; schedule(); } });
      ctl.ts = W.slider({ label: ['采样时刻 t_s', 'Sampling instant t_s'], min: -0.4, max: 2.5, step: 0.01, value: S.ts, fmt: (v) => W.fmt(v, 2) + ' T₀', onInput: (v) => { stop(); S.ts = v; schedule(); } });
      const reBtn = W.button(['重抽逐位离散', 'Re-draw skews'], () => { S.seed++; reroll(); schedule(); });
      ctl.enc.classList.add('lse-wrap');

      const PRESETS = [
        { lab: ['二进制 3→4：8 种码都可能', 'Binary 3→4: any of 8 codes'], p: { M: 8, enc: 'bin', q: 3, span: 1, hi: false } },
        { lab: ['二进制 7→0', 'Binary 7→0'], p: { M: 8, enc: 'bin', q: 7, span: 1, hi: false } },
        { lab: ['Gray 3→4：只有旧/新', 'Gray 3→4: only old/new'], p: { M: 8, enc: 'gray', q: 3, span: 1, hi: false } },
        { lab: ['Johnson 3→4', 'Johnson 3→4'], p: { M: 8, enc: 'john', q: 3, span: 1, hi: false } },
        { lab: ['one-hot 1→2，仅 OR 编码器', 'one-hot 1→2, plain OR encoder'], p: { M: 4, enc: 'onehot', q: 1, span: 1, hi: false, oh: 'or' } },
        { lab: ['one-hot 1→2，带合法性检查', 'one-hot 1→2, with legality check'], p: { M: 4, enc: 'onehot', q: 1, span: 1, hi: false, oh: 'checked' } },
        { lab: ['Gray 在组边界 + 高位 LSB：±M 撕裂', 'Gray at the wrap + high LSB: ±M tear'], p: { M: 8, enc: 'gray', q: 7, span: 1, hi: true } },
        { lab: ['不确定窗跨 2 次跳变：Gray vs Johnson', 'Window spans 2 transitions: Gray vs Johnson'], p: { M: 8, enc: 'gray', q: 1, span: 2, hi: false } },
      ];
      function applyPreset(pr) {
        stop();
        Object.assign(S, pr.p); S.insp = null;
        S.ts = S.span === 2 ? 0.9 : 0.25;
        ctl.M.value = S.M; ctl.enc.value = S.enc; ctl.q.input.max = S.M - 1; ctl.q.value = S.q; ctl.span.value = S.span; ctl.hi.value = S.hi; ctl.oh.value = S.oh; ctl.ts.value = S.ts;
        schedule();
      }
      const presetRow = W.h('div', { class: 'w-controls' }, W.h('span', { class: 'w-ctl' }, W.L('场景：', 'Scenarios:')), ...PRESETS.map((pr) => W.button(pr.lab, () => applyPreset(pr))));

      const seqHost = W.h('div', { class: 'lse-tblw' });
      const waveHost = W.h('div');
      const legendWave = W.legend([
        { color: 'var(--sig-clk)', label: ['CK₀ 跳变沿', 'CK₀ transition edge'] },
        { color: 'var(--sig-low)', label: ['低位状态位', 'low-state bits'] },
        { color: 'var(--sig-high)', label: ['高位 LSB c₀', 'high LSB c₀'] },
        { color: 'var(--sig-ref)', label: ['采样时刻与 setup/hold 窗', 'sampling instant and setup/hold aperture'] },
        { color: 'var(--sig-err)', label: ['窗内翻转 → 该位不确定（?）', 'switches inside the aperture → bit uncertain (?)'] },
      ]);
      const read = W.readout([
        { key: 'k', label: ['不确定位数 k', 'Uncertain bits k'] },
        { key: 'n', label: ['可能的捕获码 2^k', 'Possible captures 2^k'] },
        { key: 'ok', label: ['旧/新/相邻', 'old / new / adjacent'] },
        { key: 'ill', label: ['非法码（可检测）', 'illegal (detectable)'] },
        { key: 'bad', label: ['静默错码', 'silent wrong'] },
      ]);
      const enumHost = W.h('div', { class: 'lse-tblw' });
      const decHost = W.h('div');

      root.append(
        presetRow,
        W.controls(ctl.M, ctl.enc),
        W.controls(ctl.q, ctl.span, ctl.oh),
        W.controls(ctl.hi),
        W.h('div', { class: 'lse-h' }, W.L('状态序列与每次跳变的汉明距离（下划线 = 到下一状态会翻转的位；颜色 = 该跳变中采样的最坏结果；点击行选跳变）', 'State sequence and Hamming distance per transition (underlined = bits that flip to the next state; colour = worst capture outcome for that transition; click a row to select it)')),
        seqHost,
        W.h('div', { class: 'lse-h' }, W.L('在跳变中采样（一个具体的逐位离散实现）', 'Sampling during the transition (one concrete per-bit skew realisation)')),
        W.controls(play, ctl.ts, ctl.skew, reBtn),
        waveHost, legendWave,
        read.el,
        W.h('div', { class: 'lse-h' }, W.L('全部可能的捕获码与解码（覆盖所有逐位离散与旧/新解析；● = 当前 t_s 可达；点击行查看解码）', 'Every possible capture and its decoding (over all skews and old/new resolutions; ● = reachable at the current t_s; click a row to inspect the decoder)')),
        enumHost,
        decHost,
        W.note(['要点：一位变化的 Gray/Johnson 状态只约束数字码的相邻性——在一次跳变中采样只会得到旧值或新值（或 Johnson 的可检测非法码），而二进制 3→4、7→0 这类多位跳变可以得到任意码。但这不消除采样触发器的模拟亚稳态风险，也不替代 epoch 一致性：在组边界处，与低位一起解码的高位 LSB 若来自另一 epoch，仍会出现 ±M 撕裂；one-hot/移位状态需要合法性检查，否则未检查的编码器可能把非法码静默读成错值。因此验收分两层：数字模型证明不存在静默错码；晶体管/PVT 模型另行评估亚稳态传播、决策延迟与剩余失效率。',
          'Key point: a single-bit-change Gray/Johnson state only constrains digital code adjacency — sampling during one transition returns the old or the new value (or, for Johnson, a detectable illegal code), whereas multi-bit binary transitions such as 3→4 and 7→0 can return any code. That does not remove the analog metastability risk of the sampling flip-flop, nor replace epoch consistency: at the group boundary a high LSB decoded together with the low state still tears by ±M if it comes from another epoch; a one-hot/shift state needs a legality check, or an unchecked encoder can silently read an illegal code as a wrong value. Hence two-layer acceptance: the digital model proves that no silent wrong code exists; transistor/PVT models separately evaluate metastability propagation, decision delay and the residual failure rate.'], 'good'),
        W.note(['理想化示意模型：逐位翻转时刻为随机抽取的离散（每次可重抽），窗内翻转的位可解析为旧值或新值；不建模亚稳态解析时间。OR 型 one-hot→二进制编码器是通用示意，不是 Xu/Lindfors 专利的真值表（§4.2 只说明其高速移位状态在采样后由 4-to-2 encoder 恢复，部分实施方式用高位 LSB 参与解码）。',
          'Idealized illustration: per-bit switching times are drawn skews (re-drawable); a bit switching inside the aperture may resolve old or new; metastability resolution time is not modelled. The OR-type one-hot→binary encoder is a generic illustration, not the Xu/Lindfors patent truth table (§4.2 only states that its high-speed shift state is recovered by a 4-to-2 encoder after sampling, with the high-counter LSB taking part in decoding in some embodiments).'], 'warn'),
      );

      // ---------------------------------------------------------------- drawing
      let raf = 0;
      function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
      const vw = () => Math.round(W.clamp(root.clientWidth || 700, 340, 760));
      let lastSig = '';

      // per-bit captured value at t_s: returns {val (number with known bits), unc mask}
      function captureAt(R) {
        const span = S.span, nb = R.nb;
        let val = 0, unc = 0, cUnc = 0, cVal = C_OLD & 1;
        const swT = (b, j) => j + D0 + S.skew * skewU[b % skewU.length];
        for (let b = 0; b < nb; b++) {
          let v = (R.codes[0] >> b) & 1, u = false;
          for (let j = 0; j < span; j++) {
            const flips = ((R.codes[j] ^ R.codes[j + 1]) >> b) & 1;
            if (!flips) continue;
            const t = swT(b, j);
            if (t > S.ts - TSU && t < S.ts + TH) u = true;
            else if (t <= S.ts - TSU) v ^= 1;
          }
          if (u) unc |= 1 << b; else val |= v << b;
        }
        if (R.cmask) {
          for (const j of R.wraps) {
            const t = j + D0 + S.skew * skewU[8];
            if (t > S.ts - TSU && t < S.ts + TH) cUnc = 1; else if (t <= S.ts - TSU) cVal ^= 1;
          }
        }
        return { val, unc, cVal, cUnc, swT };
      }

      function draw() {
        const M = S.M;
        const R = enumerate(S.enc, M, S.q, S.span, S.hi, S.oh === 'checked');
        const cap = captureAt(R);
        drawWave(R, cap);
        // reachable set at the current t_s
        const reach = (o) => ((o.low & ~cap.unc) === (cap.val & ~cap.unc)) && (!R.cmask || cap.cUnc || o.c0 === cap.cVal);
        const nOk = R.out.filter((o) => SEV[o.cls] === 0).length, nIll = R.out.filter((o) => o.cls === 'illegal' || o.cls === 'or-ok').length, nBad = R.out.filter((o) => SEV[o.cls] === 2).length;
        read.set('k', String(R.k)); read.set('n', String(R.out.length)); read.set('ok', String(nOk)); read.set('ill', String(nIll)); read.set('bad', String(nBad));
        const reachIdx = R.out.map((o, i) => (reach(o) ? i : -1)).filter((i) => i >= 0);
        const sig = JSON.stringify([S.M, S.enc, S.q, S.span, S.hi, S.oh, S.insp, reachIdx]);
        if (sig !== lastSig) { lastSig = sig; drawSeq(); drawEnum(R, reachIdx); drawDecoder(R); }
      }

      function drawSeq() {
        const M = S.M;
        const results = {};
        for (const id of ENC_IDS) results[id] = [];
        for (let q = 0; q < M; q++) for (const id of ENC_IDS) results[id].push(enumerate(id, M, q, S.span, S.hi, S.oh === 'checked'));
        const tb = W.h('tbody');
        for (let q = 0; q < M; q++) {
          const tr = W.h('tr', { class: 'click' + (q === S.q || (S.span === 2 && q === W.mod(S.q + 1, M)) ? ' selrow' : ''), onClick: () => { stop(); S.q = q; ctl.q.value = q; S.insp = null; schedule(); } });
          tr.appendChild(W.h('td', { class: 'code' }, String(q)));
          for (const id of ENC_IDS) {
            const nb = ENC[id].nb(M), c = ENC[id].code(q, M), cn = ENC[id].code(W.mod(q + 1, M), M), tog = c ^ cn;
            const td = W.h('td', { class: 'code' + (id === S.enc ? ' sel' : '') });
            for (let b = nb - 1; b >= 0; b--) td.appendChild((tog >> b) & 1 ? W.h('span', { class: 'tg' }, String((c >> b) & 1)) : document.createTextNode(String((c >> b) & 1)));
            tr.appendChild(td);
            const w = worst(results[id][q]);
            tr.appendChild(W.h('td', { class: 'hd ' + ['good', 'warn', 'bad'][w], title: `${q}→${W.mod(q + 1, M)}` }, String(popcount(tog))));
          }
          tb.appendChild(tr);
        }
        W.clear(seqHost).appendChild(W.h('table', { class: 'lse-tbl' },
          W.h('thead', null, W.h('tr', null, W.h('th', null, 'q'), ...ENC_IDS.flatMap((id) => [W.h('th', { class: id === S.enc ? 'sel' : '' }, W.lbl(ENC[id].name)), W.h('th', { title: 'Hamming distance q → q+1' }, 'HD')]))),
          tb));
      }

      function drawWave(R, cap) {
        const M = S.M, VW = vw(), narrow = VW < 520;
        const PADL = narrow ? 50 : 70, PADR = narrow ? 30 : 40;
        const t0 = -0.5, t1 = S.span + 0.65;
        const x = W.scale([t0, t1], [PADL, VW - PADR]);
        const rows = [];
        if (R.cmask) rows.push({ c0: true });
        for (let b = R.nb - 1; b >= 0; b--) rows.push({ b });
        const rh = R.nb > 4 ? 22 : 28, top = 66;
        const VH = top + rows.length * rh + 30;
        const svg = W.svg(VW, VH);
        // CK0 edges
        const clkY = 20;
        svg.appendChild(W.s('path', { d: W.digitalPath(W.clockEdges(1, 0, t0, t1), 0, x, clkY - 8, clkY + 8, t0, t1), fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': 1.8 }));
        svg.appendChild(W.s('text', { x: 6, y: clkY + 4, class: 'lbl' }, 'CK₀'));
        for (let j = 0; j < S.span; j++) {
          svg.appendChild(W.s('line', { x1: x(j), x2: x(j), y1: clkY + 10, y2: VH - 22, class: 'grid', style: 'stroke-dasharray:3 3' }));
          svg.appendChild(W.s('text', { x: x(j) + 3, y: VH - 24, class: 'mono', style: 'font-size:9.5px' }, `${R.seq[j]}→${R.seq[j + 1]}`));
        }
        // aperture
        svg.appendChild(W.s('rect', { x: x(S.ts - TSU), y: top - 14, width: Math.max(2, x(S.ts + TH) - x(S.ts - TSU)), height: rows.length * rh + 8, style: 'fill:var(--sig-ref);fill-opacity:.22' }));
        svg.appendChild(W.s('line', { x1: x(S.ts), x2: x(S.ts), y1: top - 16, y2: top + rows.length * rh - 4, style: 'stroke:var(--sig-ref);stroke-width:1.8' }));
        svg.appendChild(W.s('text', { x: x(S.ts), y: top - 20, 'text-anchor': 'middle', style: 'font-size:10.5px;font-weight:650;fill:var(--fg)' }, 't_s'));
        rows.forEach((r, i) => {
          const y = top + i * rh, hiY = y - rh / 2 + 5, loY = y + rh / 2 - 5;
          let v0, edges = [], unc, capV;
          if (r.c0) {
            v0 = C_OLD & 1; let v = v0;
            for (const j of R.wraps) { v ^= 1; edges.push({ t: j + D0 + S.skew * skewU[8], v }); }
            unc = cap.cUnc; capV = cap.cVal;
          } else {
            v0 = (R.codes[0] >> r.b) & 1;
            for (let j = 0; j < S.span; j++) {
              const nv = (R.codes[j + 1] >> r.b) & 1, pv = (R.codes[j] >> r.b) & 1;
              if (nv !== pv) edges.push({ t: cap.swT(r.b, j), v: nv });
            }
            unc = (cap.unc >> r.b) & 1; capV = (cap.val >> r.b) & 1;
          }
          const color = r.c0 ? 'var(--sig-high)' : 'var(--sig-low)';
          svg.appendChild(W.s('text', { x: 6, y: y + 4, class: 'lbl mono', style: 'font-size:10.5px' }, r.c0 ? 'c₀' : `b${r.b}`));
          svg.appendChild(W.s('path', { d: W.digitalPath(edges, v0, x, hiY, loY, t0, t1), fill: 'none', stroke: color, 'stroke-width': 1.7 }));
          for (const e of edges) {
            const inAp = e.t > S.ts - TSU && e.t < S.ts + TH;
            if (inAp) svg.appendChild(W.s('circle', { cx: x(e.t), cy: y, r: 4, style: 'fill:none;stroke:var(--sig-err);stroke-width:1.8' }));
          }
          svg.appendChild(W.s('text', { x: VW - PADR + 8, y: y + 4.5, class: 'mono', style: `font-size:12px;font-weight:700;fill:${unc ? 'var(--sig-err)' : 'var(--fg)'}` }, unc ? '?' : String(capV)));
        });
        svg.appendChild(W.sL('采到', 'got', { x: VW - PADR + 6, y: top - 20, style: 'font-size:10px' }));
        // time axis
        const yA = VH - 14;
        svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: yA, y2: yA, class: 'axis' }));
        for (let k = Math.ceil(t0 * 2) / 2; k <= t1; k += 0.5) {
          svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: yA, y2: yA + 3, class: 'axis' }));
          if (Number.isInteger(k)) svg.appendChild(W.s('text', { x: x(k), y: yA + 13, 'text-anchor': 'middle', style: 'font-size:10px' }, String(k)));
        }
        svg.appendChild(W.sL('t / T₀', 't / T₀', { x: 6, y: yA + 4, style: 'font-size:10px' }));
        W.clear(waveHost).appendChild(svg);
      }

      function drawEnum(R, reachIdx) {
        const M = S.M;
        const tb = W.h('tbody');
        if (S.insp == null || S.insp >= R.out.length) {
          const iBad = R.out.findIndex((o) => SEV[o.cls] === 2), iIll = R.out.findIndex((o) => SEV[o.cls] === 1);
          S.insp = iBad >= 0 ? iBad : iIll >= 0 ? iIll : 0;
        }
        R.out.forEach((o, i) => {
          const cell = W.h('td', { class: 'code' });
          if (R.cmask) { cell.appendChild(W.h('span', { class: 'un' }, String(o.c0))); cell.appendChild(document.createTextNode('│')); }
          else if (S.hi) cell.appendChild(document.createTextNode((C_OLD & 1) + '│'));
          for (let b = R.nb - 1; b >= 0; b--) {
            const ch = String((o.low >> b) & 1);
            cell.appendChild((R.mask >> b) & 1 ? W.h('span', { class: 'un' }, ch) : document.createTextNode(ch));
          }
          const [kind, lab] = CLS[o.cls];
          const decTxt = o.legal ? String(o.dec) : o.viaOr ? `OR→${o.dec}` : '—';
          const tr = W.h('tr', { class: 'click' + (i === S.insp ? ' insp' : ''), onClick: () => { S.insp = i; lastSig = ''; schedule(); } },
            cell,
            W.h('td', null, o.legal ? W.L('合法', 'legal') : W.L('非法', 'illegal')),
            W.h('td', { class: 'code' }, decTxt),
            S.hi ? W.h('td', { class: 'code' }, o.N != null ? String(o.N) : '—') : null,
            W.h('td', { class: 'cls' }, W.status(kind, lab)),
            W.h('td', { class: 'now' }, reachIdx.includes(i) ? '●' : ''));
          tb.appendChild(tr);
        });
        const nSeq = S.hi ? R.Nseq.map((n) => n).join(' → ') : R.seq.join(' → ');
        W.clear(enumHost).appendChild(W.h('table', { class: 'lse-tbl' },
          W.h('thead', null,
            W.h('tr', null, W.h('th', { colspan: S.hi ? 6 : 5 }, W.L(`${ENC[S.enc].name[0]}，M = ${M}，合法序列 ${nSeq}`, `${ENC[S.enc].name[1]}, M = ${M}, legal sequence ${nSeq}`))),
            W.h('tr', null, W.h('th', null, S.hi ? W.L('c₀│低位码', 'c₀│low code') : W.L('捕获码', 'captured code')), W.h('th', null, W.L('合法？', 'legal?')), W.h('th', null, 'q'), S.hi ? W.h('th', null, 'N') : null, W.h('th', null, W.L('结果', 'outcome')), W.h('th', null, 't_s'))),
          tb));
      }

      function drawDecoder(R) {
        const M = S.M, o = R.out[S.insp] || R.out[0];
        W.clear(decHost);
        const box = W.h('div', { class: 'lse-dec' });
        decHost.appendChild(W.h('div', { class: 'lse-h' }, W.L('解码器', 'Decoder'), W.h('span', { class: 'code', style: { fontFamily: 'var(--mono)', fontWeight: 400 } }, W.L(`检查：${bits(o.low, R.nb)}`, `inspecting: ${bits(o.low, R.nb)}`))));
        decHost.appendChild(box);
        if (S.enc === 'bin') {
          box.append(W.L('二进制：q 就是码本身，每个码都合法——多位跳变中采到的错码无法被检出。', 'Binary: q is the code itself and every code is legal — a wrong code captured mid-transition cannot be detected.'),
            W.h('div', { class: 'tex' }, W.tex(`q=${bits(o.low, R.nb)}_2=${o.low}`, true)));
        } else if (S.enc === 'gray') {
          const n = R.nb; let b = 0, steps = []; let prev = 0;
          for (let i = n - 1; i >= 0; i--) { const g = (o.low >> i) & 1; prev = i === n - 1 ? g : prev ^ g; b |= prev << i; steps.push(`b_${i}&=${i === n - 1 ? `g_${i}` : `b_${i + 1}\\oplus g_${i}`}=${prev}`); }
          box.append(W.L('Gray→二进制：最高位直通，其余逐位异或（每个码都合法）。', 'Gray→binary: MSB passes through, the rest is an XOR chain (every code is legal).'),
            W.h('div', { class: 'tex' }, W.tex(`\\begin{aligned}${steps.join('\\\\')}\\end{aligned}\\ \\Rightarrow\\ q=${b}`, true)));
        } else if (S.enc === 'john') {
          const nIll = (1 << R.nb) - M;
          box.append(W.L(`Johnson：在 ${M} 个合法码中查表；其余 ${nIll} 个码判为 encoding_invalid。`, `Johnson: look up the ${M} legal codes; the other ${nIll} codes are flagged encoding_invalid.`),
            W.h('div', { class: 'tex' }, W.tex(o.legal ? `${bits(o.low, R.nb)}\\ \\mapsto\\ q=${o.dec}` : `${bits(o.low, R.nb)}\\ \\notin\\ \\text{legal set}\\ \\Rightarrow\\ \\texttt{encoding\\_invalid}`, true)));
        } else {
          box.append(W.L(`one-hot → 二进制（${M}-to-${Math.log2(M)}）：输出位 b_j = 所有下标第 j 位为 1 的输入之 OR；合法性检查要求恰有一个 1。x₀ 不连到任何 OR 门，所以全 0 码与 x₀ 读数相同。`, `one-hot → binary (${M}-to-${Math.log2(M)}): output bit b_j = OR of the inputs whose index has bit j set; the legality check requires exactly one 1. x₀ feeds no OR gate, so the all-zero code reads the same as x₀.`));
          box.appendChild(encoderSvg(o.low, M, S.oh === 'checked'));
        }
        if (S.hi) box.appendChild(W.h('div', null, W.L(`N = M·C + q，其中 C 的高位取 ${C_OLD >> 1}…（C = ${C_OLD} → ${C_OLD + 1} 只翻转 LSB），c₀ 与低位同拍捕获；c₀ 与低位若属于不同 epoch，就得到 ±M 的撕裂值（见 torn-capture 模型）。`, `N = M·C + q with the upper bits of C fixed (C = ${C_OLD} → ${C_OLD + 1} only flips the LSB) and c₀ captured in the same word; if c₀ and the low code come from different epochs the result is torn by ±M (see the torn-capture model).`)));
      }

      function encoderSvg(code, M, checked) {
        const nOut = Math.log2(M), VW = Math.min(vw(), 520);
        const rowH = M === 8 ? 19 : 26, top = 14, VH = top + M * rowH + 14;
        const svg = W.svg(VW, VH);
        const slot = (M * rowH) / nOut, xIn = 34, xG = VW * 0.62, gW = 46, gH = Math.min(46, slot - 10);
        const yIn = (i) => top + i * rowH + rowH / 2;
        const gy = (j) => top + j * slot + (slot - gH) / 2;
        const outB = [];
        for (let j = 0; j < nOut; j++) { let v = 0; for (let i = 0; i < M; i++) if ((code >> i) & 1 && (i >> j) & 1) v = 1; outB.push(v); }
        for (let i = 0; i < M; i++) {
          const on = (code >> i) & 1;
          svg.appendChild(W.s('rect', { x: 4, y: yIn(i) - 8, width: 24, height: 16, rx: 3, style: `fill:${on ? 'color-mix(in srgb, var(--sig-sel) 22%, var(--surface))' : 'var(--surface-2)'};stroke:${on ? 'var(--sig-sel)' : 'var(--border-strong)'};stroke-width:1.2` }));
          svg.appendChild(W.s('text', { x: 16, y: yIn(i) + 4, 'text-anchor': 'middle', class: 'mono', style: 'font-size:11px;font-weight:700;fill:var(--fg)' }, String(on)));
          svg.appendChild(W.s('text', { x: xIn, y: yIn(i) + 4, class: 'mono', style: 'font-size:10px' }, `x${i}`));
          let k = 0;
          for (let j = 0; j < nOut; j++) if ((i >> j) & 1) {
            const nIn = M / 2; // inputs per gate
            const idx = [...Array(M).keys()].filter((ii) => (ii >> j) & 1).indexOf(i);
            const py = gy(j) + 5 + (idx * (gH - 10)) / Math.max(1, nIn - 1);
            svg.appendChild(W.s('line', { x1: xIn + 22, y1: yIn(i), x2: xG, y2: py, style: `stroke:${on ? 'var(--sig-sel)' : 'var(--axis)'};stroke-width:${on ? 2 : 1}` }));
            k++;
          }
          if (!k) svg.appendChild(W.s('line', { x1: xIn + 22, y1: yIn(i), x2: xIn + 34, y2: yIn(i), style: 'stroke:var(--axis);stroke-width:1;stroke-dasharray:2 2' }));
        }
        for (let j = 0; j < nOut; j++) {
          const y = gy(j);
          svg.appendChild(W.s('path', { d: `M${xG},${y}Q${xG + 12},${y + gH / 2} ${xG},${y + gH}Q${xG + gW * 0.75},${y + gH} ${xG + gW},${y + gH / 2}Q${xG + gW * 0.75},${y} ${xG},${y}Z`, style: 'fill:var(--surface);stroke:var(--fg-2);stroke-width:1.3' }));
          svg.appendChild(W.s('text', { x: xG + gW * 0.45, y: y + gH / 2 + 4, 'text-anchor': 'middle', style: 'font-size:10px' }, 'OR'));
          svg.appendChild(W.s('line', { x1: xG + gW, y1: y + gH / 2, x2: xG + gW + 22, y2: y + gH / 2, style: `stroke:${outB[j] ? 'var(--sig-sel)' : 'var(--axis)'};stroke-width:${outB[j] ? 2 : 1.2}` }));
          svg.appendChild(W.s('text', { x: xG + gW + 26, y: y + gH / 2 + 4, class: 'mono', style: 'font-size:11px;font-weight:700;fill:var(--fg)' }, `b${j}=${outB[j]}`));
        }
        const val = outB.reduce((a, v, j) => a | (v << j), 0), pc = popcount(code);
        const tail = pc === 1 ? '✓' : checked ? '✗ encoding_invalid' : api.t('（未检查 → 静默）', '(unchecked → silent)');
        svg.appendChild(W.s('text', { x: VW - 6, y: VH - 4, 'text-anchor': 'end', class: 'mono', style: `font-size:11px;font-weight:700;fill:${pc === 1 ? 'var(--good-ink)' : 'var(--critical-ink)'}` }, `q=${val}  popcount=${pc} ${tail}`));
        return W.h('div', { style: { maxWidth: '520px' } }, svg);
      }

      api.onLang(() => { lastSig = ''; schedule(); });
      draw();
      const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { lastSig = ''; schedule(); }) : null;
      if (ro) ro.observe(root);
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      return { destroy() { loop.stop(); if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); } };
    },
  });
})();
