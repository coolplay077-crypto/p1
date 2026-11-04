/* causality-timeline — report §8.3: a slow after-the-fact snapshot cannot generate an edge that has already passed.
 *
 * IDEALIZED timeline model. Time unit = T0 (raw CK0 rising edge k at t = k). REF arrives at t_REF = f (fractional position f).
 *   chain: REF -> snapshot -> CDC -> decode -> slow-domain compute -> selector armed;   t_ready = t_REF + ΣL.
 *   wanted edge  e_want = ceil(t_REF)  (the CK0 edge closest after REF).  The selector needs t_su before an edge to act.
 *   Strategy 0 (what §8.3 forbids): wait for t_ready, then pick e_want.  Feasible only if t_ready + t_su <= e_want.
 *   Strategy 1 (predict ahead): the previous REF period predicts t̂_REF = t_REF + ε; the selection for ẽ = ceil(t̂_REF) is
 *       computed from data of the previous period (REF period T_REF fixed to 64 T0 here) and committed before ẽ.
 *       interval d = ẽ − t_REF must fit the TDC range  |d| <= R.
 *   Strategy 2 (fast front-end in parallel): candidates / local timing around e_want are captured at CK0 speed into a history of
 *       depth B (T0) and decoded slowly; works iff the decode finishes before the history is overwritten:  ΣL <= B + (e_want − t_REF).
 *   Strategy 3 (future executable edge): e_fut = ceil(t_ready + t_su); d = e_fut − t_REF must fit R (needs larger TDC range).
 */
(function () {
  'use strict';
  const CSS = `
.ct-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); margin-top: 10px; }
.ct-tbl { width: 100%; border-collapse: collapse; font-size: .78rem; font-variant-numeric: tabular-nums; }
.ct-tbl th, .ct-tbl td { padding: 5px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.ct-tbl th { background: var(--surface-2); font-weight: 650; white-space: nowrap; }
.ct-tbl tr:last-child td { border-bottom: 0; }
.ct-eq { overflow-x: auto; overflow-y: hidden; }
.ct-eq .katex-display { margin: .3em 0; }
.ct-st { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-top: 8px; }
`;
  const TREF = 64; // previous-period distance used by the prediction strategy (T0)
  const STAGES = [
    { k: 'snap', zh: '快照', en: 'snapshot', col: 'var(--s1)' },
    { k: 'cdc', zh: 'CDC', en: 'CDC', col: 'var(--s2)' },
    { k: 'dec', zh: '解码', en: 'decode', col: 'var(--s3)' },
    { k: 'comp', zh: '低速计算', en: 'slow compute', col: 'var(--s4)' },
    { k: 'arm', zh: '选择器就绪', en: 'selector armed', col: 'var(--s7)' },
  ];

  function model(P) {
    const tref = P.f;
    const L = STAGES.map((s) => P[s.k]);
    const sumL = L.reduce((a, b) => a + b, 0);
    const tready = tref + sumL;
    const ewant = Math.ceil(tref - 1e-9);
    const stage = []; let t = tref;
    STAGES.forEach((s, i) => { stage.push({ ...s, a: t, b: t + L[i] }); t += L[i]; });
    // strategy 0 (naive, forbidden)
    const passed = tready + P.su > ewant + 1e-9;
    // strategy 1
    const that = tref + P.eps;
    const e1 = Math.ceil(that - 1e-9);
    const d1 = e1 - tref;
    const predReady = tref - TREF + sumL; // selection computed from the previous period's data
    const feas1 = predReady + P.su <= e1 + 1e-9;
    const fits1 = Math.abs(d1) <= P.R + 1e-9;
    // strategy 2
    const d2 = ewant - tref;
    const done2 = tready;
    const hold2 = ewant + P.B; // history window of the candidate captured at e_want
    const feas2 = done2 <= hold2 + 1e-9;
    const fits2 = Math.abs(d2) <= P.R + 1e-9;
    // strategy 3
    const e3 = Math.ceil(tready + P.su - 1e-9);
    const d3 = e3 - tref;
    const fits3 = Math.abs(d3) <= P.R + 1e-9;
    return { tref, sumL, tready, ewant, stage, passed, gap: tready + P.su - ewant,
      s1: { e: e1, d: d1, predReady, feas: feas1, fits: fits1, ok: feas1 && fits1, that },
      s2: { e: ewant, d: d2, done: done2, hold: hold2, feas: feas2, fits: fits2, ok: feas2 && fits2 },
      s3: { e: e3, d: d3, fits: fits3, ok: fits3 } };
  }

  Book.registerWidget({
    id: 'causality-timeline',
    group: 'executor',
    title: { zh: '因果性：后知后觉的低速 snapshot 不能生成已过去的边沿', en: 'Causality: a slow after-the-fact snapshot cannot create a passed edge' },
    summary: {
      zh: 'REF 到来后经快照、CDC、解码、低速计算才能使选择器就绪；此时最近的 CK0 沿早已过去。对比三种闭合因果性的做法——事先预测并提交、高速前端并行捕获后慢速解码、选未来可执行边沿——各自用哪条边、REF 到该边的间隔、是否落入 TDC 量程，以及各自的失败点。',
      en: 'After REF arrives, snapshot, CDC, decode and slow compute must all finish before the selector is ready — by then the nearest CK0 edge is long gone. Compare the three ways to close causality (predict ahead and commit, parallel high-speed front-end with slow decode, pick a future executable edge): which edge each uses, the REF-to-edge interval, whether it fits the TDC range, and what fails.',
    },
    sections: ['r-8-3'],
    eqs: [],
    keywords: ['causality', 'time-predictive', 'Kuo', 'snapshot', 'CDC', 'selector', 'passed edge', '因果性', '预测', '选相', '后知后觉'],
    mount(root, api) {
      if (!document.getElementById('ct-css')) { const s = document.createElement('style'); s.id = 'ct-css'; s.textContent = CSS; document.head.appendChild(s); }
      const S = { f: 0.35, snap: 1, cdc: 2, dec: 1.5, comp: 3, arm: 1, su: 0.5, R: 2, eps: 0.3, B: 12, now: 0, speed: 3 };
      const PRESETS = {
        std: { f: 0.35, snap: 1, cdc: 2, dec: 1.5, comp: 3, arm: 1, su: 0.5, R: 2, eps: 0.3, B: 12 },
        fast: { f: 0.35, snap: 0.2, cdc: 0.3, dec: 0.2, comp: 0.1, arm: 0.1, su: 0.2, R: 2, eps: 0.3, B: 12 },
        bigErr: { f: 0.35, snap: 1, cdc: 2, dec: 1.5, comp: 3, arm: 1, su: 0.5, R: 2, eps: 2.6, B: 12 },
        wide: { f: 0.35, snap: 1, cdc: 2, dec: 1.5, comp: 3, arm: 1, su: 0.5, R: 12, eps: 0.3, B: 12 },
        shallow: { f: 0.35, snap: 2, cdc: 4, dec: 3, comp: 6, arm: 1, su: 0.5, R: 2, eps: 0.3, B: 6 },
      };
      let raf = 0;
      const sched = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
      const svgHost = W.h('div'), eqHost = W.h('div', { class: 'ct-eq' }), stHost = W.h('div', { class: 'ct-st' }), tblHost = W.h('div');
      const ctl = {};
      let tEnd = 20;
      const loop = api.loop((dt) => { S.now += dt * S.speed; if (S.now > tEnd) S.now = -1.2; sched(); });
      const play = W.playButton(loop, api);
      const T0 = (v) => `${W.fmt(v, 2)} T₀`;
      const sl = (key, label, min, max, step, fmt) => (ctl[key] = W.slider({ label, min, max, step, value: S[key], fmt: fmt || T0, onInput: (v) => { S[key] = v; sched(); } }));
      sl('f', ['REF 位置 t_REF', 'REF position t_REF'], 0, 0.95, 0.05, (v) => W.fmt(v, 2));
      sl('snap', ['快照延迟', 'Snapshot latency'], 0, 10, 0.1);
      sl('cdc', ['CDC 延迟', 'CDC latency'], 0, 10, 0.1);
      sl('dec', ['解码延迟', 'Decode latency'], 0, 10, 0.1);
      sl('comp', ['低速计算', 'Slow compute'], 0, 10, 0.1);
      sl('arm', ['选择器装载', 'Selector arming'], 0, 10, 0.1);
      sl('su', ['选择器建立 t_su', 'Selector setup t_su'], 0, 2, 0.1);
      sl('eps', ['预测误差 ε', 'Prediction error ε'], -3, 3, 0.1, (v) => `${v > 0 ? '+' : ''}${W.fmt(v, 1)} T₀`);
      sl('R', ['TDC 量程 R（±）', 'TDC range R (±)'], 0.5, 40, 0.5);
      sl('B', ['前端历史深度 B', 'Front-end history B'], 1, 40, 1, (v) => `${v} T₀`);
      function apply(n) {
        Object.assign(S, PRESETS[n]);
        for (const k of Object.keys(PRESETS[n])) ctl[k].value = S[k];
        S.now = -1.2; draw();
      }
      const presets = W.controls(
        W.h('span', { class: 'w-ctl' }, W.L('场景：', 'Scenarios:')),
        W.button(['默认链路（ΣL=8.5）', 'Default chain (ΣL=8.5)'], () => apply('std'), { primary: true }),
        W.button(['极快链路', 'Very fast chain'], () => apply('fast')),
        W.button(['预测误差大', 'Large prediction error'], () => apply('bigErr')),
        W.button(['加大 TDC 量程', 'Wide TDC range'], () => apply('wide')),
        W.button(['慢链路 + 浅历史', 'Slow chain + shallow history'], () => apply('shallow')),
        W.button(['重播动画', 'Replay'], () => { S.now = -1.2; if (!loop.running) { loop.start(); play.sync(); } }),
      );
      root.append(
        W.note(['理想化示意时间线：时间单位 T₀（CK0 周期），延迟与量程均为可调参数，不是任何实现的实测值。', 'Idealized timeline: time unit T₀ (CK0 period); latencies and ranges are free parameters, not measured values of any implementation.']),
        presets,
        W.controls(play, ctl.f),
        W.controls(ctl.snap, ctl.cdc, ctl.dec, ctl.comp, ctl.arm),
        W.controls(ctl.su, ctl.eps, ctl.R, ctl.B),
        W.legend([
          { color: 'var(--sig-clk)', label: ['CK0 边沿（灰=已过去）', 'CK0 edges (grey = already passed)'] },
          { color: 'var(--sig-ref)', label: ['REF', 'REF'] },
          ...STAGES.map((st) => ({ color: st.col, label: [st.zh, st.en] })),
          { color: 'var(--sig-sel)', label: ['被选边沿', 'selected edge'] },
          { color: 'var(--sig-fine)', label: ['REF→边沿 间隔 d', 'REF→edge interval d'] },
          { color: 'var(--sig-err)', label: ['失败', 'fails'] },
        ]),
        svgHost, eqHost, stHost, tblHost,
        W.note([
          '要点：式中 t_ready = t_REF + ΣL 一旦超过最近边沿 e_want，“REF 后慢速算完再无代价选最近边沿”就不可能——即使 q 算得完全正确，也不能倒退时间把已过去的边沿送入 TDC。只有三条路：事先预测并在目标前提交（Kuo 的 time-predictive 选相属此类，代价是预测误差进入间隔）；高速前端并行捕获候选/局部时间再慢速解码（代价是前端历史深度）；选未来可执行边沿并接受、校准更长间隔（代价是更大的 TDC 量程）。局限：延迟用同一时间单位的常数表示，预测周期固定为 64 T₀，未建模亚稳与抖动。',
          'Key point: once t_ready = t_REF + ΣL exceeds the nearest edge e_want, "compute slowly after REF and still pick the nearest edge for free" is impossible — even a perfectly computed q cannot send an already-passed edge into the TDC. Only three ways close it: predict ahead and commit before the target (Kuo’s time-predictive selection belongs here; the cost is prediction error entering the interval); capture candidates / local timing with a fast front-end in parallel and decode slowly (cost: front-end history depth); or select a future executable edge and accept / calibrate the longer interval (cost: larger TDC range). Limits: latencies are constants in one time unit, the prediction distance is fixed at 64 T₀, metastability and jitter are not modelled.',
        ]),
      );

      function draw() {
        const m = model(S);
        const tMax = Math.max(m.s3.e, m.tready, m.s1.e) + 3;
        tEnd = tMax;
        const t0 = -1.2, t1 = Math.max(tMax, 9);
        const VW = 760, PADL = 100, PADR = 14;
        const x = W.scale([t0, t1], [PADL, VW - PADR]);
        const rowsY = { top: 56, s0: 178, s1: 256, s2: 334, s3: 412 };
        const VH = 462;
        const svg = W.svg(VW, VH);
        const now = S.now;
        const dense = x(1) - x(0) < 9;
        // edges grid
        for (let k = Math.ceil(t0); k <= t1; k++) {
          const past = k < now;
          svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: 22, y2: VH - 20, style: `stroke:${past ? 'var(--grid)' : 'var(--sig-clk)'};stroke-width:${past ? 1 : 1.2};stroke-opacity:${past ? 0.9 : 0.35}` }));
          if (!dense || k % 5 === 0) svg.appendChild(W.s('text', { x: x(k), y: VH - 6, 'text-anchor': 'middle', style: 'font-size:10px' }, `${k}`));
        }
        svg.appendChild(W.sL('CK0 边沿 k', 'CK0 edge k', { x: 4, y: VH - 6, style: 'font-size:10px' }));
        // REF marker
        svg.appendChild(W.s('line', { x1: x(m.tref), x2: x(m.tref), y1: 14, y2: VH - 20, style: 'stroke:var(--sig-ref);stroke-width:2.2' }));
        svg.appendChild(W.s('text', { x: x(m.tref) - 4, y: 14, 'text-anchor': 'end', style: 'font-size:11px;font-weight:700;fill:var(--sig-ref)' }, 'REF'));
        // header lane: chain bars
        svg.appendChild(W.sL('REF 之后的链路', 'chain after REF', { x: 4, y: rowsY.top - 14, class: 'lbl' }));
        const bh = 22;
        m.stage.forEach((st, i) => {
          const a = x(st.a), b = x(st.b);
          if (b - a < 0.3) return;
          const prog = W.clamp((now - st.a) / Math.max(st.b - st.a, 1e-9), 0, 1);
          svg.appendChild(W.s('rect', { x: a, y: rowsY.top - bh / 2 + (i % 2) * 0, width: b - a, height: bh, style: `fill:${st.col};fill-opacity:.2;stroke:${st.col};stroke-width:1.2` }));
          svg.appendChild(W.s('rect', { x: a, y: rowsY.top - bh / 2, width: (b - a) * prog, height: bh, style: `fill:${st.col};fill-opacity:.5` }));
          if (b - a > Math.max(st.zh.length * 11, st.en.length * 5.6) + 6) svg.appendChild(W.sL(st.zh, st.en, { x: (a + b) / 2, y: rowsY.top + 4, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--fg)' }));
        });
        // ready + wanted
        const vline = (t, col, zh, en, y, anchor = 'start', dash = false) => {
          svg.appendChild(W.s('line', { x1: x(t), x2: x(t), y1: 22, y2: VH - 20, style: `stroke:${col};stroke-width:2${dash ? ';stroke-dasharray:5 3' : ''}` }));
          svg.appendChild(W.sL(zh, en, { x: x(t) + (anchor === 'end' ? -4 : 4), y, 'text-anchor': anchor, style: `font-size:10.5px;font-weight:700;fill:${col}` }));
        };
        // passed zone between REF and ready
        svg.appendChild(W.s('rect', { x: x(m.tref), y: rowsY.top + 20, width: Math.max(0, x(Math.min(m.tready, t1)) - x(m.tref)), height: 10, style: 'fill:var(--sig-err);fill-opacity:.25' }));
        svg.appendChild(W.sL('此间经过的边沿无法再被选择', 'edges passing in here can no longer be selected', { x: x(m.tref) + 4, y: rowsY.top + 29, style: 'font-size:10px;fill:var(--sig-err);font-weight:700' }));
        vline(m.tready, m.passed ? 'var(--sig-err)' : 'var(--good-ink)', 't_ready', 't_ready', rowsY.top + 48, 'start', true);
        // lanes
        const lane = (key, zh, en, edge, d, ok, extra) => {
          const y = rowsY[key];
          svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: y + 14, y2: y + 14, class: 'grid' }));
          svg.appendChild(W.sL(zh, en, { x: PADL + 2, y: y - 25, class: 'lbl' }));
          if (edge != null) {
            const past = edge < now;
            const col = ok ? 'var(--sig-sel)' : 'var(--sig-err)';
            svg.appendChild(W.s('line', { x1: x(edge), x2: x(edge), y1: y - 14, y2: y + 12, style: `stroke:${col};stroke-width:4` }));
            svg.appendChild(W.s('circle', { cx: x(edge), cy: y - 14, r: 4.5, style: `fill:${col}` }));
            svg.appendChild(W.s('text', { x: x(edge) + 7, y: y - 12, style: `font-size:10.5px;font-weight:700;fill:${col}` }, `e = ${edge}`));
            // interval bracket
            const a = Math.min(m.tref, edge), b = Math.max(m.tref, edge);
            svg.appendChild(W.s('line', { x1: x(a), x2: x(b), y1: y + 8, y2: y + 8, style: 'stroke:var(--sig-fine);stroke-width:2.4' }));
            svg.appendChild(W.s('text', { x: (x(a) + x(b)) / 2, y: y + 21, 'text-anchor': 'middle', style: 'font-size:10px;font-weight:700;fill:var(--sig-fine)' }, `d = ${W.fmt(d, 2)} T₀`));
            if (past && false) { /* reserved */ }
          }
          if (extra) extra(y);
        };
        // lane 0: forbidden baseline
        lane('s0', '0 ✗ 事后选最近沿', '0 ✗ pick nearest after the fact', m.ewant, m.ewant - m.tref, !m.passed);
        {
          const y = rowsY.s0;
          svg.appendChild(W.sL(m.passed ? `✗ t_ready+t_su 比 e=${m.ewant} 晚 ${W.fmt(m.gap, 2)} T₀` : '✓ 链路足够快（t_ready+t_su ≤ e_want）', m.passed ? `✗ t_ready+t_su is ${W.fmt(m.gap, 2)} T₀ after e=${m.ewant}` : '✓ chain fast enough (t_ready+t_su ≤ e_want)', { x: Math.min(x(m.ewant) + 90, VW - PADR - 4), y: y + 4, 'text-anchor': 'start', style: `font-size:10.5px;font-weight:700;fill:${m.passed ? 'var(--sig-err)' : 'var(--good-ink)'}` }));
        }
        lane('s1', '1 预测并提前提交', '1 predict & commit ahead', m.s1.e, m.s1.d, m.s1.ok, (y) => {
          const tp = m.s1.predReady;
          const lbl = tp < t0 ? [`◀ 本次选择在上一周期算好（t=${W.fmt(tp, 1)}）`, `◀ selection computed in previous period (t=${W.fmt(tp, 1)})`] : ['提交', 'commit'];
          const px = Math.max(x(Math.max(tp, t0)), PADL + 2);
          svg.appendChild(W.s('path', { d: `M${px},${y + 12}l5,-8l-10,0z`, style: 'fill:var(--sig-plan)' }));
          svg.appendChild(W.sL(lbl[0], lbl[1], { x: px + 8, y: y + 36, style: 'font-size:10px;fill:var(--sig-plan);font-weight:700' }));
          const tp2 = x(m.s1.that);
          svg.appendChild(W.s('line', { x1: tp2, x2: tp2, y1: y - 2, y2: y + 16, style: 'stroke:var(--sig-plan);stroke-width:1.6;stroke-dasharray:3 2' }));
          svg.appendChild(W.sL('预测 t̂_REF', 'predicted t̂_REF', { x: tp2 + 3, y: y + 36, style: 'font-size:10px;fill:var(--sig-plan)' }));
        });
        lane('s2', '2 高速前端并行捕获', '2 fast front-end captures', m.s2.e, m.s2.d, m.s2.ok, (y) => {
          // history window and decode completion
          const a = x(m.s2.e), b = x(Math.min(m.s2.hold, t1));
          svg.appendChild(W.s('rect', { x: a, y: y + 25, width: Math.max(0, b - a), height: 5, style: `fill:var(--sig-low);fill-opacity:.5` }));
          svg.appendChild(W.sL('历史保留窗 B', 'history window B', { x: a + 4, y: y + 42, style: 'font-size:10px;fill:var(--fg-2)' }));
          const dx = x(Math.min(m.s2.done, t1));
          svg.appendChild(W.s('path', { d: `M${dx},${y + 14}l5,8l-10,0z`, style: `fill:${m.s2.feas ? 'var(--good-ink)' : 'var(--sig-err)'}` }));
          svg.appendChild(W.sL('慢速解码完成', 'slow decode done', { x: dx + 8, y: y + 42, style: `font-size:10px;font-weight:700;fill:${m.s2.feas ? 'var(--good-ink)' : 'var(--sig-err)'}` }));
        });
        lane('s3', '3 选未来可执行沿', '3 pick a future executable edge', m.s3.e, m.s3.d, m.s3.ok);
        // playhead
        if (now >= t0 && now <= t1) svg.appendChild(W.s('line', { x1: x(now), x2: x(now), y1: 20, y2: VH - 18, style: 'stroke:var(--fg);stroke-width:1.6;stroke-opacity:.7' }));
        W.clear(svgHost).appendChild(svg);

        // equations
        const f = (v) => W.fmt(v, 2);
        W.clear(eqHost).append(
          W.tex(`t_{\\mathrm{ready}}=t_{\\mathrm{REF}}+\\textstyle\\sum L=${f(m.tref)}+${f(m.sumL)}=${f(m.tready)}\\;\\;${m.passed ? '>' : '\\le'}\\;\\;e_{\\mathrm{want}}-t_{su}=${f(m.ewant - S.su)}`, true));
        // status
        W.clear(stHost).append(
          m.passed ? W.status('bad', [`最近边沿 e=${m.ewant} 已过去 ${f(m.gap)} T₀ —— 选择器就绪太晚`, `nearest edge e=${m.ewant} passed ${f(m.gap)} T₀ before the selector was ready`]) : W.status('good', ['链路足够快，事后选择碰巧可行', 'chain is fast enough that after-the-fact selection happens to work']),
          W.status(m.s1.ok ? 'good' : 'bad', [`策略 1 ${m.s1.ok ? '可行' : '失败'}`, `Strategy 1 ${m.s1.ok ? 'OK' : 'fails'}`]),
          W.status(m.s2.ok ? 'good' : 'bad', [`策略 2 ${m.s2.ok ? '可行' : '失败'}`, `Strategy 2 ${m.s2.ok ? 'OK' : 'fails'}`]),
          W.status(m.s3.ok ? 'good' : 'bad', [`策略 3 ${m.s3.ok ? '可行' : '失败'}`, `Strategy 3 ${m.s3.ok ? 'OK' : 'fails'}`]),
        );
        // table
        const th = (zh, en) => W.h('th', null, W.L(zh, en));
        const why = (ok, okZ, okE, badZ, badE) => (ok ? W.status('good', [okZ, okE]) : W.status('bad', [badZ, badE]));
        const R = S.R;
        const rows = [
          ['0', ['事后慢速选最近沿', 'After-the-fact slow pick'], `${m.ewant}`, f(m.ewant - m.tref),
            m.passed ? W.status('bad', ['沿已过去', 'edge already passed']) : W.status('good', ['未过去', 'not yet passed']),
            m.passed ? W.L(`不可能：t_ready+t_su 晚于该沿 ${f(m.gap)} T₀`, `Impossible: t_ready+t_su is ${f(m.gap)} T₀ later than that edge`) : W.L('仅当链路足够快才成立', 'Only works if the chain is fast enough')],
          ['1', ['事先预测并提交', 'Predict ahead & commit'], `${m.s1.e}`, f(m.s1.d),
            why(m.s1.fits, `|d| ≤ R=${R}`, `|d| ≤ R=${R}`, `|d|=${f(Math.abs(m.s1.d))} > R=${R}`, `|d|=${f(Math.abs(m.s1.d))} > R=${R}`),
            m.s1.feas ? W.L(`预测误差 ε=${f(S.eps)} 直接进入间隔；预测需在上一周期完成（${f(m.s1.predReady)} ≤ e−t_su）`, `Prediction error ε=${f(S.eps)} enters the interval directly; the prediction must finish in the previous period (${f(m.s1.predReady)} ≤ e−t_su)`) : W.L('预测来不及在目标沿前提交', 'prediction cannot be committed before the target edge')],
          ['2', ['高速前端并行捕获 + 慢速解码', 'Fast front-end + slow decode'], `${m.s2.e}`, f(m.s2.d),
            why(m.s2.fits, `|d| ≤ R=${R}`, `|d| ≤ R=${R}`, `|d|=${f(Math.abs(m.s2.d))} > R=${R}`, `|d|=${f(Math.abs(m.s2.d))} > R=${R}`),
            m.s2.feas ? W.L(`解码在历史窗内完成（${f(m.s2.done)} ≤ ${f(m.s2.hold)}）；代价：高速前端面积/功耗`, `Decode finishes inside the history window (${f(m.s2.done)} ≤ ${f(m.s2.hold)}); cost: fast front-end area/power`) : W.L(`历史被覆盖：解码完成 ${f(m.s2.done)} > 保留至 ${f(m.s2.hold)}`, `History overwritten: decode done at ${f(m.s2.done)} > retained until ${f(m.s2.hold)}`)],
          ['3', ['选未来可执行沿', 'Pick a future executable edge'], `${m.s3.e}`, f(m.s3.d),
            why(m.s3.fits, `|d| ≤ R=${R}`, `|d| ≤ R=${R}`, `|d|=${f(Math.abs(m.s3.d))} > R=${R}`, `|d|=${f(Math.abs(m.s3.d))} > R=${R}`),
            m.s3.fits ? W.L(`所需量程 ≥ ${f(Math.abs(m.s3.d))} T₀（需校准该间隔）`, `Required range ≥ ${f(Math.abs(m.s3.d))} T₀ (this interval must be calibrated)`) : W.L(`需要 TDC 量程 ≥ ${f(Math.abs(m.s3.d))} T₀，当前仅 ${R}`, `Needs TDC range ≥ ${f(Math.abs(m.s3.d))} T₀, only ${R} available`)],
        ];
        const tb = W.h('table', { class: 'ct-tbl' }, W.h('thead', null, W.h('tr', null, W.h('th', null, '#'), th('策略', 'strategy'), th('使用的边沿 e', 'edge used e'), th('间隔 d (T₀)', 'interval d (T₀)'), th('是否可行', 'verdict'), th('代价 / 失败点', 'cost / what fails'))),
          W.h('tbody', null, rows.map((r) => W.h('tr', null, W.h('td', null, r[0]), W.h('td', null, W.lbl(r[1])), W.h('td', null, r[2]), W.h('td', null, r[3]), W.h('td', null, r[4]), W.h('td', null, r[5])))));
        W.clear(tblHost).appendChild(W.h('div', { class: 'ct-tblw' }, tb));
      }
      S.now = -1.2;
      draw();
      if (!api.reducedMotion) { loop.start(); play.sync(); } else { S.now = 1e3; draw(); }
      const off = api.onLang && api.onLang(() => draw());
      return { destroy() { loop.stop(); if (raf) cancelAnimationFrame(raf); off && off(); } };
    },
  });
})();
