/* blind-spot — report §6.3, Eq. (11): a whole-group error is invisible to q and to raw parity.
 *
 * Model: a raw-cycle count N = M·C + q and a captured word N + e (e = capture error in raw cycles). Each detector
 * compares a redundant feature observed independently at the true epoch with the same feature recomputed from the
 * captured word: (a) q = N mod M, (b) raw parity N mod 2 (low-bit XOR style), (c) high LSB C mod 2 observed
 * independently, (d) a 2-bit wrap toggle/sequence C mod 4. The coverage matrix counts, for every e, over how many N
 * (one full period, N = 0…255) the detector fires. The animated sweep replays the report's L03 check
 * (M = 4/8 × 256 N = 512 cases: (N+M) mod M = N mod M and (N+M) mod 2 = N mod 2).
 * This is a coverage argument about redundant codes (§6.3), not a model of any specific patent circuit.
 */
(function () {
  'use strict';
  const CSS = `
.bs-h { margin: 16px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.bs-h .w-ctl { font-weight: 400; }
.bs-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.bs-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; font-variant-numeric: tabular-nums; margin: 0; }
.bs-tbl th, .bs-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
.bs-tbl th { background: var(--surface-2); font-weight: 650; position: static; }
.bs-tbl td.n { font-family: var(--mono); text-align: center; white-space: nowrap; }
.bs-tbl td.dn { min-width: 7em; }
.bs-tbl tr:last-child td { border-bottom: 0; }
.bs-eq { margin-top: 8px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); font-size: .8rem; color: var(--fg-2); }
.bs-eq .tex { overflow-x: auto; overflow-y: hidden; }
.bs-eq .row { display: flex; flex-wrap: wrap; gap: 0 28px; justify-content: center; }
.bs-eq .katex-display { margin: .5em 0; }
.bs-mx { position: relative; }
.bs-mx svg rect.cell { cursor: pointer; }
.bs-l03 { font-size: .8rem; color: var(--fg-2); margin: 4px 0; }
.bs-l03 b { color: var(--fg); font-variant-numeric: tabular-nums; }
.bs-mono { font-family: var(--mono); font-size: .76rem; }
`;
  const DET = [
    { id: 'a', short: ['(a) 低位 q', '(a) low q'], name: ['(a) 比较低位 residue q = N mod M', '(a) compare the low residue q = N mod M'], f: (N, M) => W.mod(N, M) },
    { id: 'b', short: ['(b) raw parity', '(b) raw parity'], name: ['(b) 原周期奇偶 N mod 2（低位 XOR，Havens/Sony 式检查）', '(b) raw parity N mod 2 (low-bit XOR, Havens/Sony-style check)'], f: (N) => W.mod(N, 2) },
    { id: 'c', short: ['(c) 高位 LSB', '(c) high LSB'], name: ['(c) 高位最低位的独立观测 C mod 2', '(c) independent observation of the high LSB, C mod 2'], f: (N, M) => W.mod(Math.floor(N / M), 2) },
    { id: 'd', short: ['(d) wrap 序列', '(d) wrap seq.'], name: ['(d) 2 位 wrap toggle/sequence，C mod 4', '(d) 2-bit wrap toggle/sequence, C mod 4'], f: (N, M) => W.mod(Math.floor(N / M), 4) },
    { id: 'ac', short: ['(a)+(c)', '(a)+(c)'], name: ['(a) 与 (c) 组合', '(a) combined with (c)'], of: ['a', 'c'] },
    { id: 'ad', short: ['(a)+(d)', '(a)+(d)'], name: ['(a) 与 (d) 组合', '(a) combined with (d)'], of: ['a', 'd'] },
  ];
  const byId = Object.fromEntries(DET.map((d) => [d.id, d]));
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const frac = (a, b) => { const g = gcd(a, b) || 1; return `${a / g}/${b / g}`; };
  const PERIOD = 256; // N = 0…255 — a whole number of 4M periods for M = 4, 8
  function detects(det, N, e, M) {
    if (det.of) return det.of.some((id) => detects(byId[id], N, e, M));
    return det.f(N, M) !== det.f(N + e, M);
  }
  const covMemo = new Map();
  function coverage(det, e, M) {
    const key = det.id + '|' + e + '|' + M;
    if (covMemo.has(key)) return covMemo.get(key);
    let n = 0; for (let N = 0; N < PERIOD; N++) if (detects(det, N, e, M)) n++;
    covMemo.set(key, n); return n;
  }
  // L03 exactly as research/verify_invariants.py: M in (4, 8), n in range(256)
  function l03Case(i) {
    const M = i < 256 ? 4 : 8, n = i % 256;
    return { M, n, ok: W.mod(n, M) === W.mod(n + M, M) && W.mod(n, 2) === W.mod(n + M, 2), cM: W.mod(Math.floor(n / M), 2) !== W.mod(Math.floor((n + M) / M), 2), c2M: W.mod(Math.floor(n / M), 2) !== W.mod(Math.floor((n + 2 * M) / M), 2) };
  }

  Book.registerWidget({
    id: 'blind-spot',
    group: 'epoch',
    title: { zh: '低位盲区：整组误差看不见（式 11）', en: 'Low-bit blind spot: a whole-group error is invisible (Eq. 11)' },
    summary: {
      zh: '选一个原周期计数 N 和捕获误差 e，比较 N 与 N+e 的低位 residue、原周期奇偶、高位 LSB 与 2 位 wrap 序列。覆盖矩阵对每个 e 统计各检测器在一个完整周期的 N 上能否发现错误；动画重放报告的 L03 检查（512 例）。',
      en: 'Pick a raw-cycle count N and a capture error e; compare the low residue, raw parity, high LSB and 2-bit wrap sequence of N and N+e. The coverage matrix counts, for each e, whether each detector catches the error over one full period of N; the animation replays the report\'s L03 check (512 cases).',
    },
    sections: ['r-6-3'],
    eqs: ['11'],
    keywords: ['blind spot', 'parity', 'residue', 'wrap toggle', 'coverage', 'L03', '盲区', '奇偶', '高位错组', 'redundant code'],
    _DET: DET, _detects: detects, _coverage: coverage, _l03Case: l03Case, // DOM-free, for independent re-checks
    mount(root, api) {
      if (!document.getElementById('bs-css')) { const s = document.createElement('style'); s.id = 'bs-css'; s.textContent = CSS; document.head.appendChild(s); }
      const S = { M: 8, N: 137, e: 8, range: 2 };
      const L = { i: 0, acc: 0, done: [] }; // L03 sweep state

      // ---------------------------------------------------------------- controls
      const ctlM = W.seg({ label: ['分组倍率 M', 'Group ratio M'], options: [{ value: 4, label: '4' }, { value: 8, label: '8' }], value: S.M, onChange: (v) => { const r = S.e / S.M; S.M = +v; S.e = Math.round(r * S.M); syncE(); schedule(); } });
      const ctlN = W.slider({ label: ['真实计数 N', 'True count N'], min: 32, max: 991, step: 1, value: S.N, onInput: (v) => { S.N = v; schedule(); } });
      const ctlE = W.slider({ label: ['捕获误差 e', 'Capture error e'], min: -32, max: 32, step: 1, value: S.e, fmt: (v) => (v > 0 ? '+' : '') + v, onInput: (v) => { S.e = v; schedule(); } });
      function syncE() { ctlE.input.min = -4 * S.M; ctlE.input.max = 4 * S.M; S.e = W.clamp(S.e, -4 * S.M, 4 * S.M); ctlE.value = S.e; quick(); }
      const quickHost = W.h('div', { class: 'w-controls' });
      function quick() {
        W.clear(quickHost).append(W.h('span', { class: 'w-ctl' }, W.L('快速选择 e：', 'Quick e:')),
          ...[0, 1, -1, S.M, -S.M, 2 * S.M, -2 * S.M, 4 * S.M, -4 * S.M].map((v) => W.button(v === 0 ? '0' : (v > 0 ? '+' : '−') + (Math.abs(v) === 1 ? '1' : Math.abs(v) === S.M ? 'M' : Math.abs(v) === 2 * S.M ? '2M' : '4M'), () => { S.e = v; ctlE.value = v; schedule(); }, { title: `e = ${v}` })));
      }
      const ctlR = W.seg({ label: ['矩阵 e 范围', 'Matrix e range'], options: [{ value: 2, label: '±2M' }, { value: 4, label: '±4M' }], value: S.range, onChange: (v) => { S.range = +v; schedule(); } });

      const bitsHost = W.h('div');
      const legendBits = W.legend([
        { color: 'var(--sig-low)', label: ['低位 q（log₂M 位）', 'low q (log₂M bits)'] },
        { color: 'var(--sig-high)', label: ['高位 C', 'high C'] },
        { color: 'var(--sig-err)', label: ['N 与 N+e 不同的位', 'bits that differ between N and N+e'] },
        { color: 'var(--sig-high)', label: ['标尺：格内数字 = q，竖线 = 组边界', 'ruler: cell digit = q, bar = group boundary'] },
      ]);
      const eqHost = W.h('div', { class: 'bs-eq' });
      const tblHost = W.h('div', { class: 'bs-tblw' });
      const mxSvg = W.h('div');
      const mxHost = W.h('div', { class: 'bs-mx' }, mxSvg);
      const tip = W.tooltip(mxHost);
      const legendMx = W.legend([
        { color: 'var(--good)', label: ['对所有 N 都能检测', 'detected for every N'] },
        { color: 'var(--warning)', label: ['只对部分 N 检测（格内/悬停显示比例）', 'detected for some N only (fraction in cell / on hover)'] },
        { color: 'var(--critical)', label: ['对所有 N 都看不见', 'invisible for every N'] },
        { color: 'var(--surface-3)', label: ['e = 0（无错误）', 'e = 0 (no error)'] },
      ]);

      // L03 sweep
      const loop = api.loop((dt) => {
        L.acc += dt * 128;
        let n = Math.floor(L.acc); L.acc -= n;
        while (n-- > 0 && L.i < 512) L.done.push(l03Case(L.i++));
        if (L.i >= 512) { loop.stop(); play.sync(); }
        drawL03();
      });
      const play = W.playButton(loop, api);
      const runAll = W.button(['立即跑完', 'Run all now'], () => { while (L.i < 512) L.done.push(l03Case(L.i++)); loop.stop(); play.sync(); drawL03(); });
      const resetL = W.button(['重新开始', 'Restart'], () => { L.i = 0; L.acc = 0; L.done = []; drawL03(); if (!api.reducedMotion) { loop.start(); play.sync(); } });
      const l03Host = W.h('div');
      const l03Text = W.h('div', { class: 'bs-l03' });
      const legendL03 = W.legend([
        { color: 'var(--good)', label: ['断言成立：+M 不改变 q 与 raw parity', 'assertion holds: +M changes neither q nor raw parity'] },
        { color: 'var(--critical)', label: ['断言失败', 'assertion fails'] },
        { color: 'var(--sig-sel)', label: ['当前案例', 'current case'] },
      ]);

      root.append(
        W.controls(ctlM, ctlN, ctlE),
        quickHost,
        bitsHost, legendBits, eqHost,
        W.h('div', { class: 'bs-h' }, W.L('检测器：从真实 epoch 独立观测的冗余特征 vs 由捕获字重算的同一特征', 'Detectors: redundant feature observed independently at the true epoch vs the same feature recomputed from the captured word')),
        tblHost,
        W.h('div', { class: 'bs-h' }, W.L('覆盖矩阵（检测器 × e，N 遍历一个完整周期 0…255；点击格子选 e）', 'Coverage matrix (detector × e, N over one full period 0…255; click a cell to pick e)'), ctlR),
        mxHost, legendMx,
        W.h('div', { class: 'bs-h' }, W.L('动画重放 L03 检查（报告 §12.1）', 'Animated replay of the L03 check (report §12.1)')),
        W.controls(play, runAll, resetL),
        l03Host, l03Text, legendL03,
        W.note(['要点：对 M = 4 或 8，(N+M) mod M = N mod M 且 (N+M) mod 2 = N mod 2（式 11）——整组误差既不改变 q，也不改变原周期奇偶，所以把某个 low-bit XOR 直接搬到 /8 模型未必能发现高位错组。要检测 block mismatch 必须保留能跨组翻转的状态（高位 LSB 的独立观测、wrap toggle/sequence，或保证高位取自确定候选 epoch 的捕获协议）；即便用高位 parity，也只有在错误已被限定到相邻组时才有效，相差 2 组（2 位序列则 4 组）会再次别名。这是冗余码的覆盖范围问题，不是对某个专利电路的断言。',
          'Key point: for M = 4 or 8, (N+M) mod M = N mod M and (N+M) mod 2 = N mod 2 (Eq. 11) — a whole-group error changes neither q nor the raw parity, so transplanting a low-bit XOR into the /8 model need not detect a high-bit group error. Detecting a block mismatch needs extra state that toggles across groups (an independent high-LSB observation, a wrap toggle/sequence, or a capture protocol that takes the high bits from a determined candidate epoch); even high-bit parity only works once the error is confined to an adjacent group — two groups apart (four for a 2-bit sequence) it aliases again. This is a coverage question about redundant codes, not a claim about any specific patent circuit.'], 'good'),
      );
      quick();

      // ---------------------------------------------------------------- drawing
      let raf = 0;
      function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
      const vw = () => Math.round(W.clamp(root.clientWidth || 700, 340, 760));

      function draw() { drawBits(); drawEq(); drawTable(); drawMatrix(); drawL03(); }

      function drawBits() {
        const M = S.M, N = S.N, N2 = S.N + S.e, lb = Math.log2(M);
        const VW = vw(), narrow = VW < 520;
        // --- residue ruler
        const lo = M * Math.floor((Math.min(N, N2) - M) / M), hi = M * Math.ceil((Math.max(N, N2) + M + 1) / M);
        const PADL = narrow ? 8 : 14, PADR = 8;
        const cw = (VW - PADL - PADR) / (hi - lo);
        const svg = W.svg(VW, 236);
        const xr = (v) => PADL + (v - lo) * cw;
        const yR = 34, hR = 18;
        for (let v = lo; v < hi; v++) {
          const isN = v === N, isN2 = v === N2;
          svg.appendChild(W.s('rect', { x: xr(v), y: yR, width: cw, height: hR, style: `fill:${isN || isN2 ? 'var(--accent-wash)' : 'var(--surface)'};stroke:var(--grid);stroke-width:.8` }));
          if (cw >= 9) svg.appendChild(W.s('text', { x: xr(v) + cw / 2, y: yR + 13, 'text-anchor': 'middle', class: 'mono', style: `font-size:${cw >= 12 ? 10 : 8}px;fill:var(--sig-low)` }, String(W.mod(v, M))));
        }
        for (let v = lo; v <= hi; v += M) {
          svg.appendChild(W.s('line', { x1: xr(v), x2: xr(v), y1: yR - 14, y2: yR + hR + 2, style: 'stroke:var(--sig-high);stroke-width:1.6' }));
          if (v < hi && M * cw >= 30) svg.appendChild(W.s('text', { x: xr(v) + (M * cw) / 2, y: yR - 4, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--sig-high)' }, `C=${v / M}`));
        }
        const mark = (v, label, up) => {
          const cx = xr(v) + cw / 2;
          svg.appendChild(W.s('path', { d: up ? `M${cx - 5},${yR + hR + 10}L${cx + 5},${yR + hR + 10}L${cx},${yR + hR + 3}Z` : `M${cx - 5},${yR - 22}L${cx + 5},${yR - 22}L${cx},${yR - 15}Z`, style: 'fill:var(--fg)' }));
          svg.appendChild(W.s('text', { x: W.clamp(cx, 30, VW - 30), y: up ? yR + hR + 22 : yR - 25, 'text-anchor': 'middle', style: 'font-size:11px;font-weight:650;fill:var(--fg)' }, label));
        };
        mark(N, `N = ${N}`, true);
        if (S.e !== 0) mark(N2, `N+e = ${N2}`, false);
        // --- bit rows
        const NB = 10, LAB = narrow ? 92 : 128;
        const bw = Math.min(36, (VW - LAB - 10) / NB - 3), gap = 3;
        const bx = (b) => LAB + (NB - 1 - b) * (bw + gap);
        const rows = [{ v: N, y: 120, lab: [`N = ${N}`, `N = ${N}`] }, { v: N2, y: 152, lab: [`N+e = ${N2}`, `N+e = ${N2}`] }];
        for (let b = 0; b < NB; b++) svg.appendChild(W.s('text', { x: bx(b) + bw / 2, y: 100, 'text-anchor': 'middle', class: 'mono', style: 'font-size:9.5px' }, `b${b}`));
        for (const r of rows) {
          svg.appendChild(W.sL(r.lab[0], r.lab[1], { x: 6, y: r.y + 4, class: 'lbl mono' }));
          for (let b = 0; b < NB; b++) {
            const bit = (r.v >> b) & 1, diff = ((N >> b) & 1) !== ((N2 >> b) & 1);
            const col = b < lb ? 'var(--sig-low)' : 'var(--sig-high)';
            svg.appendChild(W.s('rect', { x: bx(b), y: r.y - 11, width: bw, height: 22, rx: 4, style: `fill:${diff ? 'color-mix(in srgb, var(--sig-err) 18%, var(--surface))' : 'var(--surface-2)'};stroke:${diff ? 'var(--sig-err)' : col};stroke-width:${diff ? 2 : 1.2}` }));
            svg.appendChild(W.s('text', { x: bx(b) + bw / 2, y: r.y + 4.5, 'text-anchor': 'middle', class: 'mono', style: `font-size:12px;font-weight:650;fill:${col}` }, String(bit)));
          }
        }
        // braces: q / C, and the observed features
        const brace = (b0, b1, y, label, color) => {
          const xa = bx(b1), xb = bx(b0) + bw;
          svg.appendChild(W.s('path', { d: `M${xa},${y - 5}L${xa},${y}L${xb},${y}L${xb},${y - 5}`, style: `fill:none;stroke:${color};stroke-width:1.4` }));
          svg.appendChild(W.s('text', { x: (xa + xb) / 2, y: y + 12, 'text-anchor': 'middle', style: `font-size:10px;fill:${color}` }, label));
        };
        brace(0, lb - 1, 176, 'q', 'var(--sig-low)');
        brace(lb, NB - 1, 176, narrow ? 'C' : 'C = ⌊N/M⌋', 'var(--sig-high)');
        const tick = (b, zh, en, anchor) => {
          const cx = bx(b) + bw / 2;
          svg.appendChild(W.s('line', { x1: cx, x2: cx, y1: 192, y2: 196, style: 'stroke:var(--axis);stroke-width:1.2' }));
          svg.appendChild(W.sL(zh, en, { x: anchor === 'end' ? bx(b) + bw : cx, y: 206, 'text-anchor': anchor || 'middle', style: 'font-size:10px' }));
        };
        tick(0, '(b) 奇偶', '(b) parity', 'end');
        tick(lb, '(c) C LSB', '(c) C LSB');
        const xa = bx(lb + 1), xb = bx(lb) + bw;
        svg.appendChild(W.s('path', { d: `M${xa},${209}L${xa},${214}L${xb},${214}L${xb},${209}`, style: 'fill:none;stroke:var(--axis);stroke-width:1.2' }));
        svg.appendChild(W.sL('(d) C mod 4（两位）', '(d) C mod 4 (two bits)', { x: (xa + xb) / 2, y: 228, 'text-anchor': 'middle', style: 'font-size:10px' }));
        W.clear(bitsHost).appendChild(svg);
      }

      function drawEq() {
        const M = S.M, N = S.N, e = S.e, N2 = N + e;
        const q1 = W.mod(N, M), q2 = W.mod(N2, M), p1 = W.mod(N, 2), p2 = W.mod(N2, 2);
        W.clear(eqHost).append(
          W.h('div', null, W.L('式 (11) 代入当前数值：', 'Eq. (11) with the current numbers:')),
          W.h('div', { class: 'row' },
            W.h('div', { class: 'tex' }, W.tex(`\\begin{aligned}N\\bmod M&=${N}\\bmod ${M}=${q1}\\\\(N+e)\\bmod M&=${N2}\\bmod ${M}=${q2}\\end{aligned}`, true)),
            W.h('div', { class: 'tex' }, W.tex(`\\begin{aligned}N\\bmod 2&=${p1}\\\\(N+e)\\bmod 2&=${p2}\\end{aligned}`, true))),
          W.h('div', null, W.status(q1 === q2 ? 'bad' : 'good', [q1 === q2 ? `q 不变（${q1} = ${q2}）` : `q 改变（${q1} ≠ ${q2}）`, q1 === q2 ? `q unchanged (${q1} = ${q2})` : `q changes (${q1} ≠ ${q2})`]), ' ',
            W.status(p1 === p2 ? 'bad' : 'good', [p1 === p2 ? `奇偶不变（${p1} = ${p2}）` : `奇偶改变（${p1} ≠ ${p2}）`, p1 === p2 ? `parity unchanged (${p1} = ${p2})` : `parity changes (${p1} ≠ ${p2})`])),
          W.h('div', { style: { marginTop: '4px' } }, e !== 0 && W.mod(e, M) === 0
            ? W.status('bad', [`e = ${e} 是 M 的整数倍：q 与 raw parity 都不变`, `e = ${e} is a multiple of M: q and raw parity are both unchanged`])
            : e === 0 ? W.status('good', ['e = 0：没有错误', 'e = 0: no error'])
              : W.status('good', ['e 不是 M 的整数倍：q 会改变', 'e is not a multiple of M: q changes'])));
      }

      function drawTable() {
        const M = S.M, N = S.N, e = S.e;
        const fmtF = (det, v) => (det.of ? '' : String(det.f(v, M)));
        const tb = W.h('tbody');
        for (const det of DET) {
          const hitNow = e !== 0 && detects(det, N, e, M);
          const cov = coverage(det, e, M);
          const covEl = e === 0 ? W.L('—', '—') : cov === PERIOD ? W.status('good', [`全部 ${PERIOD}/${PERIOD}`, `all ${PERIOD}/${PERIOD}`]) : cov === 0 ? W.status('bad', [`0/${PERIOD}（盲区）`, `0/${PERIOD} (blind)`]) : W.status('warn', [`${cov}/${PERIOD}`, `${cov}/${PERIOD}`]);
          tb.appendChild(W.h('tr', null,
            W.h('td', { class: 'dn' }, W.lbl(vw() < 520 ? det.short : det.name)),
            W.h('td', { class: 'n' }, det.of ? '·' : `${fmtF(det, N)} → ${fmtF(det, N + e)}`),
            W.h('td', { class: 'n' }, e === 0 ? '—' : hitNow ? W.status('good', ['检出', 'caught']) : W.status('bad', ['漏检', 'missed'])),
            W.h('td', { class: 'n' }, covEl)));
        }
        W.clear(tblHost).appendChild(W.h('table', { class: 'bs-tbl' },
          W.h('thead', null, W.h('tr', null, W.h('th', null, W.L('检测器', 'Detector')), W.h('th', null, W.L('观测(N) → 重算(N+e)', 'observed(N) → recomputed(N+e)')), W.h('th', null, W.L('本例', 'This N')), W.h('th', null, W.L(`该 e 在全部 N 上的覆盖`, 'Coverage of this e over all N')))),
          tb));
      }

      function drawMatrix() {
        const M = S.M, R = S.range * M;
        const VW = vw(), narrow = VW < 520;
        const LAB = narrow ? 84 : 120, PADR = 6;
        const ncol = 2 * R + 1, cw = (VW - LAB - PADR) / ncol, ch = 22;
        const top = 8, VH = top + DET.length * (ch + 3) + 34;
        const svg = W.svg(VW, VH);
        const xc = (e) => LAB + (e + R) * cw;
        DET.forEach((det, i) => {
          const y = top + i * (ch + 3);
          svg.appendChild(W.sL(det.short[0], det.short[1], { x: 4, y: y + ch / 2 + 4, class: 'lbl', style: 'font-size:10.5px' }));
          for (let e = -R; e <= R; e++) {
            const cov = coverage(det, e, M), f = cov / PERIOD;
            const color = e === 0 ? 'var(--surface-3)' : f === 1 ? 'var(--good)' : f === 0 ? 'var(--critical)' : 'var(--warning)';
            const r = W.s('rect', { class: 'cell', x: xc(e) + 0.5, y, width: Math.max(1, cw - 1), height: ch, rx: 2, style: `fill:${color};fill-opacity:${e === 0 ? 1 : 0.75}` });
            r.addEventListener('click', () => { S.e = e; ctlE.value = e; schedule(); });
            r.addEventListener('mousemove', (ev) => {
              const rect = mxHost.getBoundingClientRect();
              tip.show(ev.clientX - rect.left, ev.clientY - rect.top, `<b>${Book.esc(W.txt(det.short))}</b>, e = ${e > 0 ? '+' : ''}${e}<br>${Book.esc(api.t('检出', 'caught'))}: ${cov}/${PERIOD} N`);
            });
            r.addEventListener('mouseleave', () => tip.hide());
            svg.appendChild(r);
            if (e !== 0 && f > 0 && f < 1 && cw >= 16) svg.appendChild(W.s('text', { x: xc(e) + cw / 2, y: y + ch / 2 + 3, 'text-anchor': 'middle', style: 'font-size:8px;fill:var(--fg);pointer-events:none' }, frac(cov, PERIOD)));
          }
        });
        // selected e column
        if (Math.abs(S.e) <= R) svg.appendChild(W.s('rect', { x: xc(S.e), y: top - 3, width: cw, height: DET.length * (ch + 3) + 3, rx: 3, style: 'fill:none;stroke:var(--fg);stroke-width:1.8;pointer-events:none' }));
        // axis ticks at 0, ±1, ±M, ±2M, (±4M)
        const yA = top + DET.length * (ch + 3) + 4;
        const marks = [0, 1, -1, M, -M, 2 * M, -2 * M, 3 * M, -3 * M, 4 * M, -4 * M].filter((e) => Math.abs(e) <= R);
        const nm = (e) => (e === 0 ? '0' : (e > 0 ? '+' : '−') + (Math.abs(e) === 1 ? '1' : Math.abs(e) === M ? 'M' : (Math.abs(e) / M) + 'M'));
        for (const e of marks) {
          if (Math.abs(e) === 1 && cw < 16) continue;
          svg.appendChild(W.s('line', { x1: xc(e) + cw / 2, x2: xc(e) + cw / 2, y1: yA, y2: yA + 4, class: 'axis' }));
          svg.appendChild(W.s('text', { x: xc(e) + cw / 2, y: yA + 15, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--fg-2)' }, nm(e)));
        }
        svg.appendChild(W.s('text', { x: 4, y: yA + 15, style: 'font-size:10px' }, 'e →'));
        tip.hide();
        W.clear(mxSvg).appendChild(svg);
      }

      function drawL03() {
        const VW = vw();
        const cell = Math.max(6, Math.min(14, Math.floor((VW - 40) / 34)));
        const gw = cell * 16, gapX = Math.max(14, (VW - 2 * gw) / 3);
        const VH = 22 + gw + 8;
        const svg = W.svg(VW, VH);
        [4, 8].forEach((M, gi) => {
          const x0 = gapX + gi * (gw + gapX), y0 = 20;
          svg.appendChild(W.s('text', { x: x0, y: 13, style: 'font-size:11px;font-weight:650;fill:var(--fg)' }, `M = ${M} · N = 0…255`));
          for (let n = 0; n < 256; n++) {
            const i = gi * 256 + n, c = i < L.done.length ? L.done[i] : null;
            const cx = x0 + (n % 16) * cell, cy = y0 + Math.floor(n / 16) * cell;
            svg.appendChild(W.s('rect', { x: cx + 0.5, y: cy + 0.5, width: cell - 1, height: cell - 1, rx: 1.5, style: c ? `fill:var(--${c.ok ? 'good' : 'critical'});fill-opacity:.7` : 'fill:var(--surface-3)' }));
          }
          if (L.i > 0 && L.i <= 512 && Math.floor((L.i - 1) / 256) === gi) {
            const n = (L.i - 1) % 256;
            svg.appendChild(W.s('rect', { x: x0 + (n % 16) * cell - 1, y: y0 + Math.floor(n / 16) * cell - 1, width: cell + 2, height: cell + 2, style: 'fill:none;stroke:var(--sig-sel);stroke-width:2' }));
          }
        });
        W.clear(l03Host).appendChild(svg);
        const ok = L.done.filter((c) => c.ok).length, cM = L.done.filter((c) => c.cM).length, c2M = L.done.filter((c) => c.c2M).length;
        const cur = L.done[L.done.length - 1];
        W.clear(l03Text).append(
          W.h('div', null, W.L('案例 ', 'Cases '), W.h('b', null, `${L.done.length}/512`), W.L('，断言 (N+M) mod M = N mod M 且 (N+M) mod 2 = N mod 2 成立：', '; assertion (N+M) mod M = N mod M and (N+M) mod 2 = N mod 2 holds in '), W.h('b', null, `${ok}/${L.done.length}`), L.done.length === 512 ? ' ' : null, L.done.length === 512 ? (ok === 512 ? W.status('good', ['与报告 L03 一致：512 例通过', 'matches report L03: 512 cases PASS']) : W.status('bad', ['与报告不一致', 'does not match the report'])) : null),
          W.h('div', null, W.L('对照（同一批 N）：高位 LSB 对 +M 翻转 ', 'Contrast (same N): the high LSB flips for +M in '), W.h('b', null, `${cM}/${L.done.length}`), W.L('，对 +2M 翻转 ', ', and for +2M in '), W.h('b', null, `${c2M}/${L.done.length}`), W.L('（别名）。', ' (aliasing).')),
          cur ? W.h('div', { class: 'bs-mono' }, W.L(`当前：M=${cur.M}, N=${cur.n}：q ${W.mod(cur.n, cur.M)}→${W.mod(cur.n + cur.M, cur.M)}，parity ${cur.n % 2}→${(cur.n + cur.M) % 2}，C ${Math.floor(cur.n / cur.M)}→${Math.floor((cur.n + cur.M) / cur.M)}`, `current: M=${cur.M}, N=${cur.n}: q ${W.mod(cur.n, cur.M)}→${W.mod(cur.n + cur.M, cur.M)}, parity ${cur.n % 2}→${(cur.n + cur.M) % 2}, C ${Math.floor(cur.n / cur.M)}→${Math.floor((cur.n + cur.M) / cur.M)}`)) : null);
      }

      draw();
      const ro = 'ResizeObserver' in window ? new ResizeObserver(() => schedule()) : null;
      if (ro) ro.observe(root);
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      return { destroy() { loop.stop(); if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); tip.hide(); } };
    },
  });
})();
