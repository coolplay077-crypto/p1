/* Hub page: Glossary — symbols table + concept / signal & acronym lists.
 * Data: book/data/glossary.json (also used by the build for auto-linking terms in the text).
 * Entry ids: "hub-glossary-<termId>" (target of the term popover's "Glossary" link).
 */
(function () {
  'use strict';
  const PAGE = 'hub-glossary';
  const esc = Book.esc, bi = Book.bi;

  const CSS = `
.hk-hero { padding: 18px 0 4px; }
.hk-hero h1 { font-size: clamp(1.5rem, 3vw, 2.1rem); line-height: 1.25; margin: .1em 0 .35em; }
.hk-hero .lede { color: var(--fg-2); font-size: .98rem; margin: 0; }
.hk-bar { position: sticky; top: var(--top); z-index: 6; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 0; margin: 10px 0 6px; background: var(--page); border-bottom: 1px solid var(--border); }
.hk-search { flex: 1 1 220px; min-width: 0; font: inherit; font-size: .88rem; padding: 6px 10px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--fg); }
.hk-search:focus { outline: 2px solid var(--accent); outline-offset: 0; }
.hk-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.hk-chip { font: inherit; font-size: .74rem; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg-2); border-radius: 999px; padding: 2px 10px; cursor: pointer; line-height: 1.5; }
.hk-chip:hover { border-color: var(--accent); color: var(--accent-ink); }
.hk-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.hk-count { font-size: .75rem; color: var(--muted); white-space: nowrap; }
.hk-empty { padding: 24px; text-align: center; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: 12px; }
.hkg-h2 { margin: 26px 0 6px; font-size: 1.1rem; display: flex; align-items: baseline; gap: 8px; }
.hkg-h2 small { font-weight: 400; font-size: .76rem; color: var(--muted); }
.hkg-intro { margin: 0 0 8px; font-size: .84rem; color: var(--fg-2); }
.hkg-symtab td, .hkg-symtab th { font-size: .82rem; }
.hkg-symtab td:first-child { white-space: nowrap; }
.hkg-symtab .hkg-n1 { display: block; color: var(--fg); font-weight: 650; }
.hkg-symtab .hkg-n2 { display: block; font-size: .74rem; color: var(--muted); }
.hkg-symtab .hkg-d { display: block; margin-top: 3px; color: var(--fg-2); }
.hkg-symtab tr { scroll-margin-top: 72px; }
@keyframes hkg-rowflash { 0%, 40% { background: var(--mark); } 100% { background: transparent; } }
.hkg-symtab tr.hl-target td { animation: hkg-rowflash 1.8s ease; }
.hkg-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap: 10px; }
.hkg-entry { min-width: 0; overflow-wrap: anywhere; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px; scroll-margin-top: 72px; }
.hkg-entry.hl-target { animation: flash 1.8s ease; border-color: var(--accent); }
.hkg-term { font-size: .98rem; line-height: 1.4; }
.hkg-term .hkg-alt { display: block; font-size: .76rem; color: var(--muted); font-weight: 400; }
.hkg-sym { margin: 4px 0 2px; overflow-x: auto; overflow-y: hidden; font-size: .9rem; }
.hkg-def { margin: 6px 0; font-size: .85rem; line-height: 1.65; }
.hkg-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: .74rem; color: var(--fg-2); }
.hkg-meta .chip { margin: 0; }
.hkg-see a { margin-right: 6px; }
.hkg-alias { color: var(--muted); }
@media (max-width: 900px) { .hk-bar { position: static; } .hkg-entry, .hkg-symtab tr { scroll-margin-top: 8px; } }
@media (max-width: 640px) {
  .hkg-symtab thead { display: none; }
  .hkg-symtab, .hkg-symtab tbody, .hkg-symtab tr, .hkg-symtab td { display: block; width: 100%; }
  .hkg-symtab tr { padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .hkg-symtab td { border: 0; padding: 2px 0; }
  .hkg-symtab td[data-kzh]::before { content: attr(data-kzh) "："; color: var(--muted); font-size: .72rem; }
  html[data-lang="en"] .hkg-symtab td[data-ken]::before { content: attr(data-ken) ": "; }
  .hkg-symtab td[data-kzh] > div { display: inline; margin-left: 6px; }
}
@media print { .hk-bar { display: none; } .hkg-entry { break-inside: avoid; } }
`;
  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }
  const both = (o) => (o == null ? '' : typeof o === 'string' ? o : `${o.zh || ''} ${o.en || ''}`);
  const DATA = () => (Book.data.data && Book.data.data.glossary) || { terms: [] };
  const GROUPS = [
    { id: 'symbol', title: { zh: '符号', en: 'Symbols' }, intro: { zh: '第 3.1 节的统一符号，以及修正、执行、校准与粗相位中用到的量。单位按原文：相位一律以原周期（$CK_0$ 周期）计。', en: 'The unified symbols of §3.1 plus the quantities used for correction, execution, calibration and the coarse phase. Units follow the text: phases are always in raw cycles ($CK_0$ periods).' } },
    { id: 'concept', title: { zh: '核心概念', en: 'Core concepts' }, intro: { zh: '贯穿全书的关键术语。正文中首次出现时带虚线下划线，悬停可看定义。', en: 'Key terms used throughout the book. Their first occurrence in the text is underlined with a dotted line — hover to see the definition.' } },
    { id: 'signal', title: { zh: '信号与缩写', en: 'Signals & acronyms' }, intro: { zh: '电路信号名、接口字段与缩写。', en: 'Circuit signal names, interface fields and acronyms.' } },
  ];

  function rich(s) {
    return String(s == null ? '' : s).split(/(\$[^$]+\$)/).map((p) => (p.length > 2 && p[0] === '$' && p[p.length - 1] === '$' ? Book.tex(p.slice(1, -1)) : esc(p))).join('');
  }
  function secLabels(id) {
    for (const p of Book.data.nav) for (const s of p.sections) if (s.id === id) {
      const app = /^[A-Z]$/.test(s.num);
      const zh = `${app ? '附录 ' + s.num : s.num} ${s.title.zh || ''}`.trim();
      const en = `${app ? 'Appendix ' + s.num : s.num} ${s.title.en || s.title.zh || ''}`.trim();
      return { zh, en };
    }
    return { zh: id, en: id };
  }
  // equation numbers mentioned in a definition: "式 (4)", "式 13–15", "Eq. (4)"
  function eqLinks(def) {
    const ns = new Set();
    for (const m of String(def || '').matchAll(/式\s*[（(]?\s*(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?/g)) {
      const a = +m[1], b = m[2] ? +m[2] : a;
      for (let n = a; n <= b && n <= 22; n++) if (n >= 1) ns.add(n);
    }
    const target = Book.pages.has('hub-formulas') ? (n) => `#hub-formulas-eq-${n}` : (n) => `#eq-${n}`;
    return [...ns].sort((x, y) => x - y).map((n) => `<a href="${target(n)}">(${n})</a>`).join(' ');
  }
  function termName(t, lang) { return (t[lang] || t.zh || {}).term || t.id; }

  function entryHtml(t, byId) {
    const zh = t.zh || {}, en = t.en || t.zh || {};
    const sec = t.section ? secLabels(t.section) : null;
    const see = (t.see || []).filter((id) => byId.has(id)).map((id) => {
      const o = byId.get(id);
      return `<a href="#${PAGE}-${esc(id)}">${bi(esc(termName(o, 'zh')), esc(termName(o, 'en')))}</a>`;
    }).join('');
    const eqs = eqLinks(zh.def);
    const aliasesZh = (zh.aliases || []).filter((a) => a !== zh.term).slice(0, 6).map(esc).join(' · ');
    const aliasesEn = (en.aliases || []).filter((a) => a !== en.term).slice(0, 6).map(esc).join(' · ');
    return `<article class="hkg-entry" id="${PAGE}-${esc(t.id)}" data-group="${esc(t.group)}">
      <div class="hkg-term">${bi(`<b>${esc(zh.term)}</b><span class="hkg-alt">${esc(en.term)}</span>`, `<b>${esc(en.term)}</b><span class="hkg-alt">${esc(zh.term)}</span>`)}</div>
      ${t.symbol ? `<div class="hkg-sym">${Book.tex(t.symbol)}</div>` : ''}
      <p class="hkg-def">${bi(rich(zh.def), rich(en.def))}</p>
      <div class="hkg-meta">
        ${t.unit ? `<span>${bi('单位：', 'Unit: ')}${bi(esc(t.unit.zh), esc(t.unit.en))}</span>` : ''}
        ${sec ? `<a href="#${esc(t.section)}">§ ${bi(esc(sec.zh), esc(sec.en))}</a>` : ''}
        ${eqs ? `<span>${bi('公式', 'Eqs.')} ${eqs}</span>` : ''}
        ${see ? `<span class="hkg-see">${bi('参见：', 'See: ')}${see}</span>` : ''}
        ${aliasesZh || aliasesEn ? `<span class="hkg-alias">${bi(aliasesZh ? '别名：' + aliasesZh : '', aliasesEn ? 'Aliases: ' + aliasesEn : '')}</span>` : ''}
      </div>
    </article>`;
  }

  function symbolRow(t) {
    const zh = t.zh || {}, en = t.en || t.zh || {};
    const sec = t.section ? secLabels(t.section) : null;
    const eqs = eqLinks(zh.def);
    return `<tr id="${PAGE}-${esc(t.id)}" data-group="symbol">
      <td>${t.symbol ? Book.tex(t.symbol) : esc(zh.term)}</td>
      <td class="hkg-name">${bi(`<b class="hkg-n1">${esc(zh.term)}</b><span class="hkg-n2">${esc(en.term)}</span>`, `<b class="hkg-n1">${esc(en.term)}</b><span class="hkg-n2">${esc(zh.term)}</span>`)}<span class="hkg-d">${bi(rich(zh.def), rich(en.def))}</span></td>
      <td data-kzh="单位" data-ken="Unit">${t.unit ? bi(esc(t.unit.zh), esc(t.unit.en)) : '—'}</td>
      <td data-kzh="出处" data-ken="Where">${sec ? `<a href="#${esc(t.section)}">§ ${bi(esc(sec.zh.split(' ')[0]), esc(sec.en.split(' ')[0]))}</a>` : ''}${eqs ? `<div>${eqs}</div>` : ''}</td>
    </tr>`;
  }

  function haystack(t) {
    const zh = t.zh || {}, en = t.en || {};
    return [t.id, t.symbol, zh.term, en.term, (zh.aliases || []).join(' '), (en.aliases || []).join(' '), zh.def, en.def, both(t.unit), t.section].join(' ').toLowerCase();
  }

  Book.registerPage({
    id: PAGE,
    group: 'hub',
    order: 20,
    icon: 'Aα',
    title: { zh: '术语与符号表', en: 'Glossary & symbols' },
    summary: {
      zh: '统一符号（CK0、M、C、q、N、J、α、μ…）与核心概念、信号缩写的中英对照定义，每条都链接到原文出处与相关公式。',
      en: 'Unified symbols (CK0, M, C, q, N, J, α, μ…), core concepts and signal acronyms with bilingual definitions, each linked to its source section and related equations.',
    },
    render(el, api) {
      injectCss('hk-css-glossary', CSS);
      const terms = DATA().terms || [];
      const byId = new Map(terms.map((t) => [t.id, t]));
      const state = { g: 'all', q: '' };
      const count = (g) => terms.filter((t) => t.group === g).length;

      let h = `<div class="hk-hero"><div class="kicker">${bi('知识汇总 · 术语表', 'Knowledge hub · Glossary')}</div>
        <h1>${bi('术语与符号表', 'Glossary & symbols')}</h1>
        <p class="lede">${bi(`共 ${terms.length} 条：统一符号、核心概念与信号缩写。定义忠实于报告原文，并给出最相关的章节；每条都附另一种语言的术语，方便中英对照阅读。`, `${terms.length} entries: unified symbols, core concepts and signal acronyms. Definitions follow the report and point to the most relevant section; each entry also shows the term in the other language for bilingual reading.`)}</p></div>`;
      h += `<div class="hk-bar">
          <input type="search" class="hk-search" data-role="q" aria-label="filter">
          <div class="hk-chips" data-role="chips">
            <button type="button" class="hk-chip" data-g="all" aria-pressed="true">${bi('全部', 'All')} · ${terms.length}</button>
            ${GROUPS.map((g) => `<button type="button" class="hk-chip" data-g="${g.id}" aria-pressed="false">${bi(esc(g.title.zh), esc(g.title.en))} · ${count(g.id)}</button>`).join('')}
          </div>
          <span class="hk-count" data-role="count"></span>
        </div>`;
      for (const g of GROUPS) {
        const list = terms.filter((t) => t.group === g.id);
        if (!list.length) continue;
        h += `<section class="hkg-group" data-sec="${g.id}"><h2 class="hkg-h2">${bi(esc(g.title.zh), esc(g.title.en))} <small>${list.length}</small></h2><p class="hkg-intro">${bi(rich(g.intro.zh), rich(g.intro.en))}</p>`;
        if (g.id === 'symbol') {
          h += `<div class="tbl-wrap"><table class="hkg-symtab"><thead><tr><th>${bi('符号', 'Symbol')}</th><th>${bi('名称与定义', 'Name & definition')}</th><th>${bi('单位 / 范围', 'Unit / range')}</th><th>${bi('出处', 'Where')}</th></tr></thead><tbody>${list.map(symbolRow).join('')}</tbody></table></div>`;
        } else {
          h += `<div class="hkg-list">${list.map((t) => entryHtml(t, byId)).join('')}</div>`;
        }
        h += '</section>';
      }
      h += `<div class="hk-empty" data-role="empty" hidden>${bi('没有匹配的术语。', 'No matching term.')}</div>`;
      el.innerHTML = h;

      const rows = [...el.querySelectorAll('[id^="hub-glossary-"]')];
      const hay = new Map(rows.map((r) => [r, haystack(byId.get(r.id.slice(PAGE.length + 1)) || {})]));
      const q = el.querySelector('[data-role="q"]');
      const cnt = el.querySelector('[data-role="count"]');
      const setPh = () => { q.placeholder = api.t('筛选：术语、符号、别名或定义中的词…', 'Filter: term, symbol, alias or words in a definition…'); };
      setPh(); api.onLang(() => { setPh(); apply(); });

      function apply() {
        const terms_ = state.q.toLowerCase().split(/\s+/).filter(Boolean);
        let shown = 0;
        for (const r of rows) {
          const ok = (state.g === 'all' || r.dataset.group === state.g) && terms_.every((t) => hay.get(r).includes(t));
          r.hidden = !ok; if (ok) shown++;
        }
        el.querySelectorAll('.hkg-group').forEach((s) => { s.hidden = !s.querySelector('[id^="hub-glossary-"]:not([hidden])'); });
        el.querySelector('[data-role="empty"]').hidden = shown > 0;
        cnt.textContent = api.t(`显示 ${shown} / ${rows.length}`, `Showing ${shown} / ${rows.length}`);
        el.querySelectorAll('[data-g]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === state.g)));
      }
      q.addEventListener('input', () => { state.q = q.value.trim(); apply(); });
      el.querySelector('[data-role="chips"]').addEventListener('click', (e) => {
        const b = e.target.closest('[data-g]'); if (!b) return;
        state.g = b.dataset.g; apply();
      });
      function focusFromHash() {
        const id = decodeURIComponent(Book.hash().slice(1));
        if (!id.startsWith(PAGE + '-')) return;
        const row = document.getElementById(id);
        if (!row) return;
        if (row.hidden) { state.g = 'all'; state.q = ''; q.value = ''; apply(); }
        row.classList.remove('hl-target'); void row.offsetWidth; row.classList.add('hl-target');
      }
      window.addEventListener('hashchange', focusFromHash);
      apply();
      focusFromHash();
    },
    search() {
      return (DATA().terms || []).map((t) => {
        const zh = t.zh || {}, en = t.en || t.zh || {};
        return {
          target: `#${PAGE}-${t.id}`,
          kind: 'term',
          title: { zh: zh.term, en: en.term },
          // each language also carries the other language's term + aliases, so "blind spot" finds 低位盲区 in Chinese mode
          text: { zh: `${en.term} ${(zh.aliases || []).join(' ')} ${(en.aliases || []).join(' ')} ${zh.def || ''}`, en: `${zh.term} ${(en.aliases || []).join(' ')} ${(zh.aliases || []).join(' ')} ${en.def || ''}` },
        };
      });
    },
  });
})();
