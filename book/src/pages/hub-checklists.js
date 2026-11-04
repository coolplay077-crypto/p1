/* Hub page: interactive checklists — goals G1–G7 (§2.1), invariants I1–I8 (§10.2),
 * engineering questions Q1–Q5 (§13.2) — with a status per item (not started / in progress /
 * done) persisted in this browser via Book.store (keys "checklist:<id>"), progress bars,
 * and a traceability matrix goals x invariants.
 * Data: book/data/checklists.json. The "protects" links are an editorial cross-reference.
 */
(function () {
  'use strict';
  const PAGE = 'hub-checklists';
  const esc = Book.esc, bi = Book.bi;

  const CSS_TEXT = `
.hk2-hero { padding: 18px 0 6px; }
.hk2-hero h1 { font-size: clamp(1.5rem, 3vw, 2.1rem); line-height: 1.25; margin: .1em 0 .35em; }
.hk2-hero .lede { color: var(--fg-2); font-size: .98rem; margin: 0; }
.hk2-sum { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin: 16px 0 6px; }
.hk2-sum .stat .v { font-size: 1.25rem; }
.hk2-bar { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; margin: 6px 0 2px; }
.hk2-bar > i { display: block; height: 100%; width: 0; background: var(--good); border-radius: 999px; transition: width .25s; }
.hk2-h { margin: 24px 0 8px; font-size: 1.02rem; color: var(--fg-2); display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.hk2-h small { font-weight: 400; color: var(--muted); font-size: .78rem; }
.hk2-list { display: grid; gap: 10px; }
.hk2-item { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--border-strong); border-radius: 12px; padding: 12px 14px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 14px; align-items: start; overflow-wrap: anywhere; }
.hk2-item[data-st="doing"] { border-left-color: var(--warning); }
.hk2-item[data-st="done"] { border-left-color: var(--good); }
.hk2-item .hk2-id { font-weight: 700; color: var(--accent-ink); font-variant-numeric: tabular-nums; margin-right: 6px; }
.hk2-item .hk2-title { font-weight: 650; font-size: .95rem; line-height: 1.4; }
.hk2-item .hk2-body { grid-column: 1; font-size: .85rem; color: var(--fg-2); line-height: 1.55; }
.hk2-item .hk2-body p { margin: 2px 0; }
.hk2-links { grid-column: 1; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: .78rem; }
.hk2-links a { white-space: nowrap; }
.hk2-status { grid-column: 2; grid-row: 1 / span 3; }
.hk2-status .w-seg button { font-size: .72rem; padding: 3px 7px; }
.hk2-tag { display: inline-block; font-size: .72rem; border: 1px solid var(--border-strong); border-radius: 999px; padding: 0 7px; margin: 0 4px 2px 0; color: var(--fg-2); white-space: nowrap; }
.hk2-note { font-size: .78rem; color: var(--muted); margin: 6px 0 0; }
.hk2-mx { width: 100%; border-collapse: collapse; font-size: .8rem; }
.hk2-mx th, .hk2-mx td { border: 1px solid var(--border); padding: 5px 6px; text-align: center; }
.hk2-mx th:first-child, .hk2-mx td:first-child { text-align: left; white-space: nowrap; }
.hk2-mx td.on { background: color-mix(in srgb, var(--accent) 22%, var(--surface)); font-weight: 700; color: var(--accent-ink); }
.hk2-mx td.off { color: var(--muted); }
.hk2-mx th a { color: inherit; }
.hk2-mx-wrap { margin: 8px 0 4px; }
@media (max-width: 700px) {
  .hk2-item { grid-template-columns: minmax(0, 1fr); }
  .hk2-status, .hk2-links, .hk2-item .hk2-body { grid-column: 1; grid-row: auto; }
}
@media print { .hk2-status, .hk2-reset { display: none !important; } }
`;
  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }
  const STATES = [
    { k: 'todo', zh: '未开始', en: 'Not started' },
    { k: 'doing', zh: '进行中', en: 'In progress' },
    { k: 'done', zh: '已完成', en: 'Done' },
  ];
  const KEY = (id) => 'checklist:' + id;
  function getSt(id) {
    const v = Book.store.get(KEY(id), 'todo');
    return STATES.some((s) => s.k === v) ? v : 'todo';
  }
  function secRef(id) {
    const m = String(id).replace(/^r-/, '');
    const app = /^[A-Z]$/.test(m);
    return `<a href="#${esc(id)}">${bi(esc(app ? '附录 ' + m : '§' + m), esc(app ? 'App. ' + m : '§' + m))}</a>`;
  }
  function widgetLinks(ids) {
    return (ids || []).filter((id) => Book.widgets && Book.widgets.has(id)).map((id) => {
      const w = Book.widgets.get(id);
      const t = w.title || { zh: id, en: id };
      return `<a href="#w-${esc(id)}">▶ ${bi(esc(t.zh), esc(t.en || t.zh))}</a>`;
    }).join('');
  }
  function seg(key, id, cur) {
    return `<div class="w-seg" role="group" aria-label="${bi('状态', 'Status')}" data-seg="${esc(key)}">${STATES.map((s) =>
      `<button type="button" data-key="${esc(key)}" data-id="${esc(id)}" data-st="${s.k}" aria-pressed="${String(s.k === cur)}">${bi(s.zh, s.en)}</button>`).join('')}</div>`;
  }

  Book.registerPage({
    id: PAGE,
    group: 'hub',
    order: 40,
    icon: '☑',
    title: { zh: '检查清单', en: 'Checklists' },
    summary: {
      zh: '目标 G1–G7、不变量 I1–I8、工程问题 Q1–Q5 的可勾选清单（进度保存在本机浏览器），含 G×I 追溯矩阵。',
      en: 'Checkable lists for goals G1–G7, invariants I1–I8 and engineering questions Q1–Q5 (progress kept in this browser), with a goals × invariants traceability matrix.',
    },
    render(el, api) {
      injectCss('hk2-css-checklists', CSS_TEXT);
      const D = Book.data.data.checklists || { goals: [], invariants: [], questions: [] };
      const G = D.goals || [], I = D.invariants || [], Q = D.questions || [];
      const ST = { doing: 0.5, done: 1 };

      let h = `<div class="hk2-hero"><div class="kicker">${bi('知识汇总 · 检查清单', 'Knowledge hub · Checklists')}</div>
        <h1>${bi('目标、不变量与工程问题的进度清单', 'Progress checklists: goals, invariants and engineering questions')}</h1>
        <p class="lede">${bi('把报告的验收条件变成可跟踪的清单。状态只保存在本机浏览器中，不会上传；它记录的是你的复核进度，不代表电路已经验证。', 'The report\'s acceptance conditions as trackable lists. Status is stored only in this browser; it records your review progress and does not mean the circuit has been verified.')}</p></div>
        <div class="hk2-sum" data-role="sum"></div>`;

      h += `<h2 class="hk2-h">${bi('目标 G1–G7', 'Goals G1–G7')} <small>${bi('§2.1 必须保持的目标；验收语义逐条对应', '§2.1 goals that must be kept; acceptance semantics per item')}</small></h2>
        <div class="hk2-list">${G.map((g) => `
          <article class="hk2-item" data-item="${esc(g.id)}" data-st="${getSt(g.id)}">
            <div class="hk2-title"><span class="hk2-id">${esc(g.id)}</span>${bi(esc(g.zh.title), esc(g.en.title))}</div>
            <div class="hk2-body"><p>${bi(esc(g.zh.accept), esc(g.en.accept))}</p>
              <p>${bi('保护的不变量：', 'Protected by invariants: ')}${I.filter((x) => (x.protects || []).includes(g.id)).map((x) => `<span class="hk2-tag">${esc(x.id)}</span>`).join('') || '—'}</p></div>
            <div class="hk2-links">${(g.sections || []).map(secRef).join(' ')} ${widgetLinks(g.widgets)}</div>
            <div class="hk2-status">${seg('goal', g.id, getSt(g.id))}</div>
          </article>`).join('')}</div>`;

      h += `<h2 class="hk2-h">${bi('不变量 I1–I8', 'Invariants I1–I8')} <small>${bi('§10.2；违反后的处理同时给出', '§10.2; the handling on violation is listed too')}</small></h2>
        <div class="hk2-list">${I.map((x) => `
          <article class="hk2-item" data-item="${esc(x.id)}" data-st="${getSt(x.id)}">
            <div class="hk2-title"><span class="hk2-id">${esc(x.id)}</span>${bi(esc(x.zh.text), esc(x.en.text))}</div>
            <div class="hk2-body"><p>${bi('违反后：', 'On violation: ')}${bi(esc(x.zh.handling), esc(x.en.handling))}</p></div>
            <div class="hk2-links">${(x.sections || []).map(secRef).join(' ')} ${widgetLinks(x.widgets)}</div>
            <div class="hk2-status">${seg('inv', x.id, getSt(x.id))}</div>
          </article>`).join('')}</div>`;

      h += `<h2 class="hk2-h">${bi('工程问题 Q1–Q5', 'Engineering questions Q1–Q5')} <small>${bi('§13.2 必须先回答的五个问题', '§13.2 five questions to answer first')}</small></h2>
        <div class="hk2-list">${Q.map((q) => `
          <article class="hk2-item" data-item="${esc(q.id)}" data-st="${getSt(q.id)}">
            <div class="hk2-title"><span class="hk2-id">${esc(q.id)}</span>${bi(esc(q.zh.q), esc(q.en.q))}</div>
            <div class="hk2-body"><p>${bi('必须形成的产物：', 'Artifact to produce: ')}${bi(esc(q.zh.artifact), esc(q.en.artifact))}</p>
              <p>${bi('完成判据：', 'Done when: ')}${bi(esc(q.zh.done), esc(q.en.done))}</p></div>
            <div class="hk2-links">${(q.sections || []).map(secRef).join(' ')} ${widgetLinks(q.widgets)}</div>
            <div class="hk2-status">${seg('q', q.id, getSt(q.id))}</div>
          </article>`).join('')}</div>`;

      // traceability matrix: rows = goals, columns = invariants
      h += `<h2 class="hk2-h">${bi('追溯矩阵 G × I', 'Traceability matrix G × I')} <small>${bi('编辑性的交叉引用，非报告原文陈述', 'Editorial cross-reference; not a statement of the report')}</small></h2>
        <div class="tbl-wrap hk2-mx-wrap"><table class="hk2-mx"><thead><tr><th>${bi('目标 \\ 不变量', 'Goal \\ invariant')}</th>${I.map((x) => `<th title="${esc(x.zh.text)}">${esc(x.id)}</th>`).join('')}</tr></thead><tbody>${G.map((g) => `<tr><td>${esc(g.id)} ${bi(esc(g.zh.title), esc(g.en.title))}</td>${I.map((x) => {
          const on = (x.protects || []).includes(g.id);
          return `<td class="${on ? 'on' : 'off'}">${on ? '●' : '·'}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="hk2-note">${bi('● 表示该不变量在本页的交叉引用中保护该目标。G2（高位降速）没有直接对应的不变量，它由 I1 的 N=MC+q 连续性与 L01 的分解检查间接支撑。', '● means the invariant is cross-referenced here as protecting that goal. G2 (high-bit rate reduction) has no directly matching invariant; it is indirectly supported by the continuity of N=MC+q in I1 and by the decomposition check L01.')}</p>
        <div class="hk2-reset" style="margin-top:14px"><button type="button" class="w-btn" data-act="reset">${bi('清除全部进度', 'Reset all progress')}</button></div>`;

      el.innerHTML = h;

      function updateSummary() {
        const groups = [
          { zh: '目标', en: 'Goals', items: G },
          { zh: '不变量', en: 'Invariants', items: I },
          { zh: '工程问题', en: 'Questions', items: Q },
        ];
        el.querySelector('[data-role="sum"]').innerHTML = groups.map((gr) => {
          const score = gr.items.reduce((a, x) => a + (ST[getSt(x.id)] || 0), 0);
          const done = gr.items.filter((x) => getSt(x.id) === 'done').length;
          const pct = gr.items.length ? Math.round((score / gr.items.length) * 100) : 0;
          return `<div class="stat"><div class="k">${bi(gr.zh, gr.en)}</div><div class="v">${done} / ${gr.items.length}</div>
            <div class="hk2-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></div>`;
        }).join('');
      }
      function updateItem(id) {
        const row = el.querySelector('[data-item="' + id + '"]');
        if (!row) return;
        const st = getSt(id);
        row.dataset.st = st;
        row.querySelectorAll('[data-st]').forEach((b) => { if (b.dataset.id === id) b.setAttribute('aria-pressed', String(b.dataset.st === st)); });
      }
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'reset') {
          if (!confirm(api.t('确定清除全部检查清单进度？', 'Reset all checklist progress?'))) return;
          [...G, ...I, ...Q].forEach((x) => { try { Book.store.set(KEY(x.id), 'todo'); } catch (err) { /* storage unavailable */ } });
          [...G, ...I, ...Q].forEach((x) => updateItem(x.id));
          updateSummary();
          return;
        }
        if (!b.dataset.st || !b.dataset.id) return;
        try { Book.store.set(KEY(b.dataset.id), b.dataset.st); } catch (err) { /* storage unavailable */ }
        updateItem(b.dataset.id);
        updateSummary();
      });
      updateSummary();
    },
  });
})();
