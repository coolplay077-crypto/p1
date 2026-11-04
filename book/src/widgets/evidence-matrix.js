/* Widget: the Ch.5 cross-source evidence matrix, interactive.
 *  - question-driven highlighting (last paragraph of Ch.5: /8 split → TI; shared state & correction →
 *    Havens/Sony; short-TDC physical selection → Kuo/MediaTek; split-counter sampling waveform → Zong Fig.9)
 *  - the three complementary method classes (state / consistency / selection)
 *  - an "assembly check": pick sources and see which method classes are covered, the union of their
 *    "still missing" cells, and that the complete-interface closure (§1.4, §13.1) stays open.
 * All content comes from book/data/references.json (which is taken from the report).
 */
(function () {
  'use strict';
  const CSS = `
.evm-ans { margin: 4px 0 10px; padding: 8px 12px; border-radius: 8px; border-left: 3px solid var(--accent); background: var(--accent-wash); font-size: .82rem; min-height: 2.6em; }
.evm-ans a { font-weight: 650; }
.evm-tbl { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; font-size: .78rem; line-height: 1.45; }
.evm-tbl th, .evm-tbl td { overflow-wrap: anywhere; }
.evm-tbl th:first-child { width: 21%; }
.evm-tbl th { position: static; background: var(--surface-2); font-weight: 650; text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: normal; vertical-align: bottom; }
.evm-tbl th.miss { background: color-mix(in srgb, var(--warning) 22%, var(--surface-2)); }
.evm-tbl td { padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; transition: opacity .2s, background-color .2s; }
.evm-tbl tr:last-child td { border-bottom: 0; }
.evm-tbl td.miss { background: color-mix(in srgb, var(--warning) 9%, var(--surface)); font-weight: 600; }
.evm-tbl td.src { border-left: 4px solid var(--c); }
.evm-tbl td.src label { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; cursor: pointer; }
.evm-tbl td.src input { accent-color: var(--accent); margin: 0; }
.evm-tbl td.src b { color: var(--fg); }
.evm-tbl td.src small { color: var(--muted); font-size: .72rem; }
.evm-tbl tr.dim td { opacity: .32; }
.evm-tbl tr.hit td { background: var(--accent-wash); }
.evm-tbl tr.hit td.miss { background: color-mix(in srgb, var(--warning) 20%, var(--surface)); }
.evm-tbl tr.hit td.src b::after { content: " ★"; color: var(--accent-ink); }
.evm-tbl tbody tr:hover td { background: var(--accent-wash); }
.evm-scroll { border: 1px solid var(--border); border-radius: 10px; overflow-x: auto; background: var(--surface); }
.evm-h { margin: 14px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.evm-bins { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.evm-bin { border: 1px solid var(--border); border-top: 4px solid var(--c); border-radius: 10px; padding: 8px 10px; background: var(--surface); font-size: .76rem; }
.evm-bin h5 { margin: 0 0 5px; font-size: .78rem; color: var(--fg); }
.evm-meter { display: flex; gap: 3px; margin: 4px 0 6px; }
.evm-meter i { flex: 1; height: 10px; border-radius: 3px; background: var(--surface-3); border: 1px solid var(--border); }
.evm-meter i.on { background: var(--c); border-color: var(--c); }
.evm-bin .evm-v { font-weight: 700; font-variant-numeric: tabular-nums; }
.evm-bin.closure { border-top-style: dashed; }
.evm-bin.closure .evm-meter i { background: repeating-linear-gradient(45deg, var(--surface-3) 0 4px, transparent 4px 8px); }
.evm-missing { margin: 6px 0 0; padding-left: 1.2em; font-size: .78rem; }
.evm-missing li { margin: 1px 0; }
.evm-missing small { color: var(--muted); }
.evm-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--c); vertical-align: middle; margin-right: 4px; }
.evm-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .75rem; color: var(--fg-2); margin: 2px 0 8px; }
.evm-tag { font-size: .7rem; color: var(--muted); }
.evm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 8px; }
.evm-row > .evm-lab { font-size: .76rem; color: var(--fg-2); margin-right: 2px; }
.evm-chip { font: inherit; font-size: .76rem; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg-2); border-radius: 999px; padding: 2px 11px; cursor: pointer; line-height: 1.5; }
.evm-chip:hover { border-color: var(--accent); color: var(--accent-ink); }
.evm-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.evm-chip .evm-dot { margin-right: 5px; }
@media (max-width: 640px) {
  .evm-tbl thead { display: none; }
  .evm-tbl, .evm-tbl tbody, .evm-tbl tr, .evm-tbl td { display: block; width: 100%; }
  .evm-tbl tr { border-bottom: 1px solid var(--border); border-left: 4px solid var(--c); padding: 4px 0; }
  .evm-tbl tr:last-child { border-bottom: 0; }
  .evm-tbl td { border: 0; padding: 2px 10px; }
  .evm-tbl td.src { border-left: 0; white-space: normal; }
  .evm-tbl td[data-kzh]::before { content: attr(data-kzh) "："; color: var(--muted); font-weight: 400; font-size: .7rem; }
  html[data-lang="en"] .evm-tbl td[data-ken]::before { content: attr(data-ken) ": "; }
}
`;
  function injectCss() {
    if (document.getElementById('evm-css')) return;
    const s = document.createElement('style');
    s.id = 'evm-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  const L2 = (o) => (o == null ? null : typeof o === 'string' ? o : W.L(o.zh, o.en == null ? o.zh : o.en));

  Book.registerWidget({
    id: 'evidence-matrix',
    group: 'other',
    title: { zh: '跨文献证据矩阵：按问题分工与“拼装检验”', en: 'Cross-source evidence matrix: division by question and an “assembly check”' },
    summary: {
      zh: '第 5 章的 10 个来源 × 4 列。按问题高亮最直接的入口；勾选来源，看三类互补方法是否都被覆盖、它们各自“仍缺少什么”，以及完整接口闭合为何不会因拼装而自动完成。',
      en: 'The Ch. 5 table: 10 sources × 4 columns. Highlight the most direct entry per question; tick sources to see whether the three complementary method classes are covered, what each still lacks, and why the complete-interface closure is not achieved by assembling them.',
    },
    sections: ['r-5'],
    eqs: [],
    keywords: ['evidence matrix', '证据矩阵', 'TI', 'Havens', 'Sony', 'Kuo', 'MediaTek', 'Zong', 'Fig.9', 'method class', '方法类'],
    mount(root, api) {
      injectCss();
      const D = (Book.data.data && Book.data.data.references) || { items: [] };
      const byId = new Map((D.items || []).map((r) => [r.id, r]));
      const rows = (D.matrixOrder || []).map((id) => byId.get(id)).filter((r) => r && r.matrix);
      const classes = D.classes || [];
      const clsOf = (id) => classes.find((c) => c.members.includes(id));
      const cols = D.matrixColumns || {};
      const questions = D.questions || [];
      const hasHub = Book.pages.has('hub-evidence');
      const refHref = (id) => (hasHub ? `#hub-evidence-${id}` : `#ref-${id}`);

      const state = { q: 'none', cls: 'all', picked: new Set() };
      let tourIdx = -1, tourT = 0;

      // ---------------------------------------------------------------- controls
      const qOpts = [{ value: 'none', label: ['全部', 'All'] }].concat(questions.map((q) => ({ value: q.id, label: { split: ['/8 split', '/8 split'], shared: ['共享状态与修正', 'Shared state & correction'], select: ['短 TDC 物理选相', 'Short-TDC phase selection'], wave: ['split counter 采样波形', 'Split-counter sampling waveform'] }[q.id] || [q.q.zh, q.q.en] })));
      // wrapping chip rows (segmented controls get cramped on phones)
      function chipRow(label, options, value, onChange) {
        const row = W.h('div', { class: 'evm-row', role: 'group' }, W.h('span', { class: 'evm-lab' }, W.lbl(label)));
        let cur = value;
        const btns = options.map((o) => {
          const b = W.h('button', { type: 'button', class: 'evm-chip', onClick: () => { set(o.value); onChange(o.value); } }, o.dot ? W.h('i', { class: 'evm-dot', style: '--c:' + o.dot }) : null, W.lbl(o.label));
          b.dataset.v = o.value; row.appendChild(b); return b;
        });
        function set(v) { cur = v; btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }
        set(cur);
        Object.defineProperty(row, 'value', { get: () => cur, set });
        return row;
      }
      const ctlQ = chipRow(['问题：', 'Question:'], qOpts, state.q, (v) => { state.q = v; stopTour(); render(); });
      const ctlC = chipRow(['方法类：', 'Method class:'],
        [{ value: 'all', label: ['全部', 'All'] }].concat(classes.map((c) => ({ value: c.id, dot: c.color, label: c.short ? [c.short.zh, c.short.en] : [c.name.zh, c.name.en] }))),
        state.cls, (v) => { state.cls = v; render(); });
      const loop = api.loop((dt) => {
        tourT += dt;
        if (tourT >= 3.2) { tourT = 0; nextTour(); }
      });
      const play = W.playButton(loop, api);
      play.title = '按问题依次导览 / Tour the questions one by one';
      play.addEventListener('click', () => { if (loop.running) { tourT = 0; nextTour(); } });
      function nextTour() { tourIdx = (tourIdx + 1) % questions.length; state.q = questions[tourIdx].id; ctlQ.value = state.q; render(); }
      function stopTour() { if (loop.running) { loop.stop(); play.sync(); } }

      const btnHit = W.button(['勾选高亮来源', 'Tick highlighted'], () => { hits().forEach((id) => state.picked.add(id)); render(); });
      const btnAll = W.button(['全部 10 篇', 'All 10 sources'], () => { rows.forEach((r) => state.picked.add(r.id)); render(); });
      const btnTri = W.button(['每类各取一篇', 'One per class'], () => { state.picked = new Set(classes.map((c) => c.members.find((id) => rows.some((r) => r.id === id))).filter(Boolean)); render(); });
      const btnClr = W.button(['清空', 'Clear'], () => { state.picked.clear(); render(); });

      const ans = W.h('div', { class: 'evm-ans', 'aria-live': 'polite' });

      // ---------------------------------------------------------------- matrix table
      const tbody = W.h('tbody');
      const table = W.h('table', { class: 'evm-tbl' },
        W.h('thead', null, W.h('tr', null,
          W.h('th', null, W.L('来源（勾选=加入拼装）', 'Source (tick = add to assembly)')),
          W.h('th', null, L2(cols.split)), W.h('th', null, L2(cols.consistency)), W.h('th', null, L2(cols.selection)),
          W.h('th', { class: 'miss' }, '⚠ ', L2(cols.missing)))),
        tbody);
      const rowEls = new Map();
      for (const r of rows) {
        const c = clsOf(r.id);
        const cb = W.h('input', { type: 'checkbox' });
        cb.addEventListener('change', () => { if (cb.checked) state.picked.add(r.id); else state.picked.delete(r.id); render(); });
        const cell = (k, extra) => W.h('td', Object.assign({ 'data-kzh': (k === 'missing' ? '⚠ ' : '') + cols[k].zh, 'data-ken': (k === 'missing' ? '⚠ ' : '') + cols[k].en }, extra || {}), L2(r.matrix[k]));
        const tr = W.h('tr', { style: '--c:' + (c ? c.color : 'var(--border-strong)') },
          W.h('td', { class: 'src', style: '--c:' + (c ? c.color : 'var(--border-strong)') },
            W.h('label', null, cb, W.h('b', null, r.tag), W.h('a', { href: refHref(r.id) }, `[${r.id}]`), W.h('span', { class: 'badge lvl-' + r.level.replace('-', '') }, r.level))),
          cell('split'), cell('consistency'), cell('selection'), cell('missing', { class: 'miss' }));
        tbody.appendChild(tr);
        rowEls.set(r.id, { tr, cb });
      }

      // ---------------------------------------------------------------- assembly panel
      const bins = W.h('div', { class: 'evm-bins' });
      const missList = W.h('ul', { class: 'evm-missing' });
      const read = W.readout([
        { key: 'n', label: ['已勾选来源', 'Sources ticked'] },
        { key: 'cov', label: ['覆盖的方法类', 'Method classes covered'] },
        { key: 'gaps', label: ['仍缺的接口项（并集）', 'Missing interface items (union)'] },
        { key: 'closed', label: ['完整组合已被证明？', 'Complete combination proven?'] },
      ]);
      const statusHost = W.h('div', { style: { marginTop: '8px' } });

      root.append(
        W.h('div', { class: 'evm-row' }, play, W.h('span', { class: 'evm-tag' }, W.L('导览：依次播放第 5 章末段的四个问题', 'Tour: steps through the four questions at the end of Ch. 5'))),
        ctlQ,
        ctlC,
        ans,
        W.h('div', { class: 'evm-scroll' }, table),
        W.h('div', { class: 'evm-h' }, W.L('拼装检验：把局部“是”拼在一起会怎样？', 'Assembly check: what happens if we put the local “yes” answers together?')),
        W.controls(btnHit, btnTri, btnAll, btnClr),
        bins,
        read.el,
        statusHost,
        W.h('div', { class: 'evm-h' }, W.L('所选来源对本目标“仍缺少什么”', 'What the ticked sources still lack for this target')),
        missList,
        W.note([
          '要点：这是按问题分工——/8 split 看 TI；共享状态与修正看 Havens/Sony；short TDC 物理选相看 Kuo/MediaTek；split counter 采样波形看 Zong Fig.9——不是把某篇说成完整目标的替代品。三类方法相互补充，表中的空白不是格式遗漏，而是仍需完成的接口论证；能把局部机制拼成合理架构，不等于组合后的时序、因果性和模拟误差已经通过验证。（“拼装检验”只按第 5 章的分类计数，是示意，不是对文献的新评分。）',
          'Key point: this is a division of labour by question — TI for the /8 split; Havens/Sony for shared state and correction; Kuo/MediaTek for short-TDC physical phase selection; Zong Fig. 9 for split-counter sampling waveforms — not a claim that any source substitutes for the complete target. The three classes complement each other; blanks in the table are interface arguments still to be made, and being able to assemble local mechanisms into a plausible architecture does not mean the combined timing, causality and analog error have been verified. (The “assembly check” only counts by the Ch. 5 classification — an illustration, not a new rating of the sources.)',
        ]),
      );

      function hits() {
        const q = questions.find((x) => x.id === state.q);
        return q ? q.refs : [];
      }

      function render() {
        const hitIds = hits();
        btnHit.disabled = !hitIds.length;
        // question answer
        W.clear(ans);
        const q = questions.find((x) => x.id === state.q);
        if (q) {
          ans.append(W.h('b', null, L2(q.q)), ' ', L2(q.a), ' ');
          q.refs.forEach((id) => ans.append(W.h('a', { href: refHref(id) }, `[${id}]`), ' '));
          ans.append(W.h('div', { class: 'evm-tag' }, L2(D.questionNote)));
        } else {
          ans.append(L2(D.classNote));
        }
        // rows
        for (const r of rows) {
          const { tr, cb } = rowEls.get(r.id);
          const c = clsOf(r.id);
          const inCls = state.cls === 'all' || (c && c.id === state.cls);
          const isHit = hitIds.includes(r.id);
          tr.classList.toggle('hit', isHit);
          tr.classList.toggle('dim', !inCls || (hitIds.length > 0 && !isHit));
          cb.checked = state.picked.has(r.id);
        }
        // coverage model
        W.clear(bins);
        let covered = 0;
        for (const c of classes) {
          const members = c.members.filter((id) => rows.some((r) => r.id === id));
          const on = members.filter((id) => state.picked.has(id));
          if (on.length) covered++;
          bins.append(W.h('div', { class: 'evm-bin', style: '--c:' + c.color },
            W.h('h5', null, L2(c.name)),
            W.h('div', { class: 'evm-meter' }, members.map((id) => W.h('i', { class: state.picked.has(id) ? 'on' : '', title: (byId.get(id) || {}).tag || id }))),
            W.h('div', null, W.h('span', { class: 'evm-v' }, `${on.length}/${members.length}`), ' ', on.length ? W.L('已覆盖', 'covered') : W.L('未覆盖', 'not covered')),
            W.h('div', { class: 'evm-tag' }, members.map((id) => (byId.get(id) || {}).tag || id).join(' · '))));
        }
        bins.append(W.h('div', { class: 'evm-bin closure', style: '--c:var(--warning)' },
          W.h('h5', null, W.L('完整接口闭合（§1.4、§13.1）', 'Complete interface closure (§1.4, §13.1)')),
          W.h('div', { class: 'evm-meter' }, W.h('i'), W.h('i'), W.h('i')),
          W.h('div', null, W.h('span', { class: 'evm-v' }, '0'), ' ', W.L('来源提供', 'sources provide it')),
          W.h('div', { class: 'evm-tag' }, W.L('raw /8 + 3-bit residue → 物理选沿 + short TDC + 完整 epoch/validity', 'raw /8 + 3-bit residue → physical edge + short TDC + full epoch/validity'))));
        // union of "still missing"
        W.clear(missList);
        const picked = rows.filter((r) => state.picked.has(r.id));
        for (const r of picked) missList.append(W.h('li', null, W.h('b', null, `${r.tag} [${r.id}]`), ' — ', L2(r.matrix.missing)));
        if (!picked.length) missList.append(W.h('li', { class: 'evm-tag' }, W.L('（尚未勾选来源）', '(no source ticked yet)')));
        read.set('n', `${picked.length} / ${rows.length}`);
        read.set('cov', `${covered} / ${classes.length}`);
        read.set('gaps', String(new Set(picked.map((r) => r.matrix.missing.zh)).size));
        read.set('closed', W.L('否 · 尚未核实到', 'No · not verified'));
        W.clear(statusHost);
        if (!picked.length) statusHost.append(W.status('warn', ['勾选来源或用上面的预设开始拼装', 'Tick sources or use a preset above to start assembling']));
        else if (covered < classes.length) statusHost.append(W.status('warn', [`仍缺 ${classes.length - covered} 类方法的直接来源`, `Still missing direct sources for ${classes.length - covered} method class(es)`]));
        else statusHost.append(W.status('bad', ['三类方法都有来源 ≠ 整体已完成：组合后必须重新检查联合状态空间（§7.4）', 'All three classes have sources ≠ done: the joint state space must be re-checked after combining (§7.4)']));
      }
      // start with one source per method class ticked, so the assembly lesson is visible at once
      state.picked = new Set(classes.map((c) => c.members.find((id) => rows.some((r) => r.id === id))).filter(Boolean));
      render();
      return { destroy() { loop.stop(); } };
    },
  });
})();
