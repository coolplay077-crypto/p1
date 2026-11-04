/* multiphase-units — report §3.4, Eqs. (7)–(8): why q and the Octal region cannot simply be added.
 *
 * Idealized behavioural model (the book's own assumptions: ideal /4, eight uniformly spaced phases, aligned
 * phase origins; NOT a decoder truth table from any paper and NOT a chip specification):
 *   - raw clock CK0: rising edges at t = n (t in raw cycles T0), Φ0(t) = t; raw counter N = #edges, q_raw = N mod 4.
 *   - ideal /4: CK/4 rises at t = 4m, period T_V = 4·T0; divided counter C_d increments on each CK/4 rising edge.
 *   - eight phases P_i (i = 0…7) = CK/4 delayed by i·T_V/8, 50 % duty.
 *   - at REF the eight phases are sampled (ideal flops); the region a_s is decoded from the snapshot as the unique
 *     i with P_i = 1 and P_{i+1} = 0 (the most recently risen phase). An ideal fine TDC gives the residual.
 *   - phase-selection convention: preceding (ε ≥ 0), nearest (signed ε) or following (ε ≤ 0); choosing the next
 *     phase after a = 7 wraps a → 0 and carries into C_d (the anchor and the residual move together).
 *   - Eq. (7): Φ0 = 4C_d + a/2 + 4ε_d;  Eq. (8): Φ0 = 4C_d + q + p/2 + ε0 with q = ⌊a/2⌋, p = a mod 2, ε0 = 4ε_d.
 *   - the mixed-unit formula 4C_d + q + a/8 + ε0 is evaluated side by side.
 */
(function () {
  'use strict';
  const CSS = `
.mu .w-seg { flex-wrap: wrap; }
.mu .w-seg button { white-space: nowrap; }
.mu .w-ctl { flex-wrap: wrap; }
.mu-sub { margin: 16px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.mu-eqs { margin-top: 10px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: .82rem; color: var(--fg-2); }
.mu-eqs .ln { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; padding: 3px 0; }
.mu-eqs .ln + .ln { border-top: 1px dashed var(--border); }
.mu-eqs .ln.bad .tx { color: var(--critical-ink); }
.mu-eqs .tx { overflow-x: auto; overflow-y: hidden; max-width: 100%; padding: 2px 0; }
.mu-eqs .tag { font-size: .72rem; color: var(--muted); white-space: nowrap; }
.mu-presets { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin-bottom: 10px; }
.mu-presets .k { font-size: .75rem; color: var(--muted); }
.mu-grid { display: flex; flex-wrap: wrap; gap: 12px; }
.mu-grid > div { flex: 1 1 280px; min-width: 0; }
.mu-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.mu-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; font-variant-numeric: tabular-nums; margin: 0; }
.mu-tbl th, .mu-tbl td { padding: 3px 7px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
.mu-tbl th { background: var(--surface-2); font-weight: 650; position: static; }
.mu-tbl th:first-child, .mu-tbl td:first-child { text-align: left; }
.mu-tbl tr:last-child td { border-bottom: 0; }
.mu-tbl tr.cur td { background: var(--accent-wash); font-weight: 650; }
.mu-tbl td.bad { color: var(--critical-ink); }
.mu-tbl td.ok { color: var(--good-ink); }
.mu-tbl .katex { font-size: 1em; }
.mu-run { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); font-size: .8rem; }
.mu-bar { flex: 1 1 120px; height: 6px; border-radius: 4px; background: var(--surface-3); overflow: hidden; min-width: 80px; }
.mu-bar > i { display: block; height: 100%; width: 0; background: var(--good); }
.mu-mono { font-family: var(--mono); }
.w-svg text.mu-halo { paint-order: stroke; stroke: var(--surface); stroke-width: 3.5px; stroke-linejoin: round; }
`;
  const F = (n, d) => W.F(n, d);
  const fm = (v, d = 4) => W.fmt(v, d).replace('-', '−');
  const tx = (v, d = 4) => W.fmt(v, d);
  /** exact-looking fraction text for multiples of 1/8 */
  function frac8(v) {
    const n = Math.round(v * 8);
    if (Math.abs(v * 8 - n) > 1e-9) return fm(v, 4);
    const g = (a, b) => (b ? g(b, a % b) : a);
    const k = g(Math.abs(n), 8) || 1;
    const nn = n / k, dd = 8 / k;
    return dd === 1 ? String(nn).replace('-', '−') : `${String(nn).replace('-', '−')}/${dd}`;
  }
  function texFrac8(v) {
    const n = Math.round(v * 8);
    if (Math.abs(v * 8 - n) > 1e-9) return tx(v, 4);
    const g = (a, b) => (b ? g(b, a % b) : a);
    const k = g(Math.abs(n), 8) || 1;
    const nn = n / k, dd = 8 / k;
    if (dd === 1) return String(nn);
    return (nn < 0 ? '-' : '') + `\\tfrac{${Math.abs(nn)}}{${dd}}`;
  }

  // ------------------------------------------------------------------ model
  const phaseBit = (i, t) => (W.mod(t - i / 2, 4) < 2 ? 1 : 0); // P_i: CK/4 delayed by i·T_V/8 (= i·T0/2)
  function evaluate(tR, conv) {
    const N = Math.floor(tR); // raw rising edges at t = 0, 1, 2, … → count index
    const qRaw = W.mod(N, 4);
    let Cd = Math.floor(tR / 4); // divided counter (aligned origin)
    const bits = [];
    for (let i = 0; i < 8; i++) bits.push(phaseBit(i, tR));
    let aS = -1;
    for (let i = 0; i < 8; i++) if (bits[i] === 1 && bits[(i + 1) % 8] === 0) aS = i;
    const phiD = tR / 4; // true divided-clock phase
    const epsS = phiD - Cd - aS / 8; // residual w.r.t. the most recently risen phase, ∈ [0, 1/8)
    let a = aS;
    if ((conv === 'nearest' && epsS >= 1 / 16 - 1e-12) || (conv === 'following' && epsS > 1e-12)) a = aS + 1;
    let carry = false;
    if (a === 8) { a = 0; Cd += 1; carry = true; }
    const epsD = phiD - Cd - a / 8;
    const q = Math.floor(a / 2), p = a % 2, eps0 = 4 * epsD;
    const eq7 = 4 * Cd + a / 2 + 4 * epsD;
    const eq8 = 4 * Cd + q + p / 2 + eps0;
    const wrong = 4 * Cd + q + a / 8 + eps0;
    return { tR, N, qRaw, Cd, bits, aS, a, carry, phiD, epsD, eps0, q, p, eq7, eq8, wrong, truth: tR, wErr: wrong - tR };
  }

  Book.registerWidget({
    id: 'multiphase-units',
    group: 'phase',
    title: { zh: '八相区域与原周期单位：式 (7)–(8) 与混合单位陷阱', en: 'Eight-phase regions in raw-cycle units: Eqs. (7)–(8) and the mixed-unit trap' },
    summary: {
      zh: '理想 /4、八相均匀且相位原点对齐（第 3.4 节的假设）。拖动 REF 时刻：从八相快照解码区域 a，得到 C_d、a、ε_d，再按式 (7)/(8) 换算到原周期，与真值比对；同时并列错误的“4C + q + a/8”混合公式，看 q 被重复计入、相位间距被误读为 T₀/8 后的误差。底部可运行 L04（768 例，精确有理数）。',
      en: 'Ideal /4, eight uniformly spaced phases, aligned phase origins (the assumptions of §3.4). Move the REF instant: the region a is decoded from the eight-phase snapshot, giving C_d, a and ε_d, which Eqs. (7)/(8) convert to raw cycles and compare with the truth; side by side, the wrong mixed formula "4C + q + a/8" shows the error from counting q twice and misreading the phase spacing as T₀/8. The L04 check (768 cases, exact rationals) can be run at the bottom.',
    },
    sections: ['r-3-4'],
    eqs: ['7', '8'],
    keywords: ['Octal', 'eight-phase', 'multiphase', '/4', 'Kuo', 'unit trap', 'L04', '八相', '多相', '单位换算', '混合单位'],
    mount(root, api) {
      if (!document.getElementById('mu-css')) { const s = document.createElement('style'); s.id = 'mu-css'; s.textContent = CSS; document.head.appendChild(s); }
      root.classList.add('mu');
      const S = { tR: 10.62, conv: 'preceding', f0: 8 };
      const T_MAX = 12;
      let raf = 0, runTimer = 0;

      const loop = api.loop((dt) => { S.tR = W.mod(S.tR + dt * 0.55, T_MAX); ctl.tR.value = +S.tR.toFixed(2); draw(); });
      const play = W.playButton(loop, api);
      const ctl = {};
      ctl.tR = W.slider({ label: ['REF 时刻 t_R', 'REF instant t_R'], min: 0, max: T_MAX - 0.01, step: 0.01, value: S.tR, fmt: (v) => W.fmt(v, 2) + ' T₀', onInput: (v) => { S.tR = v; request(); } });
      ctl.conv = W.seg({ label: ['选相约定', 'Phase choice'], value: S.conv, options: [
        { value: 'preceding', label: ['前一相位（ε ≥ 0）', 'Preceding (ε ≥ 0)'] },
        { value: 'nearest', label: ['最近相位（带符号 ε）', 'Nearest (signed ε)'] },
        { value: 'following', label: ['后继相位（ε ≤ 0）', 'Following (ε ≤ 0)'] }], onChange: (v) => { S.conv = v; request(); } });
      ctl.f0 = W.slider({ label: ['示例 f₀', 'Example f₀'], min: 1, max: 12, step: 0.1, value: S.f0, fmt: (v) => W.fmt(v, 1) + ' GHz', onInput: (v) => { S.f0 = v; request(); } });
      const step = (d) => { loop.stop(); play.sync(); S.tR = W.mod(Math.round((S.tR + d) * 2) / 2 + 0.12, T_MAX); ctl.tR.value = S.tR; request(); };
      const PRESETS = [
        { label: ['a = 0：混合公式碰巧正确', 'a = 0: mixed formula happens to agree'], p: { tR: 8.2, conv: 'preceding' } },
        { label: ['a = 5：q 重复计入', 'a = 5: q counted twice'], p: { tR: 6.62, conv: 'preceding' } },
        { label: ['a = 6：最大混合误差 +¾', 'a = 6: worst mixed error +¾'], p: { tR: 7.1, conv: 'preceding' } },
        { label: ['最近相位：±T₀/4（§9.5）', 'Nearest phase: ±T₀/4 (§9.5)'], p: { tR: 5.4, conv: 'nearest' } },
        { label: ['a = 7 → 0 进位到 C_d', 'a = 7 → 0 carries into C_d'], p: { tR: 7.88, conv: 'nearest' } },
      ];
      const applyPreset = (p) => { loop.stop(); play.sync(); Object.assign(S, p); ctl.tR.value = S.tR; ctl.conv.value = S.conv; request(); };
      const presetRow = W.h('div', { class: 'mu-presets' }, W.h('span', { class: 'k' }, W.L('场景：', 'Scenarios:')), PRESETS.map((pr) => W.button(pr.label, () => applyPreset(pr.p))));

      const legend = W.legend([
        { color: 'var(--sig-clk)', label: ['CK₀ 原时钟 / 八相 P₀…P₇', 'CK₀ raw clock / phases P₀…P₇'] },
        { color: 'var(--sig-low)', label: ['原周期 residue q = N mod 4', 'raw residue q = N mod 4'] },
        { color: 'var(--sig-high)', label: ['CK/4 与分频计数 C_d', 'CK/4 and divided count C_d'] },
        { color: 'var(--sig-fine)', label: ['八相区域 a', 'eight-phase region a'] },
        { color: 'var(--sig-ref)', label: ['REF 采样时刻', 'REF sampling instant'] },
      ]);
      const svgHost = W.h('div');
      const read = W.readout([
        { key: 'snap', label: ['八相快照 P₇…P₀', 'Snapshot P₇…P₀'] },
        { key: 'a', label: ['区域 a（选相后）', 'Region a (after choice)'] },
        { key: 'Cd', label: ['分频计数 C_d', 'Divided count C_d'] },
        { key: 'eps', label: ['ε_d（分频周期）/ ε₀ = 4ε_d', 'ε_d (divided) / ε₀ = 4ε_d'] },
        { key: 'eq8', label: ['式 (7)/(8) 的 Φ₀', 'Φ₀ from Eq. (7)/(8)'] },
        { key: 'truth', label: ['真值 Φ₀(t_R)', 'Ground truth Φ₀(t_R)'] },
        { key: 'wrong', label: ['混合公式 4C+q+a/8+ε₀', 'Mixed 4C+q+a/8+ε₀'] },
        { key: 'werr', label: ['混合公式误差（原周期）', 'Mixed-formula error (raw cycles)'] },
      ]);
      const eqBox = W.h('div', { class: 'mu-eqs' });
      const tblHost = W.h('div', { class: 'mu-tblw' });
      const unitHost = W.h('div', { class: 'mu-tblw' });
      // ---------- L04 runner
      const runBtn = W.button(['运行 L04（768 例，精确有理数）', 'Run L04 (768 cases, exact rationals)'], () => runL04(), { primary: false });
      const bar = W.h('i');
      const runOut = W.h('span', { class: 'mu-mono' }, '—');
      const runBox = W.h('div', { class: 'mu-run' }, runBtn, W.h('div', { class: 'mu-bar' }, bar), runOut);

      root.append(
        W.controls(play, W.button(['◀ 半周期', '◀ half cycle'], () => step(-0.5)), W.button(['半周期 ▶', 'half cycle ▶'], () => step(0.5)), ctl.tR),
        presetRow,
        W.controls(ctl.conv),
        legend, svgHost, read.el, eqBox,
        W.h('div', { class: 'mu-grid' },
          W.h('div', null, W.h('div', { class: 'mu-sub' }, W.L('八个区域逐一换算（ε = 0，当前 a 高亮）', 'All eight regions converted (ε = 0, current a highlighted)')), tblHost),
          W.h('div', null, W.h('div', { class: 'mu-sub' }, W.L('单位换算：八相间距 = T_V/8 = T₀/2', 'Unit conversion: phase spacing = T_V/8 = T₀/2')), W.controls(ctl.f0), unitHost)),
        W.h('div', { class: 'mu-sub' }, W.L('L04 时钟单位换算检查（报告第 12.1 节）', 'L04 clock-unit conversion check (report §12.1)')),
        runBox,
        W.note(['要点：区域 a 本身已含有 q 的信息（q = ⌊a/2⌋）。正确做法是先在分频时钟单位写出 Φ_d = C_d + a/8 + ε_d，再整体乘 4 换算到原周期（式 7），或拆成 q + p/2（式 8）；把 q 与 a/8 直接相加既混合了单位又重复计数。八相间距是 T_V/8，在原周期单位中是 T₀/2，不是 T₀/8。',
          'Key point: the region a already contains the information of q (q = ⌊a/2⌋). The correct route writes Φ_d = C_d + a/8 + ε_d in divided-clock units and multiplies the whole by 4 to get raw cycles (Eq. 7), or splits it into q + p/2 (Eq. 8); adding q and a/8 directly mixes units and counts the same information twice. The eight-phase spacing is T_V/8, which is T₀/2 in raw-cycle units, not T₀/8.'], 'good'),
        W.note(['理想化示意模型：理想 /4、八相均匀、相位原点对齐、理想采样与理想 fine 残差；式 (7)–(8) 是量纲推导，不是任何论文 decoder truth table 的逐码复刻。真实电路还需处理相位排列、边沿极性、DCC 与原点偏置。f₀ 仅为示例（第 9.5 节以 8 GHz 为理想算例），不是芯片指标。',
          'Idealized illustration: ideal /4, uniform eight phases, aligned phase origins, ideal sampling and an ideal fine residual. Eqs. (7)–(8) are a dimensional derivation, not a code-by-code replica of any paper\'s decoder truth table; real circuits must also handle phase ordering, edge polarity, DCC and origin offsets. f₀ is only an example (§9.5 uses 8 GHz as an ideal worked example), not a chip specification.'], 'warn'),
      );

      function request() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

      function draw() {
        const R = evaluate(S.tR, S.conv);
        drawWave(R);
        drawRead(R);
        drawTable(R);
        drawUnits(R);
      }

      function drawWave(R) {
        const VW = Math.round(W.clamp(root.clientWidth || 700, 320, 760)), narrow = VW < 540;
        const PADL = narrow ? 50 : 76, PADR = 10;
        let t0, t1;
        if (narrow) { t0 = Math.max(0, 4 * Math.floor(S.tR / 4) - 1); t1 = t0 + 6.5; }
        else { t0 = 0; t1 = 12.3; }
        const x = W.scale([t0, t1], [PADL, VW - PADR]);
        const rows = [];
        let y = 30;
        const add = (key, h, gap, extra) => { rows.push({ key, y, h, ...extra }); y += gap; };
        add('clk', 18, 30); add('q', 18, 34); add('div', 18, 30);
        for (let i = 0; i < 8; i++) add('ph', 13, 19, { i });
        y += 8; add('a', 18, 30); add('Cd', 18, 26);
        const VH = y + 6;
        const svg = W.svg(VW, VH);
        // region grid: every T_V/8 = T0/2
        for (let k = Math.ceil(t0 * 2); k <= t1 * 2; k++) {
          const t = k / 2, isDiv = W.mod(t, 4) === 0, isRaw = Number.isInteger(t);
          svg.appendChild(W.s('line', { x1: x(t), x2: x(t), y1: 16, y2: VH - 4, class: 'grid', style: isDiv ? 'stroke:var(--axis);stroke-width:1.5' : isRaw ? '' : 'stroke-dasharray:2 3' }));
        }
        // highlight current region box (between phase a_s edges) across the phase rows
        const regStart = 4 * Math.floor(S.tR / 4) + R.aS / 2;
        const phRows = rows.filter((r) => r.key === 'ph');
        const yPh0 = phRows[0].y - 10, yPh1 = phRows[7].y + 10;
        svg.appendChild(W.s('rect', { x: x(regStart), y: yPh0, width: x(regStart + 0.5) - x(regStart), height: yPh1 - yPh0, fill: 'var(--sig-fine)', 'fill-opacity': 0.13 }));
        // T_V/8 annotation
        const annT = narrow ? t0 + 1 : 4 * Math.floor(S.tR / 4) + (W.mod(S.tR, 4) < 2 ? 2.5 : 0.5);
        if (annT + 0.5 <= t1) {
          const ya = 10;
          svg.appendChild(W.s('path', { d: `M${x(annT)},${ya}h${x(annT + 0.5) - x(annT)}M${x(annT)},${ya - 4}v8M${x(annT + 0.5)},${ya - 4}v8`, stroke: 'var(--fg-2)', 'stroke-width': 1.2, fill: 'none' }));
          svg.appendChild(W.s('text', { x: x(annT + 0.5) + 5, y: ya + 4, class: 'mu-halo', style: 'font-size:10.5px;fill:var(--fg)' }, 'T_V/8 = T₀/2'));
        }
        const lab = (zh, en, yy, mono) => svg.appendChild(en == null ? W.s('text', { x: 4, y: yy + 4, class: 'lbl' + (mono ? ' mono' : ''), style: 'font-size:10.5px' }, zh) : W.sL(zh, en, { x: 4, y: yy + 4, class: 'lbl', style: 'font-size:10.5px' }));
        for (const r of rows) {
          const top = r.y - r.h / 2, bot = r.y + r.h / 2;
          if (r.key === 'clk') {
            lab('CK₀', null, r.y);
            const e = W.clockEdges(1, 0, t0, t1);
            svg.appendChild(W.s('path', { d: W.digitalPath(e, W.mod(t0, 1) < 0.5 ? 1 : 0, x, top, bot, t0, t1), fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }));
          } else if (r.key === 'q') {
            lab(narrow ? 'q' : 'q = N mod 4', null, r.y);
            const segs = [];
            for (let k = Math.floor(t0); k <= t1; k++) segs.push({ t0: Math.max(t0, k), t1: Math.min(t1, k + 1), label: W.mod(k, 4), fill: 'var(--sig-low)', stroke: 'var(--sig-low)' });
            svg.appendChild(W.busGroup(segs, x, r.y, r.h));
          } else if (r.key === 'div') {
            lab('CK/4', null, r.y);
            const e = W.clockEdges(4, 0, t0, t1);
            svg.appendChild(W.s('path', { d: W.digitalPath(e, W.mod(t0, 4) < 2 ? 1 : 0, x, top, bot, t0, t1), fill: 'none', stroke: 'var(--sig-high)', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
          } else if (r.key === 'ph') {
            const i = r.i;
            lab(`P${'₀₁₂₃₄₅₆₇'[i]}`, null, r.y, true);
            const e = W.clockEdges(4, i / 2, t0, t1);
            const isA = i === R.aS, isB = i === (R.aS + 1) % 8;
            svg.appendChild(W.s('path', { d: W.digitalPath(e, phaseBit(i, t0 - 1e-9), x, top, bot, t0, t1), fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': isA || isB ? 1.9 : 1.2, 'stroke-opacity': isA || isB ? 1 : 0.7, 'stroke-linejoin': 'round' }));
            // sampled bit at REF
            const b = R.bits[i];
            svg.appendChild(W.s('rect', { x: x(S.tR) + 4, y: r.y - 7, width: 13, height: 14, rx: 3, fill: b ? 'var(--sig-ref)' : 'var(--surface)', 'fill-opacity': b ? 0.22 : 1, stroke: 'var(--sig-ref)', 'stroke-width': 1 }));
            svg.appendChild(W.s('text', { x: x(S.tR) + 10.5, y: r.y + 3.5, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10px;fill:var(--fg);font-weight:700' }, String(b)));
            if (isA && !narrow) svg.appendChild(W.sL('← 最近升起的相位 = a_s', '← most recently risen = a_s', { x: x(S.tR) + 22, y: r.y + 3.5, class: 'mu-halo', style: 'font-size:10px;fill:var(--fg)' }));
          } else if (r.key === 'a') {
            lab(narrow ? 'a' : '区域 a', narrow ? 'a' : 'region a', r.y);
            const segs = [];
            for (let k = Math.floor(t0 * 2); k <= t1 * 2; k++) segs.push({ t0: Math.max(t0, k / 2), t1: Math.min(t1, k / 2 + 0.5), label: W.mod(k, 8), fill: 'var(--sig-fine)', stroke: 'var(--sig-fine)' });
            svg.appendChild(W.busGroup(segs, x, r.y, r.h, { minLabelW: 9 }));
          } else if (r.key === 'Cd') {
            lab('C_d', null, r.y);
            const segs = [];
            for (let k = Math.floor(t0 / 4); k * 4 <= t1; k++) segs.push({ t0: Math.max(t0, 4 * k), t1: Math.min(t1, 4 * k + 4), label: k, fill: 'var(--sig-high)', stroke: 'var(--sig-high)' });
            svg.appendChild(W.busGroup(segs, x, r.y, r.h));
          }
        }
        // REF cursor
        const xr = x(S.tR);
        svg.appendChild(W.s('line', { x1: xr, x2: xr, y1: 16, y2: VH - 4, stroke: 'var(--sig-ref)', 'stroke-width': 1.8 }));
        svg.appendChild(W.s('text', { x: xr - 4, y: 26 - 4, 'text-anchor': 'end', class: 'mu-halo', style: 'font-size:10.5px;font-weight:650;fill:var(--fg)' }, 'REF'));
        // chosen phase edge (after convention) marker on the a row
        const aRow = rows.find((r) => r.key === 'a');
        const tChosen = 4 * R.Cd + R.a / 2;
        if (tChosen >= t0 && tChosen <= t1) {
          svg.appendChild(W.s('line', { x1: x(tChosen), x2: x(tChosen), y1: yPh0, y2: aRow.y + 12, stroke: 'var(--sig-sel)', 'stroke-width': 2, 'stroke-dasharray': '4 3' }));
          svg.appendChild(W.s('path', { d: `M${x(tChosen) - 5},${aRow.y + 18}L${x(tChosen)},${aRow.y + 11}L${x(tChosen) + 5},${aRow.y + 18}Z`, fill: 'var(--sig-sel)' }));
        }
        W.clear(svgHost).appendChild(svg);
      }

      function drawRead(R) {
        read.set('snap', R.bits.slice().reverse().join(''));
        read.set('a', R.carry ? `${R.a}  (7→0, C_d+1)` : String(R.a));
        read.set('Cd', String(R.Cd));
        read.set('eps', `${fm(R.epsD, 4)} / ${fm(R.eps0, 4)}`);
        read.set('eq8', fm(R.eq8, 4));
        const okSpan = W.h('span', null, fm(R.truth, 4) + ' ', Math.abs(R.eq8 - R.truth) < 1e-9 ? W.h('span', { style: { color: 'var(--good-ink)' } }, '✓') : W.h('span', { style: { color: 'var(--critical-ink)' } }, '✗'));
        read.set('truth', okSpan);
        read.set('wrong', fm(R.wrong, 4));
        const e = R.wErr;
        read.set('werr', W.h('span', { style: { color: Math.abs(e) < 1e-9 ? 'var(--good-ink)' : 'var(--critical-ink)' } }, Math.abs(e) < 1e-9 ? '0 ✓' : (e > 0 ? '+' : '−') + frac8(Math.abs(e)) + ' ✗'));
        const lines = [
          { tex: `\\Phi_d=C_d+\\frac{a}{8}+\\epsilon_d=${R.Cd}+\\frac{${R.a}}{8}+(${tx(R.epsD, 4)})=${tx(R.phiD, 4)}`, tag: ['分频时钟单位 T_V', 'divided-clock units T_V'] },
          { tex: `\\Phi_0=4\\Phi_d=4\\cdot${R.Cd}+\\frac{${R.a}}{2}+4\\cdot(${tx(R.epsD, 4)})=${tx(R.eq7, 4)}`, tag: ['式 (7)，原周期 T₀', 'Eq. (7), raw cycles T₀'] },
          { tex: `q=\\lfloor ${R.a}/2\\rfloor=${R.q},\\ p=${R.a}\\bmod 2=${R.p}:\\ \\Phi_0=4\\cdot${R.Cd}+${R.q}+\\frac{${R.p}}{2}+(${tx(R.eps0, 4)})=${tx(R.eq8, 4)}`, tag: [`式 (8)；真值 ${fm(R.truth, 4)} ✓`, `Eq. (8); truth ${fm(R.truth, 4)} ✓`] },
          { tex: `4C_d+q+\\frac{a}{8}+\\epsilon_0=${4 * R.Cd}+${R.q}+${texFrac8(R.a / 8)}+(${tx(R.eps0, 4)})=${tx(R.wrong, 4)}`, tag: [`混合单位：误差 ${Math.abs(R.wErr) < 1e-9 ? '0（仅 a = 0 时巧合）' : (R.wErr > 0 ? '+' : '−') + frac8(Math.abs(R.wErr)) + ' T₀'}`, `mixed units: error ${Math.abs(R.wErr) < 1e-9 ? '0 (coincides only for a = 0)' : (R.wErr > 0 ? '+' : '−') + frac8(Math.abs(R.wErr)) + ' T₀'}`], bad: Math.abs(R.wErr) > 1e-9 },
        ];
        W.clear(eqBox);
        for (const l of lines) eqBox.appendChild(W.h('div', { class: 'ln' + (l.bad ? ' bad' : '') }, W.h('span', { class: 'tx' }, W.tex(l.tex)), W.h('span', { class: 'tag' }, W.lbl(l.tag))));
      }

      let lastTblA = -1;
      function drawTable(R) {
        if (lastTblA === R.a && tblHost.firstChild) return;
        lastTblA = R.a;
        const th = (src) => W.h('th', null, W.tex(src));
        const tbl = W.h('table', { class: 'mu-tbl' },
          W.h('thead', null, W.h('tr', null, th('a'), th('q'), th('p'), th('a/2'), th('q+p/2'), th('q+a/8'), W.h('th', null, W.L('混合误差', 'mixed err.')))));
        const tb = W.h('tbody');
        for (let a = 0; a < 8; a++) {
          const q = Math.floor(a / 2), p = a % 2, e = q + a / 8 - a / 2;
          tb.appendChild(W.h('tr', { class: a === R.a ? 'cur' : '' },
            W.h('td', null, String(a)), W.h('td', null, String(q)), W.h('td', null, String(p)),
            W.h('td', null, frac8(a / 2)), W.h('td', { class: 'ok' }, frac8(q + p / 2)), W.h('td', null, frac8(q + a / 8)),
            W.h('td', { class: Math.abs(e) < 1e-9 ? 'ok' : 'bad' }, Math.abs(e) < 1e-9 ? '0' : (e > 0 ? '+' : '−') + frac8(Math.abs(e)))));
        }
        tbl.appendChild(tb);
        W.clear(tblHost).appendChild(tbl);
      }

      function drawUnits(R) {
        const T0 = 1000 / S.f0; // ps
        const ps = (v) => fm(v, 2) + ' ps';
        const rng = S.conv === 'preceding' ? { d: '[0, 1/8)', r: '[0, 1/2)', p: `[0, ${ps(T0 / 2)})` }
          : S.conv === 'nearest' ? { d: '[−1/16, 1/16)', r: '[−1/4, 1/4)', p: `±${ps(T0 / 4)}` }
            : { d: '(−1/8, 0]', r: '(−1/2, 0]', p: `(−${ps(T0 / 2)}, 0]` };
        const rows = [
          [['分频周期', 'divided period'], '1 T_V', '4 T₀', ps(4 * T0), ''],
          [['原周期', 'raw period'], '1/4 T_V', '1 T₀', ps(T0), ''],
          [['八相间距', 'phase spacing'], '1/8 T_V', '1/2 T₀', ps(T0 / 2), 'ok'],
          [['误读 T₀/8 ✗', 'misread T₀/8 ✗'], '1/32 T_V', '1/8 T₀', ps(T0 / 8), 'bad'],
          [['ε 范围*', 'ε range*'], rng.d + ' T_V', rng.r + ' T₀', rng.p, ''],
        ];
        const tbl = W.h('table', { class: 'mu-tbl' },
          W.h('thead', null, W.h('tr', null, W.h('th', null, W.L('量', 'quantity')), W.h('th', null, W.L('分频单位', 'divided')), W.h('th', null, W.L('原周期', 'raw')), W.h('th', null, `@ ${W.fmt(S.f0, 1)} GHz`))),
          W.h('tbody', null, rows.map((r) => W.h('tr', null, W.h('td', null, W.lbl(r[0])), W.h('td', null, r[1]), W.h('td', { class: r[4] }, r[2]), W.h('td', { class: r[4] }, r[3])))));
        const conv = { preceding: ['前一相位', 'preceding phase'], nearest: ['最近相位', 'nearest phase'], following: ['后继相位', 'following phase'] }[S.conv];
        W.clear(unitHost).append(tbl, W.h('div', { style: { fontSize: '.72rem', color: 'var(--muted)', padding: '4px 8px' } },
          W.L(`* 当前选相约定（${conv[0]}）下理想 fine 残差的范围；最近相位为 ±半个相位间距，后继相位最多等待约一个相位间距（第 9.5 节）。`,
            `* Ideal fine-residual range for the current choice (${conv[1]}); nearest phase gives ± half a phase spacing, following phase waits up to about one spacing (§9.5).`)));
      }

      // ---------------------------------------------------------------- L04 (exact rationals, chunked)
      function runL04() {
        clearTimeout(runTimer);
        runBtn.disabled = true;
        let C = 0, pass = 0, fail = 0, mixedSame = 0, total = 0;
        const epsList = [F(0), F(1, 64), F(-1, 64)];
        const chunk = () => {
          for (let a = 0; a < 8; a++) {
            for (const eps of epsList) {
              const phiDiv = F(C).add(F(a, 8)).add(eps);
              const q = Math.floor(a / 2), p = a % 2;
              const phiRaw = F(4 * C + q).add(F(p, 2)).add(eps.mul(4));
              if (phiDiv.mul(4).eq(phiRaw)) pass++; else fail++;
              const mixed = F(4 * C + q).add(F(a, 8)).add(eps.mul(4));
              if (mixed.eq(phiRaw)) mixedSame++;
              total++;
            }
          }
          bar.style.width = ((C + 1) / 32) * 100 + '%';
          W.clear(runOut).append(W.L(`C = ${C}：${total}/768 例`, `C = ${C}: ${total}/768 cases`));
          C++;
          if (C < 32) runTimer = setTimeout(chunk, 18);
          else {
            runBtn.disabled = false;
            bar.style.background = fail ? 'var(--critical)' : 'var(--good)';
            W.clear(runOut).append(
              W.status(fail ? 'bad' : 'good', fail ? [`失败 ${fail}`, `FAIL ${fail}`] : ['PASS', 'PASS']), ' ',
              W.L(`式 (7) = 式 (8)：${pass}/768 通过 · 混合公式仅 ${mixedSame}/768 例巧合（全为 a = 0），${768 - mixedSame} 例出错`,
                `Eq. (7) = Eq. (8): ${pass}/768 pass · mixed formula coincides in only ${mixedSame}/768 cases (all a = 0), wrong in ${768 - mixedSame}`));
          }
        };
        bar.style.background = 'var(--good)';
        chunk();
      }

      let lastW = 0;
      const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { const w = root.clientWidth; if (Math.abs(w - lastW) > 4) { lastW = w; request(); } }) : null;
      if (ro) ro.observe(root);
      draw();
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      return { destroy() { loop.stop(); clearTimeout(runTimer); if (ro) ro.disconnect(); if (raf) cancelAnimationFrame(raf); } };
    },
  });
})();
