/* Hub page: Evidence explorer — evidence levels (§2.3), the three complementary method classes (Ch.5),
 * reference cards R01–R19 / H01–H02 (Ch.4, Ch.14, Appendix A/B) and the Ch.5 cross-source matrix.
 * Data: book/data/references.json. Card ids: "hub-evidence-<Rxx|Hxx>".
 */
(function () {
  'use strict';
  const PAGE = 'hub-evidence';
  const esc = Book.esc, bi = Book.bi;

  const CSS = `
.hk-hero { padding: 18px 0 4px; }
.hk-hero h1 { font-size: clamp(1.5rem, 3vw, 2.1rem); line-height: 1.25; margin: .1em 0 .35em; }
.hk-hero .lede { color: var(--fg-2); font-size: .98rem; margin: 0; }
.hk-bar { position: sticky; top: var(--top); z-index: 6; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 0; margin: 10px 0 6px; background: var(--page); border-bottom: 1px solid var(--border); }
.hk-search { flex: 1 1 200px; min-width: 0; font: inherit; font-size: .88rem; padding: 6px 10px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--fg); }
.hk-search:focus { outline: 2px solid var(--accent); outline-offset: 0; }
.hk-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.hk-chips > .hk-lab { font-size: .72rem; color: var(--muted); margin-right: 2px; }
.hk-chip { font: inherit; font-size: .74rem; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg-2); border-radius: 999px; padding: 2px 10px; cursor: pointer; line-height: 1.5; }
.hk-chip:hover { border-color: var(--accent); color: var(--accent-ink); }
.hk-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.hk-count { font-size: .75rem; color: var(--muted); white-space: nowrap; }
.hk-empty { padding: 24px; text-align: center; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: 12px; }
.hke-h2 { margin: 28px 0 8px; font-size: 1.1rem; }
.hke-levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 10px; }
.hke-level { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; font-size: .8rem; }
.hke-level .badge { font-size: .8rem; }
.hke-level h4 { margin: 6px 0 4px; font-size: .86rem; }
.hke-level p { margin: 3px 0; color: var(--fg-2); line-height: 1.55; }
.hke-level .hke-n { float: right; font-size: .72rem; color: var(--muted); }
.hke-rule { margin: 12px 0 4px; padding: 10px 14px; border-radius: 10px; border-left: 3px solid var(--accent); background: var(--accent-wash); font-size: .88rem; }
.hke-classes { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 10px; }
.hke-class { background: var(--surface); border: 1px solid var(--border); border-top: 4px solid var(--c); border-radius: 12px; padding: 10px 12px; font-size: .82rem; }
.hke-class h4 { margin: 0 0 4px; font-size: .9rem; }
.hke-class p { margin: 0 0 6px; color: var(--fg-2); }
.hke-class a.chip { color: var(--fg); }
.hke-gap { margin: 12px 0; padding: 10px 14px; border-radius: 10px; border-left: 3px solid var(--warning); background: color-mix(in srgb, var(--warning) 11%, var(--surface)); font-size: .86rem; }
.hke-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--c, var(--muted)); vertical-align: middle; margin-right: 4px; }
.hke-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.hke-card { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--c, var(--border-strong)); border-radius: 12px; padding: 12px 16px; scroll-margin-top: 104px; font-size: .86rem; min-width: 0; overflow-wrap: anywhere; }
.hke-card.hl-target { animation: flash 1.8s ease; }
.hke-card-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.hke-id { font-weight: 750; color: var(--accent-ink); font-variant-numeric: tabular-nums; }
.hke-short { font-weight: 650; font-size: .98rem; flex: 1 1 220px; }
.hke-title { margin: 4px 0 2px; font-style: italic; }
.hke-src { color: var(--fg-2); font-size: .8rem; margin: 0 0 6px; }
.hke-focus { margin: 6px 0; }
.hke-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; margin: 8px 0; }
.hke-two > div { padding: 8px 10px; border-radius: 8px; background: var(--surface-2); }
.hke-two h5, .hke-card h5 { margin: 0 0 3px; font-size: .7rem; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.hke-two .hke-lim { background: color-mix(in srgb, var(--warning) 10%, var(--surface)); }
.hke-mrow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin: 8px 0; }
.hke-mrow > div { padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; font-size: .78rem; }
.hke-mrow > div.miss { border-color: var(--warning); background: color-mix(in srgb, var(--warning) 12%, var(--surface)); font-weight: 600; }
.hke-figs { margin: 6px 0; padding-left: 1.2em; }
.hke-figs li { margin: 2px 0; }
.hke-foot { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--border); font-size: .76rem; }
.hke-note { font-size: .78rem; color: var(--fg-2); margin: 4px 0; }
.hke-matrix table { font-size: .8rem; }
.hke-matrix th.miss { background: color-mix(in srgb, var(--warning) 22%, var(--surface-2)); }
.hke-matrix td.miss { background: color-mix(in srgb, var(--warning) 10%, var(--surface)); font-weight: 600; }
.hke-matrix td.src { white-space: nowrap; }
.hke-matrix td.src a { font-weight: 650; }
.hke-matrix th { white-space: normal; }
.hke-view { margin-left: auto; }
@media (max-width: 900px) { .hk-bar { position: static; } .hke-card { scroll-margin-top: 8px; } }
@media (max-width: 760px) {
  .hke-two { grid-template-columns: minmax(0, 1fr); }
  .hke-mrow { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .hke-view { margin-left: 0; }
}
@media (max-width: 640px) {
  .hke-matrix thead { display: none; }
  .hke-matrix table, .hke-matrix tbody, .hke-matrix tr, .hke-matrix td { display: block; width: 100%; }
  .hke-matrix tr { padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .hke-matrix td { border: 0; padding: 2px 0; }
  .hke-matrix td[data-kzh]::before { content: attr(data-kzh) "："; color: var(--muted); font-size: .72rem; font-weight: 400; }
  html[data-lang="en"] .hke-matrix td[data-ken]::before { content: attr(data-ken) ": "; }
}
@media print { .hk-bar { display: none; } .hke-card { break-inside: avoid; } }
`;
  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }
  const biO = (o) => (o == null ? '' : typeof o === 'string' ? esc(o) : bi(esc(o.zh || o.en || ''), esc(o.en || o.zh || '')));
  const both = (o) => (o == null ? '' : typeof o === 'string' ? o : `${o.zh || ''} ${o.en || ''}`);
  const DATA = () => (Book.data.data && Book.data.data.references) || { items: [] };
  const lvlCss = (lv) => 'lvl-' + String(lv || '').split('/')[0].trim().replace('-', '');
  const baseLevel = (lv) => String(lv || '').split('/')[0].trim();

  function secLabels(id) {
    for (const p of Book.data.nav) for (const s of p.sections) if (s.id === id) {
      const app = /^[A-Z]$/.test(s.num);
      return { zh: app ? '附录 ' + s.num : '§' + s.num, en: app ? 'Appendix ' + s.num : '§' + s.num, tzh: s.title.zh || '', ten: s.title.en || s.title.zh || '' };
    }
    return { zh: id, en: id, tzh: '', ten: '' };
  }

  function cardHtml(r, D) {
    const cls = (D.classes || []).find((c) => c.id === r.class);
    const cols = D.matrixColumns || {};
    const secs = (r.sections || []).map((s) => { const l = secLabels(s); return `<a href="#${esc(s)}" title="${esc(l.tzh)}">${bi(esc(l.zh), esc(l.en))}</a>`; }).join(' · ');
    const links = (r.links || []).map((l) => `<a class="ext" href="${esc(l.url)}" target="_blank" rel="noopener">${biO(l.label)}</a>`).join(' · ');
    const figs = (r.figures || []).map((f) => `<li><b>${esc(f.where)}</b> — ${biO(f.check)}</li>`).join('');
    const mrow = r.matrix ? `<h5>${bi('第 5 章证据矩阵', 'Ch. 5 evidence matrix')}</h5><div class="hke-mrow">${['split', 'consistency', 'selection', 'missing'].map((k) => `<div class="${k === 'missing' ? 'miss' : ''}"><h5>${k === 'missing' ? '⚠ ' : ''}${biO(cols[k])}</h5>${biO(r.matrix[k])}</div>`).join('')}</div>` : '';
    const meta = [r.authors, r.venue].filter(Boolean).map(esc).join(' · ');
    return `<article class="hke-card" id="${PAGE}-${esc(r.id)}" data-level="${esc(baseLevel(r.level))}" data-class="${esc(r.class || 'none')}" style="--c:${cls ? cls.color : 'var(--border-strong)'}">
      <div class="hke-card-h">
        <span class="hke-id">[${esc(r.id)}]</span>
        <span class="hke-short">${biO(r.short)}</span>
        <span class="badge ${lvlCss(r.level)}" title="${esc(both(r.levelNote))}">${esc(r.level)}</span>
        <span class="chip">${biO(r.kind)}</span>
        ${r.year ? `<span class="chip">${esc(r.year)}</span>` : ''}
        ${cls ? `<span class="chip"><i class="hke-dot"></i>${biO(cls.name)}</span>` : ''}
      </div>
      <div class="hke-title">${esc(r.title)}</div>
      ${meta ? `<p class="hke-src">${meta}</p>` : ''}
      ${r.levelNote ? `<p class="hke-note">${bi('等级说明：', 'Level note: ')}${biO(r.levelNote)}</p>` : ''}
      <p class="hke-focus"><b>${bi('核对重点', 'What to look at')}：</b>${biO(r.focus)}</p>
      <div class="hke-two">
        <div><h5>${bi('证据价值', 'Evidence value')}</h5>${biO(r.role)}</div>
        <div class="hke-lim"><h5>${bi('边界 / 不能推出', 'Limits / does not prove')}</h5>${biO(r.limits)}</div>
      </div>
      ${mrow}
      ${figs ? `<h5>${bi('原图定位（附录 A）', 'Figure locations (Appendix A)')}</h5><ul class="hke-figs">${figs}</ul>` : ''}
      ${r.note ? `<p class="hke-note">ⓘ ${biO(r.note)}</p>` : ''}
      <div class="hke-foot">
        ${secs ? `<span>${bi('正文：', 'In the text: ')}${secs}</span>` : ''}
        <a href="#ref-${esc(r.id)}">${bi('第 14 章条目', 'Ch. 14 entry')}</a>
        ${links ? `<span>${bi('原文入口：', 'Sources: ')}${links}</span>` : `<span class="muted">${bi('第 14 章未给出可访问链接', 'No accessible link given in Ch. 14')}</span>`}
      </div>
    </article>`;
  }

  function matrixHtml(D, byId) {
    const cols = D.matrixColumns || {};
    const rows = (D.matrixOrder || []).map((id) => byId.get(id)).filter((r) => r && r.matrix);
    const head = `<tr><th>${bi('来源', 'Source')}</th><th>${biO(cols.split)}</th><th>${biO(cols.consistency)}</th><th>${biO(cols.selection)}</th><th class="miss">⚠ ${biO(cols.missing)}</th></tr>`;
    const body = rows.map((r) => {
      const cls = (D.classes || []).find((c) => c.id === r.class);
      return `<tr data-ref="${esc(r.id)}" data-level="${esc(baseLevel(r.level))}" data-class="${esc(r.class || 'none')}">
        <td class="src" style="--c:${cls ? cls.color : 'var(--muted)'}"><i class="hke-dot"></i><a href="#${PAGE}-${esc(r.id)}" data-goto="${esc(r.id)}">${esc(r.tag)} [${esc(r.id)}]</a> <span class="badge ${lvlCss(r.level)}">${esc(r.level)}</span></td>
        <td data-kzh="${esc(cols.split.zh)}" data-ken="${esc(cols.split.en)}">${biO(r.matrix.split)}</td>
        <td data-kzh="${esc(cols.consistency.zh)}" data-ken="${esc(cols.consistency.en)}">${biO(r.matrix.consistency)}</td>
        <td data-kzh="${esc(cols.selection.zh)}" data-ken="${esc(cols.selection.en)}">${biO(r.matrix.selection)}</td>
        <td class="miss" data-kzh="⚠ ${esc(cols.missing.zh)}" data-ken="⚠ ${esc(cols.missing.en)}">${biO(r.matrix.missing)}</td>
      </tr>`;
    }).join('');
    const legend = (D.classes || []).map((c) => `<span style="--c:${c.color}"><i class="hke-dot"></i>${biO(c.name)}</span>`).join(' &nbsp; ');
    const hasW = Book.widgets.has('evidence-matrix') || Object.values((Book.data.data && Book.data.data['widget-map']) || {}).flat().includes('evidence-matrix');
    return `<div class="hke-matrix"><p class="hke-note">${legend}</p><div class="tbl-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <p class="hke-note">${biO(D.classNote)}</p>
      ${hasW ? `<p class="hke-note"><a href="#w-evidence-matrix">▶ ${bi('交互版：按问题高亮与“拼装检验”（第 5 章）', 'Interactive version: question-driven highlighting and an “assembly check” (Ch. 5)')}</a></p>` : ''}</div>`;
  }

  function haystack(r) {
    return [r.id, r.tag, both(r.short), r.title, r.authors, r.venue, r.year, both(r.kind), r.level, both(r.levelNote), both(r.focus), both(r.role), both(r.limits), both(r.note),
      r.matrix ? Object.values(r.matrix).map(both).join(' ') : '', (r.figures || []).map((f) => f.where + ' ' + both(f.check)).join(' '), (r.links || []).map((l) => l.label + ' ' + l.url).join(' ')].join(' ').toLowerCase();
  }

  Book.registerPage({
    id: PAGE,
    group: 'hub',
    order: 30,
    icon: '⚖',
    title: { zh: '文献证据库', en: 'Evidence explorer' },
    summary: {
      zh: '按证据等级与方法类别筛选 R01–R19、H01–H02：每篇的证据价值与边界、原图定位、原文链接，以及第 5 章跨文献证据矩阵（突出“仍缺少什么”）。',
      en: 'Filter R01–R19 and H01–H02 by evidence level and method class: what each source proves and where it stops, figure locations, source links, and the Ch. 5 cross-source matrix (highlighting what is still missing).',
    },
    render(el, api) {
      injectCss('hk-css-evidence', CSS);
      const D = DATA();
      const items = D.items || [];
      const byId = new Map(items.map((r) => [r.id, r]));
      const state = { view: 'cards', lv: 'all', cl: 'all', q: '' };
      const levels = D.levels || [];

      let h = `<div class="hk-hero"><div class="kicker">${bi('知识汇总 · 文献证据库', 'Knowledge hub · Evidence explorer')}</div>
        <h1>${bi('文献证据：价值与边界', 'Literature evidence: value and limits')}</h1>
        <p class="lede">${bi('报告按“能证明什么、不能推出什么”逐篇整理文献。这里可以按证据等级和方法类别筛选，并以第 5 章的矩阵对照每篇对本目标“仍缺少什么”。', 'The report reviews each source by what it proves and what it cannot be stretched to prove. Filter by evidence level and method class here, and use the Ch. 5 matrix to see what each source still lacks for the target.')}</p></div>`;

      h += `<h2 class="hke-h2">${bi('证据等级（§2.3）', 'Evidence levels (§2.3)')}</h2><div class="hke-levels">${levels.map((lv) => {
        const n = items.filter((r) => baseLevel(r.level) === lv.id).length;
        return `<div class="hke-level"><span class="hke-n">${lv.id === 'D' ? bi('用于公式/推导', 'used for derivations') : bi(`${n} 条`, `${n} item${n === 1 ? '' : 's'}`)}</span><span class="badge ${esc(lv.css)}">${esc(lv.id)}</span><h4>${biO({ zh: String(lv.name.zh).replace(/^.*?·\s*/, ''), en: String(lv.name.en).replace(/^.*?·\s*/, '') })}</h4><p>${biO(lv.meaning)}</p><p><b>${bi('使用规则：', 'Rule: ')}</b>${biO(lv.rule)}</p></div>`;
      }).join('')}</div>
      <div class="hke-rule">⚖ ${biO(D.levelRule)}</div>`;

      h += `<h2 class="hke-h2">${bi('三类相互补充的方法（第 5 章）', 'Three complementary kinds of method (Ch. 5)')}</h2><div class="hke-classes">${(D.classes || []).map((c) => `<div class="hke-class" style="--c:${c.color}"><h4>${biO(c.name)}</h4><p>${biO(c.desc)}</p>${c.members.map((id) => { const r = byId.get(id); return r ? `<a class="chip" href="#${PAGE}-${esc(id)}" data-goto="${esc(id)}">${esc(r.tag)} [${esc(id)}]</a>` : ''; }).join('')}</div>`).join('')}</div>
      <div class="hke-gap">⚠ ${biO(D.gap)}</div>`;

      const lvIds = ['A-P', 'A-J', 'B', 'H'];
      h += `<div class="hk-bar">
          <div class="w-seg hke-viewseg" role="group" data-role="view"><button type="button" data-view="cards" aria-pressed="true">${bi('文献卡片', 'Source cards')}</button><button type="button" data-view="matrix" aria-pressed="false">${bi('证据矩阵', 'Evidence matrix')}</button></div>
          <input type="search" class="hk-search" data-role="q" aria-label="filter">
          <div class="hk-chips" data-role="lv"><span class="hk-lab">${bi('等级', 'Level')}</span><button type="button" class="hk-chip" data-lv="all" aria-pressed="true">${bi('全部', 'All')}</button>${lvIds.map((l) => `<button type="button" class="hk-chip" data-lv="${l}" aria-pressed="false">${l} · ${items.filter((r) => baseLevel(r.level) === l).length}</button>`).join('')}</div>
          <div class="hk-chips" data-role="cl"><span class="hk-lab">${bi('方法类', 'Class')}</span><button type="button" class="hk-chip" data-cl="all" aria-pressed="true">${bi('全部', 'All')}</button>${(D.classes || []).map((c) => `<button type="button" class="hk-chip" data-cl="${c.id}" aria-pressed="false"><i class="hke-dot" style="--c:${c.color}"></i>${biO(c.short || c.name)}</button>`).join('')}<button type="button" class="hk-chip" data-cl="none" aria-pressed="false">${bi('历史/外围', 'Historical/peripheral')}</button></div>
          <span class="hk-count" data-role="count"></span>
        </div>`;
      h += `<div data-pane="cards"><div class="hke-list">${items.map((r) => cardHtml(r, D)).join('')}</div></div>`;
      h += `<div data-pane="matrix" hidden>${matrixHtml(D, byId)}</div>`;
      h += `<div class="hk-empty" data-role="empty" hidden>${bi('没有匹配的文献。', 'No matching source.')}</div>`;
      el.innerHTML = h;

      const cards = [...el.querySelectorAll('.hke-card')];
      const mrows = [...el.querySelectorAll('.hke-matrix tbody tr')];
      const hay = new Map(items.map((r) => [r.id, haystack(r)]));
      const q = el.querySelector('[data-role="q"]');
      const cnt = el.querySelector('[data-role="count"]');
      const setPh = () => { q.placeholder = api.t('筛选：作者、编号、图号、关键词…', 'Filter: author, number, figure, keyword…'); };
      setPh(); api.onLang(() => { setPh(); apply(); });

      function match(id, lv, cl) {
        const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
        return (state.lv === 'all' || lv === state.lv) && (state.cl === 'all' || cl === state.cl) && terms.every((t) => hay.get(id).includes(t));
      }
      function apply() {
        let shown = 0, total = 0;
        if (state.view === 'cards') {
          for (const c of cards) { const ok = match(c.id.slice(PAGE.length + 1), c.dataset.level, c.dataset.class); c.hidden = !ok; if (ok) shown++; }
          total = cards.length;
        } else {
          for (const r of mrows) { const ok = match(r.dataset.ref, r.dataset.level, r.dataset.class); r.hidden = !ok; if (ok) shown++; }
          total = mrows.length;
        }
        el.querySelector('[data-pane="cards"]').hidden = state.view !== 'cards';
        el.querySelector('[data-pane="matrix"]').hidden = state.view !== 'matrix';
        el.querySelector('[data-role="empty"]').hidden = shown > 0;
        cnt.textContent = api.t(`显示 ${shown} / ${total}`, `Showing ${shown} / ${total}`);
        el.querySelectorAll('[data-lv]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lv === state.lv)));
        el.querySelectorAll('[data-cl]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cl === state.cl)));
        el.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
      }
      q.addEventListener('input', () => { state.q = q.value.trim(); apply(); });
      el.querySelector('.hk-bar').addEventListener('click', (e) => {
        const b = e.target.closest('[data-lv], [data-cl], [data-view]');
        if (!b) return;
        if (b.dataset.lv) state.lv = b.dataset.lv;
        if (b.dataset.cl) state.cl = b.dataset.cl;
        if (b.dataset.view) state.view = b.dataset.view;
        apply();
      });
      function reveal(id) {
        const card = document.getElementById(`${PAGE}-${id}`);
        if (!card) return null;
        if (state.view !== 'cards' || card.hidden) { state.view = 'cards'; state.lv = 'all'; state.cl = 'all'; state.q = ''; q.value = ''; apply(); }
        card.classList.remove('hl-target'); void card.offsetWidth; card.classList.add('hl-target');
        return card;
      }
      // links inside the page (matrix rows / class chips) must also switch to the card view
      el.addEventListener('click', (e) => {
        const a = e.target.closest('[data-goto]');
        if (!a) return;
        if (Book.hash() === `#${PAGE}-${a.dataset.goto}`) {
          e.preventDefault();
          const card = reveal(a.dataset.goto);
          if (card) card.scrollIntoView({ block: 'start' });
        }
      });
      function focusFromHash() {
        const m = decodeURIComponent(Book.hash().slice(1)).match(/^hub-evidence-([RH]\d{2})$/);
        if (m) reveal(m[1]);
      }
      window.addEventListener('hashchange', focusFromHash);
      apply();
      focusFromHash();
    },
    search() {
      return (DATA().items || []).map((r) => ({
        target: `#${PAGE}-${r.id}`,
        kind: 'ref',
        title: { zh: `[${r.id}] ${(r.short || {}).zh || r.title}`, en: `[${r.id}] ${(r.short || {}).en || r.title}` },
        text: {
          zh: `${r.tag || ''} ${(r.short || {}).en || ''} ${r.title} ${r.authors || ''} ${r.venue || ''} ${r.year || ''} ${r.level} ${(r.focus || {}).zh || ''} ${(r.role || {}).zh || ''} ${(r.limits || {}).zh || ''}`,
          en: `${r.tag || ''} ${(r.short || {}).zh || ''} ${r.title} ${r.authors || ''} ${r.venue || ''} ${r.year || ''} ${r.level} ${(r.focus || {}).en || ''} ${(r.role || {}).en || ''} ${(r.limits || {}).en || ''}`,
        },
      }));
    },
  });
})();
