/* Hub page: Formula atlas — one card per numbered equation (1)–(22) of the report.
 * Data: book/data/formulas.json (tex copied verbatim from the report).
 * Card ids: "hub-formulas-eq-N" (target of the equation toolbar's "Derivation" button).
 */
(function () {
  'use strict';
  const PAGE = 'hub-formulas';
  const esc = Book.esc, bi = Book.bi;

  const CSS = `
.hk-hero { padding: 18px 0 4px; }
.hk-hero h1 { font-size: clamp(1.5rem, 3vw, 2.1rem); line-height: 1.25; margin: .1em 0 .35em; }
.hk-hero .lede { color: var(--fg-2); font-size: .98rem; margin: 0; }
.hk-bar { position: sticky; top: var(--top); z-index: 6; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 0; margin: 10px 0 6px; background: var(--page); border-bottom: 1px solid var(--border); }
.hk-search { flex: 1 1 220px; min-width: 0; font: inherit; font-size: .88rem; padding: 6px 10px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--fg); }
.hk-search:focus { outline: 2px solid var(--accent); outline-offset: 0; }
.hk-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.hk-chip { font: inherit; font-size: .74rem; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg-2); border-radius: 999px; padding: 2px 10px; cursor: pointer; line-height: 1.5; }
.hk-chip:hover { border-color: var(--accent); color: var(--accent-ink); }
.hk-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.hk-count { font-size: .75rem; color: var(--muted); white-space: nowrap; }
.hk-empty { padding: 24px; text-align: center; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: 12px; }
.hkf-mapbox { margin: 14px 0 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.hkf-mapbox > summary { cursor: pointer; padding: 6px 12px; font-size: .8rem; font-weight: 650; color: var(--fg-2); }
.hkf-map { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 0 12px; padding: 2px 12px 10px; }
.hkf-map a { display: block; font-size: .76rem; line-height: 1.9; color: var(--fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hkf-map a b { color: var(--accent-ink); font-variant-numeric: tabular-nums; margin-right: 4px; }
.hkf-map a:hover { color: var(--fg); }
.hkf-map a.off { opacity: .35; }
.hkf-ch { margin: 26px 0 8px; font-size: 1.02rem; color: var(--fg-2); display: flex; align-items: baseline; gap: 8px; }
.hkf-ch small { font-weight: 400; color: var(--muted); font-size: .78rem; }
.hkf-card { position: relative; margin: 12px 0 18px; padding: 14px 16px 12px; background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 12px; scroll-margin-top: 96px; overflow-wrap: anywhere; }
.hkf-card.hl-target { animation: flash 1.8s ease; }
.hkf-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.hkf-num { font-weight: 700; color: var(--accent-ink); font-variant-numeric: tabular-nums; }
.hkf-title { margin: 0; font-size: 1.02rem; flex: 1 1 260px; line-height: 1.4; }
.hkf-origin { font-size: .7rem; color: var(--fg-2); background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; white-space: nowrap; }
.hkf-eq { margin: 10px 0 6px; padding: 6px 10px; background: var(--surface-2); border-radius: 8px; overflow-x: auto; overflow-y: hidden; }
.hkf-eq .katex-display { margin: .35em 0; }
.hkf-eq .katex-display + .katex-display { margin-top: -.1em; }
.hkf-eq .hkf-ctx { opacity: .72; }
.hkf-meaning { margin: 8px 0; font-size: .92rem; }
.hkf-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 4px 18px; }
.hkf-card h4 { margin: 10px 0 4px; font-size: .74rem; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.hkf-vars { width: 100%; border-collapse: collapse; font-size: .82rem; }
.hkf-vars td { padding: 3px 6px 3px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
.hkf-vars tr:last-child td { border-bottom: 0; }
.hkf-vars td:first-child { white-space: nowrap; padding-right: 10px; }
.hkf-vars tbody tr:hover td { background: none; }
.hkf-assume { font-size: .84rem; color: var(--fg-2); margin: 0; }
.hkf-deriv { margin: 10px 0 6px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
.hkf-deriv > summary { cursor: pointer; padding: 6px 12px; font-size: .84rem; font-weight: 600; color: var(--accent-ink); list-style-position: inside; }
.hkf-deriv[open] > summary { border-bottom: 1px solid var(--border); }
.hkf-deriv ol { margin: 8px 0 6px; padding-left: 1.8em; font-size: .86rem; }
.hkf-deriv li { margin: 4px 0 8px; }
.hkf-deriv .hkf-step-eq { overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
.hkf-deriv .hkf-step-eq .katex-display { margin: .3em 0; text-align: left; }
.hkf-deriv .hkf-step-eq .katex-display > .katex { text-align: left; }
.hkf-tbl { margin: 8px 0; }
.hkf-tbl table { font-size: .8rem; }
.hkf-tbl th { white-space: normal; }
.hk-pit { margin: 8px 0 4px; padding: 7px 12px; font-size: .84rem; border-radius: 8px; background: color-mix(in srgb, var(--warning) 12%, var(--surface)); border-left: 3px solid var(--warning); }
.hk-pit b { color: var(--fg); }
.hkf-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: .78rem; }
.hkf-links .w-btn { font-size: .72rem; padding: 2px 9px; }
.hkf-check { font-size: .7rem; padding: 0 8px; border-radius: 999px; border: 1px solid currentColor; color: var(--good-ink); white-space: nowrap; }
@media (max-width: 700px) {
  .hkf-grid { grid-template-columns: minmax(0, 1fr); }
  .hkf-card { padding: 12px 12px 10px; scroll-margin-top: 8px; }
}
@media (max-width: 900px) { .hk-bar { position: static; } }
@media print { .hk-bar, .hkf-map { display: none; } .hkf-card { break-inside: avoid; } }
`;
  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }

  // escape + inline $math$ + `code`
  function rich(s) {
    return String(s == null ? '' : s).split(/(\$[^$]+\$|`[^`]+`)/).map((p) => {
      if (p.length > 2 && p[0] === '$' && p[p.length - 1] === '$') return Book.tex(p.slice(1, -1));
      if (p.length > 2 && p[0] === '`' && p[p.length - 1] === '`') return `<code>${esc(p.slice(1, -1))}</code>`;
      return esc(p);
    }).join('');
  }
  const biR = (o) => (o == null ? '' : typeof o === 'string' ? rich(o) : bi(rich(o.zh), rich(o.en)));
  const plain = (s) => String(s == null ? '' : s).replace(/\$([^$]+)\$/g, '$1').replace(/`/g, '').replace(/\\(mathrm|operatorname|widehat|qquad|quad|left|right|lfloor|rfloor)/g, ' ').replace(/[{}\\]/g, ' ').replace(/\s+/g, ' ');
  const untag = (t) => String(t).replace(/\s*\\tag\{[^}]*\}/, '');
  const both = (o) => (o == null ? '' : typeof o === 'string' ? o : `${o.zh || ''} ${o.en || ''}`);

  const DATA = () => (Book.data.data && Book.data.data.formulas) || { items: [], chapters: {} };
  const widgetMapIds = () => new Set(Object.values((Book.data.data && Book.data.data['widget-map']) || {}).flat());

  function secInfo(id) {
    for (const p of Book.data.nav) for (const s of p.sections) if (s.id === id) return s;
    return null;
  }
  function secBi(id) {
    const s = secInfo(id);
    if (!s) return esc(id);
    const num = /^[A-Z]$/.test(s.num) ? null : s.num;
    const zh = (num ? num + ' ' : (/^[A-Z]$/.test(s.num) ? '附录 ' + s.num + ' ' : '')) + (s.title.zh || '');
    const en = (num ? num + ' ' : (/^[A-Z]$/.test(s.num) ? 'Appendix ' + s.num + ' ' : '')) + (s.title.en || s.title.zh || '');
    return bi(esc(zh), esc(en));
  }
  function widgetLinks(f) {
    const placed = widgetMapIds();
    const ids = new Set(f.widgets || []);
    for (const w of Book.widgets.values()) if ((w.eqs || []).map(String).includes(String(f.n))) ids.add(w.id);
    return [...ids].filter((id) => Book.widgets.has(id) || placed.has(id)).map((id) => {
      const w = Book.widgets.get(id);
      const t = w && w.title ? bi(esc(w.title.zh), esc(w.title.en || w.title.zh)) : esc(id);
      return `<a href="#w-${esc(id)}">▶ ${t}</a>`;
    }).join('');
  }

  function cardHtml(f) {
    const vars = (f.vars || []).map((v) => `<tr><td>${Book.tex(v.sym)}</td><td>${bi(rich(v.zh), rich(v.en))}</td></tr>`).join('');
    const steps = (f.derivation || []).map((st) => `<li>${bi(rich(st.zh), rich(st.en))}${st.tex ? `<div class="hkf-step-eq">${Book.tex(st.tex, true)}</div>` : ''}</li>`).join('');
    let table = '';
    if (f.table) {
      table = `<div class="tbl-wrap hkf-tbl"><table><thead><tr>${f.table.head.map((h) => `<th>${biR(h)}</th>`).join('')}</tr></thead><tbody>${f.table.rows.map((r) => `<tr>${r.map((c) => `<td>${biR(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    const placed = widgetMapIds();
    const checks = (f.checks || []).map((c) => {
      const href = Book.widgets.has('verify-runner') || placed.has('verify-runner') ? '#w-verify-runner' : '#r-12-1';
      return `<a class="hkf-check" href="${href}" title="${esc(c)}">✓ ${esc(c)}</a>`;
    }).join('');
    const nSteps = (f.derivation || []).length;
    return `<article class="hkf-card" id="${PAGE}-eq-${esc(f.n)}" data-n="${esc(f.n)}" data-ch="${esc(f.chapter)}">
      <header class="hkf-head">
        <span class="hkf-num">(${esc(f.n)})</span>
        <h3 class="hkf-title">${biR(f.title)}</h3>
        <span class="hkf-origin">${biR(f.origin)}</span>
      </header>
      <div class="hkf-eq">${f.context ? `<div class="hkf-ctx">${Book.tex(f.context, true)}</div>` : ''}${untag(f.tex).split(/\\qquad|\\quad\s*\n/).map((part) => Book.tex(part.trim(), true)).join('')}</div>
      <p class="hkf-meaning">${biR(f.meaning)}</p>
      <div class="hkf-grid">
        <div><h4>${bi('变量', 'Variables')}</h4><table class="hkf-vars"><tbody>${vars}</tbody></table></div>
        <div><h4>${bi('适用条件 / 假设', 'Validity / assumptions')}</h4><p class="hkf-assume">${biR(f.assumptions)}</p></div>
      </div>
      <details class="hkf-deriv"><summary>${bi(`逐步推导（${nSteps} 步）`, `Step-by-step derivation (${nSteps} steps)`)}</summary><ol>${steps}</ol></details>
      ${table}
      <div class="hk-pit"><b>⚠ ${bi('常见陷阱', 'Pitfalls')}：</b>${biR(f.pitfalls)}</div>
      <footer class="hkf-links">
        <a href="#eq-${esc(f.n)}">↗ ${bi(`正文中的式 (${esc(f.n)})`, `Eq. (${esc(f.n)}) in the text`)}</a>
        <a href="#${esc(f.section)}">§ ${secBi(f.section)}</a>
        ${widgetLinks(f)}
        ${checks}
        <button type="button" class="w-btn" data-copytex="${esc(f.n)}">${bi('复制 LaTeX', 'Copy LaTeX')}</button>
      </footer>
    </article>`;
  }

  function haystack(f) {
    const parts = [f.n, f.tex, f.context, both(f.title), both(f.meaning), both(f.assumptions), both(f.pitfalls), both(f.origin), f.section]
      .concat((f.vars || []).map((v) => `${v.sym} ${v.zh} ${v.en}`))
      .concat((f.derivation || []).map((s) => `${s.zh} ${s.en} ${s.tex || ''}`))
      .concat(f.checks || []).concat(f.widgets || []);
    return plain(parts.join(' ')).toLowerCase();
  }

  Book.registerPage({
    id: PAGE,
    group: 'hub',
    order: 10,
    icon: '∑',
    title: { zh: '公式图谱', en: 'Formula atlas' },
    summary: {
      zh: '22 个编号公式逐一成卡：含义、变量、适用条件、逐步推导、常见陷阱、来源性质，以及到正文和交互模型的链接。',
      en: 'All 22 numbered equations as cards: meaning, variables, validity, step-by-step derivation, pitfalls, origin, and links to the text and interactive models.',
    },
    render(el, api) {
      injectCss('hk-css-formulas', CSS);
      const D = DATA();
      const items = D.items || [];
      const chapters = D.chapters || {};
      const chOrder = [...new Set(items.map((f) => f.chapter))];
      const state = { ch: 'all', q: '' };

      let h = `<div class="hk-hero"><div class="kicker">${bi('知识汇总 · 公式图谱', 'Knowledge hub · Formula atlas')}</div>
        <h1>${bi('22 个编号公式：含义、推导与陷阱', 'The 22 numbered equations: meaning, derivation, pitfalls')}</h1>
        <p class="lede">${bi('每张卡片对应报告中的一个编号公式（LaTeX 与原文逐字一致）。“定义”只是坐标约定，不是电路正确性的证明；“推导”标注为本报告的推导（D）；引自专利的公式标明来源。展开“逐步推导”查看每一步的理由。',
        'Each card is one numbered equation of the report (LaTeX identical to the source). A “definition” is only a coordinate convention, not a proof of circuit correctness; derivations are marked as the report’s own (D); equations quoted from patents name their source. Open “Step-by-step derivation” to see the reasoning for every step.')}</p></div>`;
      const narrow = window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
      h += `<details class="hkf-mapbox"${narrow ? '' : ' open'}><summary>${bi(`公式索引 · ${items.length}`, `Equation index · ${items.length}`)}</summary><nav class="hkf-map" aria-label="equations">${items.map((f) => `<a href="#${PAGE}-eq-${esc(f.n)}" data-mini="${esc(f.n)}" title="(${esc(f.n)}) ${esc(plain(f.title.zh))} / ${esc(plain(f.title.en))}"><b>(${esc(f.n)})</b>${biR(f.title)}</a>`).join('')}</nav></details>`;
      h += `<div class="hk-bar">
          <input type="search" class="hk-search" data-role="q" aria-label="filter">
          <div class="hk-chips" data-role="chips">
            <button type="button" class="hk-chip" data-ch="all" aria-pressed="true">${bi('全部', 'All')} · ${items.length}</button>
            ${chOrder.map((c) => `<button type="button" class="hk-chip" data-ch="${esc(c)}" aria-pressed="false" title="${esc(both(chapters[c]))}">${bi(`第 ${esc(c)} 章`, `Ch. ${esc(c)}`)} · ${items.filter((f) => f.chapter === c).length}</button>`).join('')}
          </div>
          <button type="button" class="w-btn" data-role="expand">${bi('展开全部推导', 'Expand all derivations')}</button>
          <span class="hk-count" data-role="count"></span>
        </div>`;
      for (const c of chOrder) {
        h += `<section class="hkf-group" data-group="${esc(c)}"><h2 class="hkf-ch">${biR(chapters[c] || { zh: '第 ' + c + ' 章', en: 'Ch. ' + c })} <small>${bi(`式 (${items.filter((f) => f.chapter === c).map((f) => f.n).join(', ')})`, `Eqs. (${items.filter((f) => f.chapter === c).map((f) => f.n).join(', ')})`)}</small></h2>`;
        h += items.filter((f) => f.chapter === c).map(cardHtml).join('');
        h += '</section>';
      }
      h += `<div class="hk-empty" data-role="empty" hidden>${bi('没有匹配的公式。试试符号（如 “kappa”、“mu”）或中文关键词。', 'No matching equation. Try a symbol (e.g. “kappa”, “mu”) or another keyword.')}</div>`;
      el.innerHTML = h;

      const cards = [...el.querySelectorAll('.hkf-card')];
      const hay = new Map(cards.map((c) => [c, haystack(items.find((f) => f.n === c.dataset.n))]));
      const q = el.querySelector('[data-role="q"]');
      const count = el.querySelector('[data-role="count"]');
      const setPh = () => { q.placeholder = api.t('筛选：关键词、符号、LaTeX…', 'Filter: keyword, symbol, LaTeX…'); };
      setPh(); api.onLang(() => { setPh(); apply(); });

      function apply() {
        const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
        let shown = 0;
        for (const c of cards) {
          const ok = (state.ch === 'all' || c.dataset.ch === state.ch) && terms.every((t) => hay.get(c).includes(t));
          c.hidden = !ok; if (ok) shown++;
          const mini = el.querySelector(`[data-mini="${c.dataset.n}"]`);
          if (mini) mini.classList.toggle('off', !ok);
        }
        el.querySelectorAll('.hkf-group').forEach((g) => { g.hidden = !g.querySelector('.hkf-card:not([hidden])'); });
        el.querySelector('[data-role="empty"]').hidden = shown > 0;
        count.textContent = api.t(`显示 ${shown} / ${cards.length}`, `Showing ${shown} / ${cards.length}`);
        el.querySelectorAll('[data-ch]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ch === state.ch)));
      }
      q.addEventListener('input', () => { state.q = q.value.trim(); apply(); });
      el.querySelector('[data-role="chips"]').addEventListener('click', (e) => {
        const b = e.target.closest('[data-ch]'); if (!b) return;
        state.ch = b.dataset.ch; apply();
      });
      const expandBtn = el.querySelector('[data-role="expand"]');
      let allOpen = false;
      expandBtn.addEventListener('click', () => {
        allOpen = !allOpen;
        el.querySelectorAll('.hkf-deriv').forEach((d) => { d.open = allOpen; });
        expandBtn.innerHTML = allOpen ? bi('收起全部推导', 'Collapse all derivations') : bi('展开全部推导', 'Expand all derivations');
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-copytex]');
        if (!b) return;
        const f = items.find((x) => x.n === b.dataset.copytex);
        if (f) Book.copy(f.tex);
      });
      window.addEventListener('beforeprint', () => el.querySelectorAll('.hkf-deriv').forEach((d) => { d.open = true; }));

      // deep links: #hub-formulas-eq-N opens the derivation and flashes the card
      function focusFromHash() {
        const m = decodeURIComponent(Book.hash().slice(1)).match(/^hub-formulas-eq-(\d+)$/);
        if (!m) return;
        const card = document.getElementById(`${PAGE}-eq-${m[1]}`);
        if (!card) return;
        if (card.hidden) { state.ch = 'all'; state.q = ''; q.value = ''; apply(); }
        const d = card.querySelector('.hkf-deriv'); if (d) d.open = true;
        card.classList.remove('hl-target'); void card.offsetWidth; card.classList.add('hl-target');
      }
      window.addEventListener('hashchange', focusFromHash);
      apply();
      focusFromHash();
    },
    search() {
      const items = DATA().items || [];
      return items.map((f) => ({
        target: `#${PAGE}-eq-${f.n}`,
        kind: 'eq',
        title: { zh: `式 (${f.n}) ${plain(f.title.zh)}`, en: `Eq. (${f.n}) ${plain(f.title.en)}` },
        text: {
          zh: plain(`${f.title.en} ${f.meaning.zh} ${f.tex} ${(f.vars || []).map((v) => v.zh).join('；')} ${f.pitfalls.zh}`),
          en: plain(`${f.title.zh} ${f.meaning.en} ${f.tex} ${(f.vars || []).map((v) => v.en).join('; ')} ${f.pitfalls.en}`),
        },
      }));
    },
  });
})();
