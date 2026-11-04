/* rollover-window — report §10.2, invariant I8: a W-bit total counter and the modular unwrap window.
 *
 * Model (idealized illustration, T0 = 1): a W-bit counter counts raw CK0 cycles; at every REF event the counter is
 * snapshotted (b), and the difference to the previous snapshot (a) is unwrapped. The true count advances by
 * D = f0·T_obs raw cycles per REF interval (D is the "observation interval" in raw cycles); an optional missed REF
 * makes one interval 2D. Unwrap methods:
 *   'mod'   — Δ̂ = ((b − a) mod 2^W) mapped to [−2^(W−1), 2^(W−1)) (I8): exact iff Δ ∈ [−2^(W−1), 2^(W−1)).
 *   'naive' — Δ̂ = b − a computed in W+1 signed bits from the W-bit snapshots ("just add a sign bit"): exact only if
 *             no wrap of the W-bit counter happened between a and b.
 * Optional policy: if the design-time bound gap·D ≥ 2^(W−1) (gap = REF intervals since the last snapshot), the
 * difference is not unwrapped but the count is reset/reacquired (the I8 "violation handling" column).
 * The accumulated estimate N̂ = N̂_prev + Δ̂ is compared with the true count to show silent aliasing.
 */
(function () {
  'use strict';
  const CSS = `
.rw-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 290px), 1fr)); gap: 10px; align-items: start; }
.rw-panel { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 4px 4px 2px; min-width: 0; }
.rw-h { margin: 14px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.rw-eq { margin-top: 8px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); font-size: .8rem; color: var(--fg-2); }
.rw-eq .tex { overflow-x: auto; overflow-y: hidden; }
`;
  const H = (Wb) => 2 ** (Wb - 1);
  const sg = (v) => (v < 0 ? '−' + Math.abs(v) : '+' + v);
  function unwrap(method, a, b, Wb) {
    const MOD = 2 ** Wb;
    if (method === 'naive') return b - a;
    return W.mod(b - a + H(Wb), MOD) - H(Wb);
  }

  Book.registerWidget({
    id: 'rollover-window',
    group: 'counter',
    title: { zh: '全宽 counter 回绕与可唯一展开窗口（不变量 I8）', en: 'Full-counter rollover and the unique unwrap window (invariant I8)' },
    summary: {
      zh: 'W 位总计数器以 f₀ 计数，每个 REF 做一次 snapshot；相邻两次 snapshot 的模差 (b − a) mod 2^W 转成 [−2^(W−1), 2^(W−1)) 的有符号差。只有当真实差 |Δ| < 2^(W−1) 时展开唯一；超出就别名，必须 reset/reacquire。调节计数宽度 W 与观测间隔，看两者的联合约束。',
      en: 'A W-bit total counter counts at f₀ and is snapshotted at every REF; the modular difference (b − a) mod 2^W of two snapshots is converted to a signed value in [−2^(W−1), 2^(W−1)). The unwrap is unique only while the true difference satisfies |Δ| < 2^(W−1); beyond that it aliases and the system must reset/reacquire. Vary the counter width W and the observation interval to see their joint constraint.',
    },
    sections: ['r-10-2'],
    eqs: [],
    keywords: ['rollover', 'wrap-around', 'modular difference', 'unwrap', 'I8', 'counter width', '回绕', '模差', '展开', 'reacquire'],
    _unwrap: unwrap, // DOM-free, for independent re-checks
    mount(root, api) {
      if (!document.getElementById('rw-css')) { const s = document.createElement('style'); s.id = 'rw-css'; s.textContent = CSS; document.head.appendChild(s); }
      const S = { Wb: 6, D: 19, method: 'mod', missed: false, reacq: false, speed: 0.5 };
      const sim = {};
      function resetSim() {
        const MOD = 2 ** S.Wb;
        sim.k = 0; sim.frac = 0; sim.Nk = Math.round(MOD * 0.7) + 2 * MOD; // count at the last REF instant
        sim.last = { k: 0, N: sim.Nk, b: W.mod(sim.Nk, MOD) }; // last good snapshot
        sim.est = sim.Nk; // acquired at start
        sim.events = [{ k: 0, N: sim.Nk, b: sim.last.b, start: true, err: 0 }];
        sim.lastPair = null;
      }
      resetSim();
      function refEvent() {
        const MOD = 2 ** S.Wb;
        sim.k += 1; sim.Nk += S.D;
        if (S.missed && W.mod(sim.k, 4) === 2) { sim.events.push({ k: sim.k, missed: true, err: sim.est - sim.last.N }); return; }
        const a = sim.last.b, b = W.mod(sim.Nk, MOD), gap = sim.k - sim.last.k;
        const dTrue = sim.Nk - sim.last.N, dHat = unwrap(S.method, a, b, S.Wb);
        const ev = { k: sim.k, a, b, gap, dTrue, dHat, N: sim.Nk };
        if (S.reacq && gap * S.D >= H(S.Wb)) { ev.reacq = true; sim.est = sim.Nk; }
        else { sim.est += dHat; ev.alias = dHat !== dTrue; }
        ev.err = sim.est - sim.Nk;
        sim.last = { k: sim.k, N: sim.Nk, b };
        sim.events.push(ev); if (sim.events.length > 60) sim.events.shift();
        sim.lastPair = ev;
      }

      // ---------------------------------------------------------------- controls
      const loop = api.loop((dt) => {
        sim.frac += dt * S.speed;
        while (sim.frac >= 1) { sim.frac -= 1; refEvent(); }
        draw();
      });
      const play = W.playButton(loop, api);
      const stop = () => { if (loop.running) { loop.stop(); play.sync(); } };
      const stepBtn = W.button(['下一个 REF', 'Next REF'], () => { stop(); sim.frac = 0; refEvent(); draw(); });
      const resetBtn = W.button(['重置', 'Reset'], () => { resetSim(); draw(); });
      const ctlW = W.slider({ label: ['计数宽度 W', 'Counter width W'], min: 4, max: 12, step: 1, value: S.Wb, fmt: (v) => `${v} bit`, onInput: (v) => { const r = S.D / 2 ** S.Wb; S.Wb = v; S.D = Math.max(1, Math.round(r * 2 ** v)); syncD(); resetSim(); schedule(); } });
      const ctlD = W.slider({ label: ['观测间隔 D = f₀·T_obs', 'Interval D = f₀·T_obs'], min: 1, max: 102, step: 1, value: S.D, fmt: (v) => `${v} = ${W.fmt(v / 2 ** S.Wb, 2)}·2^W`, onInput: (v) => { S.D = v; schedule(); } });
      function syncD() { ctlD.input.max = Math.floor(1.6 * 2 ** S.Wb); ctlD.value = S.D; }
      syncD();
      const ctlMethod = W.select({ label: ['差分方法', 'Difference method'], options: [{ value: 'mod', label: ['mod 2^W 后转有符号（I8）', 'mod 2^W → signed (I8)'] }, { value: 'naive', label: ['W+1 位直接相减（“加符号位”）', '(W+1)-bit plain subtraction'] }], value: S.method, onChange: (v) => { S.method = v; resetSim(); schedule(); } });
      const ctlMissed = W.toggle({ label: ['每 4 个 REF 丢失 1 次 snapshot（该间隔变为 2D）', 'Miss one snapshot every 4 REFs (that interval becomes 2D)'], value: S.missed, onChange: (v) => { S.missed = v; schedule(); } });
      const ctlReacq = W.toggle({ label: ['超出窗口时 reset/reacquire（按 gap·D ≥ 2^(W−1) 判定）', 'Reset/reacquire when outside the window (gap·D ≥ 2^(W−1))'], value: S.reacq, onChange: (v) => { S.reacq = v; schedule(); } });
      const ctlSpeed = W.slider({ label: ['速度', 'Speed'], min: 0.2, max: 2, step: 0.1, value: S.speed, fmt: (v) => `${W.fmt(v, 1)} REF/s`, onInput: (v) => { S.speed = v; } });

      const PRESETS = [
        { lab: ['安全：D = 0.3·2^W', 'Safe: D = 0.3·2^W'], f: (M) => ({ D: Math.round(0.3 * M), method: 'mod', missed: false, reacq: false }) },
        { lab: ['最大唯一：D = 2^(W−1) − 1', 'Largest unique: D = 2^(W−1) − 1'], f: (M) => ({ D: M / 2 - 1, method: 'mod', missed: false, reacq: false }) },
        { lab: ['D = 2^(W−1)：别名为 −2^(W−1)', 'D = 2^(W−1): aliases to −2^(W−1)'], f: (M) => ({ D: M / 2, method: 'mod', missed: false, reacq: false }) },
        { lab: ['超过一整圈：D = 1.1·2^W', 'More than a turn: D = 1.1·2^W'], f: (M) => ({ D: Math.round(1.1 * M), method: 'mod', missed: false, reacq: false }) },
        { lab: ['丢一次 REF：0.3 → 0.6·2^W', 'Missed REF: 0.3 → 0.6·2^W'], f: (M) => ({ D: Math.round(0.3 * M), method: 'mod', missed: true, reacq: false }) },
        { lab: ['丢 REF + reset/reacquire', 'Missed REF + reset/reacquire'], f: (M) => ({ D: Math.round(0.3 * M), method: 'mod', missed: true, reacq: true }) },
        { lab: ['“加一个符号位”就行？', '"Just add a sign bit"?'], f: (M) => ({ D: Math.round(0.3 * M), method: 'naive', missed: false, reacq: false }) },
      ];
      function applyPreset(pr) {
        Object.assign(S, pr.f(2 ** S.Wb));
        syncD(); ctlMethod.value = S.method; ctlMissed.value = S.missed; ctlReacq.value = S.reacq;
        resetSim(); schedule();
      }
      const presetRow = W.h('div', { class: 'w-controls' }, W.h('span', { class: 'w-ctl' }, W.L('场景：', 'Scenarios:')), ...PRESETS.map((pr) => W.button(pr.lab, () => applyPreset(pr))));

      const wheelHost = W.h('div', { class: 'rw-panel' });
      const plotHost = W.h('div', { class: 'rw-panel' });
      const legend = W.legend([
        { color: 'var(--sig-clk)', label: ['计数器当前值 / 真实行程（螺旋 = 多圈）', 'counter now / true travel (spiral = several turns)'] },
        { color: 'var(--sig-ref)', label: ['snapshot a（前）、b（后）', 'snapshots a (earlier), b (later)'] },
        { color: 'var(--sig-sel)', label: ['展开结果 = 真实差（正确）', 'unwrapped = true difference (correct)'] },
        { color: 'var(--sig-err)', label: ['展开结果 ≠ 真实差（别名）', 'unwrapped ≠ true difference (aliased)'] },
        { color: 'var(--good)', label: ['唯一展开窗口', 'unique unwrap window'] },
      ]);
      const read = W.readout([
        { key: 'ab', label: ['snapshot a → b', 'snapshots a → b'] },
        { key: 'mod', label: ['(b − a) mod 2^W', '(b − a) mod 2^W'] },
        { key: 'hat', label: ['展开结果', 'unwrapped difference'] },
        { key: 'true', label: ['真实 Δ', 'true Δ'] },
        { key: 'lim', label: ['窗口上限 2^(W−1) − 1', 'window limit 2^(W−1) − 1'] },
        { key: 'st', label: ['结论', 'verdict'] },
      ]);
      const eqHost = W.h('div', { class: 'rw-eq' });
      const traceHost = W.h('div');
      const legendTrace = W.legend([
        { color: 'var(--sig-err)', label: ['累计误差 N̂ − N（单位 2^W）', 'accumulated error N̂ − N (units of 2^W)'] },
        { color: 'var(--warning)', label: ['丢失的 REF', 'missed REF'] },
        { color: 'var(--sig-high)', label: ['reset/reacquire', 'reset/reacquire'] },
      ]);

      root.append(
        presetRow,
        W.controls(play, stepBtn, resetBtn, ctlSpeed),
        W.controls(ctlW, ctlD),
        W.controls(ctlMethod, ctlMissed, ctlReacq),
        W.h('div', { class: 'rw-grid' }, wheelHost, plotHost),
        legend, read.el, eqHost,
        W.h('div', { class: 'rw-h' }, W.L('逐个 REF 的累计计数误差（静默别名会永久残留整圈误差）', 'Accumulated count error per REF (a silent alias leaves a permanent whole-turn error)')),
        traceHost, legendTrace,
        W.note(['要点（I8）：对 W 位总计数，把模差转换为有符号差时，必须保证期望差及采样间隔落在可唯一展开的窗口内，典型条件是 |Δ| < 2^(W−1)。这是计数宽度与观测间隔（包括丢失 REF、长间隔等最坏情况）的联合约束：Δ 超出窗口时模差静默别名成相差整数个 2^W 的值；直接用 W+1 位相减（“加一个符号位”）在两次 snapshot 之间发生回绕时更会出错。超出可展开范围时只能 reset/reacquire，而不是继续累加。',
          'Key point (I8): for a W-bit total counter, converting the modular difference to a signed difference requires the expected difference and the sampling interval to lie inside the uniquely unwrappable window, typically |Δ| < 2^(W−1). It is a joint constraint on counter width and observation interval (including worst cases such as a missed REF or a long gap): beyond the window the modular difference silently aliases to a value off by a whole multiple of 2^W, and a plain (W+1)-bit subtraction ("adding a sign bit") fails as soon as the counter wraps between the two snapshots. Outside the unwrappable range the only correct action is reset/reacquire, not further accumulation.'], 'good'),
        W.note(['理想化示意模型：f₀ 恒定、每个 REF 间隔恰为 D 个原周期（丢 REF 时为 2D），不含频偏与抖动；W、D 为示意参数，不是芯片规格。', 'Idealized illustration: constant f₀, every REF interval exactly D raw cycles (2D after a missed REF), no frequency offset or jitter; W and D are illustrative parameters, not chip specifications.'], 'warn'),
      );

      // ---------------------------------------------------------------- drawing
      let raf = 0;
      function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
      const vw = () => Math.round(W.clamp(root.clientWidth || 700, 340, 760));

      function arcPath(cx, cy, r, p0, p1, MOD) { // clockwise for p1 > p0 (positions in counts), any length < MOD
        const ang = (p) => -Math.PI / 2 + (2 * Math.PI * p) / MOD;
        const n = Math.max(2, Math.ceil(Math.abs(p1 - p0) / MOD * 96));
        let d = '';
        for (let i = 0; i <= n; i++) { const p = p0 + ((p1 - p0) * i) / n, a = ang(p); d += (i ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2); }
        return d;
      }
      function arrowHead(cx, cy, r, p, dir, MOD, color) {
        const a = -Math.PI / 2 + (2 * Math.PI * p) / MOD;
        const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
        const tx = -Math.sin(a) * dir, ty = Math.cos(a) * dir; // tangent (clockwise for dir = +1)
        const nx = Math.cos(a), ny = Math.sin(a);
        return W.s('path', { d: `M${px + tx * 2},${py + ty * 2}L${px - tx * 7 + nx * 4},${py - ty * 7 + ny * 4}L${px - tx * 7 - nx * 4},${py - ty * 7 - ny * 4}Z`, style: `fill:${color}` });
      }

      function drawWheel() {
        const Wb = S.Wb, MOD = 2 ** Wb, half = H(Wb);
        const VWw = 360, VHw = 352, cx = 180, cy = 176, R = 106;
        const svg = W.svg(VWw, VHw);
        const ang = (p) => -Math.PI / 2 + (2 * Math.PI * p) / MOD;
        const pt = (p, r) => [cx + r * Math.cos(ang(p)), cy + r * Math.sin(ang(p))];
        const ev = sim.lastPair;
        // window bands relative to a
        if (ev) {
          if (S.method === 'mod') {
            svg.appendChild(W.s('path', { d: arcPath(cx, cy, R - 6, ev.a, ev.a + half, MOD), style: 'fill:none;stroke:var(--good);stroke-opacity:.35;stroke-width:10' }));
            svg.appendChild(W.s('path', { d: arcPath(cx, cy, R - 6, ev.a + half, ev.a + MOD, MOD), style: 'fill:none;stroke:var(--sig-err);stroke-opacity:.18;stroke-width:10' }));
          } else {
            svg.appendChild(W.s('path', { d: arcPath(cx, cy, R - 6, ev.a, MOD, MOD), style: 'fill:none;stroke:var(--good);stroke-opacity:.35;stroke-width:10' }));
            if (ev.a > 0) svg.appendChild(W.s('path', { d: arcPath(cx, cy, R - 6, 0, ev.a, MOD), style: 'fill:none;stroke:var(--sig-err);stroke-opacity:.18;stroke-width:10' }));
          }
        }
        svg.appendChild(W.s('circle', { cx, cy, r: R, style: 'fill:none;stroke:var(--axis);stroke-width:1.5' }));
        const nT = MOD <= 64 ? MOD : 64;
        for (let i = 0; i < nT; i++) {
          const p = (i * MOD) / nT, major = i % (nT / 4) === 0;
          const [x1, y1] = pt(p, R), [x2, y2] = pt(p, R + (major ? 9 : 4));
          svg.appendChild(W.s('line', { x1, y1, x2, y2, style: `stroke:${major ? 'var(--fg-2)' : 'var(--axis)'};stroke-width:${major ? 1.5 : 1}` }));
        }
        [[0, '0'], [MOD / 4, String(MOD / 4)], [MOD / 2, `${MOD / 2} = 2^(W−1)`], [(3 * MOD) / 4, String((3 * MOD) / 4)]].forEach(([p, t], i) => {
          const [x, y] = pt(p, R + 46);
          svg.appendChild(W.s('text', { x, y: y + 4, 'text-anchor': i === 1 ? 'end' : i === 3 ? 'start' : 'middle', class: 'mono', style: 'font-size:10.5px' }, t));
        });
        if (ev) {
          // true travel: spiral inward, one ring per turn
          const n = Math.max(8, Math.ceil((ev.dTrue / MOD) * 140));
          const r0 = R - 18, dr = 13;
          let d = '';
          for (let i = 0; i <= n; i++) { const s = (ev.dTrue * i) / n, [x, y] = pt(ev.a + s, r0 - (dr * s) / MOD); d += (i ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2); }
          svg.appendChild(W.s('path', { d, style: 'fill:none;stroke:var(--sig-clk);stroke-width:2' }));
          svg.appendChild(arrowHead(cx, cy, r0 - (dr * ev.dTrue) / MOD, ev.a + ev.dTrue, 1, MOD, 'var(--sig-clk)'));
          // interpreted arc outside the rim
          const ok = ev.dHat === ev.dTrue, col = ev.reacq ? 'var(--sig-high)' : ok ? 'var(--sig-sel)' : 'var(--sig-err)';
          if (ev.dHat !== 0) {
            svg.appendChild(W.s('path', { d: arcPath(cx, cy, R + 30, ev.a, ev.a + ev.dHat, MOD), style: `fill:none;stroke:${col};stroke-width:2.4` }));
            svg.appendChild(arrowHead(cx, cy, R + 30, ev.a + ev.dHat, Math.sign(ev.dHat), MOD, col));
          }
          // snapshot markers
          const [ax, ay] = pt(ev.a, R), [bx, by] = pt(ev.b, R);
          svg.appendChild(W.s('circle', { cx: ax, cy: ay, r: 5.5, style: 'fill:var(--surface);stroke:var(--sig-ref);stroke-width:2.2' }));
          svg.appendChild(W.s('circle', { cx: bx, cy: by, r: 5.5, style: 'fill:var(--sig-ref);stroke:var(--surface);stroke-width:1.2' }));
          const [lax, lay] = pt(ev.a, R - 34), [lbx, lby] = pt(ev.b, R - 34);
          svg.appendChild(W.s('text', { x: lax, y: lay + 4, 'text-anchor': 'middle', style: 'font-size:11px;font-weight:700;fill:var(--fg)' }, 'a'));
          svg.appendChild(W.s('text', { x: lbx + (Math.abs(lbx - lax) + Math.abs(lby - lay) < 14 ? 12 : 0), y: lby + 4, 'text-anchor': 'middle', style: 'font-size:11px;font-weight:700;fill:var(--fg)' }, 'b'));
          svg.appendChild(W.s('text', { x: cx, y: cy - 6, 'text-anchor': 'middle', class: 'mono', style: `font-size:13px;font-weight:700;fill:${col}` }, `Δ̂ = ${ev.reacq ? '—' : ev.dHat}`));
          svg.appendChild(W.s('text', { x: cx, y: cy + 12, 'text-anchor': 'middle', class: 'mono', style: 'font-size:11px;fill:var(--fg-2)' }, `Δ = ${ev.dTrue}`));
        }
        // live pointer (current count)
        const MODc = MOD, cur = sim.Nk + sim.frac * S.D;
        const [px, py] = pt(W.mod(cur, MODc), R + 2);
        svg.appendChild(W.s('line', { x1: cx, y1: cy, x2: px, y2: py, style: 'stroke:var(--sig-clk);stroke-width:1.6;stroke-opacity:.8' }));
        svg.appendChild(W.s('circle', { cx, cy, r: 3, style: 'fill:var(--sig-clk)' }));
        svg.appendChild(W.sL(`${Wb} 位计数器（模 ${MOD}）`, `${Wb}-bit counter (mod ${MOD})`, { x: 8, y: 16, style: 'font-size:11px;font-weight:650;fill:var(--fg)' }));
        svg.appendChild(W.sL(S.method === 'mod' ? '绿带：b 落此处时展开结果 ≥ 0' : '绿带：a→b 不经过 0', S.method === 'mod' ? 'green band: unwrapped ≥ 0 if b lands here' : 'green band: a→b does not pass 0', { x: VWw - 8, y: VHw - 6, 'text-anchor': 'end', style: 'font-size:10px' }));
        W.clear(wheelHost).appendChild(svg);
      }

      function drawPlot() {
        const Wb = S.Wb, MOD = 2 ** Wb, half = H(Wb);
        const VWp = 360, VHp = 330, L = 46, Rr = 12, T = 22, B = 40;
        const svg = W.svg(VWp, VHp);
        const xs = W.scale([0, 1.6 * MOD], [L, VWp - Rr]), ys = W.scale([-MOD, MOD], [VHp - B, T]);
        const a = sim.lastPair ? sim.lastPair.a : sim.last.b;
        // unique window
        svg.appendChild(W.s('rect', { x: xs(0), y: T, width: xs(S.method === 'mod' ? half : MOD - a) - xs(0), height: VHp - B - T, style: 'fill:var(--good);fill-opacity:.12' }));
        svg.appendChild(W.sL('唯一窗口', 'unique window', { x: xs(0) + 4, y: T + 12, style: 'font-size:10px;fill:var(--good-ink)' }));
        // grid / axes
        for (const v of [-MOD, -half, 0, half, MOD]) svg.appendChild(W.s('line', { x1: L, x2: VWp - Rr, y1: ys(v), y2: ys(v), class: v === 0 ? 'axis' : 'grid' }));
        for (const v of [0, half, MOD, 1.5 * MOD]) svg.appendChild(W.s('line', { x1: xs(v), x2: xs(v), y1: T, y2: VHp - B, class: v === 0 ? 'axis' : 'grid' }));
        const lab = (v) => (v === 0 ? '0' : v === half ? '2^(W−1)' : v === -half ? '−2^(W−1)' : v === MOD ? '2^W' : v === -MOD ? '−2^W' : '1.5·2^W');
        for (const v of [-MOD, -half, 0, half, MOD]) svg.appendChild(W.s('text', { x: L - 4, y: ys(v) + 3.5, 'text-anchor': 'end', class: 'mono', style: 'font-size:9px' }, lab(v)));
        for (const v of [0, half, MOD, 1.5 * MOD]) svg.appendChild(W.s('text', { x: xs(v), y: VHp - B + 13, 'text-anchor': 'middle', class: 'mono', style: 'font-size:9px' }, lab(v)));
        svg.appendChild(W.sL('真实差 Δ（原周期）', 'true difference Δ (raw cycles)', { x: (L + VWp - Rr) / 2, y: VHp - 8, 'text-anchor': 'middle', style: 'font-size:10px' }));
        svg.appendChild(W.sL('纵轴：展开结果', 'y: unwrapped difference', { x: 4, y: 12, style: 'font-size:10px' }));
        // identity
        svg.appendChild(W.s('line', { x1: xs(0), y1: ys(0), x2: xs(MOD), y2: ys(MOD), style: 'stroke:var(--fg-2);stroke-width:1.2;stroke-dasharray:4 3' }));
        // transfer curve Δ̂(Δ), drawn per continuous piece
        const f = (x) => unwrap(S.method, W.mod(a, MOD), W.mod(a + x, MOD), Wb);
        let d = '', prev = null;
        const N = 960;
        for (let i = 0; i <= N; i++) {
          const x = (1.6 * MOD * i) / N, y = f(x);
          d += (prev != null && Math.abs(y - prev) > MOD / 4 ? 'M' : (i ? 'L' : 'M')) + xs(x).toFixed(2) + ',' + ys(y).toFixed(2);
          prev = y;
        }
        svg.appendChild(W.s('path', { d, style: 'fill:none;stroke:var(--sig-sel);stroke-width:2' }));
        // operating points: D (and 2D when snapshots can be missed)
        const pts = [{ x: S.D, lab: 'D' }];
        if (S.missed) pts.push({ x: 2 * S.D, lab: '2D' });
        for (const p of pts) {
          if (p.x > 1.6 * MOD) continue;
          const y = f(p.x), ok = y === p.x;
          svg.appendChild(W.s('line', { x1: xs(p.x), x2: xs(p.x), y1: T, y2: VHp - B, style: `stroke:${ok ? 'var(--sig-sel)' : 'var(--sig-err)'};stroke-width:1.2;stroke-dasharray:3 3` }));
          svg.appendChild(W.s('circle', { cx: xs(p.x), cy: ys(y), r: 5, style: `fill:${ok ? 'var(--sig-sel)' : 'var(--sig-err)'};stroke:var(--surface);stroke-width:1.5` }));
          svg.appendChild(W.s('text', { x: xs(p.x) + 7, y: ys(y) + (y > 0 ? 14 : -7), class: 'mono', style: `font-size:10.5px;font-weight:700;fill:${ok ? 'var(--fg)' : 'var(--sig-err)'};paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round` }, `${p.lab}: Δ̂=${y}`));
        }
        W.clear(plotHost).appendChild(svg);
      }

      function drawTrace() {
        const VW = vw(), narrow = VW < 520, MOD = 2 ** S.Wb;
        const L = narrow ? 40 : 54, Rr = 10, T = 12, VH = 150, B = 26;
        const evs = sim.events.slice(-32);
        const errs = evs.map((e) => e.err / MOD);
        const lo = Math.min(-1, ...errs) - 0.5, hi = Math.max(1, ...errs) + 0.5;
        const k0 = evs.length ? evs[0].k : 0, k1 = Math.max(k0 + 31, evs.length ? evs[evs.length - 1].k : 0);
        const xs = W.scale([k0 - 0.5, k1 + 0.5], [L, VW - Rr]), ys = W.scale([lo, hi], [VH - B, T]);
        const svg = W.svg(VW, VH);
        for (const v of W.ticks(lo, hi, 4)) {
          if (!Number.isInteger(v)) continue;
          svg.appendChild(W.s('line', { x1: L, x2: VW - Rr, y1: ys(v), y2: ys(v), class: v === 0 ? 'axis' : 'grid' }));
          svg.appendChild(W.s('text', { x: L - 4, y: ys(v) + 3.5, 'text-anchor': 'end', class: 'mono', style: 'font-size:9.5px' }, v === 0 ? '0' : `${v}·2^W`));
        }
        let d = '';
        evs.forEach((e, i) => { d += (i ? `L${xs(e.k).toFixed(2)},${ys(evs[i - 1].err / MOD).toFixed(2)}` : `M${xs(e.k).toFixed(2)},${ys(e.err / MOD).toFixed(2)}`) + `L${xs(e.k).toFixed(2)},${ys(e.err / MOD).toFixed(2)}`; });
        if (evs.length) svg.appendChild(W.s('path', { d, style: 'fill:none;stroke:var(--sig-err);stroke-width:2' }));
        for (const e of evs) {
          if (e.missed) svg.appendChild(W.s('rect', { x: xs(e.k) - 3, y: VH - B - 8, width: 6, height: 8, style: 'fill:var(--warning)' }));
          else if (e.reacq) svg.appendChild(W.s('circle', { cx: xs(e.k), cy: ys(e.err / MOD), r: 4.5, style: 'fill:var(--sig-high);stroke:var(--surface);stroke-width:1' }));
          else if (e.alias) svg.appendChild(W.s('circle', { cx: xs(e.k), cy: ys(e.err / MOD), r: 4, style: 'fill:var(--sig-err);stroke:var(--surface);stroke-width:1' }));
          else svg.appendChild(W.s('circle', { cx: xs(e.k), cy: ys(e.err / MOD), r: 2.2, style: 'fill:var(--fg-2)' }));
        }
        for (let k = Math.ceil(k0 / 4) * 4; k <= k1; k += 4) svg.appendChild(W.s('text', { x: xs(k), y: VH - 8, 'text-anchor': 'middle', class: 'mono', style: 'font-size:9.5px' }, `#${k}`));
        svg.appendChild(W.sL('REF 序号', 'REF index', { x: VW - Rr, y: VH - 8 - 12, 'text-anchor': 'end', style: 'font-size:9.5px' }));
        W.clear(traceHost).appendChild(svg);
      }

      function drawReadouts() {
        const MOD = 2 ** S.Wb, half = H(S.Wb), ev = sim.lastPair;
        read.set('lim', `${half - 1} (W = ${S.Wb})`);
        if (!ev) { ['ab', 'mod', 'hat', 'true'].forEach((k) => read.set(k, '—')); read.set('st', W.L('等待第一个 REF', 'waiting for the first REF')); W.clear(eqHost).append(W.L('第一次 REF 之后显示代入数值。', 'Numbers appear after the first REF.')); return; }
        const m = W.mod(ev.b - ev.a, MOD);
        read.set('ab', `${ev.a} → ${ev.b}${ev.gap > 1 ? `  (gap ${ev.gap})` : ''}`);
        read.set('mod', S.method === 'mod' ? String(m) : '—');
        read.set('hat', ev.reacq ? 'INVALID' : String(ev.dHat));
        read.set('true', String(ev.dTrue));
        read.set('st', ev.reacq ? W.status('warn', ['超出窗口 → reset/reacquire', 'outside window → reset/reacquire']) : ev.dHat === ev.dTrue ? W.status('good', ['唯一展开', 'unique unwrap']) : W.status('bad', [`别名：差 ${sg((ev.dHat - ev.dTrue) / MOD)}·2^W`, `aliased: off by ${sg((ev.dHat - ev.dTrue) / MOD)}·2^W`]));
        const cond = Math.abs(ev.dTrue) < half;
        W.clear(eqHost).append(
          W.h('div', null, W.L('最近一次展开（代入数值）：', 'Latest unwrap (with numbers):')),
          S.method === 'mod'
            ? W.h('div', null, W.h('div', { class: 'tex' }, W.tex(`(b-a)\\bmod 2^{W}=(${ev.b}-${ev.a})\\bmod ${MOD}=${m}`, true)),
              W.h('div', { class: 'tex' }, W.tex(`\\Rightarrow\\ \\hat\\Delta=${m < half ? m : `${m}-${MOD}`}=${unwrap('mod', ev.a, ev.b, S.Wb)}\\in[-${half},\\,${half})`, true)))
            : W.h('div', { class: 'tex' }, W.tex(`\\hat\\Delta=b-a=${ev.b}-${ev.a}=${ev.b - ev.a}\\quad(\\text{no }\\bmod 2^{W})`, true)),
          W.h('div', { class: 'tex' }, W.tex(`|\\Delta|=${Math.abs(ev.dTrue)}\\ ${cond ? '<' : '\\geq'}\\ 2^{W-1}=${half}`, true)),
          W.h('div', null, cond
            ? W.L('满足 |Δ| < 2^(W−1)：模差可唯一展开。', '|Δ| < 2^(W−1) holds: the modular difference unwraps uniquely.')
            : W.L(`不满足：同一个模差对应“展开结果 + k·${MOD}”的无穷多个候选，展开只是挑出其中落在窗口内的那一个。`, `Violated: the same modular difference fits "unwrapped value + k·${MOD}" for every integer k; the unwrap merely picks the one inside the window.`)));
      }

      function draw() { drawWheel(); drawPlot(); drawTrace(); drawReadouts(); }

      draw();
      const ro = 'ResizeObserver' in window ? new ResizeObserver(() => schedule()) : null;
      if (ro) ro.observe(root);
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      return { destroy() { loop.stop(); if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); } };
    },
  });
})();
