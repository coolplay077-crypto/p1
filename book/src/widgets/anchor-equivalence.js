/* anchor-equivalence — report §6.4, Eq. (12): J − μ = (J+1) − (μ+1); the coarse anchor and the fine interval must
 * transform together.
 *
 * Idealized behavioural model (NOT a circuit or chip specification):
 *   - raw clock with constant frequency, T0 = 1; edge J at τ = 0, edge J+1 at τ = 1; Φ0(τ) = J + τ.
 *   - each REF event lands at τ_R = 1 + x (x = offset from edge J+1), x = x_c + σ_j·n (REF jitter around the boundary).
 *   - coarse chain: decides whether edge J+1 has already occurred: c = [x + n_c > θ_c]; integer anchor J_c = J + c.
 *   - fine chain: decides which edge it measures against: f = [x + n_f > θ_f]; ideal signed fine interval
 *     μ_f = (J + f) − Φ0(τ_R) (Eq. 5 convention, μ < 0 for an edge before REF).
 *   - "independent": n_c, n_f independent, θ_c ≠ θ_f allowed; "atomic candidate tuple": one decision
 *     (x + n_c > θ_c) is shared, so the tuple (J_c, μ_f) is chosen as a whole.
 *   - reconstruction Φ̂ = J_c − μ_f = Φ0 + (c − f): error ∈ {−1, 0, +1} raw cycles.
 *   - optional time normalisation: the fine chain measures Δt and divides by T̂0 = T0(1 + e) (Eq. 6), which breaks
 *     the exactness of Eq. (12) by e/(1+e) between the two consistent tuples.
 *   - expected mismatch probabilities are integrated numerically from the same model (Gaussian noise / jitter).
 */
(function () {
  'use strict';
  const J = 57; // arbitrary absolute edge index for display
  const CSS = `
.ae .w-seg { flex-wrap: wrap; }
.ae .w-seg button { white-space: nowrap; }
.ae .w-ctl { flex-wrap: wrap; }
.ae-sub { margin: 16px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.ae-presets { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin-bottom: 10px; }
.ae-presets .k { font-size: .75rem; color: var(--muted); }
.ae-eqs { margin-top: 10px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: .82rem; color: var(--fg-2); }
.ae-eqs .ln { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; padding: 3px 0; }
.ae-eqs .ln + .ln { border-top: 1px dashed var(--border); }
.ae-eqs .tx { overflow-x: auto; overflow-y: hidden; max-width: 100%; padding: 2px 0; }
.ae-eqs .tag { font-size: .72rem; color: var(--muted); }
.ae-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.ae-tbl { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: .78rem; font-variant-numeric: tabular-nums; margin: 0; }
.ae-tbl th, .ae-tbl td { padding: 5px 6px; overflow-wrap: anywhere; border-bottom: 1px solid var(--border); text-align: center; vertical-align: middle; }
.ae-tbl th { background: var(--surface-2); font-weight: 650; position: static; }
.ae-tbl tr:last-child td { border-bottom: 0; }
.ae-tbl td.c { border-left: 1px solid var(--border); }
.ae-tbl td.ok b { color: var(--good-ink); }
.ae-tbl td.bad b { color: var(--critical-ink); }
.ae-tbl td.cur { background: var(--accent-wash); box-shadow: inset 0 0 0 2px var(--accent); }
.ae-tbl .sm { display: block; font-size: .7rem; color: var(--muted); }
.ae-tbl th:first-child { width: 26%; }
.ae-run { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); font-size: .8rem; }
.ae-bar { flex: 1 1 120px; height: 6px; border-radius: 4px; background: var(--surface-3); overflow: hidden; min-width: 80px; }
.ae-bar > i { display: block; height: 100%; width: 0; background: var(--good); }
.ae-mono { font-family: var(--mono); }
.w-svg text.ae-halo { paint-order: stroke; stroke: var(--surface); stroke-width: 3.5px; stroke-linejoin: round; }
`;
  const fm = (v, d = 3) => W.fmt(v, d).replace('-', '−');
  const tx = (v, d = 3) => W.fmt(v, d);
  const sgn = (v) => (v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0');
  // standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7)
  function ncdf(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }
  const pAbove = (x, th, sn) => (sn > 0 ? ncdf((x - th) / sn) : x > th ? 1 : 0); // P(x + n > θ)

  /** expected P(err = +1), P(err = −1) for the independent chains, integrating over the REF jitter */
  function expected(P) {
    let pp = 0, pm = 0;
    const one = (x, w) => { const c = pAbove(x, P.thC, P.sn), f = pAbove(x, P.thF, P.sn); pp += w * c * (1 - f); pm += w * (1 - c) * f; };
    if (P.sj <= 0) one(P.xc, 1);
    else {
      const n = 2400, a = -7, h = 14 / n;
      for (let i = 0; i <= n; i++) { const z = a + i * h, w = (i === 0 || i === n ? 0.5 : 1) * h * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); one(P.xc + P.sj * z, w); }
    }
    return { pp, pm };
  }

  Book.registerWidget({
    id: 'anchor-equivalence',
    group: 'phase',
    title: { zh: '锚点等价：J − μ = (J+1) − (μ+1)，两条链必须共同选择', en: 'Anchor equivalence: J − μ = (J+1) − (μ+1) — both chains must choose together' },
    summary: {
      zh: 'REF 落在相邻边沿 J 与 J+1 的判决边界附近。粗链决定整数锚点取 J 还是 J+1，细链决定 μ 相对哪个边沿测量。(J, μ) 与 (J+1, μ+1) 表示同一相位（式 12）；若两条链各自独立判决，混合选择会产生 ±1 个原周期错误。播放时 REF 在边界附近抖动，对比“独立判决”与“原子候选元组”的误差直方图。',
      en: 'REF lands near the decision boundary between adjacent edges J and J+1. The coarse chain decides whether the integer anchor is J or J+1; the fine chain decides which edge μ is measured against. (J, μ) and (J+1, μ+1) represent the same phase (Eq. 12); if the two chains decide independently, mixed choices produce ±1 raw-cycle errors. Press play to jitter REF around the boundary and compare the error histograms of "independent decisions" and an "atomic candidate tuple".',
    },
    sections: ['r-6-4'],
    eqs: ['12'],
    keywords: ['anchor', 'coarse/fine handover', 'candidate tuple', 'atomic', 'L05', '锚点', '粗细交接', '原子', '±1 周期错误'],
    mount(root, api) {
      if (!document.getElementById('ae-css')) { const s = document.createElement('style'); s.id = 'ae-css'; s.textContent = CSS; document.head.appendChild(s); }
      root.classList.add('ae');
      const P = { mode: 'indep', xc: 0, sj: 0.08, thC: 0.02, thF: -0.02, sn: 0.015, e: 0, speed: 'slow', seed: 7 };
      let rng = W.rng(P.seed);
      let raf = 0, runTimer = 0, acc = 0;
      const st = { n: 0, ind: { '-1': 0, 0: 0, 1: 0 }, atm: { '-1': 0, 0: 0, 1: 0 }, recent: [], cur: null };

      function newEvent() {
        const x = P.xc + P.sj * rng.normal();
        const nc = P.sn * rng.normal(), nf = P.sn * rng.normal();
        const c = x + nc > P.thC ? 1 : 0;
        const fInd = x + nf > P.thF ? 1 : 0;
        const ev = { x, c, fInd, fAtm: c, errInd: c - fInd, errAtm: 0 };
        st.n++; st.ind[ev.errInd]++; st.atm[0]++;
        st.recent.push(ev); if (st.recent.length > 60) st.recent.shift();
        st.cur = ev;
        return ev;
      }
      function resetStats() { rng = W.rng(P.seed); st.n = 0; st.ind = { '-1': 0, 0: 0, 1: 0 }; st.atm = { '-1': 0, 0: 0, 1: 0 }; st.recent = []; st.cur = null; newEvent(); request(); }

      const loop = api.loop((dt) => {
        const rate = P.speed === 'slow' ? 1.6 : 90;
        acc += dt * rate;
        let k = 0;
        while (acc >= 1 && k < 400) { acc -= 1; newEvent(); k++; }
        if (k) draw();
      });
      const play = W.playButton(loop, api);
      const ctl = {};
      ctl.mode = W.seg({ label: ['判决方式', 'Decision'], value: P.mode, options: [{ value: 'indep', label: ['两链独立判决', 'Independent chains'] }, { value: 'atomic', label: ['原子候选元组', 'Atomic candidate tuple'] }], onChange: (v) => { P.mode = v; request(); } });
      ctl.speed = W.seg({ label: ['速度', 'Speed'], value: P.speed, options: [{ value: 'slow', label: ['逐个事件', 'Event by event'] }, { value: 'fast', label: ['快速统计', 'Fast statistics'] }], onChange: (v) => { P.speed = v; } });
      const cfg = (k, label, min, max, stp, fmt) => { ctl[k] = W.slider({ label, min, max, step: stp, value: P[k], fmt, onInput: (v) => { P[k] = v; resetStats(); } }); return ctl[k]; };
      const cyc = (v) => (v >= 0 ? '+' : '−') + W.fmt(Math.abs(v), 3) + ' T₀';
      cfg('xc', ['REF 中心 x_c（相对 J+1）', 'REF centre x_c (vs. J+1)'], -0.35, 0.35, 0.005, cyc);
      cfg('sj', ['REF 抖动 σ_j', 'REF jitter σ_j'], 0, 0.2, 0.005, (v) => W.fmt(v, 3) + ' T₀');
      cfg('thC', ['粗链阈值 θ_c', 'Coarse threshold θ_c'], -0.15, 0.15, 0.005, cyc);
      cfg('thF', ['细链阈值 θ_f', 'Fine threshold θ_f'], -0.15, 0.15, 0.005, cyc);
      cfg('sn', ['判决噪声 σ_n', 'Decision noise σ_n'], 0, 0.1, 0.002, (v) => W.fmt(v, 3) + ' T₀');
      ctl.e = W.slider({ label: ['T̂₀ 归一化误差 e', 'T̂₀ normalisation error e'], min: 0, max: 0.05, step: 0.001, value: P.e, fmt: (v) => W.fmt(v * 100, 1) + '%', onInput: (v) => { P.e = v; request(); } });
      const PRESETS = [
        { label: ['两链完全一致', 'Identical chains'], p: { mode: 'indep', xc: 0, sj: 0.05, thC: 0, thF: 0, sn: 0, e: 0 } },
        { label: ['阈值偏斜 → −1 错误', 'Skewed thresholds → −1 errors'], p: { mode: 'indep', xc: 0, sj: 0.06, thC: 0.05, thF: -0.05, sn: 0.005, e: 0 } },
        { label: ['边界附近判决噪声 → ±1', 'Noisy decisions near boundary → ±1'], p: { mode: 'indep', xc: 0, sj: 0.04, thC: 0, thF: 0, sn: 0.04, e: 0 } },
        { label: ['原子候选元组', 'Atomic candidate tuple'], p: { mode: 'atomic', xc: 0, sj: 0.04, thC: 0.02, thF: -0.04, sn: 0.04, e: 0 } },
        { label: ['远离边界', 'Far from the boundary'], p: { mode: 'indep', xc: -0.3, sj: 0.03, thC: 0.03, thF: -0.03, sn: 0.02, e: 0 } },
        { label: ['时间归一化 e = 3%', 'Time normalisation e = 3%'], p: { mode: 'atomic', xc: 0, sj: 0.05, thC: 0.03, thF: -0.03, sn: 0.02, e: 0.03 } },
      ];
      function applyPreset(p) {
        Object.assign(P, p);
        for (const k of ['xc', 'sj', 'thC', 'thF', 'sn', 'e']) ctl[k].value = P[k];
        ctl.mode.value = P.mode;
        resetStats();
      }
      const presetRow = W.h('div', { class: 'ae-presets' }, W.h('span', { class: 'k' }, W.L('场景：', 'Scenarios:')), PRESETS.map((pr) => W.button(pr.label, () => applyPreset(pr.p))));
      const stepBtn = W.button(['单个 REF 事件', 'One REF event'], () => { loop.stop(); play.sync(); newEvent(); request(); });
      const resetBtn = W.button(['清零统计', 'Reset statistics'], () => resetStats());

      const legend = W.legend([
        { color: 'var(--sig-clk)', label: ['CK₀ 边沿 J、J+1', 'CK₀ edges J, J+1'] },
        { color: 'var(--sig-ref)', label: ['REF 事件', 'REF event'] },
        { color: 'var(--sig-high)', label: ['粗链：整数锚点 J_c', 'coarse chain: integer anchor J_c'] },
        { color: 'var(--sig-fine)', label: ['细链：μ 的参考边沿', 'fine chain: edge μ is measured against'] },
        { color: 'var(--sig-err)', label: ['两链可能不一致的区域 / ±1 错误', 'zone where the chains can disagree / ±1 error'] },
      ]);
      const tlHost = W.h('div');
      const statusHost = W.h('div', { style: { fontSize: '.8rem', margin: '2px 0 4px', display: 'flex', flexWrap: 'wrap', gap: '4px 8px', alignItems: 'center' } });
      const tblHost = W.h('div', { class: 'ae-tblw' });
      const nlHost = W.h('div');
      const eqBox = W.h('div', { class: 'ae-eqs' });
      const histHost = W.h('div');
      const read = W.readout([
        { key: 'n', label: ['已模拟 REF 事件', 'REF events simulated'] },
        { key: 'ind', label: ['独立判决 ±1 错误率（模拟）', 'Independent ±1 rate (simulated)'] },
        { key: 'exp', label: ['同参数期望值（数值积分）', 'Expected rate (integrated)'] },
        { key: 'atm', label: ['原子元组：错误', 'Atomic tuple: errors'] },
      ]);
      const runBtn = W.button(['运行 L05（64 J × 4 μ = 256 例）', 'Run L05 (64 J × 4 μ = 256 cases)'], () => runL05());
      const bar = W.h('i');
      const runOut = W.h('span', { class: 'ae-mono' }, '—');

      root.append(
        W.controls(play, stepBtn, resetBtn, ctl.speed),
        presetRow,
        W.controls(ctl.mode),
        W.controls(ctl.xc, ctl.sj),
        W.controls(ctl.thC, ctl.thF, ctl.sn),
        legend, statusHost, tlHost,
        W.h('div', { class: 'ae-sub' }, W.L('当前事件的四种组合（行 = 粗链锚点，列 = 细链参考边沿）', 'Four combinations for the current event (rows = coarse anchor, columns = fine reference edge)')),
        tblHost, nlHost, eqBox,
        W.h('div', { class: 'ae-sub' }, W.L('误差直方图：同一串 REF 事件与噪声，两种判决方式', 'Error histograms: same REF events and noise, two decision schemes')),
        histHost, read.el,
        W.h('div', { class: 'ae-sub' }, W.L('与式 (6) 的联系：时间域归一化', 'Link to Eq. (6): time-domain normalisation')),
        W.controls(ctl.e),
        W.h('div', { class: 'ae-sub' }, W.L('L05 锚点等价检查（报告第 12.1 节）', 'L05 anchor-equivalence check (report §12.1)')),
        W.h('div', { class: 'ae-run' }, runBtn, W.h('div', { class: 'ae-bar' }, bar), runOut),
        W.note(['要点：边界允许两种坐标——(J, μ) 与 (J+1, μ+1) 给出同一个 Φ₀(t_R)（式 12），因此不必每次都选“唯一正确”的边沿；但整数锚点与 fine 区间必须作为一个元组共同变换。整数取 J+1 而 fine 仍相对 J（或反之）才会产生 ±1 个原周期错误。式 (12) 是精确的相位域等式；用单一 T̂₀ 把时间间隔归一化时（式 6），两种坐标只在归一化误差范围内一致。',
          'Key point: the boundary admits two coordinates — (J, μ) and (J+1, μ+1) give the same Φ₀(t_R) (Eq. 12), so a unique "correct" edge need not be chosen every time; but the integer anchor and the fine interval must transform together as one tuple. Only when the integer takes J+1 while the fine value is still relative to J (or vice versa) does a ±1 raw-cycle error appear. Eq. (12) is an exact phase-domain identity; when time intervals are normalised by a single T̂₀ (Eq. 6), the two coordinates agree only within the normalisation error.'], 'good'),
        W.note(['理想化示意模型：恒频原时钟、理想带符号 fine 区间；阈值偏斜与高斯判决噪声只是抽象的“两条链判决不一致”机制，不是亚稳态或某篇论文电路的模型，数值不是芯片指标。',
          'Idealized illustration: constant-frequency raw clock and an ideal signed fine interval; threshold skew and Gaussian decision noise are only an abstract mechanism for "the two chains decide differently" — not a metastability model or a model of any paper\'s circuit, and the numbers are not chip specifications.'], 'warn'),
      );

      function request() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

      function draw() {
        if (!st.cur) newEvent();
        drawTimeline();
        drawTable();
        drawNumberLine();
        drawEq();
        drawHist();
      }
      const curF = (ev) => (P.mode === 'atomic' ? ev.fAtm : ev.fInd);
      const curErr = (ev) => (P.mode === 'atomic' ? ev.errAtm : ev.errInd);

      function drawTimeline() {
        const VW = Math.round(W.clamp(root.clientWidth || 700, 320, 760)), narrow = VW < 540;
        const PADL = narrow ? 50 : 76, PADR = 10;
        // broken time axis: a narrow window around edge J, a compressed break, a zoomed window around edge J+1
        const A0 = -0.1, A1 = 0.1, B0 = 0.6, B1 = 1.4;
        const p0 = PADL, p3 = VW - PADR, span = p3 - p0;
        const p1 = p0 + 0.17 * span, p2 = p0 + 0.25 * span;
        const lin = (t, a, b, pa, pb) => pa + ((t - a) / (b - a)) * (pb - pa);
        const x = (t) => (t <= A1 ? lin(t, A0, A1, p0, p1) : t < B0 ? lin(t, A1, B0, p1, p2) : lin(t, B0, B1, p2, p3));
        const t0 = A0, t1 = B1;
        const yH = 22, yL = 42, yTh = 56, yC = 78, yF = 108, yE = 138, VH = 178;
        const svg = W.svg(VW, VH);
        const ev = st.cur, f = curF(ev), tR = 1 + ev.x;
        // disagreement zone (independent: between thresholds, widened by ±2σ_n)
        const zone = (a, b, col, op) => { if (b - a > 1e-6) svg.appendChild(W.s('rect', { x: x(1 + a), y: yL + 18, width: Math.max(1, x(1 + b) - x(1 + a)), height: yE + 10 - yL - 18, fill: col, 'fill-opacity': op })); };
        if (P.mode === 'indep') zone(Math.min(P.thC, P.thF) - 2 * P.sn, Math.max(P.thC, P.thF) + 2 * P.sn, 'var(--sig-err)', 0.12);
        else if (P.sn > 0) zone(P.thC - 2 * P.sn, P.thC + 2 * P.sn, 'var(--sig-high)', 0.08);
        // CK0 (piecewise polyline through the broken axis)
        const edges = W.clockEdges(1, 0, t0, t1);
        svg.appendChild(W.s('path', { d: W.digitalPath(edges, 0, x, yH, yL, t0, t1), fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
        svg.appendChild(W.s('text', { x: 4, y: (yH + yL) / 2 + 4, class: 'lbl' }, 'CK₀'));
        // break marks
        const xb = (p1 + p2) / 2;
        svg.appendChild(W.s('rect', { x: xb - 5, y: yH - 6, width: 10, height: VH - 30 - yH, fill: 'var(--surface)' }));
        for (const dx of [-3, 3]) svg.appendChild(W.s('line', { x1: xb + dx - 3, x2: xb + dx + 3, y1: yH - 6, y2: yH + 6, stroke: 'var(--fg-2)', 'stroke-width': 1.2 }));
        for (const dx of [-3, 3]) svg.appendChild(W.s('line', { x1: xb + dx - 3, x2: xb + dx + 3, y1: VH - 36, y2: VH - 24, stroke: 'var(--fg-2)', 'stroke-width': 1.2 }));
        for (const k of [0, 1]) {
          svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: yL, y2: yE + 10, stroke: 'var(--sig-clk)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
          svg.appendChild(W.s('text', { x: x(k), y: 13, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10.5px;fill:var(--fg);font-weight:650' }, k ? `J+1 = ${J + 1}` : `J = ${J}`));
        }
        // thresholds (labels in their own row, ordered left/right so they never overlap)
        const thr = [{ th: P.thC, col: 'var(--sig-high)', t: 'θ_c' }];
        if (P.mode === 'indep') thr.push({ th: P.thF, col: 'var(--sig-fine)', t: 'θ_f' });
        thr.sort((a, b) => a.th - b.th);
        thr.forEach((o, i) => {
          const xx = x(1 + o.th);
          svg.appendChild(W.s('line', { x1: xx, x2: xx, y1: yTh + 4, y2: yE + 10, stroke: o.col, 'stroke-width': 1.6, 'stroke-dasharray': '5 3' }));
          const left = thr.length === 2 && i === 0;
          svg.appendChild(W.s('text', { x: xx + (left ? -3 : 3), y: yTh + 2, 'text-anchor': left ? 'end' : 'start', class: 'ae-halo', style: 'font-size:10.5px;fill:var(--fg)' }, o.t));
        });
        // row labels
        svg.appendChild(W.sL(narrow ? '粗链' : '粗链 J_c', narrow ? 'coarse' : 'coarse J_c', { x: 4, y: yC + 4, class: 'lbl', style: 'font-size:10.5px' }));
        svg.appendChild(W.sL(narrow ? '细链' : '细链 μ', narrow ? 'fine' : 'fine μ', { x: 4, y: yF + 4, class: 'lbl', style: 'font-size:10.5px' }));
        svg.appendChild(W.sL(narrow ? 'REF' : 'REF 事件', narrow ? 'REF' : 'REF events', { x: 4, y: yE + 4, class: 'lbl', style: 'font-size:10.5px' }));
        // recent events
        for (const r of st.recent) {
          const er = P.mode === 'atomic' ? r.errAtm : r.errInd;
          const xx = x(W.clamp(1 + r.x, t0, t1));
          svg.appendChild(W.s('line', { x1: xx, x2: xx, y1: yE - 7, y2: yE + 7, stroke: er ? 'var(--sig-err)' : 'var(--fg-2)', 'stroke-width': er ? 2 : 1.2, 'stroke-opacity': er ? 0.95 : 0.45 }));
        }
        // current REF
        const xr = x(W.clamp(tR, t0, t1));
        svg.appendChild(W.s('line', { x1: xr, x2: xr, y1: yL + 4, y2: yE + 10, stroke: 'var(--sig-ref)', 'stroke-width': 2 }));
        // arrows: coarse to its anchor edge, fine to its reference edge; values printed at the right end of each row
        const arrow = (yy, xe, col, label) => {
          const d = xe >= xr ? 1 : -1;
          svg.appendChild(W.s('line', { x1: xr, x2: xe, y1: yy, y2: yy, stroke: col, 'stroke-width': 2.2 }));
          if (Math.abs(xe - xr) > 8) svg.appendChild(W.s('path', { d: `M${xe - d * 7},${yy - 4}L${xe},${yy}L${xe - d * 7},${yy + 4}`, fill: 'none', stroke: col, 'stroke-width': 2 }));
          svg.appendChild(W.s('circle', { cx: xe, cy: yy, r: 3, fill: col }));
          svg.appendChild(W.s('text', { x: p3, y: yy - 6, 'text-anchor': 'end', class: 'ae-halo mono', style: 'font-size:10.5px;fill:var(--fg);font-weight:650' }, label));
        };
        const muF = (J + f) - (J + tR);
        arrow(yC, x(ev.c), 'var(--sig-high)', `J_c = ${J + ev.c}`);
        arrow(yF, x(f), 'var(--sig-fine)', `μ = ${fm(muF, 3)}`);
        // axis: x offset relative to J+1
        for (const v of [-1, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]) {
          const tt = 1 + v;
          if (narrow && Math.abs(v * 10) % 2 === 1) continue;
          svg.appendChild(W.s('text', { x: x(tt), y: VH - 22, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10px' }, (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v)));
        }
        svg.appendChild(W.sL('REF 相对 J+1 的偏移 x（原周期；坐标轴在 J 与 J+1 之间折断）', 'REF offset x relative to J+1 (raw cycles; axis broken between J and J+1)', { x: (PADL + VW - PADR) / 2, y: VH - 6, 'text-anchor': 'middle', style: 'font-size:10px' }));
        W.clear(tlHost).appendChild(svg);
        const er = curErr(ev);
        W.clear(statusHost).append(W.L('当前事件：', 'Current event: '), W.status(er ? 'bad' : 'good', er ? [`误差 ${sgn(er)} 个原周期`, `error ${sgn(er)} raw cycle`] : ['一致：误差 0', 'consistent: error 0']),
          ' ', W.h('span', { class: 'ae-mono', style: { color: 'var(--fg-2)' } }, `x = ${fm(ev.x, 3)}, c = ${ev.c}, f = ${f}`));
      }

      function drawTable() {
        const ev = st.cur, phi = J + 1 + ev.x;
        const f = curF(ev);
        const cell = (anchor, ref) => {
          const mu = (J + ref) - phi; // μ measured relative to edge J+ref
          const rec = (J + anchor) - mu, err = Math.round(rec - phi);
          const isCur = anchor === ev.c && ref === f;
          return W.h('td', { class: 'c ' + (err ? 'bad' : 'ok') + (isCur ? ' cur' : '') },
            W.h('span', { class: 'sm' }, W.tex(`${J + anchor}-(${tx(mu, 3)})`)),
            W.h('b', null, fm(rec, 3)), ' ',
            W.h('span', { class: 'sm' }, err ? W.L(`误差 ${sgn(err)} 周期`, `error ${sgn(err)} cycle`) : W.L('= Φ₀(t_R) ✓', '= Φ₀(t_R) ✓')));
        };
        const tbl = W.h('table', { class: 'ae-tbl' },
          W.h('thead', null, W.h('tr', null, W.h('th', null, W.L('J_c ＼ μ 参考', 'J_c ＼ μ ref.')),
            W.h('th', null, W.L(`μ 相对 J`, `μ vs. J`), W.h('span', { class: 'sm' }, `(${J})`)), W.h('th', null, W.L(`μ 相对 J+1`, `μ vs. J+1`), W.h('span', { class: 'sm' }, `(${J + 1})`)))),
          W.h('tbody', null,
            W.h('tr', null, W.h('th', null, `J = ${J}`), cell(0, 0), cell(0, 1)),
            W.h('tr', null, W.h('th', null, `J+1 = ${J + 1}`), cell(1, 0), cell(1, 1))));
        W.clear(tblHost).appendChild(tbl);
      }

      function drawNumberLine() {
        const VW = Math.round(W.clamp(root.clientWidth || 700, 320, 760)), narrow = VW < 540;
        const ev = st.cur, phi = J + 1 + ev.x;
        const PADL = 14, PADR = 14, VH = 92, yA = 58;
        const x = W.scale([J - 0.8, J + 2.8], [PADL, VW - PADR]);
        const svg = W.svg(VW, VH);
        svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: yA, y2: yA, class: 'axis', style: 'stroke-width:1.5' }));
        for (let k = J; k <= J + 2; k++) {
          svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: yA - 5, y2: yA + 5, stroke: 'var(--fg-2)', 'stroke-width': 1.5 }));
          svg.appendChild(W.s('text', { x: x(k), y: yA + 18, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10.5px' }, String(k)));
        }
        const muJ = J - phi;
        const cands = [
          { v: phi, ok: true, lbl: narrow ? '(J,μ) (J+1,μ+1)' : '(J, μ) = (J+1, μ+1)', dy: -14 },
          { v: (J + 1) - muJ, ok: false, lbl: '(J+1, μ)', dy: -14 },
          { v: J - (muJ + 1), ok: false, lbl: '(J, μ+1)', dy: -14 },
        ];
        for (const c of cands) {
          const xx = x(c.v);
          svg.appendChild(W.s('path', { d: `M${xx},${yA - 7}l6,7l-6,7l-6,-7z`, fill: c.ok ? 'var(--sig-sel)' : 'var(--sig-err)' }));
          svg.appendChild(W.s('text', { x: xx, y: yA + c.dy - 6, 'text-anchor': 'middle', class: 'ae-halo mono', style: `font-size:10.5px;font-weight:650;fill:${c.ok ? 'var(--good-ink)' : 'var(--critical-ink)'}` }, c.lbl));
        }
        // ±1 arrows
        for (const s of [-1, 1]) {
          const a = x(phi), b = x(phi + s);
          svg.appendChild(W.s('path', { d: `M${a},${yA + 26}L${b},${yA + 26}`, stroke: 'var(--sig-err)', 'stroke-width': 1.2, 'stroke-dasharray': '3 2' }));
          svg.appendChild(W.s('text', { x: (a + b) / 2, y: yA + 23, 'text-anchor': 'middle', class: 'ae-halo', style: 'font-size:10px' }, s > 0 ? '+1' : '−1'));
        }
        svg.appendChild(W.sL('相位轴 Φ₀（原周期）', 'phase axis Φ₀ (raw cycles)', { x: PADL, y: 12, style: 'font-size:10.5px' }));
        W.clear(nlHost).appendChild(svg);
      }

      function drawEq() {
        const ev = st.cur, phi = J + 1 + ev.x;
        const mu = J - phi;
        // time domain: the fine chain normalises Δt with T̂0 = T0(1+e)
        const mhJ = mu / (1 + P.e), mhJ1 = (mu + 1) / (1 + P.e);
        const recJ = J - mhJ, recJ1 = (J + 1) - mhJ1;
        const lines = [
          { tex: `J-\\mu=${J}-(${tx(mu, 3)})=${tx(phi, 3)}=(J+1)-(\\mu+1)=${J + 1}-(${tx(mu + 1, 3)})`, tag: ['式 (12)，相位域精确', 'Eq. (12), exact in the phase domain'] },
          { tex: `(J+1)-\\mu=${tx(phi + 1, 3)},\\quad J-(\\mu+1)=${tx(phi - 1, 3)}`, tag: ['混合选择：±1 个原周期', 'mixed choices: ±1 raw cycle'] },
          { tex: `\\widehat\\mu=\\frac{\\Delta t}{\\widehat T_0},\\ \\widehat T_0=T_0(1+${tx(P.e, 3)}):\\ \\big(J-\\widehat\\mu_J\\big)-\\big((J+1)-\\widehat\\mu_{J+1}\\big)=${tx(recJ - recJ1, 4)}`, tag: P.e > 0 ? ['时间域：两种坐标只在归一化误差 e/(1+e) 内一致', 'time domain: the two coordinates agree only within e/(1+e)'] : ['e = 0：时间域也精确', 'e = 0: exact in the time domain too'] },
        ];
        W.clear(eqBox);
        for (const l of lines) eqBox.appendChild(W.h('div', { class: 'ln' }, W.h('span', { class: 'tx' }, W.tex(l.tex)), W.h('span', { class: 'tag' }, W.lbl(l.tag))));
      }

      let expKey = '', expVal = null;
      function drawHist() {
        const VW = Math.round(W.clamp(root.clientWidth || 700, 320, 760)), narrow = VW < 540;
        const VH = 168, gap = narrow ? 16 : 30, pw = (VW - gap) / 2, top = 34, H = 92;
        const svg = W.svg(VW, VH);
        const N = Math.max(1, st.n);
        const yMax = Math.log10(1 + N);
        const panel = (ox, hist, zh, en, active) => {
          const y = W.scale([0, yMax], [top + H, top]);
          svg.appendChild(W.s('rect', { x: ox + 0.5, y: 0.5, width: pw - 1, height: VH - 1, rx: 8, fill: active ? 'var(--accent-wash)' : 'none', stroke: active ? 'var(--accent)' : 'var(--border)' }));
          svg.appendChild(W.sL(zh, en, { x: ox + 10, y: 18, class: 'lbl', style: 'font-size:11px' }));
          const bw = (pw - 40) / 3;
          [-1, 0, 1].forEach((k, i) => {
            const cnt = hist[k], cx = ox + 26 + bw * (i + 0.5), w = Math.min(46, bw * 0.6);
            const yy = y(Math.log10(1 + cnt));
            svg.appendChild(W.s('rect', { x: cx - w / 2, y: yy, width: w, height: Math.max(0, top + H - yy), rx: 2, fill: k ? 'var(--sig-err)' : 'var(--sig-sel)' }));
            svg.appendChild(W.s('text', { x: cx, y: yy - 4, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10px;fill:var(--fg)' }, String(cnt)));
            svg.appendChild(W.s('text', { x: cx, y: top + H + 14, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10.5px' }, k ? (k > 0 ? '+1' : '−1') : '0'));
            svg.appendChild(W.s('text', { x: cx, y: top + H + 27, 'text-anchor': 'middle', class: 'mono', style: 'font-size:9.5px' }, W.fmt((100 * cnt) / N, 2) + '%'));
          });
          svg.appendChild(W.s('line', { x1: ox + 18, x2: ox + pw - 10, y1: top + H, y2: top + H, class: 'axis' }));
        };
        panel(0, st.ind, '两链独立判决', 'Independent chains', P.mode === 'indep');
        panel(pw + gap, st.atm, '原子候选元组', 'Atomic candidate tuple', P.mode === 'atomic');
        W.clear(histHost).append(svg, W.h('div', { style: { fontSize: '.72rem', color: 'var(--muted)', marginTop: '2px' } }, W.L('纵轴为对数计数 log₁₀(1 + n)；横轴为重建误差 Φ̂ − Φ₀（原周期）。', 'Vertical axis: log count log₁₀(1 + n); horizontal: reconstruction error Φ̂ − Φ₀ (raw cycles).')));
        const bad = st.ind[-1] + st.ind[1];
        read.set('n', String(st.n));
        read.set('ind', W.h('span', null, `${W.fmt((100 * bad) / N, 2)}% `, W.h('span', { style: { fontSize: '.72rem', fontWeight: 400, color: 'var(--fg-2)' } }, `(${bad}/${st.n})`)));
        if (expKey !== [P.xc, P.sj, P.thC, P.thF, P.sn].join()) { expKey = [P.xc, P.sj, P.thC, P.thF, P.sn].join(); expVal = expected(P); }
        read.set('exp', W.h('span', null, `${W.fmt(100 * (expVal.pp + expVal.pm), 2)}% `, W.h('span', { style: { fontSize: '.72rem', fontWeight: 400, color: 'var(--fg-2)' } }, `(−1: ${W.fmt(100 * expVal.pm, 2)}%, +1: ${W.fmt(100 * expVal.pp, 2)}%)`)));
        read.set('atm', W.h('span', { style: { color: 'var(--good-ink)' } }, `${st.atm[-1] + st.atm[1]} ✓`));
      }

      // ---------------------------------------------------------------- L05 (exact rationals)
      function runL05() {
        clearTimeout(runTimer);
        runBtn.disabled = true;
        const mus = [W.F(-1, 4), W.F(0), W.F(1, 4), W.F(3, 4)];
        let j = 0, pass = 0, mixedPlus = 0, mixedMinus = 0, total = 0;
        const chunk = () => {
          for (let r = 0; r < 8 && j < 64; r++, j++) {
            for (const mu of mus) {
              const a = W.F(j).sub(mu), b = W.F(j + 1).sub(mu.add(1));
              if (a.eq(b)) pass++;
              if (W.F(j + 1).sub(mu).sub(a).eq(W.F(1))) mixedPlus++;
              if (W.F(j).sub(mu.add(1)).sub(a).eq(W.F(-1))) mixedMinus++;
              total++;
            }
          }
          bar.style.width = (j / 64) * 100 + '%';
          W.clear(runOut).append(W.L(`J = ${j - 1}：${total}/256 例`, `J = ${j - 1}: ${total}/256 cases`));
          if (j < 64) runTimer = setTimeout(chunk, 60);
          else {
            runBtn.disabled = false;
            const ok = pass === 256;
            bar.style.background = ok ? 'var(--good)' : 'var(--critical)';
            W.clear(runOut).append(W.status(ok ? 'good' : 'bad', ok ? ['PASS', 'PASS'] : ['FAIL', 'FAIL']), ' ',
              W.L(`J − μ = (J+1) − (μ+1)：${pass}/256 通过 · 混合元组 (J+1, μ) 偏 +1：${mixedPlus}/256，(J, μ+1) 偏 −1：${mixedMinus}/256`,
                `J − μ = (J+1) − (μ+1): ${pass}/256 pass · mixed tuple (J+1, μ) off by +1: ${mixedPlus}/256, (J, μ+1) off by −1: ${mixedMinus}/256`));
          }
        };
        bar.style.background = 'var(--good)';
        chunk();
      }

      let lastW = 0;
      const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { const w = root.clientWidth; if (Math.abs(w - lastW) > 4) { lastW = w; request(); } }) : null;
      if (ro) ro.observe(root);
      resetStats();
      draw();
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      return { destroy() { loop.stop(); clearTimeout(runTimer); if (ro) ro.disconnect(); if (raf) cancelAnimationFrame(raf); } };
    },
  });
})();
