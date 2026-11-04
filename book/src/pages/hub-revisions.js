/* Hub page: revision log — each earlier-round statement, how this report treats it, why,
 * and where it is discussed; plus what was deliberately kept.
 * Data: book/data/revisions.json (report §11 table, 10 rows, and its closing paragraph).
 */
(function () {
  'use strict';
  const PAGE = 'hub-revisions';
  const esc = Book.esc, bi = Book.bi;

  const CSS = `
.hr-hero { padding: 18px 0 6px; }
.hr-hero h1 { font-size: clamp(1.5rem, 3vw, 2.1rem); line-height: 1.25; margin: .1em 0 .35em; }
.hr-hero .lede { color: var(--fg-2); font-size: .98rem; margin: 0; }
.hr-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 16px 0 4px; }
.hr-list { display: grid; gap: 12px; margin: 14px 0 22px; }
.hr-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; overflow-wrap: anywhere; scroll-margin-top: 96px; }
.hr-card header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-bottom: 8px; }
.hr-card header .hr-id { font-weight: 700; color: var(--accent-ink); font-variant-numeric: tabular-nums; }
.hr-card header .hr-n { font-size: .75rem; color: var(--muted); }
.hr-pair { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 8px 12px; align-items: stretch; }
.hr-side { border-radius: 9px; padding: 8px 10px; font-size: .88rem; line-height: 1.5; }
.hr-before { background: var(--surface-2); border: 1px dashed var(--border-strong); color: var(--fg-2); }
.hr-before .hr-lab, .hr-after .hr-lab { display: block; font-size: .7rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 3px; color: var(--muted); }
.hr-before q { quotes: "“" "”"; }
.hr-after { background: color-mix(in srgb, var(--good) 9%, var(--surface)); border: 1px solid color-mix(in srgb, var(--good) 35%, var(--border)); }
.hr-arrow { align-self: center; font-size: 1.2rem; color: var(--accent-ink); }
.hr-why { margin: 10px 0 0; font-size: .86rem; color: var(--fg-2); }
.hr-why b { color: var(--fg); }
.hr-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: .78rem; }
.hr-refs { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.hr-refs a, .hr-refs span { font-size: .72rem; border: 1px solid var(--border-strong); border-radius: 999px; padding: 0 7px; color: var(--fg-2); text-decoration: none; line-height: 1.6; }
.hr-refs a:hover { border-color: var(--accent); color: var(--accent-ink); }
.hr-kept { margin: 22px 0 10px; padding: 14px 16px; border-left: 3px solid var(--good); background: var(--surface); border-radius: 12px; font-size: .92rem; line-height: 1.6; }
.hr-kept h2 { margin: 0 0 6px; font-size: 1rem; }
@media (max-width: 700px) {
  .hr-pair { grid-template-columns: minmax(0, 1fr); }
  .hr-arrow { justify-self: center; transform: rotate(90deg); }
  .hr-card { padding: 12px 12px; }
}
@media print { .hr-card { break-inside: avoid; } }
`;
  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }
  // inline $...$ math and `code` inside bilingual revision text
  function rich(s) {
    return String(s == null ? '' : s).split(/(\$[^$]+\$)/).map((p) => {
      if (p.length > 2 && p[0] === '$' && p[p.length - 1] === '$') return Book.tex(p.slice(1, -1));
      return esc(p);
    }).join('');
  }
  function biR(o) { return bi(rich(o.zh), rich(o.en)); }
  function secRef(id) {
    const m = String(id).replace(/^r-/, '');
    const app = /^[A-Z]$/.test(m);
    return `<a href="#${esc(id)}">${bi(esc(app ? '附录 ' + m : '§' + m), esc(app ? 'App. ' + m : '§' + m))}</a>`;
  }
  function refChip(r) {
    return `<a href="#r-14" title="${bi('参考文献与原始入口', 'References and original sources')}">[${esc(r)}]</a>`;
  }

  Book.registerPage({
    id: PAGE,
    group: 'hub',
    order: 50,
    icon: '⇄',
    title: { zh: '修订记录', en: 'Revision log' },
    summary: {
      zh: '前几轮结论 → 本报告处理 → 原因与参考文献，共 10 项；以及明确保留的主线。',
      en: 'Earlier-round statements → how this report treats them → reasons and references, 10 items; plus the lines that were deliberately kept.',
    },
    render(el, api) {
      injectCss('hr-css-revisions', CSS);
      const D = Book.data.data.revisions || { items: [], kept: null };
      const items = D.items || [];
      const revised = items.length;

      let h = `<div class="hr-hero"><div class="kicker">${bi('知识汇总 · 修订记录', 'Knowledge hub · Revision log')}</div>
        <h1>${bi('前几轮结论如何被修订', 'How earlier-round conclusions were revised')}</h1>
        <p class="lede">${bi('每一行左侧是旧表述或倾向，右侧是本报告的处理；“原因”说明依据。这是修订的记录，不是对前轮工作的否定。', 'Left: the earlier statement or tendency. Right: this report\'s treatment. “Reason” gives the basis. This is a record of revisions, not a rejection of earlier work.')}</p></div>
        <div class="hr-stats">
          <div class="stat"><div class="k">${bi('修订条目', 'Revised items')}</div><div class="v">${revised}</div></div>
          <div class="stat"><div class="k">${bi('涉及章节', 'Sections touched')}</div><div class="v">${new Set(items.flatMap((x) => x.sections || [])).size}</div></div>
          <div class="stat"><div class="k">${bi('附带参考文献', 'Cited references')}</div><div class="v">${new Set(items.flatMap((x) => x.refs || [])).size}</div></div>
        </div>`;

      h += '<div class="hr-list">' + items.map((x, i) => `
        <article class="hr-card" id="${PAGE}-${esc(x.id)}">
          <header><span class="hr-id">${esc(x.id)}</span><span class="hr-n">${bi(`第 ${i + 1} 项 / 共 ${revised} 项（§11 表）`, `Item ${i + 1} of ${revised} (§11 table)`)}</span></header>
          <div class="hr-pair">
            <div class="hr-side hr-before"><span class="hr-lab">${bi('前轮表述或倾向', 'Earlier statement or tendency')}</span><q>${biR(x.before)}</q></div>
            <div class="hr-arrow" aria-hidden="true">⇄</div>
            <div class="hr-side hr-after"><span class="hr-lab">${bi('本报告处理', 'This report')}</span>${biR(x.handling)}</div>
          </div>
          <p class="hr-why"><b>${bi('原因：', 'Reason: ')}</b>${biR(x.reason)}</p>
          <div class="hr-foot">
            <span>${bi('章节', 'Sections')}: ${(x.sections || []).map(secRef).join(' ')}</span>
            ${(x.refs || []).length ? `<span class="hr-refs">${bi('参考', 'Refs')}: ${x.refs.map(refChip).join('')}</span>` : ''}
          </div>
        </article>`).join('') + '</div>';

      if (D.kept) {
        h += `<section class="hr-kept"><h2>${bi('保留的主线', 'What was kept')}</h2><p style="margin:0">${biR(D.kept)}</p>
          <p style="margin:8px 0 0;font-size:.82rem">${bi('相关章节：', 'See: ')}${secRef('r-11')} ${secRef('r-1-3')} ${secRef('r-8-1')} ${secRef('r-9-3')}</p></section>`;
      }
      el.innerHTML = h;
    },
  });
})();
