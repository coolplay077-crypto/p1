/* saturation-tdc — report §9.1: a short TDC saturates, Q(1.5R) = Q(3R) = R; digital modulo is not analog range.
 *   Q(x) = clamp(round(x/LSB), −R/LSB, +R/LSB)   (two-sided saturation, idealized, no noise/INL)
 * x is the physical time difference at the TDC pins; it is NOT shortened by the integer counter (CNT).
 * L06 (research/verify_invariants.py) is re-run live with exact rationals (W.Frac).
 */
(function () {
  'use strict';
  const CSS = `
.st-h { margin: 14px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.st-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; font-variant-numeric: tabular-nums; margin: 0; }
.st-tbl th, .st-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
.st-tbl th { background: var(--surface-2); font-weight: 650; white-space: nowrap; }
.st-tbl td.n { text-align: right; font-family: var(--mono); white-space: nowrap; }
.st-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.st-svgw { touch-action: pan-y; cursor: ew-resize; }
.st-eq { overflow-x: auto; overflow-y: hidden; }
`;
  const half = (v) => Math.floor(v + 0.5); // round half up (symmetric enough for a toy; ties are measure-zero)

  function Q(x, Rc, LSB) { return W.clamp(half(x / LSB), -Rc, Rc); }

  Book.registerWidget({
    id: 'saturation-tdc',
    group: 'fine',
    title: { zh: 'TDC 饱和不可逆：Q(1.5R) = Q(3R)', en: 'TDC saturation is not invertible: Q(1.5R) = Q(3R)' },
    summary: {
      zh: '两侧饱和的 TDC 传递函数 Q(x) = clamp(round(x/LSB), −R/LSB, +R/LSB)。拖动输入 x：超过量程的所有输入落到同一个码，之后再做数字取模/减整周期也无法恢复；CNT 能表示多周期差，但并不缩短 TDC 引脚上的物理时间间隔。',
      en: 'Two-sided saturating TDC transfer Q(x) = clamp(round(x/LSB), −R/LSB, +R/LSB). Drag the input x: every input beyond the range maps to the same code, and subtracting integer periods digitally afterwards cannot recover it. The CNT can represent multi-cycle differences but does not shorten the physical interval at the TDC pins.',
    },
    sections: ['r-9-1'],
    eqs: [],
    keywords: ['TDC', 'saturation', 'range', 'L06', 'non-injective', '饱和', '量程'],
    mount(root, api) {
      const st = { Rc: 6, x: 1.5, T0: 2.0 }; // Rc = R/LSB (codes); x, T0 in units of R
      root.appendChild(W.h('style', null, CSS));
      const svgHost = W.h('div', { class: 'st-svgw' });
      const read = W.readout([
        { key: 'x', label: ['输入 x', 'Input x'] },
        { key: 'code', label: ['输出码 Q(x)', 'Output code Q(x)'] },
        { key: 'flag', label: ['SAT 标志', 'SAT flags'] },
        { key: 'same', label: ['映射到同一码的输入集', 'Inputs mapping to this code'] },
      ]);
      const eqHost = W.h('div', { class: 'st-eq' });
      const modHost = W.h('div');
      const l06Host = W.h('div');

      const cX = W.slider({ label: ['输入 x', 'Input x'], min: -3.5, max: 3.5, step: 0.01, value: st.x, fmt: (v) => `${W.fmt(v, 2)} R`, onInput: (v) => { st.x = v; draw(); } });
      const cR = W.slider({ label: ['量程 R / LSB（码数）', 'Range R / LSB (codes)'], min: 2, max: 16, step: 1, value: st.Rc, fmt: (v) => `${v}`, onInput: (v) => { st.Rc = v; draw(); } });
      const cT = W.slider({ label: ['CNT 整周期 T₀', 'CNT integer period T₀'], min: 1, max: 4, step: 0.25, value: st.T0, fmt: (v) => `${W.fmt(v, 2)} R`, onInput: (v) => { st.T0 = v; draw(); } });
      const pre = (x) => () => { st.x = x; cX.value = x; draw(); };
      const btns = [
        W.button(['x = 0.4R（量程内）', 'x = 0.4R (in range)'], pre(0.4)),
        W.button(['x = 1.5R', 'x = 1.5R'], pre(1.5)),
        W.button(['x = 3R', 'x = 3R'], pre(3)),
        W.button(['x = −2R', 'x = −2R'], pre(-2)),
      ];
      root.append(
        W.note(['理想化示意模型：无噪声、无非线性；R 与 T₀ 以“量程 R”为单位，仅用于说明饱和的非单射性，不是某个 TDC 的指标。', 'Idealized illustration: no noise or nonlinearity; R and T₀ are in units of "range R" and only illustrate the non-injectivity of saturation — not the spec of any TDC.'], 'warn'),
        W.controls(cX, cR, cT),
        W.controls(...btns),
        svgHost, W.legend([{ color: 'var(--sig-fine)', label: ['Q(x)（码，纵轴）', 'Q(x) (code, vertical axis)'] }, { color: 'var(--sig-sel)', label: ['同一码对应的全部输入', 'all inputs giving the same code'] }, { color: 'var(--sig-ref)', label: ['当前输入 x（可拖动）', 'current input x (draggable)'] }]),
        read.el, eqHost,
        W.h('div', { class: 'st-h' }, W.L('饱和之后再做数字取模/减整周期', 'Digital modulo / integer-period subtraction after saturation')),
        modHost,
        W.h('div', { class: 'st-h' }, W.L('L06 检查（精确有理数，限幅 ±1/4）', 'L06 check (exact rationals, limit ±1/4)')),
        l06Host,
        W.note([
          '要点：Q 在 |x| ≥ R 处把所有输入压成同一个码，只知道输出不能恢复输入；之后再减整数周期也救不回已被压掉的 fine 信息。数字 modulo 是数值表示，模拟 TDC 能否把时间差压进一个周期是物理可观测性——CNT 能表示多周期差，但不改变两个 TDC 输入端之间已有的物理间隔，量程须由选沿、捕获结构、预测或 DTC 来约束。单侧饱和可保留误差方向（供另行定义的限幅控制使用），但绝不能当作精确 fine 残差。',
          'Key point: Q maps every input with |x| ≥ R to the same code, so the output alone cannot recover the input, and subtracting integer periods afterwards cannot restore fine information that was squashed. Digital modulo is a numerical representation; whether an analog TDC can squeeze the interval into one period is physical observability — the CNT can represent multi-cycle differences but does not change the physical interval already present between the two TDC inputs, so the range must be constrained by edge selection, capture structure, prediction or a DTC. One-sided saturation may keep an error direction (for a separately defined limiting control strategy) but must never be labelled a precise fine residual.']),
      );

      // ---- plot
      const VW = 760, VH = 330, PL = 56, PR = 20, PT = 16, PB = 40;
      const XM = 3.5;
      let svgEl = null;
      function draw() {
        const { Rc } = st, LSB = 1 / Rc; // R = 1
        const c = Q(st.x, Rc, LSB);
        const x = W.scale([-XM, XM], [PL, VW - PR]);
        const y = W.scale([-Rc * 1.25, Rc * 1.25], [VH - PB, PT]);
        const svg = W.svg(VW, VH, { class: 'w-svg' });
        // grid + axes
        for (const tk of [-3, -2, -1, 0, 1, 2, 3]) {
          svg.appendChild(W.s('line', { x1: x(tk), x2: x(tk), y1: PT, y2: VH - PB, class: tk === 0 ? 'axis' : 'grid' }));
          svg.appendChild(W.s('text', { x: x(tk), y: VH - PB + 14, 'text-anchor': 'middle' }, tk === 0 ? '0' : `${tk}R`));
        }
        for (const tk of [-Rc, 0, Rc]) {
          svg.appendChild(W.s('line', { x1: PL, x2: VW - PR, y1: y(tk), y2: y(tk), class: tk === 0 ? 'axis' : 'grid' }));
          svg.appendChild(W.s('text', { x: PL - 6, y: y(tk) + 4, 'text-anchor': 'end' }, tk === Rc ? '+R/LSB' : tk === -Rc ? '−R/LSB' : '0'));
        }
        svg.appendChild(W.sL('输入 x（TDC 引脚时间差）', 'input x (time difference at the TDC pins)', { x: (PL + VW - PR) / 2, y: VH - 6, 'text-anchor': 'middle' }));
        svg.appendChild(W.sL('码', 'code', { x: 6, y: PT + 8 }));
        // same-code band
        let a, b;
        if (c >= Rc) { a = (Rc - 0.5) * LSB; b = XM; } else if (c <= -Rc) { a = -XM; b = (-Rc + 0.5) * LSB; } else { a = (c - 0.5) * LSB; b = (c + 0.5) * LSB; }
        a = Math.max(a, -XM); b = Math.min(b, XM);
        svg.appendChild(W.s('rect', { x: x(a), y: PT, width: Math.max(1.5, x(b) - x(a)), height: VH - PB - PT, fill: 'var(--sig-sel)', 'fill-opacity': 0.22 }));
        svg.appendChild(W.s('rect', { x: x(a), y: VH - PB - 7, width: Math.max(1.5, x(b) - x(a)), height: 7, fill: 'var(--sig-sel)' }));
        // staircase
        let d = '';
        const n = 700;
        for (let i = 0; i <= n; i++) {
          const xv = -XM + (2 * XM * i) / n;
          d += (i ? 'L' : 'M') + x(xv).toFixed(1) + ',' + y(Q(xv, Rc, LSB)).toFixed(1);
        }
        svg.appendChild(W.s('path', { d, fill: 'none', stroke: 'var(--sig-fine)', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
        // markers for 1.5R, 3R
        for (const m of [1.5, 3]) {
          svg.appendChild(W.s('circle', { cx: x(m), cy: y(Q(m, Rc, LSB)), r: 3.5, fill: 'var(--sig-err)' }));
        }
        svg.appendChild(W.s('text', { x: x(1.5), y: y(Rc) - 8, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--sig-err)' }, 'Q(1.5R)'));
        svg.appendChild(W.s('text', { x: x(3), y: y(Rc) - 8, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--sig-err)' }, 'Q(3R) = R'));
        // cursor
        svg.appendChild(W.s('line', { x1: x(st.x), x2: x(st.x), y1: PT, y2: VH - PB, stroke: 'var(--sig-ref)', 'stroke-width': 1.8 }));
        svg.appendChild(W.s('circle', { cx: x(st.x), cy: y(c), r: 6, fill: 'var(--sig-ref)', stroke: 'var(--surface)', 'stroke-width': 2 }));
        W.clear(svgHost).appendChild(svg); svgEl = svg;

        // ---- readouts
        const satHi = c >= Rc, satLo = c <= -Rc;
        read.set('x', `${W.fmt(st.x, 2)} R`);
        read.set('code', `${c}  (${W.fmt(c * LSB, 3)} R)`);
        read.set('flag', satHi ? 'SAT_HI = 1' : satLo ? 'SAT_LO = 1' : 'SAT = 0');
        read.set('same', satHi ? `x ≥ ${W.fmt((Rc - 0.5) * LSB, 3)} R` : satLo ? `x ≤ ${W.fmt((-Rc + 0.5) * LSB, 3)} R` : `[${W.fmt(a, 3)}, ${W.fmt(b, 3)}) R`);
        const q15 = Q(1.5, Rc, LSB), q3 = Q(3, Rc, LSB);
        W.clear(eqHost).appendChild(W.tex(`Q(1.5R)=${q15},\\ Q(3R)=${q3}\\ (=R/\\mathrm{LSB}\\text{ codes})\\ \\Rightarrow\\ Q(1.5R)${q15 === q3 ? '=' : '\\neq'}Q(3R),\\quad Q(x)=\\operatorname{clamp}\\!\\big(\\operatorname{round}(x/\\mathrm{LSB}),-\\tfrac{R}{\\mathrm{LSB}},+\\tfrac{R}{\\mathrm{LSB}}\\big)`));

        // ---- digital modulo panel
        const n0 = half(st.x / st.T0);
        const rTrue = st.x - n0 * st.T0;
        const rDig = c * LSB - n0 * st.T0;
        const err = rDig - rTrue;
        const bad = Math.abs(err) > LSB / 2 + 1e-9;
        const tb = W.h('table', { class: 'st-tbl' },
          W.h('tr', null, W.h('th', null, W.L('量', 'Quantity')), W.h('th', { class: 'n' }, W.L('值（单位 R）', 'Value (units of R)')), W.h('th', null, W.L('说明', 'Meaning'))),
          W.h('tr', null, W.h('td', null, W.L('CNT 整周期数 n', 'CNT integer periods n')), W.h('td', { class: 'n' }, String(n0)), W.h('td', null, W.L('CNT 可以数出多周期差：n = round(x / T₀)', 'CNT can count multi-cycle differences: n = round(x / T₀)'))),
          W.h('tr', null, W.h('td', null, W.L('物理残差 x − n·T₀', 'Physical residual x − n·T₀')), W.h('td', { class: 'n' }, W.fmt(rTrue, 3)), W.h('td', null, W.L('若 TDC 不饱和且能观测到完整 x 才可得到', 'Obtainable only if the TDC saw the full x without saturating'))),
          W.h('tr', null, W.h('td', null, W.L('饱和后数字减：Q(x)·LSB − n·T₀', 'Digital subtract after saturation: Q(x)·LSB − n·T₀')), W.h('td', { class: 'n' }, W.fmt(rDig, 3)), W.h('td', null, W.L('已丢失超量程部分', 'the out-of-range part is already lost'))),
          W.h('tr', null, W.h('td', null, W.L('误差', 'Error')), W.h('td', { class: 'n' }, W.fmt(err, 3)), W.h('td', null, bad ? W.status('bad', ['无法恢复（信息已被压缩）', 'unrecoverable (information was squashed)']) : W.status('good', ['在量化误差内', 'within quantization error']))),
        );
        W.clear(modHost).append(W.h('div', { class: 'st-tblw' }, tb));

        // ---- L06
        const lim = W.F(1, 4);
        const sat = (v) => (v.cmp(lim) > 0 ? lim : v.cmp(lim.neg()) < 0 ? lim.neg() : v);
        const pairs = [[W.F(1, 3), W.F(3, 4)], [W.F(1, 2), W.F(2)], [W.F(-1, 3), W.F(-3, 4)], [W.F(-1, 2), W.F(-2)]];
        const t2 = W.h('table', { class: 'st-tbl' }, W.h('tr', null, ['x', 'y', 'sat(x)', 'sat(y)', 'x ≠ y', 'sat(x) = sat(y)'].map((h) => W.h('th', { class: 'n' }, h))));
        let allOk = true;
        for (const [px, py] of pairs) {
          const ok = !px.eq(py) && sat(px).eq(sat(py)); allOk = allOk && ok;
          t2.appendChild(W.h('tr', null, [px, py, sat(px), sat(py), !px.eq(py) ? '✓' : '✗', sat(px).eq(sat(py)) ? '✓' : '✗'].map((v) => W.h('td', { class: 'n' }, String(v)))));
        }
        W.clear(l06Host).append(W.h('div', { class: 'st-tblw' }, t2), W.h('div', { style: { marginTop: '6px' } }, allOk ? W.status('good', ['L06：4/4 对通过 —— 饱和非单射（这不是 TDC 实现）', 'L06: 4/4 pairs pass — saturation is non-injective (this is not a TDC implementation)']) : W.status('bad', ['L06 失败', 'L06 failed'])));
      }
      let drag = false;
      const move = (ev) => {
        if (!svgEl) return;
        const p = W.svgPoint(svgEl, ev);
        const xs = W.scale([-XM, XM], [PL, VW - PR]);
        st.x = W.clamp(Math.round(xs.invert(p.x) * 100) / 100, -XM, XM); cX.value = st.x; draw();
      };
      svgHost.addEventListener('pointerdown', (ev) => { drag = true; try { svgHost.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } move(ev); });
      svgHost.addEventListener('pointermove', (ev) => { if (drag) move(ev); });
      svgHost.addEventListener('pointerup', () => { drag = false; });
      svgHost.addEventListener('pointercancel', () => { drag = false; });
      draw();
      return { destroy() { svgEl = null; } };
    },
  });
})();
