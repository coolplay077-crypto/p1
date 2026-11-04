/* coarse-loop — report §9.4, Eq. (21)–(22): coarse takeover is not deletion of fine, and CNT alone is not an FLL.
 *
 * IDEALIZED ILLUSTRATION (the book prescribes no controller): REF-period time steps k = 0…K.
 *   reference phase accumulator  R[k] = R[k−1] + FCW[k]                       (raw cycles; FCW in multiples of 1/64, so exact in IEEE doubles)
 *   DCO phase                    P[k] = P[k−1] + f[k],  f[k] = f_free + u[k−1] (+ small noise)  — cycles per REF period
 *   coarse observation           N_R[k] = ⌊P[k]⌋  (integer raw cycles counted up to the k-th REF)
 *   fine observation (if usable) P_q[k] = ⌊64·P[k]⌋/64 (1/64-cycle resolution, illustrative)
 *   coarse phase error           e_c[k] = R[k] − N_R[k]                       Eq. (21)
 *   identity                     e_c[k] − e_c[k−1] = FCW[k] − (N_R[k] − N_R[k−1])   Eq. (22), checked numerically at every step
 * The PI loop below uses the best available observation (fine, else coarse with its +½ quantisation midpoint removed). It is an
 * illustrative controller only; the "coordinate bias" toggle shows what a one-raw-cycle mismatch at a phase_source switch does.
 */
(function () {
  'use strict';
  const CSS = `
.cl-eq { overflow-x: auto; overflow-y: hidden; }
.cl-eq .katex-display { margin: .3em 0; }
.cl-tag { display: inline-block; font-size: .72rem; font-weight: 700; padding: 1px 9px; border-radius: 999px; background: var(--accent-wash); color: var(--accent-ink); }
`;
  const K = 160, Q = 64;

  function sim(S) {
    const FCW = [0], R = [0], P = [S.p0], N = [Math.floor(S.p0)], Pq = [Math.floor(S.p0 * Q) / Q];
    const avail = [true], src = ['fine'];
    const ec = [R[0] - N[0]], ef = [R[0] - Pq[0]], u = [0];
    const rnd = W.rng(7);
    let I = 0;
    // k = 0 observation already available (k = 0 is the initial state)
    for (let k = 1; k <= K; k++) {
      const fcw = Math.round((S.fcw0 + (k >= S.stepAt ? S.dF : 0)) * Q) / Q;
      FCW.push(fcw); R.push(R[k - 1] + fcw);
      const fFree = S.fcw0 + S.detune;
      const f = fFree + u[k - 1] + S.noise * (rnd() - 0.5);
      P.push(P[k - 1] + f);
      N.push(Math.floor(P[k])); Pq.push(Math.floor(P[k] * Q) / Q);
      const a = !S.pureCoarse && !(S.winOn && k >= S.winStart && k < S.winStart + S.winLen);
      avail.push(a); src.push(a ? 'fine' : 'coarse');
      ec.push(R[k] - N[k]); ef.push(R[k] - Pq[k]);
      // controller input: best available observation
      let e;
      if (a) e = R[k] - Pq[k];
      else e = R[k] - N[k] - 0.5 - (S.biasErr ? 1 : 0); // coarse: remove the mean +½ quantisation offset; optional wrong coordinate bias
      I += S.ki * e;
      u.push(Math.max(-4, Math.min(4, S.kp * e + I)));
    }
    let ok = 0; const diffs = [], rhs = [];
    for (let k = 1; k <= K; k++) {
      const l = ec[k] - ec[k - 1], r = FCW[k] - (N[k] - N[k - 1]);
      diffs.push(l); rhs.push(r); if (l === r) ok++;
    }
    return { FCW, R, P, N, Pq, avail, src, ec, ef, diffs, rhs, ok };
  }

  Book.registerWidget({
    id: 'coarse-loop',
    group: 'fine',
    title: { zh: 'Coarse 接管与相位/频率恒等式（式 21–22）', en: 'Coarse takeover and the phase/frequency identity (Eq. 21–22)' },
    summary: {
      zh: '理想化示意：参考累加相位 R[k]、DCO 一侧的整数周期计数 N_R[k]、粗相位误差 e_c[k] = R[k] − N_R[k]（式 21），并逐步验证其差分等于 FCW[k] − (N_R[k] − N_R[k−1])（式 22）。可切换 fine 可用窗口观察 coarse 接管，也可演示 FCW 阶跃与 phase_source 切换时的坐标偏置错误。',
      en: 'Idealized illustration: reference accumulated phase R[k], the DCO-side integer cycle count N_R[k], the coarse phase error e_c[k] = R[k] − N_R[k] (Eq. 21), and a step-by-step check that its difference equals FCW[k] − (N_R[k] − N_R[k−1]) (Eq. 22). Toggle fine-availability windows to watch coarse takeover, and demonstrate an FCW step and a coordinate-bias error at a phase_source switch.',
    },
    sections: ['r-9-4'],
    eqs: ['21', '22'],
    keywords: ['coarse', 'takeover', 'FLL', 'e_c', 'FCW', 'phase_source', 'identity', '接管', '频率误差', '恒等式'],
    mount(root, api) {
      if (!document.getElementById('cl-css')) { const s = document.createElement('style'); s.id = 'cl-css'; s.textContent = CSS; document.head.appendChild(s); }
      const BASE = { fcw0: 20, detune: -1.2, p0: 0.4, dF: 0, stepAt: 60, kp: 0.25, ki: 0.02, noise: 0.02, winOn: true, winStart: 85, winLen: 35, pureCoarse: false, biasErr: false };
      const S = { ...BASE };
      let data = sim(S), kc = K, run = false;

      const svgHost = W.h('div');
      const eqHost = W.h('div', { class: 'cl-eq' });
      const read = W.readout([
        { key: 'ident', label: ['式 (22) 恒等式成立步数', 'Eq. (22) identity holds'] },
        { key: 'src', label: ['当前 phase_source', 'Current phase_source'] },
        { key: 'ec', label: ['e_c[k]', 'e_c[k]'] },
        { key: 'ef', label: ['fine 误差（可用时）', 'fine error (when usable)'] },
        { key: 'rhs', label: ['FCW[k] − ΔN_R[k]', 'FCW[k] − ΔN_R[k]'] },
        { key: 'jump', label: ['最大 |Δe_c| 变化', 'max |step in e|'] },
      ]);
      const ctl = {};
      const mkS = (k, label, min, max, step, fmt) => (ctl[k] = W.slider({ label, min, max, step, value: S[k], fmt, onInput: (v) => { S[k] = v; resim(); } }));
      const mkT = (k, label) => (ctl[k] = W.toggle({ label, value: S[k], onChange: (v) => { S[k] = v; resim(); } }));
      mkS('dF', ['FCW 阶跃量', 'FCW step size'], -3, 3, 0.25, (v) => `${v > 0 ? '+' : ''}${W.fmt(v, 2)}`);
      mkS('stepAt', ['阶跃发生于 k =', 'Step at k ='], 20, 140, 1, (v) => String(v));
      mkS('kp', ['K_p（示意）', 'K_p (illustrative)'], 0.05, 0.6, 0.01, (v) => W.fmt(v, 2));
      mkS('ki', ['K_i（示意）', 'K_i (illustrative)'], 0, 0.08, 0.002, (v) => W.fmt(v, 3));
      mkS('winStart', ['fine 失效起点 k', 'fine loss starts at k'], 10, 140, 1, (v) => String(v));
      mkS('winLen', ['失效长度', 'loss length'], 5, 80, 1, (v) => `${v} REF`);
      mkT('winOn', ['启用 fine 失效窗口', 'Enable fine-loss window']);
      mkT('pureCoarse', ['始终只用 coarse', 'Coarse only, always']);
      mkT('biasErr', ['切换到 coarse 时坐标偏置差 1 周期 ✗', 'Wrong coordinate bias (1 raw cycle) on coarse ✗']);

      function setAll(p) { Object.assign(S, BASE, p); for (const k of Object.keys(ctl)) ctl[k].value = S[k]; resim(); }
      const playBtn = W.button(['▶ 逐步重放', '▶ Replay'], () => { kc = 0; run = true; loop.start(); draw(); }, { primary: true });
      const loop = api.loop((dt) => { if (!run) return; kc = Math.min(K, kc + dt * 45); if (kc >= K) run = false; draw(); });
      const presets = W.controls(playBtn, W.h('span', { class: 'w-ctl' }, W.L('场景：', 'Scenarios:')),
        W.button(['fine 全程可用', 'Fine always usable'], () => setAll({ winOn: false })),
        W.button(['fine 掉线 → coarse 接管', 'Fine drop-out → coarse takeover'], () => setAll({})),
        W.button(['FCW 阶跃', 'FCW step'], () => { setAll({ dF: 1.5, winOn: false }); kc = 0; run = true; loop.start(); }),
        W.button(['FCW 阶跃 + 接管', 'FCW step + takeover'], () => { setAll({ dF: 1.5, stepAt: 70, winStart: 60, winLen: 40 }); kc = 0; run = true; loop.start(); }),
        W.button(['仅 coarse', 'Coarse only'], () => setAll({ pureCoarse: true })),
        W.button(['坐标偏置错误 ✗', 'Coordinate-bias error ✗'], () => setAll({ biasErr: true })));

      root.append(
        W.h('div', null, W.h('span', { class: 'cl-tag' }, W.L('理想化示意模型：PI 控制器仅为说明，书中并未规定', 'Idealized illustration: the PI controller is only illustrative — the book prescribes none'))),
        presets,
        W.controls(ctl.dF, ctl.stepAt, ctl.kp, ctl.ki),
        W.controls(ctl.winOn, ctl.winStart, ctl.winLen, ctl.pureCoarse, ctl.biasErr),
        W.legend([
          { color: 'var(--sig-clk)', label: ['e_c[k] = R − N_R（粗）', 'e_c[k] = R − N_R (coarse)'] },
          { color: 'var(--sig-fine)', label: ['fine 相位误差（可用时）', 'fine phase error (when usable)'] },
          { color: 'var(--sig-ref)', label: ['FCW[k]', 'FCW[k]'] },
          { color: 'var(--sig-low)', label: ['ΔN_R[k]', 'ΔN_R[k]'] },
          { color: 'var(--sig-err)', label: ['coarse 接管区间', 'coarse-takeover interval'] },
        ]),
        svgHost, eqHost, read.el,
        W.note([
          '要点：e_c 是量化较粗的相位误差；只有它的差分才对应频率：e_c[k] − e_c[k−1] = FCW[k] − (N_R[k] − N_R[k−1])，上图每一步都精确成立。CNT 本身并不构成一条独立的 FLL——只有另行设计频率误差控制器、状态机或增益路径时，才应称为 FLL-assisted。coarse 接管不等于删除 fine；fine 恢复时坐标偏置必须一致，phase_source 切换不能引入人为的整周期跳变（打开“坐标偏置差 1 周期”可看到 1 个原周期的假跳变）。本模型为理想化示意：f 与 FCW 的数值是任意选取的，非芯片指标。',
          'Key point: e_c is a coarse-quantised PHASE error; only its difference relates to frequency: e_c[k] − e_c[k−1] = FCW[k] − (N_R[k] − N_R[k−1]), which holds exactly at every step above. CNT alone does not constitute an FLL — only a separately designed frequency-error controller, state machine or gain path makes it FLL-assisted. Coarse takeover is not deletion of fine; on fine recovery the coordinate bias must agree, and a phase_source switch must not introduce artificial whole-cycle jumps (enable "wrong coordinate bias" to see a fake one-raw-cycle jump). Idealized illustration: f and FCW values are arbitrary, not chip specifications.',
        ]),
      );

      function resim() { data = sim(S); kc = K; run = false; draw(); }

      function draw() {
        const d = data;
        const kk = Math.min(K, Math.floor(kc));
        const VW = 760, PADL = 50, PADR = 14;
        const PH = [{ y: 14, h: 118 }, { y: 158, h: 96 }, { y: 280, h: 96 }];
        const VH = 410;
        const x = W.scale([0, K], [PADL, VW - PADR]);
        const svg = W.svg(VW, VH);
        // coarse-takeover shading across all panels
        let a = null;
        const spans = [];
        for (let k = 0; k <= K; k++) {
          if (!d.avail[k] && a == null) a = k;
          if ((d.avail[k] || k === K) && a != null) { spans.push([a, d.avail[k] ? k : K]); a = null; }
        }
        const panel = (i, lo, hi, titleZh, titleEn, fmtY) => {
          const p = PH[i];
          const y = W.scale([lo, hi], [p.y + p.h, p.y]);
          for (const [s0, s1] of spans) svg.appendChild(W.s('rect', { x: x(s0), y: p.y, width: x(s1) - x(s0), height: p.h, style: 'fill:var(--sig-err);fill-opacity:.1' }));
          for (const t of W.ticks(lo, hi, 4)) {
            svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: y(t), y2: y(t), class: 'grid' }));
            svg.appendChild(W.s('text', { x: PADL - 5, y: y(t) + 3.5, 'text-anchor': 'end', style: 'font-size:10px' }, fmtY ? fmtY(t) : W.fmt(t, 2)));
          }
          if (lo < 0 && hi > 0) svg.appendChild(W.s('line', { x1: PADL, x2: VW - PADR, y1: y(0), y2: y(0), class: 'axis' }));
          svg.appendChild(W.s('rect', { x: PADL, y: p.y, width: VW - PADL - PADR, height: p.h, fill: 'none', class: 'axis' }));
          svg.appendChild(W.sL(titleZh, titleEn, { x: PADL + 6, y: p.y + 12, class: 'lbl', style: 'font-size:10.5px' }));
          return y;
        };
        const path = (arr, k0, k1, xf, yf, stepped) => {
          let s = '';
          for (let k = k0; k <= k1; k++) {
            const X = xf(k).toFixed(1), Y = yf(arr[k]).toFixed(1);
            if (stepped && k > k0) s += `L${X},${yf(arr[k - 1]).toFixed(1)}`;
            s += (k === k0 ? 'M' : 'L') + X + ',' + Y;
          }
          return s;
        };
        // panel A: phase errors
        const eAll = [];
        for (let k = 0; k <= K; k++) { eAll.push(d.ec[k]); if (d.avail[k]) eAll.push(d.ef[k]); }
        const eLo = Math.floor(Math.min(...eAll) * 2) / 2 - 0.25, eHi = Math.ceil(Math.max(...eAll) * 2) / 2 + 0.25;
        const yA = panel(0, eLo, eHi, '相位误差（原周期）', 'Phase error (raw cycles)');
        svg.appendChild(W.s('path', { d: path(d.ec, 0, kk, x, yA, true), fill: 'none', style: 'stroke:var(--sig-clk);stroke-width:1.7;stroke-linejoin:round' }));
        let seg = [];
        const flush = () => { if (seg.length > 1) { let s = ''; seg.forEach((k, i) => { s += (i ? 'L' : 'M') + x(k).toFixed(1) + ',' + yA(d.ef[k]).toFixed(1); }); svg.appendChild(W.s('path', { d: s, fill: 'none', style: 'stroke:var(--sig-fine);stroke-width:2;stroke-linejoin:round' })); } seg = []; };
        for (let k = 0; k <= kk; k++) { if (d.avail[k]) seg.push(k); else flush(); }
        flush();
        // panel B: FCW & dN
        const dN = [0]; for (let k = 1; k <= K; k++) dN.push(d.N[k] - d.N[k - 1]);
        const bLo = Math.floor(Math.min(...d.FCW.slice(1), ...dN.slice(1)) - 1), bHi = Math.ceil(Math.max(...d.FCW.slice(1), ...dN.slice(1)) + 1);
        const yB = panel(1, bLo, bHi, 'FCW[k] 与每个 REF 周期内的整数计数 ΔN_R[k]', 'FCW[k] and integer count per REF period ΔN_R[k]', (t) => W.fmt(t, 1));
        svg.appendChild(W.s('path', { d: path(dN, 1, kk, x, yB, true), fill: 'none', style: 'stroke:var(--sig-low);stroke-width:1.5;stroke-linejoin:round' }));
        svg.appendChild(W.s('path', { d: path(d.FCW, 1, kk, x, yB, true), fill: 'none', style: 'stroke:var(--sig-ref);stroke-width:2.2' }));
        // panel C: identity
        let cLo = 1e9, cHi = -1e9;
        for (let k = 0; k < K; k++) { cLo = Math.min(cLo, d.diffs[k], d.rhs[k]); cHi = Math.max(cHi, d.diffs[k], d.rhs[k]); }
        cLo = Math.floor(cLo) - 0.5; cHi = Math.ceil(cHi) + 0.5;
        const yC = panel(2, cLo, cHi, '式 (22)：e_c[k] − e_c[k−1]（实线）与 FCW[k] − ΔN_R[k]（虚线）', 'Eq. (22): e_c[k] − e_c[k−1] (solid) vs FCW[k] − ΔN_R[k] (dashed)', (t) => W.fmt(t, 1));
        const xs1 = (k) => x(k);
        const pd = (arr) => { let s = ''; for (let k = 1; k <= kk; k++) s += (k === 1 ? 'M' : 'L') + xs1(k).toFixed(1) + ',' + yC(arr[k - 1]).toFixed(1); return s; };
        svg.appendChild(W.s('path', { d: pd(d.diffs), fill: 'none', style: 'stroke:var(--sig-clk);stroke-width:3.2;stroke-opacity:.55;stroke-linejoin:round' }));
        svg.appendChild(W.s('path', { d: pd(d.rhs), fill: 'none', style: 'stroke:var(--fg);stroke-width:1.2;stroke-dasharray:4 3;stroke-linejoin:round' }));
        // step marker + cursor + x axis
        if (S.dF !== 0 && S.stepAt <= K) {
          svg.appendChild(W.s('line', { x1: x(S.stepAt), x2: x(S.stepAt), y1: PH[0].y, y2: PH[2].y + PH[2].h, style: 'stroke:var(--sig-ref);stroke-width:1.4;stroke-dasharray:5 3' }));
          svg.appendChild(W.sL('FCW 阶跃', 'FCW step', { x: x(S.stepAt) + 4, y: PH[1].y + PH[1].h - 5, style: 'font-size:10px;fill:var(--sig-ref);font-weight:700' }));
        }
        for (const [s0, s1] of spans) svg.appendChild(W.sL('coarse 接管', 'coarse takeover', { x: (x(s0) + x(s1)) / 2, y: PH[0].y + PH[0].h - 6, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--sig-err);font-weight:700' }));
        if (kk < K) svg.appendChild(W.s('line', { x1: x(kk), x2: x(kk), y1: PH[0].y, y2: PH[2].y + PH[2].h, style: 'stroke:var(--fg);stroke-width:1.2' }));
        const axY = PH[2].y + PH[2].h + 14;
        for (const t of W.ticks(0, K, 8)) svg.appendChild(W.s('text', { x: x(t), y: axY, 'text-anchor': 'middle', style: 'font-size:10px' }, String(t)));
        svg.appendChild(W.sL('REF 周期序号 k', 'REF period index k', { x: VW - PADR, y: axY + 14, 'text-anchor': 'end', style: 'font-size:10px' }));
        W.clear(svgHost).appendChild(svg);

        // readouts + equation with live numbers
        const k = Math.max(1, kk);
        let okc = 0; for (let i = 1; i <= kk; i++) if (d.diffs[i - 1] === d.rhs[i - 1]) okc++;
        let jmax = 0; for (let i = 1; i <= kk; i++) jmax = Math.max(jmax, Math.abs(d.diffs[i - 1]));
        read.set('ident', `${okc} / ${kk}${okc === kk ? ' ✓' : ' ✗'}`);
        read.set('src', d.src[kk] === 'fine' ? 'FINE' : 'COARSE');
        read.set('ec', W.fmt(d.ec[kk], 4));
        read.set('ef', d.avail[kk] ? W.fmt(d.ef[kk], 4) : api.t('不可用', 'unavailable'));
        read.set('rhs', kk >= 1 ? `${W.fmt(d.FCW[k], 3)} − ${d.N[k] - d.N[k - 1]} = ${W.fmt(d.rhs[k - 1], 3)}` : '—');
        read.set('jump', W.fmt(jmax, 3));
        W.clear(eqHost).append(
          W.tex('e_c[k]=R[k]-N_R[k]\\qquad(21)', true),
          W.tex(`e_c[k]-e_c[k-1]=\\mathrm{FCW}[k]-\\big(N_R[k]-N_R[k-1]\\big)\\qquad(22)`, true),
          kk >= 1 ? W.tex(`k=${k}:\\;${W.fmt(d.ec[k], 3)}-${W.fmt(d.ec[k - 1], 3)}=${W.fmt(d.diffs[k - 1], 3)}\\;=\\;${W.fmt(d.FCW[k], 3)}-${d.N[k] - d.N[k - 1]}=${W.fmt(d.rhs[k - 1], 3)}`, true) : '');
      }
      draw();
      const off = api.onLang(() => draw());
      return { destroy() { run = false; loop.stop(); off && off(); } };
    },
  });
})();
