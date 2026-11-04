/* phase-anchor — report §3.3, Eqs. (3)–(6): complete phase Φ0(t_R) = A − μ from a selected physical edge.
 *
 * Idealized behavioural model (NOT a circuit or chip specification; deviations are exaggerated for visibility):
 *   - time t in units of the nominal raw period T̄0 (f̄0 = 1 cycle per T̄0).
 *   - instantaneous raw-clock frequency f0(t) = 1 + δ(t) with δ = 0 | d | d·sin(2πt/Tm) | d·[t ≥ ts].
 *   - continuous unwrapped phase Φ0(t) = Φ0(0) + ∫0^t f0 (closed form) — the ground truth.
 *   - CK0 rising edges where Φ0 crosses an integer J, falling edges at J + ½ (solved numerically, Newton).
 *   - the selected edge is the preceding / following / k-th following edge of REF (time ordering of edge list);
 *     A = J + α with α = ½ when the falling edge is selected (Eq. 3).
 *   - μ = ∫_{tR}^{tE} f0 dt by Gauss–Legendre quadrature (Eq. 4); Φ0(tR) = A − μ (Eq. 5) is compared with the
 *     closed-form ground truth.
 *   - μ̂ = Δt / T̂0 (Eq. 6) with Δt exact (no TDC quantisation) and T̂0 = nominal T̄0 or the last measured period
 *     before REF; |μ̂ − μ| is compared with δf_max·|Δt|, δf_max = max |f0 − 1/T̂0| over the interval.
 */
(function () {
  'use strict';
  const PHI00 = 100.3; // Φ0(0): arbitrary absolute origin so that edge indices look like a running counter
  const GLX = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498, 0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
  const GLW = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620, 0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
  const CSS = `
.pa-sub { margin: 14px 0 4px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.pa-eqs { margin-top: 10px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: .82rem; color: var(--fg-2); }
.pa-eqs .ln { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; padding: 3px 0; }
.pa-eqs .ln + .ln { border-top: 1px dashed var(--border); }
.pa-eqs .tx { overflow-x: auto; overflow-y: hidden; max-width: 100%; padding: 2px 0; }
.pa-eqs .tag { font-size: .72rem; color: var(--muted); white-space: nowrap; }
.pa-presets { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin-bottom: 10px; }
.pa-presets .k { font-size: .75rem; color: var(--muted); margin-right: 2px; }
.pa .w-seg { flex-wrap: wrap; }
.pa .w-seg button { white-space: nowrap; }
.pa .w-ctl { flex-wrap: wrap; }
.w-svg text.pa-halo { paint-order: stroke; stroke: var(--surface); stroke-width: 3.5px; stroke-linejoin: round; }
.pa-mx .katex { font-size: 1.08em; }
.pa-flag { display: inline-block; font-size: .72rem; font-weight: 650; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: 999px; padding: 0 8px; margin-left: 4px; }
`;
  let uid = 0;
  const fm = (v, d = 4) => W.fmt(v, d).replace('-', '−');
  const tx = (v, d = 4) => { const s = W.fmt(v, d); return s.startsWith('-') ? '-' + s.slice(1) : s; };
  /** label mixing KaTeX and bilingual text */
  const mx = (src, zh, en) => W.h('span', { class: 'pa-mx' }, W.tex(src), zh || en ? W.L(zh || '', en || '') : null);
  const sci = (v) => (v === 0 ? '0' : Math.abs(v) < 1e-6 ? v.toExponential(1).replace('-', '−') : fm(v, 6));

  // ------------------------------------------------------------------ model (DOM-free)
  function model(P) {
    const d = P.prof === 'const' ? 0 : P.dev;
    const w = (2 * Math.PI) / P.Tm;
    const delta = (t) => (P.prof === 'offset' ? d : P.prof === 'fm' ? d * Math.sin(w * t) : P.prof === 'step' ? (t >= P.ts ? d : 0) : 0);
    const f = (t) => 1 + delta(t);
    const phi = (t) => PHI00 + t + (P.prof === 'offset' ? d * t : P.prof === 'fm' ? (d / w) * (1 - Math.cos(w * t)) : P.prof === 'step' ? d * Math.max(0, t - P.ts) : 0);
    /** time where Φ0 crosses level y (Φ0 strictly increasing since f0 ≥ 0.85) */
    function edgeTime(y) {
      let t = y - PHI00;
      for (let i = 0; i < 80; i++) { const e = phi(t) - y; if (Math.abs(e) < 1e-13) break; t -= e / f(t); }
      return t;
    }
    /** signed ∫_a^b f0 dt, Gauss–Legendre on sub-intervals ≤ 0.25 T̄0, split at discontinuities */
    function integ(a, b) {
      if (a === b) return 0;
      const s = b < a ? -1 : 1, lo = Math.min(a, b), hi = Math.max(a, b);
      const cuts = [lo];
      if (P.prof === 'step' && P.ts > lo && P.ts < hi) cuts.push(P.ts);
      cuts.push(hi);
      let sum = 0;
      for (let c = 0; c + 1 < cuts.length; c++) {
        const A = cuts[c], B = cuts[c + 1], n = Math.max(1, Math.ceil((B - A) / 0.25)), h = (B - A) / n;
        for (let j = 0; j < n; j++) {
          const m = A + (j + 0.5) * h, r = h / 2;
          for (let g = 0; g < 8; g++) sum += GLW[g] * r * f(m + r * GLX[g]);
        }
      }
      return s * sum;
    }
    /** max |f0(t) − c| over [a,b]: f0 extrema are at the ends, at the step, or at the sine peaks */
    function maxDev(a, b, c) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const pts = [lo, hi];
      if (P.prof === 'step' && P.ts > lo && P.ts < hi) pts.push(P.ts - 1e-9, P.ts + 1e-9);
      if (P.prof === 'fm') for (let m = Math.ceil((lo * w) / Math.PI - 0.5); (Math.PI * (m + 0.5)) / w <= hi; m++) pts.push((Math.PI * (m + 0.5)) / w);
      return Math.max(...pts.map((t) => Math.abs(f(t) - c)));
    }
    return { d, f, phi, edgeTime, integ, maxDev, w };
  }

  /** Evaluate the selected-edge reconstruction for selection offset `off` (0 = preceding, k ≥ 1 = k-th following). */
  function evaluate(P, m, off) {
    const al = P.alpha ? 0.5 : 0;
    const phR = m.phi(P.tR);
    // preceding selected-type edge from the physical edge-time list (time ordering, not from Φ directly)
    let n = Math.floor(phR - al) + 1;
    while (m.edgeTime(n + al) > P.tR) n--;
    const J = n + off, A = J + al, tE = m.edgeTime(A);
    const dt = tE - P.tR;
    const mu = m.integ(P.tR, tE); // Eq. (4)
    const recon = A - mu; // Eq. (5)
    // T̂0: nominal, or the last measured raw period (two most recent rising edges at/before REF)
    let That = 1;
    if (P.est === 'local') { let r = Math.floor(phR) + 1; while (m.edgeTime(r) > P.tR) r--; That = m.edgeTime(r) - m.edgeTime(r - 1); }
    const muHat = dt / That; // Eq. (6)
    const err = muHat - mu;
    const dfmax = m.maxDev(P.tR, tE, 1 / That);
    const bound = dfmax * Math.abs(dt);
    return { J, A, al, tE, dt, mu, phR, recon, idErr: recon - phR, That, muHat, err, dfmax, bound, ok: Math.abs(err) <= bound * (1 + 1e-9) + 1e-12 };
  }

  Book.registerWidget({
    id: 'phase-anchor',
    group: 'phase',
    title: { zh: '完整相位锚点：Φ₀(t_R) = A − μ 与周期归一化误差', en: 'Complete-phase anchor: Φ₀(t_R) = A − μ and the period-normalisation error' },
    summary: {
      zh: '原时钟相位 Φ₀(t) 是频率的积分，CK₀ 上升沿出现在 Φ₀ 穿过整数处。任选 REF 时刻与被选边沿（前一沿 / 后继沿 / 第 k 个后继沿 / 下降沿），按式 (4) 数值积分得到带符号的 μ，按式 (5) 复原 Φ₀(t_R) 并与真值比对；再看式 (6) 的 Δt/T̂₀ 近似在频偏、调频、阶跃和长间隔下误差如何增长。',
      en: 'The raw-clock phase Φ₀(t) is the integral of frequency; CK₀ rising edges occur where Φ₀ crosses an integer. Pick a REF instant and the selected edge (preceding / following / k-th following / falling edge), integrate Eq. (4) numerically for the signed μ, rebuild Φ₀(t_R) with Eq. (5) and compare with the ground truth; then watch how the Δt/T̂₀ approximation of Eq. (6) degrades with offset, FM, a step and long intervals.',
    },
    sections: ['r-3-3'],
    eqs: ['3', '4', '5', '6'],
    keywords: ['phase anchor', 'selected edge', 'preceding edge', 'following edge', 'μ', 'Φ0', '完整相位', '被选边沿', '归一化', 'δf_max'],
    mount(root, api) {
      if (!document.getElementById('pa-css')) { const s = document.createElement('style'); s.id = 'pa-css'; s.textContent = CSS; document.head.appendChild(s); }
      root.classList.add('pa');
      const clipId = 'pa-clip-' + (++uid);
      const P = { prof: 'fm', dev: 0.08, Tm: 9, ts: 4, tR: 2.37, sel: 'kth', k: 4, alpha: false, est: 'nom' };
      const TR_MIN = 1, TR_MAX = 5;
      let dir = 1, raf = 0;

      // ---------------------------------------------------------------- controls
      const loop = api.loop((dt) => {
        let v = P.tR + dir * dt * 0.32;
        if (v > TR_MAX) { v = TR_MAX; dir = -1; }
        if (v < TR_MIN) { v = TR_MIN; dir = 1; }
        P.tR = v; ctl.tR.value = +v.toFixed(2); draw();
      });
      const play = W.playButton(loop, api);
      const ctl = {};
      const upd = () => { syncVis(); request(); };
      ctl.prof = W.seg({ label: ['频率行为', 'Frequency behaviour'], value: P.prof, options: [
        { value: 'const', label: ['恒频 f̄₀', 'Constant f̄₀'] }, { value: 'offset', label: ['恒定频偏', 'Offset'] },
        { value: 'fm', label: ['慢调频', 'Slow FM'] }, { value: 'step', label: ['频率阶跃', 'Step'] }], onChange: (v) => { P.prof = v; upd(); } });
      ctl.dev = W.slider({ label: ['相对偏差 d', 'Relative deviation d'], min: -0.15, max: 0.15, step: 0.005, value: P.dev, fmt: (v) => (v >= 0 ? '+' : '−') + W.fmt(Math.abs(v) * 100, 1) + '%', onInput: (v) => { P.dev = v; request(); } });
      ctl.Tm = W.slider({ label: ['调制周期 T_m', 'Modulation period T_m'], min: 4, max: 24, step: 0.5, value: P.Tm, fmt: (v) => W.fmt(v, 1) + ' T̄₀', onInput: (v) => { P.Tm = v; request(); } });
      ctl.ts = W.slider({ label: ['阶跃时刻 t_s', 'Step time t_s'], min: 0, max: 14, step: 0.1, value: P.ts, fmt: (v) => W.fmt(v, 1) + ' T̄₀', onInput: (v) => { P.ts = v; request(); } });
      ctl.tR = W.slider({ label: ['REF 时刻 t_R', 'REF instant t_R'], min: TR_MIN, max: TR_MAX, step: 0.01, value: P.tR, fmt: (v) => W.fmt(v, 2) + ' T̄₀', onInput: (v) => { P.tR = v; request(); } });
      ctl.sel = W.seg({ label: ['被选边沿', 'Selected edge'], value: P.sel, options: [
        { value: 'prev', label: ['前一沿', 'Preceding'] }, { value: 'next', label: ['后继沿', 'Following'] }, { value: 'kth', label: ['第 k 个后继沿', 'k-th following'] }], onChange: (v) => { P.sel = v; upd(); } });
      ctl.k = W.slider({ label: 'k', min: 2, max: 8, step: 1, value: P.k, fmt: (v) => String(v), onInput: (v) => { P.k = v; request(); } });
      ctl.alpha = W.toggle({ label: ['选下降沿（α = ½）', 'Select falling edge (α = ½)'], value: P.alpha, onChange: (v) => { P.alpha = v; request(); } });
      ctl.est = W.seg({ label: ['式 (6) 的 T̂₀', 'T̂₀ in Eq. (6)'], value: P.est, options: [
        { value: 'nom', label: ['名义周期 T̄₀', 'Nominal T̄₀'] }, { value: 'local', label: ['局部估计（上一周期）', 'Local (last period)'] }], onChange: (v) => { P.est = v; request(); } });
      function syncVis() {
        ctl.dev.style.display = P.prof === 'const' ? 'none' : '';
        ctl.Tm.style.display = P.prof === 'fm' ? '' : 'none';
        ctl.ts.style.display = P.prof === 'step' ? '' : 'none';
        ctl.k.style.display = P.sel === 'kth' ? '' : 'none';
      }
      const PRESETS = [
        { label: ['理想恒频', 'Ideal constant f₀'], p: { prof: 'const', dev: 0, sel: 'next', k: 2, alpha: false, est: 'nom', tR: 2.37 } },
        { label: ['前一沿：μ < 0', 'Preceding edge: μ < 0'], p: { prof: 'offset', dev: 0.03, sel: 'prev', k: 2, alpha: false, est: 'nom', tR: 2.62 } },
        { label: ['下降沿 α = ½', 'Falling edge α = ½'], p: { prof: 'offset', dev: 0.03, sel: 'next', k: 2, alpha: true, est: 'nom', tR: 2.37 } },
        { label: ['恒定频偏 + 第 8 个后继沿', 'Offset + 8th following edge'], p: { prof: 'offset', dev: -0.04, sel: 'kth', k: 8, alpha: false, est: 'nom', tR: 1.6 } },
        { label: ['慢调频 + 局部估计', 'Slow FM + local estimate'], p: { prof: 'fm', dev: 0.1, Tm: 8, sel: 'kth', k: 6, alpha: false, est: 'local', tR: 1.4 } },
        { label: ['间隔内频率阶跃', 'Step inside the interval'], p: { prof: 'step', dev: 0.08, ts: 4, sel: 'kth', k: 5, alpha: false, est: 'local', tR: 2.6 } },
      ];
      function applyPreset(p) {
        Object.assign(P, p);
        ctl.prof.value = P.prof; ctl.dev.value = P.dev; ctl.Tm.value = P.Tm; ctl.ts.value = P.ts; ctl.tR.value = P.tR;
        ctl.sel.value = P.sel; ctl.k.value = P.k; ctl.alpha.value = P.alpha; ctl.est.value = P.est;
        upd();
      }
      const presetRow = W.h('div', { class: 'pa-presets' }, W.h('span', { class: 'k' }, W.L('场景：', 'Scenarios:')), PRESETS.map((pr) => W.button(pr.label, () => applyPreset(pr.p))));

      const legend = W.legend([
        { color: 'var(--sig-clk)', label: ['CK₀ / Φ₀(t) / f₀(t)', 'CK₀ / Φ₀(t) / f₀(t)'] },
        { color: 'var(--sig-ref)', label: ['REF 时刻 t_R', 'REF instant t_R'] },
        { color: 'var(--sig-sel)', label: ['被选边沿 t_E 与精确 μ（面积）', 'Selected edge t_E and exact μ (area)'] },
        { color: 'var(--sig-fine)', dash: true, label: mx('\\widehat\\mu=\\Delta t/\\widehat T_0,\\ \\widehat f_0=1/\\widehat T_0', ' 近似', ' approximation') },
        { color: 'var(--sig-err)', label: mx('\\widehat\\mu-\\mu', ' 误差', ' error') },
      ]);
      const svgHost = W.h('div');
      const read = W.readout([
        { key: 'J', label: ['被选沿 J，A = J + α（式 3）', 'Selected J, A = J + α (Eq. 3)'] },
        { key: 'dt', label: ['Δt = t_E − t_R', 'Δt = t_E − t_R'] },
        { key: 'mu', label: ['精确 μ（式 4）', 'Exact μ (Eq. 4)'] },
        { key: 'rec', label: ['A − μ（式 5）', 'A − μ (Eq. 5)'] },
        { key: 'true', label: ['真值 Φ₀(t_R)', 'Ground truth Φ₀(t_R)'] },
        { key: 'mh', label: mx('\\widehat\\mu=\\Delta t/\\widehat T_0', '（式 6）', ' (Eq. 6)') },
        { key: 'err', label: mx('|\\widehat\\mu-\\mu|') },
        { key: 'bnd', label: ['上界 δf_max·|Δt|', 'Bound δf_max·|Δt|'] },
      ]);
      const eqBox = W.h('div', { class: 'pa-eqs' });
      const errHost = W.h('div');
      root.append(
        W.controls(play, ctl.tR),
        presetRow,
        W.controls(ctl.prof, ctl.dev, ctl.Tm, ctl.ts),
        W.controls(ctl.sel, ctl.k, ctl.alpha),
        W.controls(ctl.est),
        legend, svgHost, read.el, eqBox,
        W.h('div', { class: 'pa-sub' }, W.L('误差随被选边沿间隔的增长（当前参数，逐个选择计算）', 'Error growth with the selected-edge interval (current parameters, every selection evaluated)')),
        errHost,
        W.note(['要点：式 (5) Φ₀(t_R) = A − μ 对前一沿、后继沿或更远的边沿同样成立；μ 的符号由式 (4) 的积分上下限决定（选前一沿时 μ < 0），不需要未定义的“±TDC”约定。式 (6) 用单一周期 T̂₀ 归一化只在间隔内近似恒频时成立，误差满足 |δμ| ≤ δf_max|Δt| 并随间隔增长——过长的 selected-edge 间隔不宜仅靠固定周期归一化。',
          'Key point: Eq. (5) Φ₀(t_R) = A − μ holds equally for the preceding, the following or a more distant edge; the sign of μ comes from the limits of the integral in Eq. (4) (μ < 0 for a preceding edge), so no undefined "±TDC" convention is needed. Normalising with a single period T̂₀ (Eq. 6) is valid only if the frequency is roughly constant over the interval; the error obeys |δμ| ≤ δf_max|Δt| and grows with the interval — an overly long selected-edge interval should not rely on fixed-period normalisation alone.'], 'good'),
        W.note(['理想化示意模型：时间以名义周期 T̄₀ 为单位，频偏/调频幅度被放大以便观察；Δt 视为精确测得（未含 TDC 量化、非线性与噪声），Φ₀(0) 取任意原点。不是论文数据或芯片指标。',
          'Idealized illustration: time in units of the nominal period T̄₀; offset/FM amplitudes are exaggerated for visibility; Δt is taken as exactly measured (no TDC quantisation, nonlinearity or noise); Φ₀(0) is an arbitrary origin. Not data from the cited papers and not a chip specification.'], 'warn'),
      );

      // ---------------------------------------------------------------- drawing
      function request() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

      function draw() {
        const m = model(P);
        const off = P.sel === 'prev' ? 0 : P.sel === 'next' ? 1 : P.k;
        const R = evaluate(P, m, off);
        drawMain(m, R);
        drawReadouts(R);
        drawErr(m, off);
      }

      function drawMain(m, R) {
        const VW = Math.round(W.clamp(root.clientWidth || 700, 320, 760)), narrow = VW < 540;
        const PADL = narrow ? 40 : 54, PADR = 12;
        const lo = Math.min(P.tR, R.tE), hi = Math.max(P.tR, R.tE);
        let t0, t1;
        if (narrow) { t0 = Math.max(0, lo - 1.1); t1 = Math.max(t0 + 5, hi + 0.8); }
        else { t0 = 0; t1 = Math.max(14, hi + 0.8); }
        const x = W.scale([t0, t1], [PADL, VW - PADR]);
        const pxPer = x(1) - x(0);
        const yCkH = 22, yCkL = 44, yDt = 60;
        const phTop = 82, phH = narrow ? 140 : 160, phBot = phTop + phH;
        const fTop = phBot + 24, fH = narrow ? 92 : 104, fBot = fTop + fH;
        const VH = fBot + 34;
        const svg = W.svg(VW, VH);
        svg.appendChild(W.s('defs', null, W.s('clipPath', { id: clipId }, W.s('rect', { x: PADL, y: phTop, width: VW - PADL - PADR, height: phH }))));

        // time grid
        for (let k = Math.ceil(t0); k <= t1; k++) svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: phTop, y2: fBot, class: 'grid' }));

        // ---- CK0 waveform from Φ0 crossings
        const nA = Math.floor(m.phi(t0)) - 1, nB = Math.ceil(m.phi(t1)) + 1;
        const edges = [], rising = [];
        for (let n = nA; n <= nB; n++) {
          const tr = m.edgeTime(n), tf = m.edgeTime(n + 0.5);
          edges.push({ t: tr, v: 1 }, { t: tf, v: 0 });
          if (tr >= t0 && tr <= t1) rising.push({ n, t: tr });
        }
        const v0 = W.mod(m.phi(t0), 1) < 0.5 ? 1 : 0;
        svg.appendChild(W.s('path', { d: W.digitalPath(edges, v0, x, yCkH, yCkL, t0, t1), fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
        svg.appendChild(W.s('text', { x: 4, y: (yCkH + yCkL) / 2 + 4, class: 'lbl' }, 'CK₀'));
        const every = pxPer >= 26 ? 1 : pxPer >= 13 ? 2 : 5;
        for (const e of rising) {
          const isSel = !R.al && e.n === R.J;
          if (!isSel && W.mod(e.n, every) !== 0) continue;
          if (!isSel && R.al === 0 && Math.abs(e.n - R.J) < every && e.n !== R.J) continue;
          svg.appendChild(W.s('text', { x: x(e.t), y: 13, 'text-anchor': 'middle', class: 'mono', style: `font-size:10px;${isSel ? 'fill:var(--fg);font-weight:700' : ''}` }, String(e.n)));
        }
        if (R.al) svg.appendChild(W.s('text', { x: x(R.tE), y: 13, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10px;fill:var(--fg);font-weight:700' }, `${R.J}+½`));
        svg.appendChild(W.sL('沿号 J', 'edge J', { x: 4, y: 13, style: 'font-size:10px' }));

        // ---- REF and selected-edge cursors
        const xR = x(P.tR), xE = x(R.tE);
        svg.appendChild(W.s('line', { x1: xR, x2: xR, y1: 4, y2: fBot, stroke: 'var(--sig-ref)', 'stroke-width': 1.6 }));
        svg.appendChild(W.s('line', { x1: xE, x2: xE, y1: 4, y2: fBot, stroke: 'var(--sig-sel)', 'stroke-width': 1.6, 'stroke-dasharray': '5 3' }));
        svg.appendChild(W.s('circle', { cx: xE, cy: R.al ? yCkL : yCkH, r: 3.5, fill: 'var(--sig-sel)' }));
        // Δt bracket
        const dir2 = R.tE >= P.tR ? 1 : -1;
        svg.appendChild(W.s('path', { d: `M${xR},${yDt - 4}V${yDt + 4}M${xR},${yDt}H${xE}M${xE},${yDt - 4}V${yDt + 4}`, stroke: 'var(--fg-2)', 'stroke-width': 1.2, fill: 'none' }));
        svg.appendChild(W.s('path', { d: `M${xE - dir2 * 6},${yDt - 3}L${xE},${yDt}L${xE - dir2 * 6},${yDt + 3}`, stroke: 'var(--fg-2)', 'stroke-width': 1.2, fill: 'none' }));
        const dtTxt = `Δt = ${fm(R.dt, 3)} T̄₀`;
        const span = Math.abs(xE - xR);
        if (span > 92) svg.appendChild(W.s('text', { x: (xR + xE) / 2, y: yDt - 4, 'text-anchor': 'middle', class: 'pa-halo', style: 'font-size:10.5px' }, dtTxt));
        else svg.appendChild(W.s('text', { x: Math.max(xR, xE) + 6, y: yDt + 4, class: 'pa-halo', style: 'font-size:10.5px' }, dtTxt));

        // ---- Φ0 panel (y zoomed on the interval)
        const yLo = Math.floor(Math.min(R.phR, R.A, R.phR + R.muHat)) - 1, yHi = Math.ceil(Math.max(R.phR, R.A, R.phR + R.muHat)) + 1;
        const y = W.scale([yLo, yHi], [phBot, phTop]);
        svg.appendChild(W.s('rect', { x: PADL, y: phTop, width: VW - PADL - PADR, height: phH, fill: 'none', stroke: 'var(--border)' }));
        const yStep = W.ticks(yLo, yHi, narrow ? 4 : 6);
        for (const v of yStep) {
          if (!Number.isInteger(v)) continue;
          svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: y(v), y2: y(v), class: 'grid' }));
          svg.appendChild(W.s('text', { x: PADL - 4, y: y(v) + 3.5, 'text-anchor': 'end', class: 'mono', style: 'font-size:10px' }, String(v)));
        }
        const g = W.s('g', { 'clip-path': `url(#${clipId})` });
        let d = '';
        const nS = Math.ceil((VW - PADL - PADR) / 2);
        for (let i = 0; i <= nS; i++) { const t = t0 + ((t1 - t0) * i) / nS; d += (i ? 'L' : 'M') + x(t).toFixed(1) + ',' + y(m.phi(t)).toFixed(1); }
        g.appendChild(W.s('path', { d, fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': 2 }));
        const yR = y(R.phR), yA = y(R.A), yH = y(R.phR + R.muHat);
        g.appendChild(W.s('line', { x1: xR, x2: xE, y1: yR, y2: yR, stroke: 'var(--fg-2)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
        g.appendChild(W.s('line', { x1: xR, x2: xE, y1: yR, y2: yH, stroke: 'var(--sig-fine)', 'stroke-width': 1.8, 'stroke-dasharray': '6 4' }));
        // μ bracket at t_E
        const bx = xE + (dir2 > 0 ? 7 : -7);
        g.appendChild(W.s('path', { d: `M${bx - 3},${yR}H${bx + 3}M${bx},${yR}V${yA}M${bx - 3},${yA}H${bx + 3}`, stroke: 'var(--sig-sel)', 'stroke-width': 2.2, fill: 'none' }));
        // error segment μ̂ − μ
        if (Math.abs(yH - yA) > 0.8) g.appendChild(W.s('line', { x1: xE, x2: xE, y1: yA, y2: yH, stroke: 'var(--sig-err)', 'stroke-width': 3.5, 'stroke-linecap': 'round' }));
        g.appendChild(W.s('circle', { cx: xR, cy: yR, r: 4, fill: 'var(--sig-ref)', stroke: 'var(--surface)', 'stroke-width': 1.5 }));
        g.appendChild(W.s('circle', { cx: xE, cy: yA, r: 4, fill: 'var(--sig-sel)', stroke: 'var(--surface)', 'stroke-width': 1.5 }));
        svg.appendChild(g);
        // labels in the Φ panel
        const muLblX = bx + (dir2 > 0 ? 6 : -6), anchorMu = dir2 > 0 ? 'start' : 'end';
        const muLblY = W.clamp((yR + yA) / 2 + 4, phTop + 24, phBot - 6);
        const roomRight = dir2 > 0 ? VW - PADR - muLblX : muLblX - PADL;
        const muTxt = `μ = ${fm(R.mu, 3)}`;
        if (roomRight > 70) svg.appendChild(W.s('text', { x: muLblX, y: muLblY, 'text-anchor': anchorMu, class: 'pa-halo', style: 'font-size:11px;font-weight:700;fill:var(--fg)' }, muTxt));
        else svg.appendChild(W.s('text', { x: xE - dir2 * 8, y: muLblY, 'text-anchor': dir2 > 0 ? 'end' : 'start', class: 'pa-halo', style: 'font-size:11px;font-weight:700;fill:var(--fg)' }, muTxt));
        // t_R / t_E tags at the top of the Φ panel, placed on the outer sides
        const tag = (xx, txt, left) => svg.appendChild(W.s('text', { x: xx + (left ? -4 : 4), y: phTop + 13, 'text-anchor': left ? 'end' : 'start', class: 'pa-halo', style: 'font-size:10.5px;font-weight:650;fill:var(--fg)' }, txt));
        tag(xR, 't_R', dir2 > 0); tag(xE, 't_E', dir2 < 0);
        svg.appendChild(W.sL('Φ₀(t)（原周期）', 'Φ₀(t) (raw cycles)', { x: PADL, y: phTop - 5, class: 'lbl', style: 'font-size:10.5px' }));

        // ---- f0 panel
        let fMax = 1;
        for (let i = 0; i <= 100; i++) fMax = Math.max(fMax, m.f(t0 + ((t1 - t0) * i) / 100));
        const fTopV = Math.max(1.25, fMax * 1.1);
        const yf = W.scale([0, fTopV], [fBot, fTop]);
        svg.appendChild(W.s('rect', { x: PADL, y: fTop, width: VW - PADL - PADR, height: fH, fill: 'none', stroke: 'var(--border)' }));
        for (const v of [0, 0.5, 1]) {
          svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: yf(v), y2: yf(v), class: v ? 'grid' : 'axis' }));
          svg.appendChild(W.s('text', { x: PADL - 4, y: yf(v) + 3.5, 'text-anchor': 'end', class: 'mono', style: 'font-size:10px' }, String(v)));
        }
        // shaded area μ between t_R and t_E, and the difference band to f̂0
        const fh = 1 / R.That;
        const nI = Math.max(8, Math.ceil(Math.abs(xE - xR) / 2));
        const tsI = [];
        for (let i = 0; i <= nI; i++) tsI.push(P.tR + ((R.tE - P.tR) * i) / nI);
        if (P.prof === 'step' && P.ts > lo && P.ts < hi) tsI.push(P.ts - 1e-9, P.ts + 1e-9); // crisp vertical step
        tsI.sort((a, b) => dir2 * (a - b));
        const top = tsI.map((t) => [x(t), yf(m.f(t))]);
        let area = `M${xR},${yf(0)}`;
        for (const [px, py] of top) area += `L${px.toFixed(1)},${py.toFixed(1)}`;
        area += `L${xE},${yf(0)}Z`;
        svg.appendChild(W.s('path', { d: area, fill: 'var(--sig-sel)', 'fill-opacity': 0.2, stroke: 'none' }));
        const band = `M${top.map(([px, py]) => px.toFixed(1) + ',' + py.toFixed(1)).join('L')}L${xE},${yf(fh)}L${xR},${yf(fh)}Z`;
        svg.appendChild(W.s('path', { d: band, fill: 'var(--sig-err)', 'fill-opacity': 0.35, stroke: 'none' }));
        // f0 curve over the window
        let df = '';
        const nF = Math.ceil((VW - PADL - PADR) / 2);
        for (let i = 0; i <= nF; i++) { const t = t0 + ((t1 - t0) * i) / nF; df += (i ? 'L' : 'M') + x(t).toFixed(1) + ',' + yf(m.f(t)).toFixed(1); }
        svg.appendChild(W.s('path', { d: df, fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': 2 }));
        svg.appendChild(W.s('line', { x1: xR, x2: xE, y1: yf(fh), y2: yf(fh), stroke: 'var(--sig-fine)', 'stroke-width': 1.8, 'stroke-dasharray': '6 4' }));
        if (P.prof === 'step' && P.ts >= t0 && P.ts <= t1) {
          svg.appendChild(W.s('line', { x1: x(P.ts), x2: x(P.ts), y1: fTop, y2: fBot, stroke: 'var(--fg-2)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
          svg.appendChild(W.s('text', { x: x(P.ts) + 3, y: fBot - 5, style: 'font-size:10px' }, 't_s'));
        }
        svg.appendChild(W.s('text', { x: PADL, y: fTop - 5, class: 'lbl', style: 'font-size:10.5px' }, 'f₀(t) / f̄₀'));
        // area caption
        svg.appendChild(W.sL(narrow ? `面积 = μ = ${fm(R.mu, 3)}` : `阴影面积 = μ = ${fm(R.mu, 3)}；红带 = 归一化近似误差`, narrow ? `area = μ = ${fm(R.mu, 3)}` : `shaded area = μ = ${fm(R.mu, 3)}; red band = normalisation error`, { x: VW - PADR, y: fTop - 5, 'text-anchor': 'end', class: 'pa-halo', style: 'font-size:10px' }));

        // ---- time axis
        for (const v of W.ticks(t0, t1, narrow ? 5 : 10)) {
          if (v < t0 - 1e-9 || v > t1 + 1e-9) continue;
          svg.appendChild(W.s('text', { x: x(v), y: fBot + 14, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10px' }, W.fmt(v, 2)));
        }
        svg.appendChild(W.sL('时间 t（单位 T̄₀，名义周期）', 'time t (units of the nominal period T̄₀)', { x: (PADL + VW - PADR) / 2, y: fBot + 29, 'text-anchor': 'middle', style: 'font-size:10.5px' }));
        W.clear(svgHost).appendChild(svg);
      }

      function drawReadouts(R) {
        read.set('J', R.al ? `${R.J} + ½ = ${fm(R.A, 1)}` : `${R.J}`);
        read.set('dt', `${fm(R.dt, 4)} T̄₀`);
        read.set('mu', fm(R.mu, 6));
        read.set('rec', fm(R.recon, 6));
        const tv = W.h('span', null, fm(R.phR, 6) + ' ', Math.abs(R.idErr) < 1e-9 ? W.h('span', { style: { color: 'var(--good-ink)' } }, '✓') : W.h('span', { style: { color: 'var(--critical-ink)' } }, '✗'));
        read.set('true', tv);
        read.set('mh', fm(R.muHat, 6));
        read.set('err', sci(Math.abs(R.err)));
        read.set('bnd', W.h('span', null, sci(R.bound) + ' ', R.ok ? W.h('span', { style: { color: 'var(--good-ink)' } }, '≥ ✓') : W.h('span', { style: { color: 'var(--critical-ink)' } }, '✗')));
        const sign = R.mu < 0 ? ['μ < 0：被选边沿在 REF 之前（积分上限小于下限）', 'μ < 0: the selected edge precedes REF (upper limit below lower limit)']
          : R.mu > 0 ? ['μ > 0：被选边沿在 REF 之后', 'μ > 0: the selected edge follows REF'] : ['μ = 0：REF 恰在被选边沿上', 'μ = 0: REF sits exactly on the selected edge'];
        const lines = [
          { tex: `\\mu=\\int_{t_R}^{t_E} f_0(t)\\,dt=${tx(R.mu, 6)}`, tag: sign },
          { tex: `\\Phi_0(t_R)=A-\\mu=${tx(R.A, 1)}-(${tx(R.mu, 6)})=${tx(R.recon, 6)}`, tag: [`真值 ${fm(R.phR, 6)}，差 ${sci(Math.abs(R.idErr))}（式 5 精确）`, `truth ${fm(R.phR, 6)}, diff ${sci(Math.abs(R.idErr))} (Eq. 5 exact)`] },
          { tex: `\\widehat\\mu=\\frac{\\Delta t}{\\widehat T_0}=\\frac{${tx(R.dt, 4)}}{${tx(R.That, 4)}}=${tx(R.muHat, 6)}`, tag: P.est === 'nom' ? ['T̂₀ = 名义周期', 'T̂₀ = nominal period'] : ['T̂₀ = REF 前最近一个实测周期', 'T̂₀ = last measured period before REF'] },
          { tex: `|\\widehat\\mu-\\mu|=${tx(Math.abs(R.err), 6)}\\;${R.ok ? '\\le' : '>'}\\;\\delta f_{max}|\\Delta t|=${tx(R.dfmax, 4)}\\times${tx(Math.abs(R.dt), 4)}=${tx(R.bound, 6)}`, tag: ['δf_max = 区间内 max|f₀ − 1/T̂₀|', 'δf_max = max |f₀ − 1/T̂₀| over the interval'] },
        ];
        W.clear(eqBox);
        for (const l of lines) eqBox.appendChild(W.h('div', { class: 'ln' }, W.h('span', { class: 'tx' }, W.tex(l.tex)), W.h('span', { class: 'tag' }, W.lbl(l.tag))));
      }

      function drawErr(m, curOff) {
        const VW = Math.round(W.clamp(root.clientWidth || 700, 320, 760)), narrow = VW < 540;
        const PADL = narrow ? 46 : 58, PADR = 10, top = 14, H = 120, VH = top + H + 40;
        const offs = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        const rows = offs.map((o) => evaluate(P, m, o));
        const maxV = Math.max(1e-6, ...rows.map((r) => Math.max(Math.abs(r.err), r.bound)));
        const yMax = W.ticks(0, maxV * 1.08, 4).slice(-1)[0] < maxV ? maxV * 1.15 : W.ticks(0, maxV * 1.08, 4).slice(-1)[0];
        const y = W.scale([0, yMax], [top + H, top]);
        const bw = (VW - PADL - PADR) / offs.length;
        const svg = W.svg(VW, VH);
        for (const v of W.ticks(0, yMax, 4)) {
          svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: y(v), y2: y(v), class: v ? 'grid' : 'axis' }));
          svg.appendChild(W.s('text', { x: PADL - 4, y: y(v) + 3.5, 'text-anchor': 'end', class: 'mono', style: 'font-size:10px' }, W.fmt(v, 4)));
        }
        rows.forEach((r, i) => {
          const cx = PADL + bw * (i + 0.5), w = Math.min(28, bw * 0.5);
          const isCur = offs[i] === curOff;
          if (isCur) svg.appendChild(W.s('rect', { x: cx - bw / 2 + 2, y: top - 6, width: bw - 4, height: H + 8, rx: 4, fill: 'var(--accent-wash)' }));
          const e = Math.abs(r.err);
          svg.appendChild(W.s('rect', { x: cx - w / 2, y: y(e), width: w, height: Math.max(0, y(0) - y(e)), fill: 'var(--sig-err)', 'fill-opacity': isCur ? 1 : 0.75 }));
          svg.appendChild(W.s('line', { x1: cx - w / 2 - 5, x2: cx + w / 2 + 5, y1: y(r.bound), y2: y(r.bound), stroke: 'var(--fg)', 'stroke-width': 2, 'stroke-dasharray': '4 2' }));
          const lbl = offs[i] === 0 ? ['前一沿', 'prev'] : [`+${offs[i]}`, `+${offs[i]}`];
          svg.appendChild(W.sL(lbl[0], lbl[1], { x: cx, y: top + H + 15, 'text-anchor': 'middle', style: `font-size:10.5px;${isCur ? 'fill:var(--fg);font-weight:700' : ''}` }));
          if (!narrow || isCur) svg.appendChild(W.s('text', { x: cx, y: top + H + 28, 'text-anchor': 'middle', class: 'mono', style: 'font-size:9.5px' }, `|Δt|=${W.fmt(Math.abs(r.dt), 1)}`));
        });
        svg.appendChild(W.sL('被选边沿（相对 REF）', 'selected edge (relative to REF)', { x: PADL, y: VH - 1, style: 'font-size:10px' }));
        W.clear(errHost).append(
          W.legend([{ color: 'var(--sig-err)', label: mx('|\\widehat\\mu-\\mu|', '（式 6 相对式 4）', ' (Eq. 6 vs Eq. 4)') }, { color: 'var(--fg)', dash: true, label: ['上界 δf_max·|Δt|', 'bound δf_max·|Δt|'] }]),
          svg,
        );
      }

      let lastW = 0;
      const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { const w = root.clientWidth; if (Math.abs(w - lastW) > 4) { lastW = w; request(); } }) : null;
      if (ro) ro.observe(root);
      syncVis();
      draw();
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      return { destroy() { loop.stop(); if (ro) ro.disconnect(); if (raf) cancelAnimationFrame(raf); } };
    },
  });
})();
