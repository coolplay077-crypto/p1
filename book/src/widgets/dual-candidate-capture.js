/* dual-candidate-capture — report §7.1 (route A) and §4.1 (TI [R01]): two retimed candidates + safe-candidate selection.
 *
 * IDEALIZED behavioural illustration (not a reproduction of TI Fig.4, not chip data). Time unit = one CKV period (= T0).
 *   - CKV rising edges at integers; a mod-8 low counter changes on them: N(t) = floor(t), q = N mod 8, C = floor(N/8).
 *   - Candidate R: REF retimed on CKV RISING edges; the fine anchor is that rising edge.
 *   - Candidate F: REF retimed on CKV FALLING edges; its fine anchor is the next rising edge after the capture
 *     (so for REF in the second half of a cycle the two candidates anchor on rising edges one cycle apart, but each tuple is
 *      self-consistent:  P̂ = N_anchor − Δ,  Δ = t_anchor − t_REF  measured by the fine TDC).
 *   - A retiming flop is in its danger window when REF lies in (e − t_su, e + t_h) around its capture edge e; there the flag
 *     may be seen at e or one capture-period later (ambiguity of ±1 cycle between tuple and TDC anchor).
 *   - SEL (SEL_EDGE-like, from the fine boundary side): REF near a rising edge -> use F, otherwise R. The switch points
 *     (φ = 1/4, 3/4) are where both candidates are safe.
 *   - Split mode: coarse bus and fine anchor are selected by SEL evaluated at φ−δ and φ+δ (late / skewed select control).
 */
(function () {
  'use strict';
  const CSS = `
.dc-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); margin-top: 10px; }
.dc-tbl { width: 100%; border-collapse: collapse; font-size: .78rem; font-variant-numeric: tabular-nums; }
.dc-tbl th, .dc-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
.dc-tbl th { background: var(--surface-2); font-weight: 650; }
.dc-tbl tr:last-child td { border-bottom: 0; }
.dc-tbl tr.sel td { background: color-mix(in srgb, var(--sig-sel) 14%, transparent); }
.dc-eq { overflow-x: auto; overflow-y: hidden; }
.dc-eq .katex-display { margin: .3em 0; }
.dc-st { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-top: 8px; }
.dc-h { font-weight: 650; font-size: .85rem; margin: 12px 0 2px; color: var(--fg); }
`;
  const MQ = 8;

  // candidate outcome for REF at time tref; su/h: setup/hold half-windows (CKV periods)
  function outcome(kind, tref, su, h) {
    const e = kind === 'R' ? Math.round(tref) : Math.round(tref - 0.5) + 0.5; // nearest capture edge
    const rel = tref - e;
    const danger = rel > -su && rel < h;
    const off = kind === 'R' ? 0 : 0.5;
    const capNom = rel < 0 ? e : e + 1;
    const capAlt = danger ? (rel < 0 ? e + 1 : e) : null;
    return { kind, e, rel, danger, capNom, anchor: capNom + off, anchorAlt: capAlt == null ? null : capAlt + off };
  }
  const selOf = (phi) => { const p = W.mod(phi, 1); return Math.abs(p - Math.round(p)) < 0.25 ? 'F' : 'R'; };

  function evaluate(S, phi) {
    const tref = S.m + phi;
    const o = { R: outcome('R', tref, S.su, S.h), F: outcome('F', tref, S.su, S.h) };
    const pol = (p) => (S.policy === 'sel' ? selOf(p) : S.policy);
    const kc = pol(S.tuple === 'atomic' ? phi : phi - S.skew);
    const kf = pol(S.tuple === 'atomic' ? phi : phi + S.skew);
    const oc = o[kc], of = o[kf];
    const errNom = oc.anchor - of.anchor;
    const errAlt = oc.anchorAlt == null ? null : oc.anchorAlt - of.anchor;
    return { tref, o, kc, kf, oc, of, errNom, errAlt, dangerC: oc.danger };
  }
  const tupleOf = (anchor, tref, kind, near) => {
    const N = Math.round(anchor);
    return { C: Math.floor(N / MQ), q: W.mod(N, MQ), side: near, id: 'e' + N, cand: kind, delta: anchor - tref, N };
  };

  Book.registerWidget({
    id: 'dual-candidate-capture',
    group: 'snapshot',
    title: { zh: '路线 A：双候选捕获与安全候选选择', en: 'Route A: dual-candidate capture and safe-candidate selection' },
    summary: {
      zh: '理想化示意（不是 TI Fig.4 的复现）：REF 分别在 CKV 上升沿、下降沿被重定时，得到两个候选元组；扫描 REF 相位，观察各候选的 setup/hold 危险窗、被选候选，以及“数据稳定 / 选择控制稳定 / 元组原子选择”三件事分别失败时的重建相位误差。',
      en: 'Idealized illustration (not a reproduction of TI Fig.4): REF is retimed on CKV rising and on CKV falling edges, giving two candidate tuples. Sweep the REF phase and watch each candidate’s setup/hold danger window, the selected candidate, and the reconstructed-phase error when data stability, select-control stability or atomic tuple selection fails.',
    },
    sections: ['r-7-1', 'r-4-1'],
    eqs: [],
    keywords: ['SEL_EDGE', 'candidate', 'retiming', 'TI', 'atomic', 'tuple', '双候选', '重定时', '原子', '路线 A'],
    mount(root, api) {
      if (!document.getElementById('dc-css')) { const s = document.createElement('style'); s.id = 'dc-css'; s.textContent = CSS; document.head.appendChild(s); }
      const S = { m: 6, phi: 0.82, su: 0.1, h: 0.06, policy: 'sel', tuple: 'atomic', skew: 0.08, speed: 0.08 };
      const PRESETS = {
        good: { policy: 'sel', tuple: 'atomic', skew: 0.08, su: 0.1, h: 0.06, phi: 0.82 },
        onlyR: { policy: 'R', tuple: 'atomic', skew: 0.08, su: 0.1, h: 0.06, phi: 0.98 },
        split: { policy: 'sel', tuple: 'split', skew: 0.08, su: 0.1, h: 0.06, phi: 0.76 },
        atomicSkew: { policy: 'sel', tuple: 'atomic', skew: 0.14, su: 0.1, h: 0.06, phi: 0.76 },
        wide: { policy: 'sel', tuple: 'atomic', skew: 0.08, su: 0.2, h: 0.2, phi: 0.5 },
      };
      let raf = 0;
      const sched = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

      const waveHost = W.h('div'), plotHost = W.h('div'), eqHost = W.h('div', { class: 'dc-eq' }), stHost = W.h('div', { class: 'dc-st' }), tblHost = W.h('div');
      const read = W.readout([
        { key: 'phi', label: ['REF 相位 φ（CKV 周期）', 'REF phase φ (CKV periods)'] },
        { key: 'sel', label: ['SEL 选择 / 实际使用', 'SEL choice / actually used'] },
        { key: 'tuple', label: ['使用的整数元组 N = 8C+q', 'Tuple used N = 8C+q'] },
        { key: 'err', label: ['重建误差 P̂ − t_REF', 'Reconstruction error P̂ − t_REF'] },
      ]);
      const ctl = {};
      const loop = api.loop((dt) => { S.phi = W.mod(S.phi + dt * S.speed, 1); ctl.phi.value = S.phi; draw(); });
      const play = W.playButton(loop, api);
      ctl.phi = W.slider({ label: ['REF 相位 φ', 'REF phase φ'], min: 0, max: 0.995, step: 0.005, value: S.phi, fmt: (v) => W.fmt(v, 3), onInput: (v) => { S.phi = v; loop.running && (loop.stop(), play.sync()); sched(); } });
      ctl.m = W.slider({ label: ['REF 所在周期 m（q 位置）', 'REF cycle m (q position)'], min: 0, max: 15, step: 1, value: S.m, fmt: (v) => `m=${v} (q=${v % MQ})`, onInput: (v) => { S.m = v; sched(); } });
      ctl.su = W.slider({ label: ['t_su 危险窗(前)', 't_su window (before)'], min: 0.02, max: 0.2, step: 0.01, value: S.su, fmt: (v) => `${W.fmt(v, 2)} T`, onInput: (v) => { S.su = v; sched(); } });
      ctl.h = W.slider({ label: ['t_h 危险窗(后)', 't_h window (after)'], min: 0.02, max: 0.2, step: 0.01, value: S.h, fmt: (v) => `${W.fmt(v, 2)} T`, onInput: (v) => { S.h = v; sched(); } });
      ctl.skew = W.slider({ label: ['选择控制偏斜 δ', 'Select-control skew δ'], min: 0, max: 0.2, step: 0.01, value: S.skew, fmt: (v) => `±${W.fmt(v, 2)} T`, onInput: (v) => { S.skew = v; sched(); } });
      ctl.policy = W.seg({ label: ['选择策略', 'Selection'], options: [{ value: 'sel', label: ['SEL 边界侧', 'SEL boundary'] }, { value: 'R', label: ['只用 R', 'R only'] }, { value: 'F', label: ['只用 F', 'F only'] }], value: S.policy, onChange: (v) => { S.policy = v; sched(); } });
      ctl.tuple = W.seg({ label: ['元组选择', 'Tuple selection'], options: [{ value: 'atomic', label: ['原子（整元组）', 'atomic (whole tuple)'] }, { value: 'split', label: ['非原子（粗/细分别选）', 'non-atomic (coarse / fine separately)'] }], value: S.tuple, onChange: (v) => { S.tuple = v; sched(); } });
      function apply(n) {
        Object.assign(S, PRESETS[n]);
        for (const k of ['phi', 'su', 'h', 'skew', 'policy', 'tuple']) ctl[k].value = S[k];
        loop.running && (loop.stop(), play.sync());
        draw();
      }
      const presets = W.controls(
        W.h('span', { class: 'w-ctl' }, W.L('场景：', 'Scenarios:')),
        W.button(['正常：SEL + 原子元组', 'Normal: SEL + atomic'], () => apply('good'), { primary: true }),
        W.button(['只用 R（无第二候选）', 'R only (no 2nd candidate)'], () => apply('onlyR')),
        W.button(['选择偏斜 + 非原子 ✗', 'Skewed select + non-atomic ✗'], () => apply('split')),
        W.button(['选择偏斜 + 原子 ✓', 'Skewed select + atomic ✓'], () => apply('atomicSkew')),
        W.button(['危险窗过宽', 'Windows too wide'], () => apply('wide')),
      );
      root.append(
        W.note(['理想化示意模型：用于区分三件事，不复现 TI Fig.4，也不代表任何芯片数据。时间单位为 CKV 周期。', 'Idealized illustration to separate three things; it does not reproduce TI Fig.4 or represent any chip data. Time unit: one CKV period.']),
        presets,
        W.controls(play, ctl.phi, ctl.m),
        W.controls(ctl.policy, ctl.tuple),
        W.controls(ctl.su, ctl.h, ctl.skew),
        W.legend([
          { color: 'var(--sig-clk)', label: ['CKV / 候选 R（上升沿）', 'CKV / candidate R (rising)'] },
          { color: 'var(--sig-fine)', label: ['候选 F（下降沿）', 'candidate F (falling)'] },
          { color: 'var(--sig-ref)', label: ['REF', 'REF'] },
          { color: 'var(--sig-sel)', label: ['被使用的锚沿', 'anchor edge used'] },
          { color: 'var(--sig-err)', label: ['误差 / 危险', 'error / danger'] },
        ]),
        waveHost,
        W.h('div', { class: 'dc-h' }, W.L('重建相位误差 vs REF 相位（整个周期扫描）', 'Reconstructed-phase error vs REF phase (full-cycle sweep)')),
        plotHost, eqHost, read.el, stHost, tblHost,
        W.note([
          '要点：（1）数据候选稳定——REF 靠近某候选的捕获沿时该候选落入危险窗，另一候选则安全；（2）选择控制稳定——SEL 的切换点（φ=¼、¾）必须落在两候选都安全处，且不能晚到/偏斜；（3）元组原子——SEL 选定后，{coarse, low_state, boundary_side, fine_anchor_id, candidate_id} 必须整体来自同一候选，粗位取 A、细位取 B 会在两候选锚沿相差一个周期的相位（φ>½）产生 1 个周期的误差。模型的局限：单一对称危险窗、单一理想计数器、未建模 CKVD8 延迟与 TDC 量程。',
          'Key points: (1) data-candidate stability — near one candidate’s capture edge that candidate is in its danger window while the other is safe; (2) select-control stability — SEL must switch where both candidates are safe, and must not arrive late or skewed; (3) atomic tuple — after selection the whole {coarse, low_state, boundary_side, fine_anchor_id, candidate_id} must come from one candidate; coarse from A and fine from B gives a one-cycle error wherever the two candidates anchor one cycle apart (φ > ½). Limits: one symmetric danger window, one ideal counter, no CKVD8 delay and no TDC range modelled.',
        ]),
      );

      // ---- waveform
      function drawWave(ev) {
        const VW = 760, PADL = 92, PADR = 14;
        const t0 = S.m - 0.7, t1 = S.m + 2.75;
        const x = W.scale([t0, t1], [PADL, VW - PADR]);
        const rows = { ckv: 34, cnt: 72, ref: 110, rr: 160, rf: 202 };
        const VH = 252, RH = 22;
        const svg = W.svg(VW, VH);
        // danger bands
        for (let k = Math.ceil(t0 - 1); k <= t1 + 1; k++) {
          for (const [kind, e, col] of [['R', k, 'var(--sig-clk)'], ['F', k + 0.5, 'var(--sig-fine)']]) {
            const a = Math.max(e - S.su, t0), b = Math.min(e + S.h, t1);
            if (b > a) svg.appendChild(W.s('rect', { x: x(a), y: 14, width: x(b) - x(a), height: VH - 38, style: `fill:${col};fill-opacity:.17` }));
          }
        }
        for (let k = Math.ceil(t0); k <= t1; k++) {
          svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: 14, y2: VH - 24, class: 'grid' }));
          svg.appendChild(W.s('text', { x: x(k), y: VH - 10, 'text-anchor': 'middle', style: 'font-size:10px' }, `${k}`));
        }
        svg.appendChild(W.sL('CKV 周期编号', 'CKV cycle #', { x: 6, y: VH - 10, style: 'font-size:10px' }));
        const lab = (y, t) => svg.appendChild(W.s('text', { x: 6, y: y + 4, class: 'lbl' }, t));
        const labL = (y, zh, en) => svg.appendChild(W.sL(zh, en, { x: 6, y: y + 4, class: 'lbl' }));
        const wave = (y, edges, color, w = 2) => svg.appendChild(W.s('path', { d: W.digitalPath(edges, 0, x, y - RH / 2, y + RH / 2, t0, t1), fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linejoin': 'round' }));
        lab(rows.ckv, 'CKV'); wave(rows.ckv, W.clockEdges(1, 0, t0, t1), 'var(--sig-clk)');
        labL(rows.cnt, '计数 C:q', 'count C:q');
        const segs = [];
        for (let k = Math.floor(t0); k < t1; k++) { const N = k; if (N < 0) continue; segs.push({ t0: Math.max(k, t0), t1: Math.min(k + 1, t1), label: `${Math.floor(N / MQ)}:${N % MQ}`, fill: 'var(--sig-low)', stroke: 'var(--sig-low)' }); }
        svg.appendChild(W.busGroup(segs, x, rows.cnt, RH));
        lab(rows.ref, 'REF');
        const tr = ev.tref;
        wave(rows.ref, [{ t: tr, v: 1 }, { t: tr + 0.6, v: 0 }], 'var(--sig-ref)', 2.2);
        const retime = (y, o, color, name) => {
          lab(y, name);
          const edges = [{ t: o.capNom, v: 1 }, { t: o.capNom + 0.99, v: 0 }];
          if (o.danger) {
            svg.appendChild(W.s('path', { d: W.digitalPath([{ t: o.capAlt ?? o.anchorAlt, v: 1 }], 0, x, y - RH / 2, y + RH / 2, t0, t1), fill: 'none', stroke: 'var(--sig-err)', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }));
          }
          wave(y, [{ t: o.capNom, v: 1 }], color, 2);
          svg.appendChild(W.s('circle', { cx: x(o.capNom), cy: y, r: 3.5, style: `fill:${color}` }));
          if (o.danger) {
            const alt = o.kind === 'R' ? o.anchorAlt : o.anchorAlt - 0.5;
            svg.appendChild(W.sL('亚稳/不确定', 'metastable', { x: x(Math.max(o.capNom, alt)) + 8, y: y + 4, 'text-anchor': 'start', style: 'font-size:10px;fill:var(--sig-err);font-weight:700' }));
          }
        };
        retime(rows.rr, { ...ev.o.R, capAlt: ev.o.R.anchorAlt }, 'var(--sig-clk)', 'REF_R');
        retime(rows.rf, { ...ev.o.F, capAlt: ev.o.F.anchorAlt == null ? null : ev.o.F.anchorAlt - 0.5 }, 'var(--sig-fine)', 'REF_F');
        // anchor edges used by coarse (solid) and fine (dashed if different)
        const anc = (t, dash, col) => svg.appendChild(W.s('line', { x1: x(t), x2: x(t), y1: 14, y2: VH - 24, style: `stroke:${col};stroke-width:2.2${dash ? ';stroke-dasharray:5 3' : ''}` }));
        const split = ev.oc.anchor !== ev.of.anchor;
        anc(ev.oc.anchor, false, 'var(--sig-sel)');
        if (split) anc(ev.of.anchor, true, 'var(--sig-err)');
        // Δ bracket
        const yb = rows.ref + 16;
        svg.appendChild(W.s('line', { x1: x(tr), x2: x(ev.of.anchor), y1: yb, y2: yb, style: 'stroke:var(--sig-fine);stroke-width:2' }));
        svg.appendChild(W.sL('Δ（TDC）', 'Δ (TDC)', { x: (x(tr) + x(ev.of.anchor)) / 2, y: yb + 11, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--sig-fine);font-weight:700' }));
        svg.appendChild(W.sL(split ? '粗位锚沿' : '锚沿', split ? 'coarse anchor' : 'anchor', { x: x(ev.oc.anchor) + 4, y: 12, style: 'font-size:10px;fill:var(--sig-sel);font-weight:700' }));
        if (split) svg.appendChild(W.sL('细位(TDC)锚沿', 'fine (TDC) anchor', { x: x(ev.of.anchor) + 4, y: 24, style: 'font-size:10px;fill:var(--sig-err);font-weight:700' }));
        W.clear(waveHost).appendChild(svg);
      }

      // ---- error plot
      const NS = 400;
      function drawPlot(ev) {
        const VW = 760, VH = 250, PADL = 70, PADR = 14, TOP = 30, BOT = 36;
        const x = W.scale([0, 1], [PADL, VW - PADR]);
        const y = W.scale([1.6, -1.6], [TOP + 14, VH - BOT]);
        const svg = W.svg(VW, VH, { style: 'cursor:ew-resize;touch-action:none' });
        // strips: danger windows of R and F, SEL choice
        const strip = (yy, label, fn, col) => {
          svg.appendChild(W.sL(label[0], label[1], { x: 6, y: yy + 9, style: 'font-size:10px' }));
          let run = null;
          for (let i = 0; i <= NS; i++) {
            const p = i / NS, on = i < NS && fn(p);
            if (on && !run) run = p;
            if ((!on || i === NS) && run != null) { svg.appendChild(W.s('rect', { x: x(run), y: yy, width: Math.max(1, x(p) - x(run)), height: 10, style: `fill:${col};fill-opacity:.75` })); run = null; }
          }
        };
        strip(8, ['R 危险窗', 'R danger'], (p) => outcome('R', S.m + p, S.su, S.h).danger, 'var(--sig-clk)');
        strip(20, ['F 危险窗', 'F danger'], (p) => outcome('F', S.m + p, S.su, S.h).danger, 'var(--sig-fine)');
        // axes
        for (const v of [-1, 0, 1]) {
          svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
          svg.appendChild(W.s('text', { x: PADL - 6, y: y(v) + 4, 'text-anchor': 'end' }, (v > 0 ? '+' : '') + v));
        }
        for (const v of [0, 0.25, 0.5, 0.75, 1]) {
          svg.appendChild(W.s('line', { x1: x(v), x2: x(v), y1: y(1.6), y2: y(-1.6), class: 'grid' }));
          svg.appendChild(W.s('text', { x: x(v), y: VH - 20, 'text-anchor': 'middle' }, W.fmt(v, 2)));
        }
        svg.appendChild(W.sL('REF 相位 φ（CKV 周期）', 'REF phase φ (CKV periods)', { x: (PADL + VW - PADR) / 2, y: VH - 5, 'text-anchor': 'middle' }));
        svg.appendChild(W.sL('误差（周期）', 'error (cycles)', { x: 6, y: y(0) - 20, style: 'font-size:10px' }));
        // runs
        const key = (e) => `${e.errNom}|${e.errAlt}`;
        let prev = null, start = 0;
        const flush = (endP) => {
          if (!prev) return;
          const bad = prev.errNom !== 0;
          const w = Math.max(1, x(endP) - x(start));
          if (prev.errAlt != null && prev.errAlt !== prev.errNom) {
            const a = Math.min(y(prev.errNom), y(prev.errAlt)), b = Math.max(y(prev.errNom), y(prev.errAlt));
            svg.appendChild(W.s('rect', { x: x(start), y: a, width: w, height: b - a, style: 'fill:var(--warning);fill-opacity:.45' }));
          }
          svg.appendChild(W.s('rect', { x: x(start), y: y(prev.errNom) - 1.5, width: w, height: 3, style: `fill:${bad ? 'var(--sig-err)' : 'var(--good)'}` }));
        };
        for (let i = 0; i < NS; i++) {
          const p = (i + 0.5) / NS, e = evaluate(S, p);
          if (!prev || key(e) !== key(prev)) { flush(i / NS); prev = e; start = i / NS; }
        }
        flush(1);
        // cursor
        svg.appendChild(W.s('line', { x1: x(S.phi), x2: x(S.phi), y1: TOP - 2, y2: VH - BOT + 4, style: 'stroke:var(--sig-ref);stroke-width:2' }));
        svg.appendChild(W.s('circle', { cx: x(S.phi), cy: y(ev.errNom), r: 5, style: 'fill:var(--sig-ref);stroke:var(--surface);stroke-width:1.5' }));
        const lx = S.phi > 0.6 ? x(S.phi) - 6 : x(S.phi) + 6;
        svg.appendChild(W.sL('当前 φ', 'current φ', { x: lx, y: TOP + 6, 'text-anchor': S.phi > 0.6 ? 'end' : 'start', style: 'font-size:10px;fill:var(--sig-ref);font-weight:700' }));
        // legend inside plot
        const pick = (ev2) => { const p = W.svgPoint(svg, ev2); S.phi = W.clamp((p.x - PADL) / (VW - PADL - PADR), 0, 0.995); ctl.phi.value = S.phi; loop.running && (loop.stop(), play.sync()); sched(); };
        let drag = false;
        svg.addEventListener('pointerdown', (e) => { drag = true; svg.setPointerCapture(e.pointerId); pick(e); });
        svg.addEventListener('pointermove', (e) => { if (drag) pick(e); });
        svg.addEventListener('pointerup', () => { drag = false; });
        svg.addEventListener('pointercancel', () => { drag = false; });
        W.clear(plotHost).appendChild(svg);
        plotHost.appendChild(W.legend([
          { color: 'var(--good)', label: ['误差 = 0', 'error = 0'] },
          { color: 'var(--sig-err)', label: ['误差 ≠ 0（整周期错）', 'error ≠ 0 (whole-cycle error)'] },
          { color: 'var(--warning)', label: ['被选候选在危险窗：可能 0 或 ±1', 'selected candidate in danger window: 0 or ±1'] },
        ]));
      }

      function draw() {
        const ev = evaluate(S, S.phi);
        drawWave(ev);
        drawPlot(ev);
        const near = Math.abs(S.phi - Math.round(S.phi)) < 0.25 ? 'near-rise' : 'near-fall';
        const tc = tupleOf(ev.oc.anchor, ev.tref, ev.kc, near), tf = tupleOf(ev.of.anchor, ev.tref, ev.kf, near);
        const f2 = (v) => W.fmt(v, 3);
        const sgn = (v) => (v > 0 ? '+' : '') + v;
        const selNow = selOf(S.phi);
        read.set('phi', `${f2(S.phi)}  (t_REF = ${f2(ev.tref)})`);
        read.set('sel', S.policy === 'sel' ? `SEL=${selNow} / ${S.tuple === 'atomic' ? ev.kc : `coarse ${ev.kc}, fine ${ev.kf}`}` : `${api.t('固定', 'fixed')} ${ev.kc}`);
        read.set('tuple', `${tc.N} = 8·${tc.C} + ${tc.q}   (Δ = ${f2(tf.delta)} T)`);
        const errTxt = sgn(ev.errNom) + (ev.errAlt != null && ev.errAlt !== ev.errNom ? ` / ${sgn(ev.errAlt)}` : '');
        read.set('err', errTxt + api.t(' 周期', ' cycles'));
        W.clear(eqHost).append(W.tex(`\\hat P=N_{\\mathrm{coarse}}-\\Delta_{\\mathrm{fine}}=(8C+q)-\\Delta=${tc.N}-${f2(tf.delta)}=${f2(tc.N - tf.delta)},\\quad t_{\\mathrm{REF}}=${f2(ev.tref)}\\;\\Rightarrow\\;\\hat P-t_{\\mathrm{REF}}=${sgn(ev.errNom)}`, true));
        W.clear(stHost);
        const dangerSel = ev.dangerC;
        stHost.append(
          dangerSel ? W.status('bad', ['数据候选不稳定：被选候选的捕获沿落在 REF 危险窗内', 'Data candidate unstable: the selected candidate’s capture edge is inside the REF danger window']) : W.status('good', ['数据候选稳定（被选候选在危险窗外）', 'Data candidate stable (selected candidate outside its danger window)']),
          ev.kc !== ev.kf ? W.status('bad', [`选择控制偏斜：粗位取 ${ev.kc}、细位取 ${ev.kf}（非原子）`, `Skewed select: coarse from ${ev.kc}, fine from ${ev.kf} (non-atomic)`]) : W.status('good', ['元组来自同一候选（原子）', 'Tuple from a single candidate (atomic)']),
          ev.errNom !== 0 ? W.status('bad', [`重建误差 ${sgn(ev.errNom)} 个 CKV 周期`, `Reconstruction error ${sgn(ev.errNom)} CKV cycle(s)`]) : (dangerSel ? W.status('warn', ['标称误差 0，但可能出现 ±1', 'Nominal error 0, but ±1 possible']) : W.status('good', ['重建无误差', 'No reconstruction error'])),
        );
        const mk = (id, o, t) => {
          const row = W.h('tr', { class: (ev.kc === id || ev.kf === id) ? 'sel' : '' });
          const used = ev.kc === id && ev.kf === id ? [`✓ 被选（整元组）`, `✓ selected (whole tuple)`] : ev.kc === id ? ['✓ 提供粗位', '✓ supplies coarse'] : ev.kf === id ? ['✓ 提供细位锚', '✓ supplies fine anchor'] : ['—', '—'];
          row.append(
            W.h('td', null, id === 'R' ? api.t('R 上升沿', 'R rising') : api.t('F 下降沿', 'F falling')),
            W.h('td', null, f2(o.capNom)),
            W.h('td', null, String(t.C)), W.h('td', null, String(t.q)),
            W.h('td', null, t.side), W.h('td', null, t.id), W.h('td', null, id),
            W.h('td', null, f2(t.delta)),
            W.h('td', null, o.danger ? W.status('bad', ['危险窗', 'in window']) : W.status('good', ['安全', 'safe'])),
            W.h('td', null, W.lbl(used)));
          return row;
        };
        const th = (zh, en) => W.h('th', null, W.L(zh, en));
        const tb = W.h('table', { class: 'dc-tbl' }, W.h('thead', null, W.h('tr', null,
          th('候选', 'candidate'), th('捕获沿时刻', 'capture edge t'), W.h('th', null, 'coarse C'), W.h('th', null, 'low_state q'), W.h('th', null, 'boundary_side'), W.h('th', null, 'fine_anchor_id'), W.h('th', null, 'candidate_id'), th('Δ (T)', 'Δ (T)'), th('状态', 'state'), th('用途', 'role'))),
          W.h('tbody', null, mk('R', ev.o.R, tupleOf(ev.o.R.anchor, ev.tref, 'R', near)), mk('F', ev.o.F, tupleOf(ev.o.F.anchor, ev.tref, 'F', near))));
        W.clear(tblHost).appendChild(W.h('div', { class: 'dc-tblw' }, tb));
      }
      draw();
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      const off = api.onLang && api.onLang(() => draw());
      return { destroy() { loop.stop(); if (raf) cancelAnimationFrame(raf); off && off(); } };
    },
  });
})();
