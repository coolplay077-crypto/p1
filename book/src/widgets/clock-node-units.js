/* clock-node-units — report §3.1, §4.5, §4.9: the clock node chosen as CK0 fixes ALL units.
 *
 * Idealized bookkeeping model (frequencies in GHz, periods in ps; NOT chip data):
 *   oscillator f_osc → up to three ideal divider stages (/1,/2,/4,/8) → nodes N0 (oscillator), N1, N2, N3.
 *   The user designates one node as CK0 (the node whose cycle index is preserved by the CNT).
 *   For every node: f, T, r = T / T_osc (oscillator cycles per node cycle), FCW = f / f_ref (f_ref is a USER parameter),
 *   μ = Δt / T (fine normalisation), and the spacing of an optional eight-phase grid on a chosen node expressed in that
 *   row's own CK0 units (Δφ = T_P / 8 / T_row).  A split counter clocked by CK0 has weights: q = 1 CK0 cycle,
 *   C = M CK0 cycles, both converted to oscillator cycles.
 */
(function () {
  'use strict';
  const CSS = `
.cn-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); margin-top: 10px; }
.cn-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; font-variant-numeric: tabular-nums; margin: 0; }
.cn-tbl th, .cn-tbl td { padding: 4px 6px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
.cn-tbl th:first-child, .cn-tbl td:first-child { text-align: left; }
.cn-tbl th { background: var(--surface-2); font-weight: 650; position: static; }
.cn-tbl tr:last-child td { border-bottom: 0; }
.cn-tbl tr.sel td { background: var(--accent-wash); font-weight: 650; }
.cn-tbl td.mono { font-family: var(--mono); }
.cn-h { margin: 14px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.cn-band { font-size: .78rem; color: var(--fg-2); margin: 4px 0 0; }
.cn-ws { cursor: pointer; }
`;
  const RATIOS = [1, 2, 4, 8];
  const N = 4;

  function model(S) {
    const f = [S.fosc], r = [1];
    for (let i = 0; i < 3; i++) { f.push(f[i] / S.div[i]); r.push(r[i] * S.div[i]); }
    const nodes = f.map((fi, i) => ({ i, f: fi, T: 1000 / fi, r: r[i] }));
    const Tosc = nodes[0].T;
    const k = nodes[S.ck0];
    const fcw = (nd) => nd.f * 1000 / S.fref; // GHz→MHz
    for (const nd of nodes) {
      nd.fcw = fcw(nd);
      nd.mu = S.dt / nd.T;
      nd.phi = S.phase >= 0 ? nodes[S.phase].T / 8 / nd.T : null;
      nd.wq = nd.r; nd.wC = S.M * nd.r;
    }
    return { nodes, Tosc, ck0: k, phaseNode: S.phase >= 0 ? nodes[S.phase] : null };
  }

  Book.registerWidget({
    id: 'clock-node-units',
    group: 'phase',
    title: { zh: '时钟节点与单位换算：CK₀ 选在哪里', en: 'Clock nodes and unit conversion: where CK₀ is taken' },
    summary: {
      zh: '振荡器后接可配置的预分频级，选择哪个节点作为 CK₀（需要完整保留周期编号的节点）。T₀、CNT 一个计数的权重、FCW、fine 归一化 μ = Δt/T₀、八相间距、分组计数低位权重会一起变化；Kuo 的 T_V/8 = T₀/2 单位陷阱在此可直接看到。',
      en: 'An oscillator followed by configurable prescaler stages; choose which node is CK₀ (the node whose cycle index must be preserved). T₀, the weight of one CNT count, FCW, the fine normalisation μ = Δt/T₀, the eight-phase spacing and the low-bit weights of a split counter all change together — the Kuo "T_V/8 = T₀/2" unit trap is visible directly.',
    },
    sections: ['r-3-1', 'r-4-5', 'r-4-9'],
    eqs: [],
    keywords: ['CKV', 'CK0', 'prescaler', 'FCW', 'unit', 'Kuo', 'Zong', '预分频', '时钟节点', '单位'],
    mount(root, api) {
      if (!document.getElementById('cn-css')) { const s = document.createElement('style'); s.id = 'cn-css'; s.textContent = CSS; document.head.appendChild(s); }
      const S = { fosc: 7.05, div: [4, 1, 1], ck0: 0, phase: 1, M: 8, fref: 100, dt: 20, band: [5.7, 8.4] };
      const PRESETS = {
        kuo: { fosc: 7.05, div: [4, 1, 1], ck0: 0, phase: 1, M: 8, band: [5.7, 8.4] },
        zong: { fosc: 20, div: [4, 2, 1], ck0: 2, phase: -1, M: 4, band: null },
        bogdan: { fosc: 8, div: [1, 1, 1], ck0: 0, phase: -1, M: 8, band: null },
      };

      const svgHost = W.h('div');
      const tblHost = W.h('div');
      const bandHost = W.h('div', { class: 'cn-band' });
      const wfHost = W.h('div');
      const read = W.readout([
        { key: 'f0', label: ['f₀（所选 CK₀）', 'f₀ (selected CK₀)'] },
        { key: 'T0', label: ['T₀', 'T₀'] },
        { key: 'cnt', label: ['低位 q 加 1 的权重', 'Weight of one low count (q + 1)'] },
        { key: 'C', label: ['高位 C 加 1 的权重', 'Weight of one high count (C + 1)'] },
        { key: 'fcw', label: ['FCW = f₀ / f_ref', 'FCW = f₀ / f_ref'] },
        { key: 'mu', label: ['μ = Δt / T₀', 'μ = Δt / T₀'] },
        { key: 'phi', label: ['八相间距 (T₀ 单位)', '8-phase spacing (T₀ units)'] },
      ]);

      const ctl = {};
      ctl.fosc = W.slider({ label: ['振荡器 f_osc', 'Oscillator f_osc'], min: 1, max: 25, step: 0.05, value: S.fosc, fmt: (v) => `${W.fmt(v, 2)} GHz`, onInput: (v) => { S.fosc = v; draw(); } });
      ctl.d = [0, 1, 2].map((i) => W.seg({ label: [`分频级 ${i + 1}`, `Stage ${i + 1}`], options: RATIOS.map((v) => ({ value: v, label: v === 1 ? '/1' : '/' + v })), value: S.div[i], onChange: (v) => { S.div[i] = +v; draw(); } }));
      ctl.ck0 = W.seg({ label: ['CK₀ 节点', 'CK₀ node'], options: [0, 1, 2, 3].map((i) => ({ value: i, label: 'N' + i })), value: S.ck0, onChange: (v) => { S.ck0 = +v; draw(); } });
      ctl.phase = W.seg({ label: ['八相网格所在节点', '8-phase grid on node'], options: [{ value: -1, label: ['无', 'none'] }, ...[0, 1, 2, 3].map((i) => ({ value: i, label: 'N' + i }))], value: S.phase, onChange: (v) => { S.phase = +v; draw(); } });
      ctl.M = W.seg({ label: ['分组倍率 M', 'Group ratio M'], options: [{ value: 4, label: 'M = 4' }, { value: 8, label: 'M = 8' }], value: S.M, onChange: (v) => { S.M = +v; draw(); } });
      ctl.fref = W.slider({ label: ['f_ref（用户参数）', 'f_ref (user parameter)'], min: 10, max: 400, step: 1, value: S.fref, fmt: (v) => `${v} MHz`, onInput: (v) => { S.fref = v; draw(); } });
      ctl.dt = W.slider({ label: ['示例 fine 间隔 Δt', 'Example fine interval Δt'], min: -100, max: 100, step: 1, value: S.dt, fmt: (v) => `${v} ps`, onInput: (v) => { S.dt = v; draw(); } });

      function apply(name) {
        const p = PRESETS[name];
        Object.assign(S, { fosc: p.fosc, div: p.div.slice(), ck0: p.ck0, phase: p.phase, M: p.M, band: p.band });
        ctl.fosc.value = S.fosc; ctl.d.forEach((c, i) => { c.value = S.div[i]; });
        ctl.ck0.value = S.ck0; ctl.phase.value = S.phase; ctl.M.value = S.M;
        draw();
      }
      const presets = W.controls(
        W.h('span', { class: 'w-ctl' }, W.L('预设：', 'Presets:')),
        W.button(['Kuo 2018 [R06]：DCO → /4 → 八相', 'Kuo 2018 [R06]: DCO → /4 → 8 phases'], () => apply('kuo')),
        W.button(['Zong 2019 [R11]：≈20 GHz → /4 → /2 → CKV', 'Zong 2019 [R11]: ≈20 GHz → /4 → /2 → CKV'], () => apply('zong')),
        W.button(['Bogdan 基线：原始 CKV', 'Bogdan baseline: raw CKV'], () => apply('bogdan')),
      );

      root.append(
        presets,
        W.controls(ctl.fosc, ctl.fref, ctl.dt),
        W.controls(...ctl.d, ctl.M),
        W.controls(ctl.ck0, ctl.phase),
        bandHost,
        svgHost, wfHost,
        W.h('div', { class: 'cn-h' }, W.L('所选 CK₀ 下的全部换算', 'All conversions for the selected CK₀')),
        read.el,
        W.h('div', { class: 'cn-h' }, W.L('同一链上每个节点若被选作 CK₀ 的对比（μ、FCW、权重、八相间距都随之改变）', 'If each node on the chain were chosen as CK₀ (μ, FCW, weights and phase spacing all change)')),
        tblHost,
        W.note([
          '要点（§3.1）：改变 CK₀ 就必须把 CNT 权重、FCW、fine 归一化和 edge ID 一起换算。表中每一行都是自洽的一套单位，混用不同行的数就是单位错误。f_ref 是你输入的参数，论文并未给出可直接套用的值。本图为理想分频的单位记账示意，不是电路。预设中仅使用书中所述数字：Kuo 的 DCO 调谐范围 5.7–8.4 GHz（/4 后 1.425–2.1 GHz）、八相间距 T_V/8 = T₀/2（相对 /4 之前的周期）；Zong 的约 20 GHz 基波经 /4、/2 后进入 CKV，其计数器的低 2 位每计 1 对应 8 个基波周期。',
          'Key points (§3.1): changing CK₀ requires converting the CNT weights, FCW, fine normalisation and edge IDs together. Each table row is one self-consistent set of units; mixing numbers from different rows is a unit error. f_ref is a parameter you enter — the papers give no value to plug in here. This is idealized unit bookkeeping for ideal dividers, not a circuit. The presets use only numbers stated in the book: Kuo\'s DCO tuning range 5.7–8.4 GHz (1.425–2.1 GHz after /4) and eight-phase spacing T_V/8 = T₀/2 (relative to the pre-/4 period); Zong\'s ≈20 GHz fundamental through /4 and /2 into CKV, whose counter\'s 2-bit low part counts CKV cycles, each = 8 fundamental cycles.',
        ]),
      );

      const nodeName = (i) => ['N0', 'N1', 'N2', 'N3'][i];

      function drawChain(m) {
        const VW = 760, VH = 108;
        const svg = W.svg(VW, VH);
        const bx = [16, 212, 408, 604], bw = 140, y0 = 30, bh = 56;
        // dividers between nodes
        for (let i = 0; i < N; i++) {
          const sel = i === S.ck0;
          const nd = m.nodes[i];
          const g = W.s('g', { class: 'cn-ws', onClick: () => { S.ck0 = i; ctl.ck0.value = i; draw(); } });
          g.appendChild(W.s('rect', { x: bx[i], y: y0, width: bw, height: bh, rx: 10, style: `fill:${sel ? 'var(--accent-wash)' : 'var(--surface-2)'};stroke:${sel ? 'var(--accent)' : 'var(--border-strong)'};stroke-width:${sel ? 2.4 : 1.2}` }));
          g.appendChild(W.s('text', { x: bx[i] + 10, y: y0 + 19, class: 'lbl' }, i === 0 ? 'N0' : 'N' + i));
          g.appendChild(W.sL(i === 0 ? '振荡器' : '分频输出', i === 0 ? 'oscillator' : 'divider out', { x: bx[i] + 34, y: y0 + 19, style: 'font-size:10px' }));
          g.appendChild(W.s('text', { x: bx[i] + 10, y: y0 + 37, style: 'font-size:11.5px;fill:var(--fg)' }, `${W.fmt(nd.f, 4)} GHz`));
          g.appendChild(W.s('text', { x: bx[i] + 10, y: y0 + 51, style: 'font-size:10.5px' }, `T = ${W.fmt(nd.T, 2)} ps`));
          if (sel) {
            g.appendChild(W.s('rect', { x: bx[i] + bw - 42, y: y0 - 9, width: 38, height: 17, rx: 8, style: 'fill:var(--accent)' }));
            g.appendChild(W.s('text', { x: bx[i] + bw - 23, y: y0 + 3, 'text-anchor': 'middle', style: 'fill:#fff;font-size:10.5px;font-weight:700' }, 'CK₀'));
          }
          if (m.phaseNode && m.phaseNode.i === i) {
            g.appendChild(W.s('rect', { x: bx[i] + 4, y: y0 + bh + 4, width: bw - 8, height: 14, rx: 7, style: 'fill:var(--sig-fine);fill-opacity:.2;stroke:var(--sig-fine)' }));
            g.appendChild(W.sL('八相网格', '8-phase grid', { x: bx[i] + bw / 2, y: y0 + bh + 14.5, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--fg)' }));
          }
          svg.appendChild(g);
          if (i < N - 1) {
            const xa = bx[i] + bw, xb = bx[i + 1], ym = y0 + bh / 2;
            svg.appendChild(W.s('line', { x1: xa + 2, x2: xb - 7, y1: ym, y2: ym, style: 'stroke:var(--fg-2);stroke-width:1.6' }));
            svg.appendChild(W.s('path', { d: `M${xb - 8},${ym - 4}L${xb - 1},${ym}L${xb - 8},${ym + 4}Z`, style: 'fill:var(--fg-2)' }));
            const dv = S.div[i];
            svg.appendChild(W.s('text', { x: (xa + xb) / 2 - 2, y: ym - 7, 'text-anchor': 'middle', style: 'font-size:12px;font-weight:700;fill:var(--fg)' }, dv === 1 ? '/1' : '/' + dv));
          }
        }
        svg.appendChild(W.sL('点击节点以选作 CK₀', 'Click a node to make it CK₀', { x: 16, y: 14, style: 'font-size:10px' }));
        W.clear(svgHost).appendChild(svg);
      }

      function drawWave(m) {
        // time axis in oscillator periods; window = 3 periods of the slower of CK0 / grid node (cap 48 osc cycles of detail)
        const VW = 760, LBL = 62, R = 14;
        const k = m.ck0, P = m.phaseNode;
        const span = 3 * Math.max(k.r, P ? P.r : 1);
        const x = W.scale([0, span], [LBL, VW - R]);
        const rows = [0, 1, 2, 3].map((i) => ({ i }));
        const rowH = 22, gap = 10;
        const VH = 18 + rows.length * (rowH + gap) + (P ? 34 : 0) + 8;
        const svg = W.svg(VW, VH);
        let y = 18;
        for (const row of rows) {
          const nd = m.nodes[row.i];
          const top = y, bot = y + rowH;
          const sel = row.i === k.i;
          svg.appendChild(W.s('text', { x: 6, y: y + 15, class: 'lbl' }, nodeName(row.i) + (sel ? ' = CK₀' : '')));
          const pxPer = x(nd.r) - x(0);
          if (pxPer < 3.6) {
            svg.appendChild(W.s('rect', { x: x(0), y: top + 2, width: x(span) - x(0), height: rowH - 4, rx: 3, style: `fill:var(--sig-clk);fill-opacity:.22;stroke:var(--sig-clk);stroke-width:1` }));
            svg.appendChild(W.sL(`密集（${W.fmt(span / nd.r, 0)} 个周期）`, `dense (${W.fmt(span / nd.r, 0)} cycles)`, { x: (x(0) + x(span)) / 2, y: y + 15, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--fg)' }));
          } else {
            const edges = W.clockEdges(nd.r, 0, 0, span);
            svg.appendChild(W.s('path', { d: W.digitalPath(edges, 0, x, top, bot, 0, span), fill: 'none', stroke: sel ? 'var(--sig-clk)' : 'var(--fg-2)', 'stroke-width': sel ? 2.2 : 1.4, 'stroke-linejoin': 'round' }));
          }
          y += rowH + gap;
        }
        // CK0 rising edge guide lines
        const kp = x(k.r) - x(0);
        for (let e = 0; e * k.r <= span + 1e-9; e++) {
          svg.appendChild(W.s('line', { x1: x(e * k.r), x2: x(e * k.r), y1: 12, y2: VH - (P ? 34 : 6) - 2, class: 'grid', style: kp > 3 ? 'stroke-dasharray:3 3' : 'display:none' }));
        }
        if (P) {
          const ty = y + 8;
          svg.appendChild(W.sL('八相', '8 ph.', { x: 6, y: ty + 4, class: 'lbl' }));
          svg.appendChild(W.s('line', { x1: x(0), x2: x(span), y1: ty, y2: ty, class: 'axis' }));
          const nTick = Math.round(span / (P.r / 8));
          const showAll = (x(P.r / 8) - x(0)) > 4;
          for (let j = 0; j <= nTick; j++) {
            const tt = j * P.r / 8;
            const major = j % 8 === 0;
            if (!showAll && !major) continue;
            svg.appendChild(W.s('line', { x1: x(tt), x2: x(tt), y1: ty - (major ? 8 : 5), y2: ty + (major ? 8 : 5), style: `stroke:${major ? 'var(--sig-fine)' : 'var(--fg-2)'};stroke-width:${major ? 2 : 1}` }));
          }
          // spacing brace between first two ticks
          const ax = x(0), bxx = x(P.r / 8);
          svg.appendChild(W.s('path', { d: `M${ax},${ty + 14}L${ax},${ty + 18}L${bxx},${ty + 18}L${bxx},${ty + 14}`, style: 'fill:none;stroke:var(--sig-fine);stroke-width:1.4' }));
          svg.appendChild(W.s('text', { x: bxx + 5, y: ty + 22, style: 'font-size:10.5px;fill:var(--fg)' }, `T_${nodeName(P.i)}/8 = ${W.fmt(P.T / 8, 2)} ps = ${W.fmt(P.r / 8 / k.r, 3)} T₀`));
        }
        svg.appendChild(W.sL(`横轴：${W.fmt(span, 0)} 个 N0 周期`, `time axis: ${W.fmt(span, 0)} N0 periods`, { x: VW - R, y: 12, 'text-anchor': 'end', style: 'font-size:10px' }));
        W.clear(wfHost).appendChild(svg);
      }

      function draw() {
        const m = model(S);
        const k = m.ck0;
        const outOfBand = S.band && (S.fosc < S.band[0] - 1e-9 || S.fosc > S.band[1] + 1e-9);
        W.clear(bandHost);
        if (S.band) {
          bandHost.append(W.L(
            `Kuo [R06] 实验给出的 DCO 调谐范围 ${S.band[0]}–${S.band[1]} GHz；/4 后 ${W.fmt(S.band[0] / 4, 3)}–${W.fmt(S.band[1] / 4, 3)} GHz。当前 f_osc ${outOfBand ? '超出' : '处于'}该范围。`,
            `Kuo [R06] reports a DCO tuning range of ${S.band[0]}–${S.band[1]} GHz; after /4 that is ${W.fmt(S.band[0] / 4, 3)}–${W.fmt(S.band[1] / 4, 3)} GHz. The current f_osc is ${outOfBand ? 'outside' : 'inside'} that range.`));
        }
        drawChain(m);
        drawWave(m);
        read.set('f0', `${W.fmt(k.f, 4)} GHz`);
        read.set('T0', `${W.fmt(k.T, 3)} ps`);
        read.set('cnt', `${k.r} ${api.t('个 N0 周期', 'N0 cycles')} = ${W.fmt(k.T, 2)} ps`);
        read.set('C', `${S.M}·T₀ = ${S.M * k.r} ${api.t('个 N0 周期', 'N0 cycles')} = ${W.fmt(S.M * k.T, 2)} ps`);
        read.set('fcw', W.fmt(k.fcw, 3));
        read.set('mu', `${S.dt} / ${W.fmt(k.T, 2)} = ${W.fmt(k.mu, 4)}`);
        read.set('phi', m.phaseNode ? `${W.fmt(k.phi, 4)}` : '—');
        // comparison table
        const tbl = W.h('table', { class: 'cn-tbl' });
        tbl.appendChild(W.h('thead', null, W.h('tr', null,
          W.h('th', null, W.L('若 CK₀ =', 'If CK₀ =')),
          W.h('th', null, 'f (GHz)'), W.h('th', null, 'T (ps)'),
          W.h('th', null, W.L('q 权重(N0)', 'q wt (N0)')),
          W.h('th', null, W.L('C 权重(N0)', 'C wt (N0)')),
          W.h('th', null, 'FCW'),
          W.h('th', null, `μ=${S.dt}ps/T`),
          W.h('th', null, W.L('八相间距/T₀', '8-ph. gap/T₀')))));
        const tb = W.h('tbody');
        for (const nd of m.nodes) {
          tb.appendChild(W.h('tr', { class: nd.i === S.ck0 ? 'sel' : '' },
            W.h('td', null, nodeName(nd.i) + (nd.i === S.ck0 ? ' ◀ CK₀' : '')),
            W.h('td', null, W.fmt(nd.f, 4)), W.h('td', null, W.fmt(nd.T, 2)),
            W.h('td', null, nd.wq), W.h('td', null, nd.wC),
            W.h('td', null, W.fmt(nd.fcw, 3)), W.h('td', null, W.fmt(nd.mu, 4)),
            W.h('td', null, nd.phi == null ? '—' : W.fmt(nd.phi, 4))));
        }
        tbl.appendChild(tb);
        W.clear(tblHost).appendChild(W.h('div', { class: 'cn-tblw' }, tbl));
      }
      draw();
      const off = api.onLang(() => draw());
      return { destroy() { off && off(); } };
    },
  });
})();
