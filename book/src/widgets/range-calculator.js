/* range-calculator — report §9.5: ideal required TDC range from f0, divider, phase count, selection policy,
 * plus additive worst-case budget terms. IDEAL ARITHMETIC ONLY (not a chip specification):
 *   T0 = 1000/f0 [ps];  T_div = ratio·T0;  spacing = T_div / phases.
 *   nearest-phase:  ideal signed residual ∈ [−spacing/2, +spacing/2]
 *   following-phase: ideal residual ∈ [0, spacing)
 *   total range = ideal range extended on BOTH sides by the sum of the budget terms (worst-case additive, symmetric).
 */
(function () {
  'use strict';
  const CSS = `
.rc-tbl { width: 100%; border-collapse: collapse; font-size: .78rem; font-variant-numeric: tabular-nums; margin: 8px 0 0; }
.rc-tbl th, .rc-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; }
.rc-tbl td.n { text-align: right; font-family: var(--mono); white-space: nowrap; }
.rc-sl { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: 6px 18px; margin: 4px 0 8px; }
.rc-sl .w-ctl { justify-content: space-between; }
.rc-sl .w-ctl input[type=range] { width: 120px; }
.rc-h { margin: 12px 0 4px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.rc-eq { overflow-x: auto; overflow-y: hidden; }
`;
  const TERMS = [
    { key: 'pred', zh: '预测误差', en: 'Prediction error', color: 'var(--s4)' },
    { key: 'nonu', zh: '相位不均匀', en: 'Phase non-uniformity', color: 'var(--s3)' },
    { key: 'path', zh: '路径误差', en: 'Path error', color: 'var(--s6)' },
    { key: 'freq', zh: '瞬态频偏', en: 'Transient frequency offset', color: 'var(--s7)' },
    { key: 'guard', zh: '判决 guard', en: 'Decision guard', color: 'var(--s8)' },
  ];

  // DOM-free model
  function calc(P) {
    const T0 = 1000 / P.f0, Td = P.ratio * T0, sp = Td / P.phases;
    const B = TERMS.reduce((s, t) => s + P.b[t.key], 0);
    const ideal = P.policy === 'nearest' ? [-sp / 2, sp / 2] : [0, sp];
    const total = [ideal[0] - B, ideal[1] + B];
    return { T0, Td, sp, B, ideal, total, span: total[1] - total[0], idealSpan: sp, naive: sp / 2 };
  }

  Book.registerWidget({
    id: 'range-calculator',
    group: 'fine',
    title: { zh: 'TDC 量程估算器（理想算例 + 预算叠加）', en: 'TDC range calculator (ideal example + additive budget)' },
    summary: {
      zh: '由 f₀、分频比、相数和选沿策略推出相位间距与“理想残差范围”，再把预测误差、相位不均匀、路径误差、瞬态频偏、判决 guard 逐项叠加成所需 TDC 总量程。默认值复现书中例子：8 GHz → 125 ps → /4 → 500 ps → 八相 62.5 ps。',
      en: 'From f₀, divider ratio, phase count and selection policy, derive the phase spacing and the ideal residual range, then stack prediction error, phase non-uniformity, path error, transient frequency offset and decision guard into the total required TDC range. Defaults reproduce the book example: 8 GHz → 125 ps → /4 → 500 ps → eight phases 62.5 ps.',
    },
    sections: ['r-9-5'],
    eqs: [],
    keywords: ['TDC range', 'quantization', 'phase spacing', '量程', '八相', '选沿'],
    mount(root, api) {
      const st = { f0: 8, ratio: 4, phases: 8, policy: 'nearest', b: { pred: 0, nonu: 0, path: 0, freq: 0, guard: 0 } };
      root.appendChild(W.h('style', null, CSS));
      const barHost = W.h('div');
      const tblHost = W.h('div');
      const eqHost = W.h('div', { class: 'rc-eq' });
      const read = W.readout([
        { key: 'T0', label: ['T₀ = 1/f₀', 'T₀ = 1/f₀'] },
        { key: 'Td', label: ['分频后周期', 'Divided period'] },
        { key: 'sp', label: ['相位间距', 'Phase spacing'] },
        { key: 'ideal', label: ['理想残差范围', 'Ideal residual range'] },
        { key: 'total', label: ['所需总量程', 'Total required range'] },
      ]);

      const cF = W.slider({ label: ['f₀', 'f₀'], min: 1, max: 16, step: 0.5, value: st.f0, fmt: (v) => `${W.fmt(v, 1)} GHz`, onInput: (v) => { st.f0 = v; draw(); } });
      const cR = W.seg({ label: ['分频比', 'Divide ratio'], options: [2, 4, 8].map((v) => ({ value: v, label: '/' + v })), value: st.ratio, onChange: (v) => { st.ratio = +v; draw(); } });
      const cP = W.seg({ label: ['相数', 'Phases'], options: [4, 8, 16].map((v) => ({ value: v, label: String(v) })), value: st.phases, onChange: (v) => { st.phases = +v; draw(); } });
      const cPol = W.seg({ label: ['选沿策略', 'Selection policy'], options: [{ value: 'nearest', label: ['最近相位', 'Nearest phase'] }, { value: 'following', label: ['必须取后继相位', 'Must use following phase'] }], value: st.policy, onChange: (v) => { st.policy = v; draw(); } });
      const sl = {};
      const slRow = W.h('div', { class: 'rc-sl' });
      for (const t of TERMS) {
        sl[t.key] = W.slider({ label: [t.zh, t.en], min: 0, max: 40, step: 0.5, value: 0, fmt: (v) => `${W.fmt(v, 1)} ps`, onInput: (v) => { st.b[t.key] = v; draw(); } });
        slRow.appendChild(sl[t.key]);
      }
      const setAll = (o) => { for (const t of TERMS) { st.b[t.key] = o[t.key] || 0; sl[t.key].value = st.b[t.key]; } };
      const presets = [
        W.button(['书中理想例子（预算 0）', 'Book ideal example (budget 0)'], () => { Object.assign(st, { f0: 8, ratio: 4, phases: 8, policy: 'nearest' }); setAll({}); sync(); draw(); }),
        W.button(['后继相位策略', 'Following-phase policy'], () => { st.policy = 'following'; cPol.value = 'following'; draw(); }),
        W.button(['加入示例预算（各 5–10 ps）', 'Add sample budget (5–10 ps each)'], () => { setAll({ pred: 10, nonu: 5, path: 5, freq: 8, guard: 5 }); draw(); }),
      ];
      function sync() { cF.value = st.f0; cR.value = st.ratio; cP.value = st.phases; cPol.value = st.policy; }

      root.append(
        W.note(['理想化算术示例，不是芯片指标；预算项为用户输入的最坏情况加法叠加，书中未给出其数值。', 'Idealized arithmetic, not a chip specification. Budget terms are user-entered worst-case additive values; the book gives no numbers for them.'], 'warn'),
        W.controls(cF, cR, cP, cPol),
        W.h('div', { class: 'rc-h' }, W.L('额外预算项（默认 0）', 'Additional budget terms (default 0)')),
        slRow,
        W.controls(...presets),
        barHost, read.el, tblHost, eqHost,
        W.note([
          '要点：有八相并不等于 TDC 量程是 ±31.25 ps。最近相位选沿只在“选沿因果性成立”时才给出 ±间距/2；必须取后继相位时理想范围是 [0, 间距)；再叠加预测误差、相位不均匀、路径误差、瞬态频偏与判决 guard。量程必须由真实测量流程导出（第 8.3 节）。',
          'Key point: having eight phases does not by itself make the TDC range ±31.25 ps. ±spacing/2 holds for nearest-phase selection only if the selection causality is satisfied; with a must-use-following-phase policy the ideal range is [0, spacing); prediction error, phase non-uniformity, path error, transient frequency offset and decision guard come on top. The range must be derived from the actual measurement flow (Section 8.3).']),
      );

      function draw() {
        const r = calc(st);
        const f = (v) => W.fmt(v, 2);
        read.set('T0', `${f(r.T0)} ps`);
        read.set('Td', `${f(r.Td)} ps`);
        read.set('sp', `${f(r.sp)} ps`);
        read.set('ideal', st.policy === 'nearest' ? `±${f(r.sp / 2)} ps` : `[0, ${f(r.sp)}) ps`);
        read.set('total', `${f(r.total[0])} … ${f(r.total[1])} ps (${f(r.span)} ps)`);

        // ---- bar chart
        const VW = 760, PADL = 20, PADR = 20, VH = 214;
        const lim = Math.max(Math.abs(r.total[0]), Math.abs(r.total[1]), r.sp / 2 + 1) * 1.12;
        const x = W.scale([-lim, lim], [PADL, VW - PADR]);
        const svg = W.svg(VW, VH);
        const ax = 160;
        for (const tk of W.ticks(-lim, lim, 8)) {
          svg.appendChild(W.s('line', { x1: x(tk), x2: x(tk), y1: 24, y2: ax, class: 'grid' }));
          svg.appendChild(W.s('text', { x: x(tk), y: ax + 14, 'text-anchor': 'middle' }, W.fmt(tk, 1)));
        }
        svg.appendChild(W.s('line', { x1: x(0), x2: x(0), y1: 20, y2: ax, class: 'axis', style: 'stroke-width:1.6' }));
        svg.appendChild(W.sL('残差 / ps（0 = 所选边沿）', 'residual / ps (0 = the selected edge)', { x: VW / 2, y: ax + 32, 'text-anchor': 'middle' }));
        // row 1: ideal range
        svg.appendChild(W.sL('理想范围', 'Ideal range', { x: PADL, y: 22, class: 'lbl' }));
        svg.appendChild(W.s('rect', { x: x(r.ideal[0]), y: 30, width: x(r.ideal[1]) - x(r.ideal[0]), height: 24, fill: 'var(--sig-fine)', 'fill-opacity': 0.35, stroke: 'var(--sig-fine)', 'stroke-width': 1.6 }));
        svg.appendChild(W.s('text', { x: (x(r.ideal[0]) + x(r.ideal[1])) / 2, y: 46, 'text-anchor': 'middle', class: 'mono', style: 'fill:var(--fg);font-size:11px' }, `${f(r.sp)} ps`));
        // row 2: stacked budget on both sides
        svg.appendChild(W.sL('叠加预算 → 总量程', 'Stacked budget → total range', { x: PADL, y: 100, class: 'lbl' }));
        svg.appendChild(W.s('rect', { x: x(r.ideal[0]), y: 108, width: x(r.ideal[1]) - x(r.ideal[0]), height: 26, fill: 'var(--sig-fine)', 'fill-opacity': 0.35, stroke: 'var(--sig-fine)', 'stroke-width': 1.2 }));
        let lo = r.ideal[0], hi = r.ideal[1];
        for (const t of TERMS) {
          const b = st.b[t.key];
          if (!(b > 0)) continue;
          svg.appendChild(W.s('rect', { x: x(hi), y: 108, width: x(hi + b) - x(hi), height: 26, fill: t.color, 'fill-opacity': 0.55, stroke: t.color }));
          svg.appendChild(W.s('rect', { x: x(lo - b), y: 108, width: x(lo) - x(lo - b), height: 26, fill: t.color, 'fill-opacity': 0.55, stroke: t.color }));
          hi += b; lo -= b;
        }
        svg.appendChild(W.s('line', { x1: x(r.total[0]), x2: x(r.total[0]), y1: 104, y2: 138, stroke: 'var(--fg)', 'stroke-width': 2 }));
        svg.appendChild(W.s('line', { x1: x(r.total[1]), x2: x(r.total[1]), y1: 104, y2: 138, stroke: 'var(--fg)', 'stroke-width': 2 }));
        svg.appendChild(W.s('text', { x: x(r.total[0]) - 4, y: 152, 'text-anchor': 'end', class: 'mono', style: 'fill:var(--fg);font-size:11px' }, f(r.total[0])));
        svg.appendChild(W.s('text', { x: x(r.total[1]) + 4, y: 152, 'text-anchor': 'start', class: 'mono', style: 'fill:var(--fg);font-size:11px' }, f(r.total[1])));
        // naive ±spacing/2 marker (only a reference)
        for (const s of [-1, 1]) {
          svg.appendChild(W.s('line', { x1: x(s * r.naive), x2: x(s * r.naive), y1: 58, y2: 74, stroke: 'var(--sig-err)', 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }));
        }
        svg.appendChild(W.sL(`虚线：±${f(r.naive)} ps（仅“最近相位”理想值，不可直接当量程）`, `dashed: ±${f(r.naive)} ps (ideal nearest-phase value only — not to be used as the range directly)`, { x: x(0), y: 84, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--sig-err)' }));
        const wrap = W.h('div', null, svg, W.legend([{ color: 'var(--sig-fine)', label: ['理想残差范围', 'Ideal residual range'] }, ...TERMS.filter((t) => st.b[t.key] > 0).map((t) => ({ color: t.color, label: [t.zh, t.en] }))]));
        W.clear(barHost).appendChild(wrap);

        // ---- table
        const rows = [
          [['T₀', 'T₀'], `${f(r.T0)} ps`, '1000 / f₀[GHz]'],
          [['分频后周期', 'Divided period'], `${f(r.Td)} ps`, `/${st.ratio} × T₀`],
          [['相位间距', 'Phase spacing'], `${f(r.sp)} ps = ${W.fmt(st.ratio / st.phases, 3)} T₀`, `${f(r.Td)} / ${st.phases}`],
          [['理想残差范围宽度', 'Ideal range width'], `${f(r.sp)} ps`, st.policy === 'nearest' ? ['最近相位：±间距/2', 'nearest: ±spacing/2'] : ['后继相位：[0, 间距)', 'following: [0, spacing)']],
          [['预算总和（每侧）', 'Budget sum (each side)'], `${f(r.B)} ps`, ['各项直接相加（最坏情况）', 'terms added directly (worst case)']],
          [['所需总量程宽度', 'Total required width'], `${f(r.span)} ps`, `${f(r.sp)} + 2 × ${f(r.B)}`],
        ];
        const tb = W.h('table', { class: 'rc-tbl' });
        for (const [k, v, n] of rows) tb.appendChild(W.h('tr', null, W.h('th', null, W.lbl(k)), W.h('td', { class: 'n' }, v), W.h('td', null, Array.isArray(n) ? W.lbl(n) : n)));
        W.clear(tblHost).appendChild(tb);

        const tx = (v) => W.fmt(v, 2);
        const e = st.policy === 'nearest'
          ? `T_0=\\tfrac{1}{${tx(st.f0)}\\,\\mathrm{GHz}}=${tx(r.T0)}\\,\\mathrm{ps},\\quad \\Delta\\phi=\\tfrac{${st.ratio}\\,T_0}{${st.phases}}=${tx(r.sp)}\\,\\mathrm{ps},\\quad R_{\\rm ideal}=\\pm\\tfrac{\\Delta\\phi}{2}=\\pm${tx(r.sp / 2)}\\,\\mathrm{ps}`
          : `T_0=\\tfrac{1}{${tx(st.f0)}\\,\\mathrm{GHz}}=${tx(r.T0)}\\,\\mathrm{ps},\\quad \\Delta\\phi=\\tfrac{${st.ratio}\\,T_0}{${st.phases}}=${tx(r.sp)}\\,\\mathrm{ps},\\quad R_{\\rm ideal}=[0,\\Delta\\phi)=[0,${tx(r.sp)})\\,\\mathrm{ps}`;
        W.clear(eqHost).appendChild(W.tex(e, false));
      }
      sync(); draw();
      const off = api.onLang && api.onLang(() => draw());
      return { destroy() { if (typeof off === 'function') off(); } };
    },
  });
})();
