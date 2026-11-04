/* Hub page: one-page cheat sheet — positioning, the two chains, key formulas,
 * the three corrections, unit traps, G/I/Q lists, snapshot routes and verification layers.
 * Data: book/data/formulas.json (tex, titles), book/data/checklists.json (goals, invariants,
 * questions, routes, corrections). Every item links to its section / equation / widget.
 */
(function () {
  'use strict';
  const PAGE = 'hub-cheatsheet';
  const esc = Book.esc, bi = Book.bi;

  const CSS = `
.hc-hero { padding: 18px 0 6px; }
.hc-hero h1 { font-size: clamp(1.5rem, 3vw, 2.1rem); line-height: 1.25; margin: .1em 0 .35em; }
.hc-hero .lede { color: var(--fg-2); font-size: .98rem; margin: 0; }
.hc-tools { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 4px; }
.hc-pos { margin: 14px 0; padding: 12px 16px; border-left: 3px solid var(--accent); background: var(--surface); border-radius: 10px; font-size: .95rem; line-height: 1.6; }
.hc-h { margin: 22px 0 8px; font-size: 1.02rem; color: var(--fg-2); }
.hc-h small { font-weight: 400; color: var(--muted); font-size: .78rem; margin-left: 6px; }
.hc-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0 10px; font-size: .8rem; }
.hc-chain .hc-lab { font-weight: 700; color: var(--accent-ink); margin-right: 4px; white-space: nowrap; }
.hc-node { border: 1px solid var(--border-strong); background: var(--surface); border-radius: 8px; padding: 3px 9px; color: var(--fg); line-height: 1.5; }
.hc-node.hl { border-color: var(--accent); }
.hc-arr { color: var(--muted); }
.hc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 10px; }
.hc-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; font-size: .88rem; line-height: 1.55; min-width: 0; overflow-wrap: anywhere; }
.hc-box h3 { margin: 0 0 6px; font-size: .92rem; }
.hc-box ul { margin: 0; padding-left: 1.2em; }
.hc-box li { margin: 3px 0; }
.hc-formula { display: flex; flex-direction: column; gap: 4px; }
.hc-fx { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--border); }
.hc-fx:last-child { border-bottom: 0; }
.hc-fx .hc-tag { font-weight: 700; color: var(--accent-ink); font-variant-numeric: tabular-nums; font-size: .85rem; white-space: nowrap; }
.hc-fx .hc-math { overflow-x: auto; overflow-y: hidden; }
.hc-fx .hc-math .katex-display { margin: .2em 0; text-align: left; }
.hc-fx .hc-math .katex-display > .katex { text-align: left; }
.hc-fx .hc-cap { grid-column: 2; font-size: .8rem; color: var(--fg-2); }
.hc-fx .hc-cap a { margin-right: 8px; }
.hc-tbl { font-size: .8rem; }
.hc-tbl th, .hc-tbl td { vertical-align: top; }
.hc-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.hc-tag2 { display: inline-flex; gap: 4px; align-items: baseline; font-size: .78rem; border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 2px 7px; color: var(--fg); text-decoration: none; line-height: 1.45; }
.hc-tag2 b { color: var(--accent-ink); font-variant-numeric: tabular-nums; }
.hc-tag2:hover { border-color: var(--accent); }
.hc-src { font-size: .76rem; color: var(--muted); margin: 6px 0 0; }
@media (max-width: 700px) {
  .hc-fx { grid-template-columns: minmax(0, 1fr); }
  .hc-fx .hc-cap { grid-column: 1; }
}
@media print {
  .hc-tools, .hc-tbl-note { display: none !important; }
  .hc-box, .hc-fx { break-inside: avoid; }
  .hc-grid { grid-template-columns: 1fr 1fr; }
  body { font-size: 10pt; }
}
`;
  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }

  // "r-3-2" -> §3.2 ; "r-A" -> 附录 A / App. A
  function secRef(id) {
    const m = String(id).replace(/^r-/, '');
    const app = /^[A-Z]$/.test(m);
    return `<a href="#${esc(id)}">${bi(esc(app ? '附录 ' + m : '§' + m), esc(app ? 'App. ' + m : '§' + m))}</a>`;
  }
  function eqRef(n) {
    return `<a href="#eq-${esc(n)}">${bi(`式 (${esc(n)})`, `Eq. (${esc(n)})`)}</a>`;
  }
  function wRef(id, label) {
    const w = Book.widgets && Book.widgets.get(id);
    if (!w) return '';
    const t = w.title || { zh: id, en: id };
    return `<a href="#w-${esc(id)}">${label ? label : ''}▶ ${bi(esc(t.zh), esc(t.en || t.zh))}</a>`;
  }
  const plainTex = (s) => String(s || '').replace(/\s*\\tag\{[^}]*\}\s*$/, '').trim();
  const CK = () => Book.data.data.checklists || { goals: [], invariants: [], questions: [], routes: [], corrections: [] };

  const TRAPS = [
    { zh: 'CK0 不能跨文献同名代换：CKV、DCO、预分频输出可能处于不同层级，改变 CK0 时 CNT 权重、FCW、fine 归一化与 edge ID 须一起换算。', en: 'CK0 cannot be swapped by name across papers: CKV, DCO and prescaled outputs may sit at different levels; changing CK0 means converting CNT weights, FCW, fine normalisation and edge IDs together.', s: 'r-3-1' },
    { zh: 'Kuo 的 DCO 调谐范围 5.7–8.4 GHz，/4 后为 1.425–2.1 GHz；“约 2 GHz”是 /4 后的量级，不是原始 DCO。八相 T_V/8 换算到前置 /4 之前的周期是 T0/2，而不是 T0/8。', en: 'Kuo\'s DCO tunes over 5.7–8.4 GHz, i.e. 1.425–2.1 GHz after /4; “about 2 GHz” is the order of magnitude after /4, not the raw DCO. T_V/8 of the eight-phase CKV, converted to the period before the /4, is T0/2, not T0/8.', s: 'r-4-5' },
    { zh: 'Zong 2019 的 CKV 是约 20 GHz 基波经 /4 与 /2 后的节点；Fig.9 的 counter 基准是前置 /8 之后的 CKV，不能把其低两位等同于 20 GHz 基波的全部周期。', en: 'Zong 2019\'s CKV is the ~20 GHz fundamental after /4 and /2; the Fig. 9 counter reference is the CKV after the preceding /8, so its low two bits are not all cycles of the 20 GHz fundamental.', s: 'r-4-9' },
    { zh: '普通二进制 q[2] 的上升沿对应 3→4，下降沿对应 7→0；不能只凭信号名 CKVD8 就默认其有效沿等于 carry，须核对极性、复位原点与流水延迟。', en: 'For an ordinary binary q[2], the rising edge is 3→4 and the falling edge is 7→0; do not assume from the name CKVD8 that the active edge equals the carry — check polarity, reset origin and pipeline delay.', s: 'r-3-2' },
    { zh: '高低字撕裂的错误是 ±M（如 80 与 88 相差 −8），不是 ±1 原周期；κ_C 的单位是一个慢计数组，κ_N 是一个原始周期，不能共用一个无单位 κ。', en: 'A high/low word tear produces ±M errors (e.g. 80 vs 88 is −8), not ±1 raw cycle; κ_C is in slow-count groups and κ_N in raw cycles, so one unitless κ must not be used for both.', s: 'r-6-2' },
    { zh: '式 (7)–(8) 的量纲：分频后的 a/8 与原周期的 a/2 不是同一单位；q + a/8 直接相加混合了单位，并可能重复计数。', en: 'Units in Eqs. (7)–(8): a/8 of the divided period and a/2 of the raw period are different units; adding q + a/8 mixes units and may double-count.', s: 'r-3-4' },
    { zh: '理想示例的 ±31.25 ps 只是最近相位残差的理想范围；必须加入预测误差、相位不均匀、路径误差、瞬态频偏与判决 guard，并由实际测量流程导出。', en: 'The ideal ±31.25 ps is only the nearest-phase residual range; prediction error, phase non-uniformity, path error, transient offset and decision guard must be added, and the range derived from the real measurement flow.', s: 'r-9-5' }
  ];

  Book.registerPage({
    id: PAGE,
    group: 'hub',
    order: 5,
    icon: '▤',
    title: { zh: '速查表', en: 'Cheat sheet' },
    summary: {
      zh: '一页速查：定位、两条链、关键公式、三处更正、单位陷阱、G/I/Q 清单、三条快照路线与验证层次。可打印。',
      en: 'One-page summary: positioning, the two chains, key formulas, the three corrections, unit traps, G/I/Q lists, the three snapshot routes and the verification layers. Printable.',
    },
    render(el, api) {
      injectCss('hc-css-cheatsheet', CSS);
      const F = (Book.data.data.formulas && Book.data.data.formulas.items) || [];
      const byN = new Map(F.map((f) => [String(f.n), f]));
      const K = CK();
      const KEY = ['1', '2', '5', '10', '11', '12', '16', '17', '18', '20', '21'];

      const formulas = KEY.map((n) => {
        const f = byN.get(n);
        if (!f) return '';
        return `<div class="hc-fx">
          <span class="hc-tag">(${esc(n)})</span>
          <div class="hc-math">${api.tex(plainTex(f.tex), true)}</div>
          <div class="hc-cap">${bi(esc(f.title.zh), esc(f.title.en))} · ${secRef(f.section)} · <a href="#hub-formulas-eq-${esc(n)}">${bi('推导卡', 'Card')}</a></div>
        </div>`;
      }).join('');

      const corr = (K.corrections || []).map((c) => `<li>${bi(esc(c.zh.text), esc(c.en.text))} <span class="hc-src">${bi(esc(c.zh.link), esc(c.en.link))} · ${(c.sections || []).map(secRef).join(' ')}</span></li>`).join('');

      const traps = TRAPS.map((t) => `<li>${bi(esc(t.zh), esc(t.en))} ${secRef(t.s)}</li>`).join('');

      const goals = (K.goals || []).map((g) => `<a class="hc-tag2" href="#r-2-1"><b>${esc(g.id)}</b>${bi(esc(g.zh.title), esc(g.en.title))}</a>`).join('');
      const invs = (K.invariants || []).map((i) => `<a class="hc-tag2" href="#r-10-2"><b>${esc(i.id)}</b>${bi(esc(i.zh.text), esc(i.en.text))}</a>`).join('');
      const qs = (K.questions || []).map((q) => `<a class="hc-tag2" href="#r-13-2"><b>${esc(q.id)}</b>${bi(esc(q.zh.q), esc(q.en.q))}</a>`).join('');
      const routes = (K.routes || []).map((r) => `<tr><td>${bi(esc(r.zh.name), esc(r.en.name))}</td><td>${bi(esc(r.zh.solves), esc(r.en.solves))}</td><td>${bi(esc(r.zh.needs), esc(r.en.needs))}</td><td>${(r.sections || []).map(secRef).join(' ')}</td></tr>`).join('');

      el.innerHTML = `
        <div class="hc-hero">
          <div class="kicker">${bi('知识汇总 · 速查表', 'Knowledge hub · Cheat sheet')}</div>
          <h1>${bi('一页看懂 CNT-ADPLL 的相位链', 'The CNT-ADPLL phase chain on one page')}</h1>
          <p class="lede">${bi('每一项都链接到正文的章节、编号公式或交互模型。打印时隐藏工具栏。', 'Every item links to the section, numbered equation or interactive model. The toolbar is hidden when printing.')}</p>
          <div class="hc-tools"><button type="button" class="w-btn" data-act="print">${bi('打印速查表', 'Print cheat sheet')}</button></div>
        </div>

        <div class="hc-pos"><b>${bi('定位', 'Positioning')}：</b>${bi(
          '在 CNT / VPA / phase-domain ADPLL 中，把宽位整数相位计数器的高位降到 CKV/4 或 CKV/8 工作，同时完整保留原始 CKV 周期编号；再把低位状态、参考相关快照与被选择的真实物理边沿关联起来，使短量程 TDC 只测局部残差，并能判断观测是否有效。（§1.1）',
          'In a CNT / VPA / phase-domain ADPLL, the high bits of a wide integer phase counter run at CKV/4 or CKV/8 while the raw CKV cycle index is kept completely; the low-bit state, the reference-related snapshot and the physically selected edge are then linked, so that a short-range TDC measures only the local residual and the validity of each observation can be judged. (§1.1)'
        )}</div>

        <h2 class="hc-h">${bi('两条链', 'Two chains')} <small>${bi('测量链与执行链不能混为一谈（§1.1、§8.1）', 'Measurement and execution must not be confused (§1.1, §8.1)')}</small></h2>
        <div class="hc-chain"><span class="hc-lab">${bi('测量链', 'Measure')}</span>
          <span class="hc-node">${bi('实际 CK0', 'Actual CK0')}</span><span class="hc-arr">→</span>
          <span class="hc-node">${bi('持续高/低计数 (C, q)', 'Continuous high/low count (C, q)')}</span><span class="hc-arr">→</span>
          <span class="hc-node">${bi('REF 相关安全快照', 'REF-related safe snapshot')}</span><span class="hc-arr">→</span>
          <span class="hc-node">${bi('coarse 锚点', 'coarse anchor')}</span><span class="hc-arr">+</span>
          <span class="hc-node">${bi('fine 残差 μ', 'fine residual μ')}</span><span class="hc-arr">→</span>
          <span class="hc-node hl">${bi('相位误差 · 有效性', 'phase error · validity')}</span>
        </div>
        <div class="hc-chain"><span class="hc-lab">${bi('执行链', 'Execute')}</span>
          <span class="hc-node">${bi('计划 J_plan', 'Plan J_plan')}</span><span class="hc-arr">→</span>
          <span class="hc-node">${bi('高位命中 + slot 控制', 'high-bit match + slot control')}</span><span class="hc-arr">→</span>
          <span class="hc-node">${bi('物理选沿 / 门控', 'physical edge select / gate')}</span><span class="hc-arr">→</span>
          <span class="hc-node">${bi('实际边沿', 'actual edge')}</span><span class="hc-arr">→</span>
          <span class="hc-node hl">${bi('执行回执 J_observed', 'receipt J_observed')}</span>
        </div>
        <div class="hc-chain">${wRef('arch-flow', '')} ${wRef('ps-executor', '')} ${secRef('r-8-1')} ${secRef('r-8-2')}</div>

        <h2 class="hc-h">${bi('关键公式', 'Key formulas')} <small>${bi('LaTeX 与报告一致；卡片含变量与推导', 'LaTeX as in the report; cards hold variables and derivations')}</small></h2>
        <div class="hc-box hc-formula">${formulas}</div>

        <h2 class="hc-h">${bi('三处更正', 'Three corrections')} <small>${bi('§1.3', '§1.3')}</small></h2>
        <div class="hc-box"><ul>${corr}</ul></div>

        <h2 class="hc-h">${bi('单位与陷阱', 'Unit traps')}</h2>
        <div class="hc-box"><ul>${traps}</ul></div>

        <h2 class="hc-h">${bi('目标 G1–G7', 'Goals G1–G7')} <small>${bi('§2.1', '§2.1')}</small></h2>
        <div class="hc-tags">${goals}</div>
        <h2 class="hc-h">${bi('不变量 I1–I8', 'Invariants I1–I8')} <small>${bi('§10.2', '§10.2')}</small></h2>
        <div class="hc-tags">${invs}</div>
        <h2 class="hc-h">${bi('工程问题 Q1–Q5', 'Engineering questions Q1–Q5')} <small>${bi('§13.2', '§13.2')}</small></h2>
        <div class="hc-tags">${qs}</div>

        <h2 class="hc-h">${bi('三条快照路线', 'Three snapshot routes')} <small>${bi('§7.4：模块名不能代替完整证明', '§7.4: a module name cannot replace a full proof')}</small></h2>
        <div class="tbl-wrap"><table class="hc-tbl"><thead><tr><th>${bi('路线', 'Route')}</th><th>${bi('能直接解决的问题', 'Problem it directly solves')}</th><th>${bi('仍须独立证明', 'Still needs an independent proof')}</th><th>${bi('正文', 'Text')}</th></tr></thead><tbody>${routes}</tbody></table></div>

        <h2 class="hc-h">${bi('验证层次', 'Verification layers')} <small>${bi('§12', '§12')}</small></h2>
        <div class="hc-grid">
          <div class="hc-box"><h3>${bi('已执行：六组逻辑/量纲检查', 'Done: six logic / unit checks')} ${secRef('r-12-1')}</h3>
            <p style="margin:0">${bi('精确有理数检查，合计 9860 个定义明确的逻辑案例（L01–L06）。它不是 9860 次电路仿真，也不含 RTL 时序、亚稳态、闭环噪声、AMS 或 PVT。', 'Exact-rational checks, 9860 well-defined logic cases in total (L01–L06). These are not 9860 circuit simulations and include no RTL timing, metastability, closed-loop noise, AMS or PVT.')}</p>
            <p style="margin:6px 0 0">${wRef('verify-runner', '')}</p></div>
          <div class="hc-box"><h3>${bi('第一层：事件级 golden model', 'Layer 1: event-level golden model')} ${secRef('r-12-2')}</h3>
            <p style="margin:0">${bi('每个事件的原边沿编号、C/q 原码、候选编号、边界标签、修正量及单位、J_plan / J_observed、fine_raw、VALID/SAT 与最终相位。', 'Per event: raw edge index, raw C/q, candidate ID, boundary label, correction and its unit, J_plan / J_observed, fine_raw, VALID/SAT and the final phase.')}</p>
            <p style="margin:6px 0 0">${wRef('golden-model', '')}</p></div>
          <div class="hc-box"><h3>${bi('第二层：RTL / 门级时序与 CDC', 'Layer 2: RTL / gate-level timing and CDC')} ${secRef('r-12-3')}</h3>
            <p style="margin:0">${bi('carry 极性、shift-state decode、候选元组选择、snapshot 生命周期、异步同步延迟、短脉冲与根时钟 retiming。', 'Carry polarity, shift-state decode, candidate-tuple selection, snapshot lifetime, asynchronous synchroniser delay, short pulses and root-clock retiming.')}</p></div>
          <div class="hc-box"><h3>${bi('第三层：晶体管 / PVT', 'Layer 3: transistor / PVT')} ${secRef('r-12-4')}</h3>
            <p style="margin:0">${bi('亚稳态解析时间、非法 Johnson/Gray 码、delay-matching 失配、占空比、mux/gate 毛刺与 TDC 饱和判定。本报告未运行这些验证，也未给出虚构的 PVT margin。', 'Metastability resolution time, illegal Johnson/Gray codes, delay-matching mismatch, duty cycle, mux/gate glitches and TDC saturation decisions. This report did not run these and gives no invented PVT margin.')}</p></div>
        </div>
        <p class="hc-src">${bi('顺序：事件身份 → 有效性 → 局部时序 → 再比较闭环噪声与 spur（§12.5）。', 'Order: event identity → validity → local timing → then closed-loop noise and spurs (§12.5).')}</p>
      `;
      el.querySelector('[data-act="print"]').addEventListener('click', () => window.print());
    },
  });
})();
