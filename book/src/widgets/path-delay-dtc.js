/* path-delay-dtc — report §9.2, Eq. (18)–(19): path delays, DTC placement and normalization.
 *   d_pin = (t_E + τ_E) − (t_R + τ_R)                         (TDC pin difference; DTC delay is part of τ_R or τ_E)
 *   Δt̂   = d̂_pin − (τ̂_E − τ̂_R)                              (Eq. 18)
 *   μ̂    = (code − code_0)·LSB_t / T̂0 + o_phase               (Eq. 19)
 * Idealized behavioural model (ps; no noise, INL or DTC nonlinearity). The four "error toggles" are the mistakes the book
 * warns about; their sizes (stale gain +8 %, stale code_0 +2 codes) are illustrative values chosen here, not data.
 */
(function () {
  'use strict';
  const STALE_GAIN = 0.08, STALE_C0 = 2;
  const CSS = `
.pd-h { margin: 14px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.pd-tags { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 8px; }
.pd-tag { border: 1px solid var(--border); border-radius: 10px; padding: 6px 10px; background: var(--surface); font-size: .76rem; }
.pd-tag.bad { border-color: var(--critical); }
.pd-tag .nm { font-family: var(--mono); font-weight: 700; color: var(--fg); }
.pd-tag .vv { display: flex; justify-content: space-between; gap: 8px; font-family: var(--mono); color: var(--fg-2); }
.pd-eq { overflow-x: auto; overflow-y: hidden; }
.pd-eq .katex-display { margin: .3em 0; }
.pd-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; font-variant-numeric: tabular-nums; }
.pd-tbl th, .pd-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; }
.pd-tbl td.n { text-align: right; font-family: var(--mono); white-space: nowrap; }
.pd-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
`;

  // DOM-free model
  function model(P) {
    const dtcR = P.place === 'ref' ? P.dtc : 0, dtcE = P.place === 'fb' ? P.dtc : 0;
    const tR = 0, tE = P.dt;
    const pinR = tR + P.tauR + dtcR, pinE = tE + P.tauE + dtcE;
    const dpin = pinE - pinR;
    const code = Math.round(dpin / P.lsb);
    // estimator beliefs
    let eR = dtcR, eE = dtcE; // DTC delay attributed to the (correct) path
    if (P.twice) { eR *= 2; eE *= 2; } // DTC compensated twice
    if (P.signWrong) { const a = eR; eR = eE; eE = a; } // DTC attributed to the other path
    const lsbH = P.lsb * (1 + (P.stale ? STALE_GAIN : 0));
    const dTauH = (P.tauE + eE) - (P.tauR + eR);
    const code0 = dTauH / lsbH + (P.stale ? STALE_C0 : 0);
    const T0 = 1000 / P.f0, T0h = T0 * P.k;
    const dHatPin = code * lsbH;
    const dtH = dHatPin - dTauH - (P.stale ? STALE_C0 * lsbH : 0); // Eq. 18 (with the stale code_0 offset carried into d̂_pin)
    const mu = P.dt / T0;
    const muH = (code - code0) * lsbH / T0h;
    const errMu = muH - mu;
    const gainOK = !P.stale, periodOK = P.k === 1, pathOK = !P.twice && !P.signWrong;
    return { dtcR, dtcE, tR, tE, pinR, pinE, dpin, code, lsbH, dTauH, code0, T0, T0h, dHatPin, dtH, mu, muH, errMu, errPs: errMu * T0, gainOK, periodOK, pathOK, valid: gainOK && periodOK && pathOK };
  }

  Book.registerWidget({
    id: 'path-delay-dtc',
    group: 'fine',
    title: { zh: '路径延迟、DTC 位置与归一化符号（式 18–19）', en: 'Path delays, DTC placement and normalization sign (Eq. 18–19)' },
    summary: {
      zh: '事件间隔 Δt = t_E − t_R 经各自路径延迟 τ_R、τ_E（含可选 DTC）后在 TDC 引脚上变成 d_pin；估计器按式 (18) 扣除路径差，再按式 (19) 用 LSB_t、code₀、T̂₀ 归一化为 μ̂。切换四种常见错误，观察 μ 的误差（原周期与 ps），并核对校准版本标签。',
      en: 'The event interval Δt = t_E − t_R becomes d_pin at the TDC pins after the path delays τ_R, τ_E (including an optional DTC). The estimator removes the path difference per Eq. (18) and normalizes with LSB_t, code₀ and T̂₀ per Eq. (19). Switch on the four classic mistakes to see the resulting μ error (in raw cycles and ps) and check the calibration version tags.',
    },
    sections: ['r-9-2'],
    eqs: ['18', '19'],
    keywords: ['DTC', 'path delay', 'LSB_t', 'normalization', 'calibration epoch', '路径延迟', '归一化'],
    mount(root, api) {
      const st = { dt: 120, tauR: 40, tauE: 55, dtc: 60, place: 'ref', lsb: 5, f0: 8, twice: false, stale: false, k: 1, signWrong: false };
      root.appendChild(W.h('style', null, CSS));
      const svgHost = W.h('div');
      const eqHost = W.h('div', { class: 'pd-eq' });
      const tblHost = W.h('div');
      const tagHost = W.h('div', { class: 'pd-tags' });
      const stateHost = W.h('div', { style: { margin: '8px 0 0' } });
      const read = W.readout([
        { key: 'dpin', label: ['d_pin', 'd_pin'] },
        { key: 'code', label: ['TDC 码', 'TDC code'] },
        { key: 'dt', label: ['真实 / 估计 Δt', 'True / estimated Δt'] },
        { key: 'mu', label: ['真实 / 估计 μ（周期）', 'True / estimated μ (cycles)'] },
        { key: 'err', label: ['μ 误差', 'μ error'] },
      ]);

      const sl = (label, key, min, max, step, unit) => W.slider({ label, min, max, step, value: st[key], fmt: (v) => `${W.fmt(v, 1)} ${unit}`, onInput: (v) => { st[key] = v; draw(); } });
      const cDt = sl(['真实 Δt = t_E − t_R', 'True Δt = t_E − t_R'], 'dt', -60, 300, 1, 'ps');
      const cTR = sl(['τ_R', 'τ_R'], 'tauR', 0, 150, 1, 'ps');
      const cTE = sl(['τ_E', 'τ_E'], 'tauE', 0, 150, 1, 'ps');
      const cPl = W.seg({ label: ['DTC 位置', 'DTC placement'], options: [{ value: 'none', label: ['无', 'None'] }, { value: 'ref', label: ['参考路径', 'Reference path'] }, { value: 'fb', label: ['反馈路径', 'Feedback path'] }], value: st.place, onChange: (v) => { st.place = v; draw(); } });
      const cDtc = sl(['DTC 延迟', 'DTC delay'], 'dtc', 0, 120, 1, 'ps');
      const cLsb = sl(['LSB_t', 'LSB_t'], 'lsb', 1, 20, 0.5, 'ps');
      const cF = W.slider({ label: ['f₀', 'f₀'], min: 2, max: 16, step: 0.5, value: st.f0, fmt: (v) => `${W.fmt(v, 1)} GHz`, onInput: (v) => { st.f0 = v; draw(); } });
      const tTw = W.toggle({ label: ['DTC 被补偿两次', 'DTC compensated twice'], value: false, onChange: (v) => { st.twice = v; draw(); } });
      const tSt = W.toggle({ label: ['校准过期（LSB_t / code₀ 来自旧校准）', 'Stale calibration (LSB_t / code₀ from an older calibration)'], value: false, onChange: (v) => { st.stale = v; draw(); } });
      const tSg = W.toggle({ label: ['DTC 放在另一条路径但符号未改', 'DTC on the other path but sign not changed'], value: false, onChange: (v) => { st.signWrong = v; draw(); } });
      const cK = W.seg({ label: ['T̂₀ 取自的时钟节点', 'T̂₀ taken from clock node'], options: [{ value: 1, label: ['CK₀（正确）', 'CK₀ (correct)'] }, { value: 4, label: '/4 ×4' }, { value: 8, label: '/8 ×8' }], value: st.k, onChange: (v) => { st.k = +v; draw(); } });

      const reset = () => { Object.assign(st, { twice: false, stale: false, k: 1, signWrong: false }); tTw.value = false; tSt.value = false; tSg.value = false; cK.value = 1; };
      const presets = [
        W.button(['正确（DTC 在参考路径）', 'Correct (DTC on reference path)'], () => { reset(); Object.assign(st, { place: 'ref', dtc: 60 }); cPl.value = 'ref'; cDtc.value = 60; draw(); }),
        W.button(['DTC 在反馈路径', 'DTC on feedback path'], () => { reset(); Object.assign(st, { place: 'fb', dtc: 60 }); cPl.value = 'fb'; cDtc.value = 60; draw(); }),
        W.button(['DTC 补偿两次', 'DTC compensated twice'], () => { reset(); st.twice = true; tTw.value = true; if (st.place === 'none') { st.place = 'ref'; cPl.value = 'ref'; } draw(); }),
        W.button(['T̂₀ 取错节点 ×4', 'T̂₀ from wrong node ×4'], () => { reset(); st.k = 4; cK.value = 4; draw(); }),
      ];

      root.append(
        W.note(['理想化示意模型（ps，无噪声/INL）。错误开关的大小（校准过期：LSB_t +8 %、code₀ +2 码）是本小部件为演示选取的数值，不是文献数据。', 'Idealized illustration (ps, no noise/INL). The error-toggle sizes (stale calibration: LSB_t +8 %, code₀ +2 codes) are values chosen here for demonstration, not data from any source.'], 'warn'),
        W.controls(cDt, cTR, cTE, cF),
        W.controls(cPl, cDtc, cLsb),
        W.controls(tTw, tSt, tSg, cK),
        W.controls(...presets),
        svgHost, read.el,
        W.h('div', { class: 'pd-h' }, W.L('式 (18)–(19) 代入当前数值', 'Eq. (18)–(19) with the current numbers')),
        eqHost, W.h('div', { class: 'pd-tblw' }, tblHost),
        W.h('div', { class: 'pd-h' }, W.L('校准版本标签（失配 ⇒ fine 无效，见 I5 / V_cal）', 'Calibration version tags (mismatch ⇒ fine invalid, see I5 / V_cal)')),
        tagHost, stateHost,
        W.note([
          '要点：路径定义必须统一采用式 (18)：DTC 插在参考路径就计入 τ_R，插在反馈路径就计入 τ_E，只能补偿一次、符号只能有一个。式 (19) 中的 LSB_t、code₀、选相/DCC 偏差、路径差与 T̂₀ 都要带校准版本；把 raw code 直接当成原周期小数，可能把增益或时钟节点差错藏进相位环路。',
          'Key point: use the path definition of Eq. (18) consistently: a DTC on the reference path counts into τ_R, one on the feedback path into τ_E — compensated once, with one sign. LSB_t, code₀, phase-select/DCC bias, path difference and T̂₀ in Eq. (19) all carry a calibration version; treating the raw code as a fraction of the raw period may hide a gain or clock-node error inside the phase loop.']),
      );

      function draw() {
        const m = model(st);
        const f = (v, d = 1) => W.fmt(v, d);
        // ---------- timeline
        const VW = 760, VH = 262, PL = 108, PR = 24;
        const tmin = Math.min(0, st.dt) - 20, tmax = Math.max(m.pinR, m.pinE) + 40;
        const x = W.scale([tmin, tmax], [PL, VW - PR]);
        const svg = W.svg(VW, VH);
        for (const tk of W.ticks(tmin, tmax, 8)) {
          svg.appendChild(W.s('line', { x1: x(tk), x2: x(tk), y1: 14, y2: VH - 26, class: 'grid' }));
          svg.appendChild(W.s('text', { x: x(tk), y: VH - 12, 'text-anchor': 'middle' }, f(tk, 0)));
        }
        svg.appendChild(W.sL('时间 / ps', 'time / ps', { x: VW - PR, y: VH - 1, 'text-anchor': 'end' }));
        const lane = (y, labelZh, labelEn, t0, wire, dtcLen, color) => {
          svg.appendChild(W.sL(labelZh, labelEn, { x: 6, y: y + 4, class: 'lbl' }));
          svg.appendChild(W.s('circle', { cx: x(t0), cy: y, r: 5, fill: color }));
          svg.appendChild(W.s('line', { x1: x(t0), x2: x(t0 + wire), y1: y, y2: y, stroke: 'var(--fg-2)', 'stroke-width': 3 }));
          if (dtcLen > 0) svg.appendChild(W.s('rect', { x: x(t0 + wire), y: y - 7, width: x(t0 + wire + dtcLen) - x(t0 + wire), height: 14, fill: 'var(--sig-plan)', 'fill-opacity': 0.5, stroke: 'var(--sig-plan)', 'stroke-width': 1.6 }));
          const pin = t0 + wire + dtcLen;
          svg.appendChild(W.s('path', { d: `M${x(pin)},${y - 9}L${x(pin)},${y + 9}`, stroke: color, 'stroke-width': 3 }));
          return pin;
        };
        lane(40, 'REF 路径', 'REF path', m.tR, st.tauR, m.dtcR, 'var(--sig-ref)');
        lane(92, '反馈路径', 'Feedback path', m.tE, st.tauE, m.dtcE, 'var(--sig-clk)');
        svg.appendChild(W.sL('t_R', 't_R', { x: x(m.tR), y: 24, 'text-anchor': 'middle', style: 'font-size:10px' }));
        svg.appendChild(W.sL('t_E', 't_E', { x: x(m.tE), y: 76, 'text-anchor': 'middle', style: 'font-size:10px' }));
        // pin row
        svg.appendChild(W.sL('TDC 引脚', 'TDC pins', { x: 6, y: 150, class: 'lbl' }));
        svg.appendChild(W.s('line', { x1: x(m.pinR), x2: x(m.pinR), y1: 30, y2: 160, stroke: 'var(--sig-ref)', 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }));
        svg.appendChild(W.s('line', { x1: x(m.pinE), x2: x(m.pinE), y1: 82, y2: 160, stroke: 'var(--sig-clk)', 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }));
        const yb = 146;
        svg.appendChild(W.s('line', { x1: x(m.pinR), x2: x(m.pinE), y1: yb, y2: yb, stroke: 'var(--sig-fine)', 'stroke-width': 3 }));
        for (const p of [m.pinR, m.pinE]) svg.appendChild(W.s('path', { d: `M${x(p)},${yb - 6}L${x(p)},${yb + 6}`, stroke: 'var(--sig-fine)', 'stroke-width': 2.4 }));
        svg.appendChild(W.s('text', { x: (x(m.pinR) + x(m.pinE)) / 2, y: yb - 9, 'text-anchor': 'middle', class: 'mono', style: 'fill:var(--fg);font-size:11px' }, `d_pin = ${f(m.dpin)} ps`));
        // quantization ticks (code grid) just below
        const nt = Math.min(60, Math.abs(m.dpin) / st.lsb);
        for (let i = 0; i <= nt; i++) {
          const tt = m.pinR + Math.sign(m.dpin || 1) * i * st.lsb;
          svg.appendChild(W.s('line', { x1: x(tt), x2: x(tt), y1: yb + 8, y2: yb + 14, stroke: 'var(--sig-fine)', 'stroke-width': 1 }));
        }
        svg.appendChild(W.sL(`码 = ${m.code}（LSB_t = ${f(st.lsb)} ps）`, `code = ${m.code} (LSB_t = ${f(st.lsb)} ps)`, { x: (x(m.pinR) + x(m.pinE)) / 2, y: yb + 28, 'text-anchor': 'middle', style: 'font-size:10.5px' }));
        // estimate row
        svg.appendChild(W.sL('Δt 真实/估计', 'Δt true/est.', { x: 6, y: 214, class: 'lbl' }));
        svg.appendChild(W.s('line', { x1: x(m.tR), x2: x(m.tE), y1: 206, y2: 206, stroke: 'var(--sig-sel)', 'stroke-width': 3 }));
        svg.appendChild(W.s('line', { x1: x(m.tR), x2: x(m.tR + m.dtH), y1: 224, y2: 224, stroke: m.valid && Math.abs(m.dtH - st.dt) <= st.lsb ? 'var(--sig-fine)' : 'var(--sig-err)', 'stroke-width': 3 }));
        svg.appendChild(W.sL(`真实 ${f(st.dt)} ps`, `true ${f(st.dt)} ps`, { x: x(Math.max(m.tR, m.tE)) + 6, y: 209, style: 'font-size:10.5px' }));
        svg.appendChild(W.sL(`估计 ${f(m.dtH)} ps`, `est. ${f(m.dtH)} ps`, { x: x(Math.max(m.tR, m.tR + m.dtH)) + 6, y: 228, style: 'font-size:10.5px' }));
        W.clear(svgHost).append(svg, W.legend([
          { color: 'var(--fg-2)', label: ['路径延迟 τ', 'path delay τ'] },
          { color: 'var(--sig-plan)', label: ['DTC 延迟', 'DTC delay'] },
          { color: 'var(--sig-fine)', label: ['TDC 引脚差 d_pin / 估计 Δt', 'TDC pin difference d_pin / estimated Δt'] },
          { color: 'var(--sig-sel)', label: ['真实 Δt', 'true Δt'] },
        ]));

        // ---------- readouts
        read.set('dpin', `${f(m.dpin)} ps`);
        read.set('code', String(m.code));
        read.set('dt', `${f(st.dt)} / ${f(m.dtH)} ps`);
        read.set('mu', `${f(m.mu, 4)} / ${f(m.muH, 4)}`);
        read.set('err', `${m.errMu >= 0 ? '+' : ''}${f(m.errMu, 4)} T₀ = ${m.errPs >= 0 ? '+' : ''}${f(m.errPs, 1)} ps`);

        // ---------- equations
        const n = (v, d = 1) => W.fmt(v, d);
        W.clear(eqHost).append(
          W.tex(`d_{\\rm pin}=(${n(m.tE)}+${n(st.tauE + m.dtcE)})-(${n(m.tR)}+${n(st.tauR + m.dtcR)})=${n(m.dpin)}\\,\\mathrm{ps}`, true),
          W.tex(`\\widehat{\\Delta t}=\\widehat d_{\\rm pin}-(\\widehat\\tau_E-\\widehat\\tau_R)=${n(m.dHatPin)}-(${n(m.dTauH)})=${n(m.dtH)}\\,\\mathrm{ps}\\quad(\\text{true }\\Delta t=${n(st.dt)})\\ \\ \\text{(18)}`, true),
          W.tex(`\\widehat\\mu=(\\mathrm{code}-\\mathrm{code}_0)\\frac{\\mathrm{LSB}_t}{\\widehat T_0}=(${m.code}-${n(m.code0, 2)})\\frac{${n(m.lsbH, 2)}}{${n(m.T0h, 1)}}=${n(m.muH, 4)}\\quad(\\mu_{\\rm true}=${n(m.mu, 4)})\\ \\ \\text{(19)}`, true),
        );
        // ---------- error table
        const rows = [
          [['量化误差上限 ±LSB_t/2', 'Quantization bound ±LSB_t/2'], `±${n(st.lsb / 2)} ps`, `±${n(st.lsb / 2 / m.T0, 4)} T₀`],
          [['μ 误差（当前设置）', 'μ error (current setting)'], `${n(m.errPs)} ps`, `${n(m.errMu, 4)} T₀`],
          [['其中超出量化误差的部分', 'of which beyond quantization'], `${n(Math.abs(m.errPs) > st.lsb / 2 ? m.errPs - Math.sign(m.errPs) * st.lsb / 2 : 0)} ps (≤)`, `${n(Math.abs(m.errMu) > st.lsb / 2 / m.T0 ? m.errMu - Math.sign(m.errMu) * st.lsb / 2 / m.T0 : 0, 4)} T₀ (≤)`],
        ];
        const tb = W.h('table', { class: 'pd-tbl' }, W.h('tr', null, W.h('th', null, W.L('量', 'Quantity')), W.h('th', { class: 'n' }, W.L('ps', 'ps')), W.h('th', { class: 'n' }, W.L('原周期 T₀', 'raw cycles T₀'))));
        for (const [k, a, b] of rows) tb.appendChild(W.h('tr', null, W.h('td', null, W.lbl(k)), W.h('td', { class: 'n' }, a), W.h('td', { class: 'n' }, b)));
        W.clear(tblHost).appendChild(tb);

        // ---------- tags
        const tags = [
          ['tdc_gain_epoch', 7, m.gainOK ? 7 : 6, m.gainOK],
          ['period_epoch', 7, m.periodOK ? 7 : 6, m.periodOK],
          ['path_epoch', 7, m.pathOK ? 7 : 6, m.pathOK],
        ];
        W.clear(tagHost);
        for (const [nm, fr, cal, ok] of tags) {
          tagHost.appendChild(W.h('div', { class: 'pd-tag' + (ok ? '' : ' bad') },
            W.h('div', { class: 'nm' }, nm),
            W.h('div', { class: 'vv' }, W.h('span', null, W.L('帧', 'frame')), W.h('span', null, String(fr))),
            W.h('div', { class: 'vv' }, W.h('span', null, W.L('所用校准', 'calibration used')), W.h('span', null, String(cal))),
            ok ? W.status('good', ['匹配', 'match']) : W.status('bad', ['失配', 'mismatch'])));
        }
        W.clear(stateHost).append(m.valid
          ? W.status('good', ['V_cal = 1：fine 可用（仍受 V_code / V_range 等约束）', 'V_cal = 1: fine usable (still subject to V_code / V_range etc.)'])
          : W.status('bad', ['V_cal = 0：版本失配 ⇒ 必须使 fine 无效，退回 coarse', 'V_cal = 0: version mismatch ⇒ fine must be invalidated, fall back to coarse']));
      }
      draw();
      return { destroy() { } };
    },
  });
})();
