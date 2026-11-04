/* verify-runner — browser re-run of research/verify_invariants.py (checks L01–L06, 9860 cases), report §12.1.
 * Exact arithmetic: integers as BigInt, rationals as W.Frac (BigInt numerator/denominator), like Python's
 * int / fractions.Fraction. Chunked execution (time-budgeted per animation frame) with per-check progress strips,
 * comparison against the embedded original JSON results, an "extended" range mode (reported separately, beyond the
 * 9860 baseline) and fault injection that deliberately breaks one identity to show the checks are live.
 */
(function () {
  'use strict';
  const F = (n, d) => W.F(n, d);
  const B = (x) => BigInt(x);

  // ---------------------------------------------------------------- TeX helpers for exact values
  function fx(fr) { // Frac -> TeX
    if (fr.d === 1n) return String(fr.n);
    const neg = fr.n < 0n, n = neg ? -fr.n : fr.n;
    return (neg ? '-' : '') + `\\tfrac{${n}}{${fr.d}}`;
  }
  const sat = (x, lim) => (x.cmp(lim) > 0 ? lim : x.cmp(lim.neg()) < 0 ? lim.neg() : x);

  // ---------------------------------------------------------------- parameter sets
  const BASE = { Ms: [4, 8], N1: 4096, C2: 64, N3: 256, C4: 32, eps4: [F(0), F(1, 64), F(-1, 64)], J5: 64,
    mu5: [F(-1, 4), F(0), F(1, 4), F(3, 4)], pairs6: null };
  const L06_PAIRS = [[F(1, 3), F(3, 4)], [F(1, 2), F(2)], [F(-1, 3), F(-3, 4)], [F(-1, 2), F(-2)]];
  function extPairs() { // all distinct same-side pairs from {±k/12 : k = 4..24}, |x| > 1/4
    const out = [];
    for (const s of [1, -1]) for (let i = 4; i <= 24; i++) for (let j = i + 1; j <= 24; j++) out.push([F(s * i, 12), F(s * j, 12)]);
    return out;
  }
  function extParams(ui) {
    const mu = []; for (let k = -16; k < 32; k++) mu.push(F(k, 16));
    const eps = [0, 1, -1, 2, -2, 3, -3].map((k) => F(k, 64));
    return { Ms: ui.Ms.slice(), N1: ui.N + 1, C2: ui.C2, N3: ui.N + 1, C4: ui.C4, eps4: eps, J5: ui.J5, mu5: mu, pairs6: extPairs() };
  }

  // ---------------------------------------------------------------- the six checks (index -> case -> verdict)
  const CHECKS = [
    {
      id: 'L01', test: 'L01_split_count', eq: '1',
      name: { zh: 'L01 计数分解', en: 'L01 Split count' },
      scopeZh: '仅算术；假设 C 与 q 相干',
      js: { zh: 'BigInt：C = N / M（整除），q = N % M，断言 M·C + q = N。', en: 'BigInt: C = N / M (floor), q = N % M; assert M·C + q = N.' },
      fault: { zh: '高位提前一个原周期更新：C = ⌊(N+1)/M⌋（只在 q = M−1 时出错）', en: 'High count updated one raw cycle early: C = ⌊(N+1)/M⌋ (fails only when q = M−1)' },
      rangeZh: (p) => `M∈{${p.Ms.join(',')}}；N=0…${p.N1 - 1}`, rangeEn: (p) => `M∈{${p.Ms.join(',')}}; N=0…${p.N1 - 1}`,
      count: (p) => p.Ms.length * p.N1,
      run(i, p, fault) {
        const M = B(p.Ms[Math.floor(i / p.N1)]), N = B(i % p.N1);
        const C = fault ? (N + 1n) / M : N / M, q = N % M;
        const ok = M * C + q === N;
        return { ok, tex: () => `M=${M},\\;N=${N}:\\;C=${C},\\;q=${q},\\;MC+q=${M * C + q}${ok ? '=N' : '\\neq N'}` };
      },
    },
    {
      id: 'L02', test: 'L02_torn_wrap', eq: '10',
      name: { zh: 'L02 跨组撕裂', en: 'L02 Torn wrap' },
      scopeZh: '两种理想的撕裂字故障模式；无位级模拟模型',
      js: { zh: '合法前后态 MC+M−1 → M(C+1)；撕裂值 MC（旧高+新低）与 M(C+1)+M−1（新高+旧低），断言相对对应合法锚点为 −M 与 +M。', en: 'Legal before/after MC+M−1 → M(C+1); torn values MC (old high + new low) and M(C+1)+M−1 (new high + old low); assert −M and +M versus the matching legal anchor.' },
      fault: { zh: '误用 ±1 原周期修正器：断言 ∃κ_N∈{−1,0,+1} 使撕裂值恢复为合法锚点', en: 'Misuse a ±1-raw-cycle corrector: assert ∃κ_N∈{−1,0,+1} restoring the legal anchor' },
      rangeZh: (p) => `M∈{${p.Ms.join(',')}}；C=0…${p.C2 - 1}；两种撕裂`, rangeEn: (p) => `M∈{${p.Ms.join(',')}}; C=0…${p.C2 - 1}; two tear patterns`,
      count: (p) => p.Ms.length * p.C2,
      run(i, p, fault) {
        const M = B(p.Ms[Math.floor(i / p.C2)]), C = B(i % p.C2);
        const before = M * C + M - 1n, after = M * (C + 1n);
        const ohnl = M * C, nhol = M * (C + 1n) + M - 1n;
        let ok;
        if (!fault) ok = ohnl - after === -M && nhol - before === M;
        else {
          const fix = (v, legal) => [-1n, 0n, 1n].some((k) => v + k === legal);
          ok = fix(ohnl, after) && fix(nhol, before);
        }
        return { ok, tex: () => fault
          ? `M=${M}:\\;${ohnl}+\\kappa_N\\overset{?}{=}${after},\\;${nhol}+\\kappa_N\\overset{?}{=}${before},\\;\\kappa_N\\in\\{-1,0,1\\}`
          : `M=${M},\\;C=${C}:\\;(${C},0)\\!\\to\\!${ohnl},\\;${ohnl}-${after}=${ohnl - after};\\;(${C + 1n},${M - 1n})\\!\\to\\!${nhol},\\;${nhol}-${before}=+${nhol - before}` };
      },
    },
    {
      id: 'L03', test: 'L03_low_state_blind_spot', eq: '11',
      name: { zh: 'L03 低位盲区', en: 'L03 Low-state blind spot' },
      scopeZh: '仅凭低位 residue/奇偶性看不出整组误差',
      js: { zh: 'BigInt：断言 N mod M = (N+M) mod M 且 N mod 2 = (N+M) mod 2。', en: 'BigInt: assert N mod M = (N+M) mod M and N mod 2 = (N+M) mod 2.' },
      fault: { zh: '把整组误差 +M 换成原周期误差 +1（盲区只对整组误差成立）', en: 'Replace the whole-block error +M by a raw-cycle error +1 (the blind spot only holds for block errors)' },
      rangeZh: (p) => `M∈{${p.Ms.join(',')}}；N=0…${p.N3 - 1}`, rangeEn: (p) => `M∈{${p.Ms.join(',')}}; N=0…${p.N3 - 1}`,
      count: (p) => p.Ms.length * p.N3,
      run(i, p, fault) {
        const M = B(p.Ms[Math.floor(i / p.N3)]), n = B(i % p.N3);
        const e = fault ? 1n : M;
        const ok = n % M === (n + e) % M && n % 2n === (n + e) % 2n;
        return { ok, tex: () => `M=${M},\\;N=${n},\\;e=${e}:\\;N\\bmod M=${n % M}${n % M === (n + e) % M ? '=' : '\\neq'}(N+e)\\bmod M;\\;N\\bmod 2=${n % 2n}${n % 2n === (n + e) % 2n ? '=' : '\\neq'}(N+e)\\bmod 2` };
      },
    },
    {
      id: 'L04', test: 'L04_clock_unit_conversion', eq: '8',
      name: { zh: 'L04 时钟单位换算', en: 'L04 Clock-unit conversion' },
      scopeZh: '理想 /4、均匀八相网格、相位原点对齐',
      js: { zh: 'W.Frac：Φ_d = C + a/8 + ε；q,p = divmod(a,2)；断言 4Φ_d = 4C + q + p/2 + 4ε（式 7–8）。', en: 'W.Frac: Φ_d = C + a/8 + ε; q,p = divmod(a,2); assert 4Φ_d = 4C + q + p/2 + 4ε (Eqs. 7–8).' },
      fault: { zh: '混合单位：Φ₀ = 4C + q + a/8 + 4ε（第 3.4 节指出的错误叠加）', en: 'Mixed units: Φ₀ = 4C + q + a/8 + 4ε (the stacking error of §3.4)' },
      rangeZh: (p) => `C=0…${p.C4 - 1}；a=0…7；ε∈{${p.eps4.map(String).join(', ')}}`, rangeEn: (p) => `C=0…${p.C4 - 1}; a=0…7; ε∈{${p.eps4.map(String).join(', ')}}`,
      count: (p) => p.C4 * 8 * p.eps4.length,
      run(i, p, fault) {
        const ne = p.eps4.length;
        const C = Math.floor(i / (8 * ne)), a = Math.floor(i / ne) % 8, eps = p.eps4[i % ne];
        const phiDiv = F(C).add(F(a, 8)).add(eps);
        const q = Math.floor(a / 2), pp = a % 2;
        const phiRaw = fault ? F(4 * C + q).add(F(a, 8)).add(eps.mul(4)) : F(4 * C + q).add(F(pp, 2)).add(eps.mul(4));
        const lhs = phiDiv.mul(4);
        const ok = lhs.eq(phiRaw);
        return { ok, tex: () => `C=${C},\\;a=${a},\\;\\epsilon=${fx(eps)}:\\;4\\Phi_d=${fx(lhs)}${ok ? '=' : '\\neq'}${fx(phiRaw)}=\\Phi_0` };
      },
    },
    {
      id: 'L05', test: 'L05_anchor_equivalence', eq: '12',
      name: { zh: 'L05 锚点等价', en: 'L05 Anchor equivalence' },
      scopeZh: '精确相位域等式；时间归一化必须一致',
      js: { zh: 'W.Frac：断言 J − μ = (J+1) − (μ+1)（式 12）。', en: 'W.Frac: assert J − μ = (J+1) − (μ+1) (Eq. 12).' },
      fault: { zh: '去掉 μ 上的 +1：整数锚点换成 J+1 而 fine 仍相对 J', en: 'Drop the +1 on μ: integer anchor moves to J+1 while fine stays relative to J' },
      rangeZh: (p) => `J=0…${p.J5 - 1}；μ∈{${p.mu5.length <= 4 ? p.mu5.map(String).join(', ') : p.mu5.length + ' 个值 k/16'}}`, rangeEn: (p) => `J=0…${p.J5 - 1}; μ∈{${p.mu5.length <= 4 ? p.mu5.map(String).join(', ') : p.mu5.length + ' values k/16'}}`,
      count: (p) => p.J5 * p.mu5.length,
      run(i, p, fault) {
        const nm = p.mu5.length;
        const J = Math.floor(i / nm), mu = p.mu5[i % nm];
        const lhs = F(J).sub(mu), rhs = F(J + 1).sub(fault ? mu : mu.add(1));
        const ok = lhs.eq(rhs);
        return { ok, tex: () => `J=${J},\\;\\mu=${fx(mu)}:\\;J-\\mu=${fx(lhs)}${ok ? '=' : '\\neq'}${fx(rhs)}=(J+1)-(\\mu${fault ? '' : '+1'})` };
      },
    },
    {
      id: 'L06', test: 'L06_saturation_noninvertibility', eq: null,
      name: { zh: 'L06 饱和不可逆', en: 'L06 Saturation non-invertibility' },
      scopeZh: '饱和是非单射的；不是 TDC 的实现',
      js: { zh: 'W.Frac：sat(x) = max(−¼, min(¼, x))；断言 x ≠ y 且 sat(x) = sat(y)。', en: 'W.Frac: sat(x) = max(−¼, min(¼, x)); assert x ≠ y and sat(x) = sat(y).' },
      fault: { zh: '把饱和换成不饱和的线性传递：sat(x) = x', en: 'Replace saturation by an unsaturated linear transfer: sat(x) = x' },
      rangeZh: (p) => (p.pairs6 ? `${p.pairs6.length} 对同侧输入 ±k/12（k=4…24）` : '四对不同输入'), rangeEn: (p) => (p.pairs6 ? `${p.pairs6.length} same-side pairs ±k/12 (k=4…24)` : 'four pairs of distinct inputs'),
      count: (p) => (p.pairs6 || L06_PAIRS).length,
      run(i, p, fault) {
        const [x, y] = (p.pairs6 || L06_PAIRS)[i];
        const lim = F(1, 4);
        const s = (v) => (fault ? v : sat(v, lim));
        const sx = s(x), sy = s(y);
        const ok = !x.eq(y) && sx.eq(sy);
        return { ok, tex: () => `x=${fx(x)},\\;y=${fx(y)}:\\;\\mathrm{sat}(x)=${fx(sx)}${sx.eq(sy) ? '=' : '\\neq'}${fx(sy)}=\\mathrm{sat}(y),\\;x\\neq y` };
      },
    },
  ];
  const EQ_TEX = {
    L01: 'N=MC+q,\\;C=\\lfloor N/M\\rfloor,\\;q=N\\bmod M',
    L02: '(C,0)\\to MC=(MC{+}M)-M,\\quad (C{+}1,M{-}1)\\to (MC{+}M{-}1)+M',
    L03: '(N+M)\\bmod M=N\\bmod M,\\;(N+M)\\bmod 2=N\\bmod 2',
    L04: '4\\Phi_d=4C_d+q+\\tfrac{p}{2}+4\\epsilon_d=\\Phi_0',
    L05: 'J-\\mu=(J+1)-(\\mu+1)',
    L06: 'x\\neq y,\\;\\mathrm{sat}(x)=\\mathrm{sat}(y)',
  };
  const NBINS = 64;
  const PASS_C = 'var(--good)', FAIL_C = 'var(--sig-err)', PEND_C = 'var(--surface-3)';

  Book.registerWidget({
    id: 'verify-runner',
    group: 'verify',
    _checks: CHECKS, _base: BASE, _extParams: extParams, // exposed for book-independent cross-checks
    title: { zh: '六组逻辑检查 L01–L06：在浏览器中精确复跑', en: 'Six logical checks L01–L06, re-run exactly in your browser' },
    summary: {
      zh: '把 research/verify_invariants.py 移植为 JavaScript（BigInt 整数与 BigInt 有理数），逐项复跑 9860 个案例并与随报告附带的 JSON 结果比对；可扩大范围（单独计数），也可故意破坏某个等式，看检查立即变成 FAIL。',
      en: 'research/verify_invariants.py ported to JavaScript (BigInt integers and BigInt rationals): re-run all 9860 cases, compare with the JSON results shipped with the report, enlarge the ranges (counted separately), or deliberately break one identity and watch the check turn FAIL.',
    },
    sections: ['r-12-1'],
    eqs: ['1', '11', '12'],
    keywords: ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', '9860', 'verify_invariants.py', 'Fraction', 'logical check', '逻辑检查', '精确有理数', 'fault injection', '故障注入'],
    mount(root, api) {
      const orig = (Book.data.checks && Book.data.checks.checks) || [];
      const origTotal = (Book.data.checks && Book.data.checks.total_cases) || null;
      const ui = { speed: 'anim', ext: false, fault: 'none', Ms: [2, 4, 8, 16], N: 16383, C2: 1024, C4: 256, J5: 1024 };
      // run state
      let run = null; // {phase:'base'|'ext', ci, i, params, started}
      const res = { base: CHECKS.map(() => null), ext: CHECKS.map(() => null) };
      let lastCase = null, dirty = true, elapsed = { base: 0, ext: 0 };

      // ---------------------------------------------------------------- controls
      const loop = api.loop(() => tick());
      const runBtn = W.button(['▶ 运行检查', '▶ Run checks'], () => start(), { primary: true });
      const stopBtn = W.button(['❚❚ 停止', '❚❚ Stop'], () => { run = null; loop.stop(); dirty = true; render(); });
      const speedSeg = W.seg({ label: ['速度', 'Speed'], options: [{ value: 'anim', label: ['动画', 'Animated'] }, { value: 'fast', label: ['全速', 'Full speed'] }], value: ui.speed, onChange: (v) => { ui.speed = v; } });
      const faultSel = W.select({
        label: ['故障注入', 'Fault injection'], value: 'none',
        options: [{ value: 'none', label: ['无（原始检查）', 'none (original checks)'] }].concat(CHECKS.map((c) => ({ value: c.id, label: [c.id + '：' + c.fault.zh.split('：')[0].split('（')[0], c.id + ': ' + c.fault.en.split(':')[0].split(' (')[0]] }))),
        onChange: (v) => { ui.fault = v; resetResults(); start(); },
      });
      const extTog = W.toggle({ label: ['扩展模式（超出 9860 基线，单独计数）', 'Extended mode (beyond the 9860 baseline, counted separately)'], value: ui.ext, onChange: (v) => { ui.ext = v; extBox.hidden = !v; res.ext = CHECKS.map(() => null); dirty = true; render(); } });

      const mToggles = [2, 4, 8, 16].map((m) => W.toggle({ label: 'M=' + m, value: ui.Ms.includes(m), onChange: (v) => { ui.Ms = [2, 4, 8, 16].filter((k) => (k === m ? v : ui.Ms.includes(k))); if (!ui.Ms.length) { ui.Ms = [m]; mToggles.forEach((t, j) => { t.value = [2, 4, 8, 16][j] === m; }); } extChanged(); } }));
      const nSl = W.slider({ label: ['L01/L03：N 上限', 'L01/L03: N max'], min: 4095, max: 65535, step: 4096, value: ui.N, fmt: (v) => String(v), onInput: (v) => { ui.N = v; extChanged(); } });
      const c2Sl = W.slider({ label: ['L02：组数', 'L02: groups'], min: 64, max: 4096, step: 64, value: ui.C2, fmt: (v) => String(v), onInput: (v) => { ui.C2 = v; extChanged(); } });
      const c4Sl = W.slider({ label: ['L04：C 个数', 'L04: C count'], min: 32, max: 1024, step: 32, value: ui.C4, fmt: (v) => String(v), onInput: (v) => { ui.C4 = v; extChanged(); } });
      const j5Sl = W.slider({ label: ['L05：J 个数', 'L05: J count'], min: 64, max: 4096, step: 64, value: ui.J5, fmt: (v) => String(v), onInput: (v) => { ui.J5 = v; extChanged(); } });
      const extTotal = W.h('span', { class: 'mono', style: { fontWeight: 650, color: 'var(--fg)' } });
      const extBox = W.h('div', { style: { border: '1px dashed var(--border-strong)', borderRadius: '8px', padding: '8px 10px', margin: '0 0 10px' } },
        W.h('div', { style: { fontSize: '.78rem', color: 'var(--fg-2)', marginBottom: '6px' } }, W.L('扩展范围（仅用于加强信心；不属于报告的 9860 个案例，结果单独列出）。案例总数：', 'Extended ranges (extra confidence only; not part of the report\'s 9860 cases, reported separately). Total cases: '), extTotal),
        W.controls(...mToggles, nSl, c2Sl, c4Sl, j5Sl));
      extBox.hidden = !ui.ext;
      function extChanged() { res.ext = CHECKS.map(() => null); extTotal.textContent = totalOf(extParams(ui)).toLocaleString(); dirty = true; render(); }
      extTotal.textContent = totalOf(extParams(ui)).toLocaleString();

      // ---------------------------------------------------------------- per-check rows
      const rowsBox = W.h('div', { style: { display: 'grid', gap: '8px' } });
      const rows = CHECKS.map((c) => {
        const o = orig.find((r) => r.test === c.test) || null;
        const pill = W.h('span');
        const match = W.h('span', { style: { fontSize: '.75rem' } });
        const strip = mkStrip(), stripE = mkStrip();
        const cnt = W.h('span', { class: 'mono', style: { fontSize: '.75rem', color: 'var(--fg-2)', whiteSpace: 'nowrap' } });
        const cntE = W.h('span', { class: 'mono', style: { fontSize: '.75rem', color: 'var(--fg-2)', whiteSpace: 'nowrap' } });
        const rng = W.h('div', { style: { fontSize: '.72rem', color: 'var(--muted)', margin: '0 0 4px' } });
        const caseBox = W.h('div', { style: { fontSize: '.8rem', overflowX: 'auto', overflowY: 'hidden', minHeight: '1.6em' } });
        const eRow = W.h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '8px', alignItems: 'center' } }, W.h('span', { style: { fontSize: '.7rem', color: 'var(--muted)' } }, W.L('扩展', 'ext.')), stripE.el, cntE);
        const el = W.h('div', { style: { border: '1px solid var(--border)', borderRadius: '10px', padding: '8px 10px', background: 'var(--surface)' } },
          W.h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px' } },
            W.h('b', { style: { fontSize: '.88rem' } }, W.lbl(c.name)), pill, match,
            W.h('span', { style: { marginLeft: 'auto', fontSize: '.75rem', color: 'var(--fg-2)' } }, c.eq ? W.h('a', { href: '#eq-' + c.eq }, W.L('式 (' + c.eq + ')', 'Eq. (' + c.eq + ')')) : W.L('§9.1 饱和', '§9.1 saturation'))),
          W.h('div', { style: { fontSize: '.75rem', color: 'var(--fg-2)', margin: '2px 0 4px' } },
            W.L('范围：', 'Scope: '), W.h('span', { class: 'i18n-zh' }, c.scopeZh), W.h('span', { class: 'i18n-en' }, o ? o.scope : ''),
            W.h('span', { style: { color: 'var(--muted)' } }, ' · JS ≡ '), W.lbl(c.js)),
          W.h('div', { style: { overflowX: 'auto', overflowY: 'hidden', fontSize: '.8rem', margin: '0 0 4px' } }, W.tex(EQ_TEX[c.id])),
          rng,
          W.h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '8px', alignItems: 'center' } }, W.h('span', { style: { fontSize: '.7rem', color: 'var(--muted)' } }, W.L('基线', 'base')), strip.el, cnt),
          eRow,
          W.h('div', { style: { fontSize: '.72rem', color: 'var(--muted)', marginTop: '4px' } }, W.L('最近案例：', 'Latest case: ')), caseBox);
        rowsBox.appendChild(el);
        return { c, o, pill, match, strip, stripE, cnt, cntE, caseBox, eRow, rng, lastShown: null };
      });
      function mkStrip() {
        const svg = W.s('svg', { viewBox: `0 0 ${NBINS} 1`, preserveAspectRatio: 'none', style: 'display:block;width:100%;height:12px;border-radius:3px;overflow:hidden' });
        const rects = [];
        for (let b = 0; b < NBINS; b++) { const r = W.s('rect', { x: b + 0.06, y: 0, width: 0.88, height: 1, fill: PEND_C }); svg.appendChild(r); rects.push(r); }
        return { el: svg, rects, state: new Array(NBINS).fill(-1) };
      }

      // ---------------------------------------------------------------- summary / sources / notes
      const read = W.readout([
        { key: 'base', label: ['基线案例（JS 复跑 / 报告）', 'Baseline cases (JS re-run / report)'] },
        { key: 'pass', label: ['通过的检查', 'Checks passed'] },
        { key: 'match', label: ['与原 JSON 一致', 'Agrees with original JSON'] },
        { key: 'time', label: ['用时', 'Elapsed'] },
        { key: 'ext', label: ['扩展案例（超出基线）', 'Extended cases (beyond baseline)'] },
      ]);
      const banner = W.h('div');
      const pySrc = Book.data.verifyScript || '# (verify_invariants.py not embedded)';
      const jsSrc = CHECKS.map((c) => `// ${c.test}\n` + c.run.toString().replace(/\n {8}/g, '\n')).join('\n\n');
      const preStyle = { maxHeight: '320px', overflow: 'auto', fontSize: '.72rem', margin: '6px 0 0', whiteSpace: 'pre' };
      const sources = W.h('div', { class: 'w-grid2', style: { marginTop: '10px' } },
        W.h('details', null, W.h('summary', { style: { cursor: 'pointer', fontSize: '.8rem', fontWeight: 600 } }, W.L('原始 Python 源码（verify_invariants.py）', 'Original Python source (verify_invariants.py)')), W.h('pre', { style: preStyle }, pySrc)),
        W.h('details', null, W.h('summary', { style: { cursor: 'pointer', fontSize: '.8rem', fontWeight: 600 } }, W.L('JavaScript 移植（本页实际运行的函数）', 'JavaScript port (the functions actually running here)')), W.h('pre', { style: preStyle }, jsSrc)));

      root.append(
        W.controls(runBtn, stopBtn, speedSeg, faultSel, extTog),
        extBox,
        banner,
        rowsBox,
        read.el,
        sources,
        W.note(['边界：这些是公式/接口层的逻辑与量纲检查（精确有理数），不包含 RTL 时序、亚稳态模型、闭环噪声、AMS 或 PVT 验证。9860 是“定义明确的逻辑案例”，不是 9860 次电路仿真；L02 每个案例内检查两个撕裂结果，沿用脚本的计数定义。',
          'Boundary: these are formula/interface-level logical and dimensional checks (exact rationals). They include no RTL timing, metastability model, closed-loop noise, AMS or PVT verification. 9860 counts well-defined logical cases, not 9860 circuit simulations; each L02 case checks two torn results, following the script\'s counting definition.'], 'warn'),
        W.note(['要点：L01 只说明式 (1) 对相干状态成立；L02 说明撕裂错误是 ±M，±1 原周期修正器覆盖不了；L03 说明整组误差在 q 与 raw parity 上不可见（式 11）；L04 说明分频相位与原相位必须统一单位；L05 说明锚点与残差必须共同变换（式 12）；L06 说明饱和码不能反推输入。打开“故障注入”可看到每条检查确实在检验其等式。',
          'What to notice: L01 only shows that Eq. (1) holds for coherent states; L02 shows torn errors are ±M, which a ±1-raw-cycle corrector cannot cover; L03 shows a whole-block error is invisible in q and raw parity (Eq. 11); L04 shows divided-clock and raw-clock phases need one unit; L05 shows anchor and residual must transform together (Eq. 12); L06 shows a saturated code cannot be inverted. Use fault injection to confirm each check really tests its identity.']),
      );
      // ---------------------------------------------------------------- engine
      function totalOf(p) { return CHECKS.reduce((s, c) => s + c.count(p), 0); }
      function newRes(c, p) { const T = c.count(p); return { T, done: 0, fail: 0, failBins: new Set(), firstFail: null, last: null }; }
      function resetResults() { run = null; res.base = CHECKS.map(() => null); res.ext = CHECKS.map(() => null); elapsed = { base: 0, ext: 0 }; dirty = true; }
      function start() {
        resetResults();
        run = { phase: 'base', ci: 0, params: BASE };
        res.base[0] = newRes(CHECKS[0], BASE);
        loop.start();
        render();
      }
      function maxCase(b, T) { return Math.min(T - 1, Math.ceil((b + 1) * T / NBINS) - 1); }
      function step(budgetMs) {
        const t0 = performance.now();
        let n = 0;
        while (run) {
          const c = CHECKS[run.ci], r = res[run.phase][run.ci];
          const perFrame = ui.speed === 'anim' ? Math.max(1, Math.ceil(r.T / 24)) : Infinity;
          let k = 0;
          while (r.done < r.T && k < perFrame) {
            const out = c.run(r.done, run.params, ui.fault === c.id);
            if (!out.ok) {
              r.fail++;
              const i = r.done, a = Math.floor(i * NBINS / r.T), b = Math.max(a, Math.ceil((i + 1) * NBINS / r.T) - 1);
              for (let x = a; x <= b; x++) r.failBins.add(x);
              if (!r.firstFail) r.firstFail = out;
            }
            r.last = out; r.done++; k++; n++;
            if ((n & 255) === 0 && performance.now() - t0 > budgetMs) break;
          }
          if (r.done >= r.T) {
            run.ci++;
            if (run.ci >= CHECKS.length) {
              elapsed[run.phase] += performance.now() - t0;
              if (run.phase === 'base' && ui.ext) { const p = extParams(ui); run = { phase: 'ext', ci: 0, params: p }; res.ext[0] = newRes(CHECKS[0], p); return; }
              run = null; return;
            }
            res[run.phase][run.ci] = newRes(CHECKS[run.ci], run.params);
          }
          if (ui.speed === 'anim' || performance.now() - t0 > budgetMs) break;
        }
        if (run) elapsed[run.phase] += performance.now() - t0;
      }
      function tick() {
        if (!run) { loop.stop(); render(); return; }
        step(ui.speed === 'anim' ? 6 : 12);
        dirty = true;
        render();
        if (!run) loop.stop();
      }

      // ---------------------------------------------------------------- render (≤ once per frame)
      const pillKey = new Map();
      function setPill(row, kind, zh, en) {
        const key = kind + zh;
        if (pillKey.get(row) === key) return;
        pillKey.set(row, key);
        W.clear(row.pill).append(W.status(kind, [zh, en]));
      }
      function paintStrip(strip, r) {
        for (let b = 0; b < NBINS; b++) {
          const st = !r ? -1 : r.failBins.has(b) && r.done > Math.floor(b * r.T / NBINS) ? 2 : r.done > maxCase(b, r.T) ? 1 : -1;
          if (st !== strip.state[b]) { strip.state[b] = st; strip.rects[b].setAttribute('fill', st === 2 ? FAIL_C : st === 1 ? PASS_C : PEND_C); }
        }
      }
      function render() {
        if (!dirty) return;
        dirty = false;
        let baseDone = 0, basePass = 0, baseMatch = 0, extDone = 0, extFail = 0;
        rows.forEach((row, ci) => {
          const r = res.base[ci], re = res.ext[ci];
          const T = row.c.count(BASE);
          paintStrip(row.strip, r);
          row.cnt.textContent = `${(r ? r.done : 0).toLocaleString()} / ${T.toLocaleString()}`;
          row.eRow.style.display = ui.ext ? 'grid' : 'none';
          if (ui.ext) { paintStrip(row.stripE, re); const Te = row.c.count(extParams(ui)); row.cntE.textContent = `${(re ? re.done : 0).toLocaleString()} / ${Te.toLocaleString()}`; }
          if (re) { extDone += re.done; extFail += re.fail; }
          const pe = extParams(ui);
          row.rng.textContent = api.t(`基线：${row.c.rangeZh(BASE)}；${T} 例`, `Baseline: ${row.c.rangeEn(BASE)}; ${T} cases`)
            + (ui.ext ? api.t(` ｜ 扩展：${row.c.rangeZh(pe)}；${row.c.count(pe)} 例`, ` | Extended: ${row.c.rangeEn(pe)}; ${row.c.count(pe)} cases`) : '');
          if (!r) setPill(row, 'warn', '待运行', 'pending');
          else if (r.done < r.T) setPill(row, 'warn', `运行中 ${Math.floor(100 * r.done / r.T)}%`, `running ${Math.floor(100 * r.done / r.T)}%`);
          else if (r.fail) setPill(row, 'bad', `FAIL（${r.fail.toLocaleString()} 例）`, `FAIL (${r.fail.toLocaleString()} cases)`);
          else setPill(row, 'good', 'PASS', 'PASS');
          if (r) baseDone += r.done;
          const fin = r && r.done >= r.T;
          if (fin && !r.fail) basePass++;
          // comparison with the original JSON
          W.clear(row.match);
          if (!row.o) row.match.append(W.L('（无原始 JSON）', '(no original JSON)'));
          else {
            const js = fin ? (r.fail ? 'FAIL' : 'PASS') : '…';
            const ok = fin && js === row.o.result && T === row.o.cases;
            if (ok) baseMatch++;
            row.match.append(W.h('span', { class: 'mono', style: { color: 'var(--fg-2)' } }, `JSON: ${row.o.cases} · ${row.o.result}  ↔  JS: ${T} · ${js} `));
            if (fin) row.match.append(W.h('b', { style: { color: ok ? 'var(--good-ink)' : 'var(--critical-ink)' } }, ok ? W.L('一致 ✓', 'match ✓') : W.L('不一致 ✗', 'differs ✗')));
          }
          // latest / first failing case (TeX only for rows that changed)
          const shown = r && (r.firstFail || r.last);
          if (shown && shown !== row.lastShown) {
            row.lastShown = shown;
            W.clear(row.caseBox).append(W.tex(shown.tex()));
            if (r.firstFail) row.caseBox.append(W.h('span', { style: { color: 'var(--critical-ink)', fontSize: '.75rem', marginLeft: '8px' } }, W.L('← 首个失败案例', '← first failing case')));
          } else if (!shown && row.lastShown) { row.lastShown = null; W.clear(row.caseBox); }
        });
        const T = totalOf(BASE);
        read.set('base', `${baseDone.toLocaleString()} / ${(origTotal || T).toLocaleString()}`);
        read.set('pass', `${basePass} / ${CHECKS.length}`);
        read.set('match', orig.length ? `${baseMatch} / ${orig.length}` : '—');
        read.set('time', `${W.fmt(elapsed.base, 1)} ms` + (ui.ext && elapsed.ext ? ` + ${W.fmt(elapsed.ext, 0)} ms` : ''));
        read.set('ext', ui.ext ? `${extDone.toLocaleString()}${extFail ? ' · FAIL ' + extFail.toLocaleString() : ''}` : api.t('（未启用）', '(off)'));
        // banner
        W.clear(banner);
        if (ui.fault !== 'none') {
          const c = CHECKS.find((x) => x.id === ui.fault);
          banner.append(W.note(W.h('span', null, W.h('b', null, W.L(`已注入故障 ${c.id}：`, `Fault injected in ${c.id}: `)), W.lbl(c.fault), W.L('。预期该项变为 FAIL 并与原 JSON 不一致——这证明检查确实在检验等式，而不是恒为 PASS。', '. That check is expected to turn FAIL and differ from the original JSON — proof that it really tests its identity rather than always passing.')), 'bad'));
        } else if (T !== origTotal && origTotal) {
          banner.append(W.note(['JS 基线案例总数与原 JSON 不同。', 'JS baseline total differs from the original JSON.'], 'bad'));
        }
      }
      api.onLang(() => { dirty = true; render(); });
      dirty = true; render();
      if (!api.reducedMotion) start();
      return { destroy() { run = null; loop.stop(); } };
    },
  });
})();
