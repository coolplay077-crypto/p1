/* matched-delay-sampling — report §7.2 (route B), §4.4, §4.9; Eq. (13)–(15).
 *
 * Idealized timing model, time unit T0, target logical edge at t_E = 0. Three counter groups (generic, illustrative
 * delays — in the spirit of matched read-out in Zong Fig.9 / CN105071798, but NOT their numbers):
 *   group i data after t_E changes somewhere in [d_i^min, d_i^max]; next rewrite at t_next,i (+ d_next,i^min..max, here the
 *   same delay range); setup t_su, hold t_h.  Sampling instant spread [t_S,i^min, t_S,i^max]:
 *     matched: chain CKS_i = CKS_0 + k·(nominal delay difference of group i vs group 0), spread grows 10 % of the chain offset
 *     common : one sampling clock for every group (the "unmatched" alternative).
 *   PVT corner: delay scale 1.0 / 1.4 / 0.65 applies to data delays and (matched) chain offsets; the base sampling time
 *   t_S,0 and t_next do NOT scale (they come from the clock). The scale factors are illustrative, not PVT data.
 *   Eq. (15): m_i = t_S,i^min − t_E − d_i^max − t_su,i ;  h_i = t_next,i + d_next,i^min − t_S,i^max − t_h,i.
 */
(function () {
  'use strict';
  const GROUPS = [
    { zh: '组 0（LSB，异步）', en: 'group 0 (LSB, async)', dmin: 0.10, dmax: 0.30, tn: 1.0 },
    { zh: '组 1', en: 'group 1', dmin: 0.35, dmax: 0.60, tn: 2.0 },
    { zh: '组 2（高位，同步）', en: 'group 2 (high bits, sync)', dmin: 0.65, dmax: 1.00, tn: 4.0 },
  ];
  const CORNER = { typ: 1, slow: 1.4, fast: 0.65 };
  const EPS = 1e-9;
  const CSS = `
.md-h { margin: 14px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.md-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; font-variant-numeric: tabular-nums; margin: 0; }
.md-tbl th, .md-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
.md-tbl th { background: var(--surface-2); font-weight: 650; white-space: nowrap; }
.md-tbl td.n, .md-tbl th.n { text-align: right; font-family: var(--mono); white-space: nowrap; }
.md-tbl tr:last-child td { border-bottom: 0; }
.md-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.md-sl { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: 6px 18px; margin: 4px 0 8px; }
.md-sl .w-ctl { justify-content: space-between; }
.md-sl .w-ctl input[type=range] { width: 120px; }
.md-eq { overflow-x: auto; overflow-y: hidden; }
.md-eq .katex-display { margin: .3em 0; }
`;
  let uid = 0;

  // ------------------------------------------------------------------ DOM-free model
  function model(P) {
    const k = CORNER[P.corner], nom = (g) => (g.dmin + g.dmax) / 2;
    const rows = GROUPS.map((g, i) => {
      const dmin = g.dmin * k, dmax = g.dmax * k;
      const off = P.mode === 'matched' ? k * (nom(g) - nom(GROUPS[0])) : 0;
      const Smin = P.base + off, Smax = Smin + P.spread + (P.mode === 'matched' ? 0.1 * Math.abs(off) : 0);
      const tn = g.tn, dnmin = dmin, dnmax = dmax;
      const m = Smin - 0 - dmax - P.tsu;
      const h = tn + dnmin - Smax - P.th;
      // captured epoch: aperture [Smin − tsu, Smax + th] against the two uncertain windows
      const a0 = Smin - P.tsu, a1 = Smax + P.th;
      const c0 = [dmin, dmax], c1 = [tn + dnmin, tn + dnmax];
      const ov = (c) => a0 < c[1] - EPS && a1 > c[0] + EPS;
      let ep, cert;
      if (a1 <= c0[0] + EPS) { ep = 'E−1'; cert = true; }
      else if (a0 >= c1[1] - EPS) { ep = 'E+1'; cert = true; }
      else if (a0 >= c0[1] - EPS && a1 <= c1[0] + EPS) { ep = 'E'; cert = true; }
      else { ep = ov(c0) && ov(c1) ? 'E−1…E+1' : ov(c0) ? 'E−1/E' : 'E/E+1'; cert = false; }
      return { i, g, dmin, dmax, dnmin, dnmax, tn, Smin, Smax, m, h, pass: m > 0 && h > 0, ep, cert, c0, c1 };
    });
    const allPass = rows.every((r) => r.pass);
    const certs = rows.every((r) => r.cert);
    const same = certs && rows.every((r) => r.ep === rows[0].ep);
    let joint;
    if (allPass) joint = { k: 'ok', zh: '所有组属于同一逻辑 epoch E —— 一致', en: 'All groups belong to the same logical epoch E — coherent' };
    else if (same) joint = { k: 'warn', zh: `各组一致但都取到 ${rows[0].ep}，而不是目标 epoch E`, en: `The groups agree with each other but all captured ${rows[0].ep}, not the target epoch E` };
    else if (certs) joint = { k: 'bad', zh: '各组都已稳定，但取到的 epoch 不同 —— 撕裂（“各自等稳定”并不够）', en: 'Every group is stable, but they captured different epochs — torn (“wait until each is stable” is not enough)' };
    else joint = { k: 'bad', zh: '至少一组落在不确定窗口内（亚稳/不确定），epoch 无法保证', en: 'At least one group samples inside its uncertain window (metastable / undetermined) — epoch not guaranteed' };
    return { k, rows, allPass, joint };
  }

  Book.registerWidget({
    id: 'matched-delay-sampling',
    group: 'snapshot',
    title: { zh: '路线 B：沿计数传播方向匹配采样时刻（式 13–15）', en: 'Route B: matching sampling instants along the count propagation (Eq. 13–15)' },
    summary: {
      zh: '目标逻辑边沿 t_E 之后，每个计数组 i 的数据在 [d_min, d_max] 内变化，下一次改写在 t_next + d_next^min。逐组画出“变化窗口 / 稳定窗口 / 采样窗口”，实时计算式 (15) 的建立余量 m_i 与保持余量 h_i，并检查所有组是否属于同一逻辑 epoch；可切换 PVT 角、匹配/共用采样时钟，并做蒙特卡洛余量直方图。',
      en: 'After the target logical edge t_E, group i data changes somewhere in [d_min, d_max]; the next rewrite lands at t_next + d_next^min. Per group, see the changing / stable / sampling windows, the live setup margin m_i and hold margin h_i of Eq. (15), and whether all groups belong to the same logical epoch. Switch PVT corner and matched vs. common sampling clock, and run a Monte-Carlo margin histogram.',
    },
    sections: ['r-7-2', 'r-4-4', 'r-4-9'],
    eqs: ['13', '14', '15'],
    keywords: ['matched delay', 'setup', 'hold', 'PVT', 'Zong', 'same epoch', '匹配延迟', '建立保持'],
    mount(root, api) {
      const st = { mode: 'matched', corner: 'typ', base: 0.5, spread: 0.1, tsu: 0.05, th: 0.03 };
      const id = 'md' + (++uid);
      let mcTimer = 0, mc = null;
      root.appendChild(W.h('style', null, CSS));
      const svgHost = W.h('div'), tblHost = W.h('div'), eqHost = W.h('div', { class: 'md-eq' }), mcHost = W.h('div'), jointHost = W.h('div', { style: { margin: '8px 0 0' } });

      const cMode = W.seg({ label: ['采样时钟', 'Sampling clock'], options: [{ value: 'matched', label: ['匹配链 CKS_i', 'Matched chain CKS_i'] }, { value: 'common', label: ['单一共用时钟', 'Single common clock'] }], value: st.mode, onChange: (v) => { st.mode = v; draw(); } });
      const cCor = W.seg({ label: ['PVT 角（示意缩放）', 'PVT corner (illustrative scale)'], options: [{ value: 'typ', label: ['典型 ×1', 'Typical ×1'] }, { value: 'slow', label: ['慢 ×1.4', 'Slow ×1.4'] }, { value: 'fast', label: ['快 ×0.65', 'Fast ×0.65'] }], value: st.corner, onChange: (v) => { st.corner = v; draw(); } });
      const cBase = W.slider({ label: ['基准采样时刻 t_S,0^min', 'Base sampling t_S,0^min'], min: 0, max: 3, step: 0.01, value: st.base, fmt: (v) => `${W.fmt(v, 2)} T₀`, onInput: (v) => { st.base = v; draw(); } });
      const cSp = W.slider({ label: ['采样时刻展宽', 'Sampling spread'], min: 0, max: 0.5, step: 0.01, value: st.spread, fmt: (v) => `${W.fmt(v, 2)} T₀`, onInput: (v) => { st.spread = v; draw(); } });
      const cSu = W.slider({ label: ['t_su', 't_su'], min: 0, max: 0.2, step: 0.005, value: st.tsu, fmt: (v) => `${W.fmt(v, 3)} T₀`, onInput: (v) => { st.tsu = v; draw(); } });
      const cH = W.slider({ label: ['t_h', 't_h'], min: 0, max: 0.2, step: 0.005, value: st.th, fmt: (v) => `${W.fmt(v, 3)} T₀`, onInput: (v) => { st.th = v; draw(); } });
      const apply = (o) => { Object.assign(st, o); cMode.value = st.mode; cCor.value = st.corner; cBase.value = st.base; cSp.value = st.spread; draw(); };
      const presets = [
        W.button(['匹配采样（各组稳定后采样）', 'Matched sampling (each group after it settles)'], () => apply({ mode: 'matched', corner: 'typ', base: 0.5, spread: 0.1 })),
        W.button(['单一共用时钟（等最慢组）', 'Single common clock (wait for slowest)'], () => apply({ mode: 'common', corner: 'typ', base: 1.45, spread: 0.1 })),
        W.button(['慢角破坏建立', 'Slow corner breaks setup'], () => apply({ mode: 'matched', corner: 'slow', base: 0.5, spread: 0.1 })),
        W.button(['快角破坏保持', 'Fast corner breaks hold'], () => apply({ mode: 'matched', corner: 'fast', base: 0.95, spread: 0.1 })),
      ];
      const mcBtn = W.button(['蒙特卡洛 4000 次', 'Monte-Carlo 4000 trials'], () => runMC());

      root.append(
        W.note(['理想化示意模型：时间单位 T₀，目标逻辑边沿 t_E = 0；三组延迟、t_next、角缩放系数都是本小部件的示意取值，不是文献或芯片数据（思路对应 Zong Fig.9 / CN105071798 的匹配读出，但不使用其数值）。', 'Idealized illustration: time unit T₀, target logical edge t_E = 0; the three groups\' delays, t_next and the corner scale factors are illustrative values of this widget, not source or chip data (the idea follows the matched read-out of Zong Fig.9 / CN105071798, but none of their numbers).'], 'warn'),
        W.controls(cMode, cCor),
        W.h('div', { class: 'md-sl' }, cBase, cSp, cSu, cH),
        W.controls(...presets),
        svgHost, jointHost, W.h('div', { class: 'md-tblw', style: { marginTop: '8px' } }, tblHost), eqHost,
        W.h('div', { class: 'md-h' }, W.L('蒙特卡洛：在各自范围内均匀抽取 d、d_next、t_S（固定种子）', 'Monte-Carlo: draw d, d_next, t_S uniformly within their ranges (fixed seed)')),
        W.controls(mcBtn), mcHost,
        W.note([
          '要点：必须对每一组验证 m_i > 0 且 h_i > 0（式 15）；而且所有组要针对同一个目标逻辑 epoch——“每组各自等到稳定再采”（例如单一共用时钟等最慢组）并不能保证采到同一拍：快组可能已被下一次改写覆盖。一致 = 属于同一逻辑 epoch，不是“同时锁存”。最终的统一重采样本身并不能证明中间级的建立/保持。',
          'Key point: verify m_i > 0 and h_i > 0 for every group (Eq. 15), and all groups must target the same logical epoch — “wait until each group is stable” (e.g. one common clock after the slowest group) does not guarantee the same cycle: the fast group may already be overwritten by its next update. Coherent = same logical epoch, not simultaneous latching, and a final uniform resampling does not by itself prove the intermediate setup/hold.']),
      );

      // ---------------------------------------------------------------- drawing
      const fm = (v) => (v >= 0 ? '+' : '−') + W.fmt(Math.abs(v), 3);
      function draw() {
        const M = model(st);
        const VW = 760, PL = 128, PR = 14, T0 = -0.15, T1 = 5.8, LH = 92, VH = 24 + LH * 3 + 26;
        const x = W.scale([T0, T1], [PL, VW - PR]);
        const svg = W.svg(VW, VH);
        const pid = id + 'h';
        svg.appendChild(W.s('defs', null, W.s('pattern', { id: pid, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, W.s('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--sig-err)', 'stroke-width': 2.4 }))));
        for (let t = 0; t <= 5; t++) {
          svg.appendChild(W.s('line', { x1: x(t), x2: x(t), y1: 12, y2: VH - 22, class: 'grid' }));
          svg.appendChild(W.s('text', { x: x(t), y: VH - 8, 'text-anchor': 'middle' }, t === 0 ? 't_E' : `t_E+${t}T₀`));
        }
        svg.appendChild(W.s('line', { x1: x(0), x2: x(0), y1: 12, y2: VH - 22, stroke: 'var(--fg)', 'stroke-width': 1.6 }));
        const cl = (a) => W.clamp(a, T0, T1);
        const rect = (a, b, y, h, props) => { a = cl(a); b = cl(b); return b - a > 1e-6 ? W.s('rect', { x: x(a), y, width: x(b) - x(a), height: h, ...props }) : null; };
        const lbl = (a, b, y, txt) => { a = cl(a); b = cl(b); return x(b) - x(a) > 26 ? W.s('text', { x: (x(a) + x(b)) / 2, y: y + 12, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10px;fill:var(--fg)' }, txt) : null; };
        M.rows.forEach((r) => {
          const y0 = 24 + r.i * LH, yd = y0, hd = 18, ys = y0 + 26, hs = 16;
          svg.appendChild(W.sL(r.g.zh, r.g.en, { x: 6, y: y0 + 13, class: 'lbl', style: 'font-size:10.5px' }));
          svg.appendChild(W.s('text', { x: 6, y: y0 + 28, style: 'font-size:10px' }, `t_next = ${W.fmt(r.tn, 1)}`));
          svg.appendChild(W.s('text', { x: 6, y: y0 + 41, style: 'font-size:10px' }, `d ∈ [${W.fmt(r.dmin, 2)}, ${W.fmt(r.dmax, 2)}]`));
          // data windows
          const segs = [
            [T0, r.dmin, 'var(--fg-2)', 0.16, 'E−1'], [r.dmax, r.tn + r.dnmin, 'var(--sig-low)', 0.35, 'E'], [r.tn + r.dnmax, T1, 'var(--fg-2)', 0.16, 'E+1'],
          ];
          for (const [a, b, c, o, t] of segs) {
            const e = rect(a, b, yd, hd, { fill: c, 'fill-opacity': o, stroke: c, 'stroke-width': 1 }); if (e) svg.appendChild(e);
            const l = lbl(a, b, yd, t); if (l) svg.appendChild(l);
          }
          for (const [a, b] of [r.c0, r.c1]) { const e = rect(a, b, yd, hd, { fill: `url(#${pid})`, stroke: 'var(--sig-err)', 'stroke-width': 1, 'fill-opacity': 0.9 }); if (e) svg.appendChild(e); }
          // t_next marker
          svg.appendChild(W.s('line', { x1: x(r.tn), x2: x(r.tn), y1: yd - 3, y2: yd + hd + 3, stroke: 'var(--sig-clk)', 'stroke-width': 1.4, 'stroke-dasharray': '3 2' }));
          // sampling window + aperture
          const a0 = r.Smin - st.tsu, a1 = r.Smax + st.th;
          svg.appendChild(W.s('rect', { x: x(a0), y: ys, width: Math.max(1, x(a1) - x(a0)), height: hs, fill: 'none', stroke: r.pass ? 'var(--sig-sel)' : 'var(--sig-err)', 'stroke-width': 1.2, 'stroke-dasharray': '3 2' }));
          svg.appendChild(W.s('rect', { x: x(r.Smin), y: ys + 2, width: Math.max(1.5, x(r.Smax) - x(r.Smin)), height: hs - 4, fill: 'var(--sig-sel)', 'fill-opacity': 0.55 }));
          svg.appendChild(W.sL('采样', 'sample', { x: x(a1) + 5, y: ys + 12, style: 'font-size:10px' }));
          // margins
          const txt = `m = ${fm(r.m)}   h = ${fm(r.h)}`;
          svg.appendChild(W.s('text', { x: PL, y: y0 + 62, class: 'mono', style: `font-size:11px;fill:${r.pass ? 'var(--good-ink)' : 'var(--critical-ink)'};font-weight:700` }, txt));
          svg.appendChild(W.sL(r.pass ? '通过' : '失败', r.pass ? 'PASS' : 'FAIL', { x: PL + 168, y: y0 + 62, style: `font-size:11px;font-weight:700;fill:${r.pass ? 'var(--good-ink)' : 'var(--critical-ink)'}` }));
          svg.appendChild(W.sL(`捕获：${r.ep}`, `captured: ${r.ep}`, { x: PL + 222, y: y0 + 62, style: 'font-size:11px' }));
        });
        W.clear(svgHost).append(svg, W.legend([
          { color: 'var(--sig-low)', label: ['稳定窗口（目标 epoch E）', 'stable window (target epoch E)'] },
          { color: 'var(--sig-err)', label: ['数据变化窗口 [d_min, d_max]', 'data-changing window [d_min, d_max]'] },
          { color: 'var(--sig-sel)', label: ['采样时刻范围 [t_S^min, t_S^max]（虚线框含 t_su / t_h）', 'sampling instants [t_S^min, t_S^max] (dashed box includes t_su / t_h)'] },
          { color: 'var(--sig-clk)', label: ['下一次改写 t_next', 'next rewrite t_next'], dash: true },
        ]));

        W.clear(jointHost).append(W.status(M.joint.k === 'ok' ? 'good' : M.joint.k === 'warn' ? 'warn' : 'bad', [M.joint.zh, M.joint.en]));

        // table
        const tb = W.h('table', { class: 'md-tbl' }, W.h('tr', null, ['组', '数据延迟 d', 't_S 范围', 'm_i（建立）', 'h_i（保持）', '捕获 epoch'].map((zh, j) => W.h('th', { class: j ? 'n' : '' }, W.L(zh, ['Group', 'Data delay d', 't_S range', 'm_i (setup)', 'h_i (hold)', 'Captured epoch'][j])))));
        for (const r of M.rows) {
          tb.appendChild(W.h('tr', null, W.h('td', null, W.L(r.g.zh, r.g.en)), W.h('td', { class: 'n' }, `[${W.fmt(r.dmin, 3)}, ${W.fmt(r.dmax, 3)}]`), W.h('td', { class: 'n' }, `[${W.fmt(r.Smin, 3)}, ${W.fmt(r.Smax, 3)}]`),
            W.h('td', { class: 'n' }, W.h('span', { style: { color: r.m > 0 ? 'var(--good-ink)' : 'var(--critical-ink)' } }, fm(r.m))),
            W.h('td', { class: 'n' }, W.h('span', { style: { color: r.h > 0 ? 'var(--good-ink)' : 'var(--critical-ink)' } }, fm(r.h))),
            W.h('td', { class: 'n' }, r.ep + (r.cert ? '' : ' ?'))));
        }
        W.clear(tblHost).appendChild(tb);
        // equation with worst-case numbers
        const w = M.rows.reduce((a, r) => (Math.min(r.m, r.h) < Math.min(a.m, a.h) ? r : a), M.rows[0]);
        const n3 = (v) => W.fmt(v, 3);
        W.clear(eqHost).append(
          W.tex(`m_i=t_{S,i}^{\\min}-t_E-d_i^{\\max}-t_{su,i},\\qquad h_i=t_{{\\rm next},i}+d_{{\\rm next},i}^{\\min}-t_{S,i}^{\\max}-t_{h,i}\\qquad(15)`, true),
          W.tex(`\\text{${W.txt(['最紧的组', 'tightest group'])} }i=${w.i}:\\ \\ m=${n3(w.Smin)}-0-${n3(w.dmax)}-${n3(st.tsu)}=${n3(w.m)},\\quad h=${n3(w.tn)}+${n3(w.dnmin)}-${n3(w.Smax)}-${n3(st.th)}=${n3(w.h)}`, true),
        );
        // invalidate MC on parameter change
        mc = null; clearTimeout(mcTimer); W.clear(mcHost).append(W.h('div', { style: { fontSize: '.78rem', color: 'var(--muted)' } }, W.L('参数已变更；点击“蒙特卡洛”重新统计。', 'Parameters changed; press “Monte-Carlo” to recompute.')));
      }

      // ---------------------------------------------------------------- Monte-Carlo
      function runMC() {
        clearTimeout(mcTimer);
        const M = model(st), N = 4000, CH = 1000, rnd = W.rng(20240607);
        const ms = [], hs = []; let ok = 0, done = 0;
        W.clear(mcHost).append(W.h('div', { style: { fontSize: '.78rem' } }, '…'));
        const step = () => {
          for (let n = 0; n < CH; n++) {
            let wm = Infinity, wh = Infinity;
            for (const r of M.rows) {
              const d = r.dmin + rnd() * (r.dmax - r.dmin), dn = r.dnmin + rnd() * (r.dnmax - r.dnmin), S = r.Smin + rnd() * (r.Smax - r.Smin);
              wm = Math.min(wm, S - d - st.tsu); wh = Math.min(wh, r.tn + dn - S - st.th);
            }
            ms.push(wm); hs.push(wh); if (wm > 0 && wh > 0) ok++;
          }
          done += CH;
          if (done < N) mcTimer = setTimeout(step, 0); else showMC(M, ms, hs, ok, N);
        };
        mcTimer = setTimeout(step, 0);
      }
      function showMC(M, ms, hs, ok, N) {
        const wcM = Math.min(...M.rows.map((r) => r.m)), wcH = Math.min(...M.rows.map((r) => r.h));
        const lo = Math.min(...ms, ...hs, wcM, wcH, -0.05), hi = Math.max(...ms, ...hs, 0.05);
        const VW = 760, VH = 190, nb = 28, PB = 34, PT = 22;
        const svg = W.svg(VW, VH);
        const hist = (arr, x0, x1, name, wc, colorOK) => {
          const x = W.scale([lo, hi], [x0, x1]);
          const bins = new Array(nb).fill(0);
          for (const v of arr) bins[Math.min(nb - 1, Math.floor(((v - lo) / (hi - lo)) * nb))]++;
          const mx = Math.max(...bins), y = W.scale([0, mx], [VH - PB, PT]);
          bins.forEach((c, i) => {
            const a = lo + ((hi - lo) * i) / nb, b = a + (hi - lo) / nb;
            svg.appendChild(W.s('rect', { x: x(a), y: y(c), width: Math.max(1, x(b) - x(a) - 1), height: VH - PB - y(c), fill: (a + b) / 2 > 0 ? colorOK : 'var(--sig-err)', 'fill-opacity': 0.7 }));
          });
          svg.appendChild(W.s('line', { x1: x(0), x2: x(0), y1: PT - 4, y2: VH - PB, stroke: 'var(--fg)', 'stroke-width': 1.5 }));
          svg.appendChild(W.s('line', { x1: x(wc), x2: x(wc), y1: PT - 4, y2: VH - PB, stroke: 'var(--sig-plan)', 'stroke-width': 1.8, 'stroke-dasharray': '4 3' }));
          svg.appendChild(W.s('line', { x1: x0, x2: x1, y1: VH - PB, y2: VH - PB, class: 'axis' }));
          for (const tk of W.ticks(lo, hi, 4)) svg.appendChild(W.s('text', { x: x(tk), y: VH - PB + 13, 'text-anchor': 'middle' }, W.fmt(tk, 2)));
          svg.appendChild(W.sL(name[0], name[1], { x: x0, y: 12, class: 'lbl' }));
        };
        hist(ms, 30, 370, ['最差组建立余量（实现值）/ T₀', 'worst-group setup margin (realized) / T₀'], wcM, 'var(--sig-low)');
        hist(hs, 410, 750, ['最差组保持余量（实现值）/ T₀', 'worst-group hold margin (realized) / T₀'], wcH, 'var(--sig-low)');
        const yld = ok / N;
        W.clear(mcHost).append(svg,
          W.legend([{ color: 'var(--sig-plan)', label: ['式 (15) 最坏情形 m / h', 'Eq. (15) worst-case m / h'], dash: true }, { color: 'var(--sig-err)', label: ['余量 < 0', 'margin < 0'] }]),
          W.h('div', { style: { marginTop: '4px' } }, W.status(yld >= 1 ? 'good' : yld > 0.5 ? 'warn' : 'bad', [`${N} 次中全部余量 > 0 的比例：${W.fmt(100 * yld, 1)} %`, `Trials with every margin > 0: ${W.fmt(100 * yld, 1)} % of ${N}`])),
          W.h('div', { style: { fontSize: '.76rem', color: 'var(--muted)', marginTop: '4px' } }, W.L('蒙特卡洛的实现值不会比式 (15) 的最坏情形更差；通过比例 < 100 % 时，式 (15) 必有某组失败。', 'Realized margins are never worse than the Eq. (15) worst case; a pass fraction below 100 % implies Eq. (15) fails for some group.')));
      }
      draw();
      return { destroy() { clearTimeout(mcTimer); } };
    },
  });
})();
