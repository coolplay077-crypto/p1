/* sony-xor-correction — report §4.7 (Sony US11936392B2 embodiment), §7.3 (route C), Eq. (9), Eq. (11).
 *   Part A  Eq. (9): CRRCT = VINT[0] ⊕ VFRAC[0],  SIGN = VFRAC[0] ⊕ VFRAC[3]  → correction 0 / −1 / +1 (book table).
 *   Part B  GENERIC parity-coverage analysis — a book-level derivation, NOT a claim about Sony's actual circuit:
 *           integer path and fractional path share the same LSB state (VFRAC[0] = N mod 2); an integer-path error e
 *           flips VINT[0] iff e is odd. Since (N+M) mod 2 = N mod 2 (Eq. 11) for even M, whole-group errors are invisible.
 *           The correction "±1" is applied with an oracle sign (best case) in a user-selected unit.
 *   Part C  Route-C error-class checklist; the assumed error magnitudes are illustrative, model-dependent choices.
 */
(function () {
  'use strict';
  const CSS = `
.sx-h { margin: 14px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.sx-h .w-ctl { font-weight: 400; }
.sx-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; font-variant-numeric: tabular-nums; margin: 0; }
.sx-tbl th, .sx-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
.sx-tbl th { background: var(--surface-2); font-weight: 650; white-space: nowrap; }
.sx-tbl td.n, .sx-tbl th.n { text-align: right; font-family: var(--mono); white-space: nowrap; }
.sx-tbl tr.hit td { background: var(--accent-wash); }
.sx-tbl tr:last-child td { border-bottom: 0; }
.sx-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.sx-eq { overflow-x: auto; overflow-y: hidden; }
.sx-eq .katex-display { margin: .3em 0; }
.sx-big { display: inline-block; min-width: 2.4em; text-align: center; font-family: var(--mono); font-weight: 700; padding: 1px 8px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface-2); }
.sx-cav { margin: 6px 0 0 1.2em; padding: 0; font-size: .78rem; color: var(--fg-2); }
.sx-cav li { margin: 2px 0; }
`;
  const sg = (v) => (v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0');

  Book.registerWidget({
    id: 'sony-xor-correction',
    group: 'epoch',
    title: { zh: 'Sony 式 (9) 的两个 XOR 修正及其覆盖范围', en: 'Sony Eq. (9): the two XOR corrections and what they cover' },
    summary: {
      zh: '先按书中表格逐位试算 CRRCT = VINT[0]⊕VFRAC[0]、SIGN = VFRAC[0]⊕VFRAC[3] 及送往相位比较器的修正；再用一个明确标注的通用抽象模型（不是 Sony 实际电路）说明：单个 LSB 奇偶只能标记奇数误差，±2 与整组 ±M 悄悄通过（式 11），并给出路线 C 必须枚举的错误类别。',
      en: 'First try Eq. (9) bit by bit — CRRCT = VINT[0]⊕VFRAC[0], SIGN = VFRAC[0]⊕VFRAC[3] — and the correction sent to the phase comparator per the book table. Then a clearly labelled generic abstract model (not Sony\'s actual circuit) shows that a single LSB parity flags only odd errors, so ±2 and whole-group ±M pass silently (Eq. 11), followed by the error classes route C must enumerate.',
    },
    sections: ['r-4-7', 'r-7-3'],
    eqs: ['9'],
    keywords: ['Sony', 'XOR', 'CRRCT', 'SIGN', 'VFRAC', 'parity', 'route C', '奇偶', '冗余校正'],
    mount(root, api) {
      const st = { vi0: 1, vf0: 0, vf3: 1, M: 8, N: 13, e: 2, unit: 'raw' };
      root.appendChild(W.h('style', null, CSS));
      const aHost = W.h('div'), bHost = W.h('div'), chartHost = W.h('div'), cHost = W.h('div'), eqB = W.h('div', { class: 'sx-eq' });

      const tA = (key, label) => W.toggle({ label, value: !!st[key], onChange: (v) => { st[key] = v ? 1 : 0; drawA(); } });
      const tVi = tA('vi0', 'VINT[0] = 1'), tVf0 = tA('vf0', 'VFRAC[0] = 1'), tVf3 = tA('vf3', 'VFRAC[3] = 1');
      const cM = W.seg({ label: ['分组倍率 M', 'Group ratio M'], options: [{ value: 4, label: 'M = 4' }, { value: 8, label: 'M = 8' }], value: st.M, onChange: (v) => { st.M = +v; drawB(); drawC(); } });
      const cN = W.slider({ label: ['当前计数 N', 'Current count N'], min: 0, max: 31, step: 1, value: st.N, fmt: (v) => String(v), onInput: (v) => { st.N = v; drawB(); } });
      const eOpts = [];
      const cE = W.select({ label: ['注入误差 e（整数路径）', 'Injected integer-path error e'], options: eOpts, value: String(st.e), onChange: (v) => { st.e = +v; drawB(); } });
      const cU = W.seg({ label: ['修正中“1”的单位', 'Unit of the "1" in the correction'], options: [{ value: 'raw', label: ['原周期 T₀', 'raw cycle T₀'] }, { value: 'grp', label: ['一整组 M·T₀', 'one group M·T₀'] }], value: st.unit, onChange: (v) => { st.unit = v; drawB(); } });

      root.append(
        W.h('div', { class: 'sx-h' }, W.L('A. 式 (9) 试算（书中表格）', 'A. Eq. (9) explorer (book table)')),
        W.controls(tVi, tVf0, tVf3, W.button(['遍历 8 种组合 →', 'Cycle all 8 combinations →'], () => { const k = ((st.vi0 << 2) | (st.vf0 << 1) | st.vf3) + 1 & 7; st.vi0 = (k >> 2) & 1; st.vf0 = (k >> 1) & 1; st.vf3 = k & 1; tVi.value = st.vi0; tVf0.value = st.vf0; tVf3.value = st.vf3; drawA(); })),
        aHost,
        W.h('div', { class: 'sx-h' }, W.L('B. 通用奇偶覆盖分析（书级推导，不是 Sony 实际电路）', 'B. Generic parity-coverage analysis (book-level derivation, NOT Sony\'s actual circuit)')),
        W.note(['抽象假设：整数路径与小数路径共享同一个 LSB 状态，即 VFRAC[0] = N mod 2；整数路径出现误差 e 时 VINT = N + e。修正的符号按“理想已知”处理（最好情形）。', 'Abstract assumption: the integer path and the fractional path share the same LSB state, VFRAC[0] = N mod 2; an integer-path error e gives VINT = N + e. The correction sign is taken as perfectly known (best case).'], 'warn'),
        W.controls(cM, cN, cE, cU),
        bHost, eqB, chartHost,
        W.h('div', { class: 'sx-h' }, W.L('C. 路线 C（有界错配与冗余校正）必须枚举的错误类别', 'C. Error classes route C (bounded mismatch + redundant correction) must enumerate')),
        cHost,
        W.h('div', { class: 'sx-h' }, W.L('书中的边界', 'Caveats from the book')),
        W.h('ul', { class: 'sx-cav' },
          W.h('li', null, W.L('VFRAC 是带周期冗余的状态码（Fig.12 的值跨至 1.75），不是普通纯小数二进制。', 'VFRAC is a state code with period redundancy (Fig.12 values reach 1.75), not a plain fractional binary number.')),
          W.h('li', null, W.L('修正量的“1”必须按其原相位单位解释。', 'The "1" in the correction must be interpreted in its original phase unit.')),
          W.h('li', null, W.L('个别 retiming 节点/位序需结合 Fig.6、8、11、12 交叉确认；本页不把它直接转写为 RTL。', 'Individual retiming nodes and bit orders need cross-checking with Fig.6, 8, 11, 12; this page does not turn it into RTL.')),
          W.h('li', null, W.L('该实施例用多相 latch/correction 替代传统 TDC，不能说已接上本项目的 short TDC。', 'The embodiment replaces the conventional TDC with multiphase latch/correction; it cannot be said to be connected to this project\'s short TDC.')),
          W.h('li', null, W.L('不能从式 (9) 推出对任意异步错误都保证唯一复原。', 'Eq. (9) does not guarantee unique recovery for arbitrary asynchronous errors.'))),
        W.note([
          '要点：式 (9) 只在“整数路径与小数路径共享的 LSB 状态不一致”时动作。对 M = 4 或 8，一整组误差既不改变 q 也不改变奇偶（式 11），所以把某个 low-bit XOR 直接搬到 /8 模型未必能检测高位错组；要覆盖它，必须另行保留能跨组翻转的状态（高位最低位、wrap toggle/sequence 或确定候选 epoch 的捕获协议），且先枚举所有可能的错误状态再选冗余。',
          'Key point: Eq. (9) only acts when the LSB state shared by the integer and fractional paths disagrees. For M = 4 or 8 a whole-group error changes neither q nor the parity (Eq. 11), so moving a low-bit XOR into a /8 model does not necessarily detect a wrong high group; covering it needs additional state that flips across groups (the high-count LSB, a wrap toggle/sequence, or a capture protocol that fixes the candidate epoch) — and the set of possible error states must be enumerated first, before choosing the redundancy.']),
      );

      // -------------------------------------------------------------- Part A
      function drawA() {
        const crrct = st.vi0 ^ st.vf0, sign = st.vf0 ^ st.vf3;
        const corr = crrct === 0 ? 0 : sign === 0 ? -1 : 1;
        const tb = W.h('table', { class: 'sx-tbl' }, W.h('tr', null, W.h('th', { class: 'n' }, 'CRRCT'), W.h('th', { class: 'n' }, 'SIGN'), W.h('th', null, W.L('送往 phase comparator 的修正', 'Correction sent to the phase comparator'))));
        const book = [[0, 'x', '0'], [1, 0, '−1'], [1, 1, '+1']];
        for (const [c, s, v] of book) {
          const hit = c === crrct && (c === 0 || s === sign);
          tb.appendChild(W.h('tr', { class: hit ? 'hit' : '' }, W.h('td', { class: 'n' }, String(c)), W.h('td', { class: 'n' }, s === 'x' ? W.L('任意', 'any') : String(s)), W.h('td', { class: 'n' }, v)));
        }
        W.clear(aHost).append(
          W.tex(`\\mathrm{CRRCT}=${st.vi0}\\oplus${st.vf0}=${crrct},\\qquad \\mathrm{SIGN}=${st.vf0}\\oplus${st.vf3}=${sign}\\ \\Rightarrow\\ \\text{correction }${sg(corr)}`, true),
          W.h('div', { class: 'sx-tblw' }, tb),
          W.h('div', { style: { marginTop: '6px' } }, W.h('span', { class: 'sx-big' }, sg(corr)), ' ', W.L('（按原相位单位）', '(in the original phase unit)')));
      }

      // -------------------------------------------------------------- Part B
      const eList = () => [-2 * st.M, -st.M, -3, -2, -1, 0, 1, 2, 3, st.M, 2 * st.M];
      const evalE = (e) => {
        const unit = st.unit === 'grp' ? st.M : 1;
        const vf0 = st.N & 1, vint0 = W.mod(st.N + e, 2);
        const flag = vint0 ^ vf0; // CRRCT in the abstract model
        const applied = flag ? Math.sign(e || 1) * unit : 0; // oracle sign
        // when e = 0 flag is always 0
        const resid = e - applied;
        return { e, vf0, vint0, flag, applied, resid };
      };
      function drawB() {
        const opts = eList();
        const sel = cE.querySelector('select');
        const keep = String(st.e);
        W.clear(sel);
        eOpts.length = 0;
        for (const e of opts) {
          const label = `e = ${sg(e)}${Math.abs(e) === st.M ? ' (±M)' : Math.abs(e) === 2 * st.M ? ' (±2M)' : ''}`;
          eOpts.push({ value: String(e), label });
          sel.appendChild(W.h('option', { value: String(e) }, label));
        }
        if (!opts.includes(+keep)) { st.e = 2; }
        sel.value = String(st.e);
        const r = evalE(st.e);
        const verdict = st.e === 0 ? ['无误差', 'no error', 'good'] : r.flag ? (r.resid === 0 ? ['被标记并修正', 'flagged and corrected', 'good'] : ['被标记，但修正后仍有残差', 'flagged, but a residual error remains', 'warn']) : ['未被标记：悄悄通过', 'NOT flagged: passes silently', 'bad'];
        W.clear(eqB).append(
          W.tex(`\\begin{aligned}\\mathrm{VFRAC}[0]&=N\\bmod2=${r.vf0},\\quad \\mathrm{VINT}=N+e=${st.N + st.e},\\ \\mathrm{VINT}[0]=${r.vint0}\\\\ \\mathrm{CRRCT}&=\\mathrm{VINT}[0]\\oplus\\mathrm{VFRAC}[0]=${r.flag}\\ \\Longleftrightarrow\\ e\\ \\text{odd}\\end{aligned}`, true),
          W.h('div', null, W.status(verdict[2], [verdict[0], verdict[1]]), ' ', W.h('span', { class: 'mono' }, `e ${sg(st.e)} → ${W.txt(['修正', 'corr.'])} ${sg(r.applied)} → ${W.txt(['残差', 'residual'])} ${sg(r.resid)}`)));
        if (st.M % 2 === 0) W.clear(bHost).append(W.tex(`(N+M)\\bmod 2=N\\bmod 2\\ \\text{(Eq. 11)},\\ M=${st.M}:\\ \\ (N+${st.M})\\bmod2=${W.mod(st.N + st.M, 2)}=${W.mod(st.N, 2)}`));

        // chart: |e| before / after
        const VW = 760, VH = 210, PL = 44, PR = 12, PT = 18, PB = 44;
        const svg = W.svg(VW, VH);
        const ys = W.scale([0, 2 * st.M], [VH - PB, PT]);
        for (const tk of W.ticks(0, 2 * st.M, 4)) {
          svg.appendChild(W.s('line', { x1: PL, x2: VW - PR, y1: ys(tk), y2: ys(tk), class: 'grid' }));
          svg.appendChild(W.s('text', { x: PL - 6, y: ys(tk) + 4, 'text-anchor': 'end' }, String(tk)));
        }
        svg.appendChild(W.sL('|误差| / T₀', '|error| / T₀', { x: 4, y: 10, style: 'font-size:10px' }));
        const slot = (VW - PL - PR) / opts.length;
        opts.forEach((e, i) => {
          const rr = evalE(e), cx = PL + slot * (i + 0.5), bw = Math.min(22, slot / 2 - 3);
          const sel2 = e === st.e;
          if (sel2) svg.appendChild(W.s('rect', { x: cx - slot / 2, y: PT - 6, width: slot, height: VH - PB - PT + 6, fill: 'var(--accent-wash)' }));
          svg.appendChild(W.s('rect', { x: cx - bw - 1, y: ys(Math.abs(e)), width: bw, height: ys(0) - ys(Math.abs(e)), fill: 'var(--sig-err)', 'fill-opacity': 0.55 }));
          svg.appendChild(W.s('rect', { x: cx + 1, y: ys(Math.abs(rr.resid)), width: bw, height: Math.max(0, ys(0) - ys(Math.abs(rr.resid))), fill: Math.abs(rr.resid) === 0 ? 'var(--good)' : 'var(--sig-fine)', 'fill-opacity': 0.8 }));
          svg.appendChild(W.s('text', { x: cx, y: VH - PB + 14, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10.5px;fill:var(--fg)' }, sg(e)));
          svg.appendChild(W.s('text', { x: cx, y: VH - PB + 27, 'text-anchor': 'middle', style: `font-size:10px;fill:${rr.flag ? 'var(--good-ink)' : e === 0 ? 'var(--muted)' : 'var(--critical-ink)'}` }, e === 0 ? '—' : rr.flag ? '⚑' : '✗'));
          const hit = svg.appendChild(W.s('rect', { x: cx - slot / 2, y: PT - 6, width: slot, height: VH - PT + 6, fill: 'transparent', style: 'cursor:pointer' }));
          hit.addEventListener('click', () => { st.e = e; drawB(); });
        });
        svg.appendChild(W.sL('⚑ = 被 CRRCT 标记    ✗ = 未被标记（悄悄通过）', '⚑ = flagged by CRRCT    ✗ = not flagged (passes silently)', { x: VW / 2, y: VH - 2, 'text-anchor': 'middle', style: 'font-size:10.5px' }));
        W.clear(chartHost).append(svg, W.legend([{ color: 'var(--sig-err)', label: ['注入误差 |e|', 'injected error |e|'] }, { color: 'var(--sig-fine)', label: ['修正后残差（理想已知符号）', 'residual after correction (sign assumed known)'] }, { color: 'var(--good)', label: ['残差为 0', 'zero residual'] }]));
      }

      // -------------------------------------------------------------- Part C
      function drawC() {
        const M = st.M;
        const cls = [
          [['低位合法相邻变化', 'Legal adjacent low-state change'], 1, ['一个原周期', 'one raw cycle']],
          [['高位错一组', 'High count off by one group'], M, ['整组 M', 'one whole group M']],
          [['高低位撕裂（旧高位 + 新低位）', 'High/low tearing (old high + new low)'], M, ['跨组撕裂 ±M（见 torn-capture）', 'cross-group tear ±M (see torn-capture)']],
          [['fine anchor 延迟一个 raw cycle', 'Fine anchor one raw cycle late'], 1, ['一个原周期', 'one raw cycle']],
          [['phase-selector 绕回', 'Phase-selector wrap'], 4, ['假设一个 /4 周期 = 4 T₀（依赖具体定义）', 'assumed one /4 period = 4 T₀ (definition-dependent)']],
          [['同步器延迟超过假设范围', 'Synchronizer delay beyond assumption'], 2, ['假设多 2 个原周期（依赖具体设计）', 'assumed 2 extra raw cycles (design-dependent)']],
        ];
        const tb = W.h('table', { class: 'sx-tbl' }, W.h('tr', null, W.h('th', null, W.L('错误类别', 'Error class')), W.h('th', { class: 'n' }, W.L('假设 e', 'assumed e')), W.h('th', null, W.L('假设依据', 'basis of assumption')), W.h('th', null, W.L('单个 LSB 奇偶', 'single LSB parity'))));
        for (const [nm, e, basis] of cls) {
          const odd = Math.abs(e) % 2 === 1;
          tb.appendChild(W.h('tr', null, W.h('td', null, W.lbl(nm)), W.h('td', { class: 'n' }, sg(e) + ' T₀'), W.h('td', null, W.lbl(basis)), W.h('td', null, odd ? W.status('good', ['标记（仅检测）', 'flags (detection only)']) : W.status('bad', ['不标记', 'does not flag']))));
        }
        W.clear(cHost).append(W.h('div', { class: 'sx-tblw' }, tb), W.note(['误差大小为演示用的示意假设（依赖具体电路定义），不是文献数据；“标记”仅表示奇偶位翻转，不等于已正确修正或已唯一复原。不同错误可能需要不同冗余信息和不同的无效处理。', 'The error sizes are illustrative, definition-dependent assumptions, not data from any source. "Flags" only means the parity bit flips — it does not mean correctly corrected or uniquely recovered. Different errors may need different redundancy and different invalid handling.']));
      }
      drawA(); drawB(); drawC();
      return { destroy() { } };
    },
  });
})();
