/* Hub page: my bookmarks & notes (stored locally via Book.store), with Markdown export. */
(function () {
  'use strict';
  Book.registerPage({
    id: 'hub-notes',
    group: 'hub',
    order: 80,
    icon: '✎',
    title: { zh: '我的收藏与笔记', en: 'My bookmarks & notes' },
    summary: { zh: '小节收藏与阅读笔记（仅保存在本机浏览器），可导出为 Markdown。', en: 'Section bookmarks and reading notes (stored only in this browser), exportable as Markdown.' },
    render(el, api) {
      const bi = Book.bi, esc = Book.esc;
      function draw() {
        const bms = Book.store.get('bookmarks', {});
        const notes = Book.store.get('notes', {});
        const ids = [...new Set([...Object.keys(bms), ...Object.keys(notes)])]
          .sort((a, b) => ((notes[b] || bms[b] || {}).t || 0) - ((notes[a] || bms[a] || {}).t || 0));
        let h = `<div class="hero"><div class="kicker">${bi('知识汇总', 'Knowledge hub')}</div><h1 id="hub-notes-top">${bi('我的收藏与笔记', 'My bookmarks & notes')}</h1>
          <p class="lede">${bi('在任意小节标题旁点击 ☆ 收藏、✎ 记笔记（快捷键 B 收藏当前小节）。数据只保存在本机浏览器中。', 'Click ☆ (bookmark) or ✎ (note) next to any section heading (shortcut B bookmarks the current section). Data stays in this browser only.')}</p></div>
          <div class="w-controls"><button class="w-btn primary" data-act="export">${bi('导出 Markdown', 'Export Markdown')}</button><button class="w-btn" data-act="clear">${bi('全部清除', 'Clear all')}</button></div>`;
        if (!ids.length) h += `<div class="w-note">${bi('还没有收藏或笔记。', 'No bookmarks or notes yet.')}</div>`;
        else {
          h += '<div class="cards">' + ids.map((id) => `
            <div class="card">
              <h4>${bms[id] ? '★ ' : ''}<a href="#${esc(id)}">${esc(Book.secLabel(id))}</a></h4>
              ${notes[id] ? `<p style="white-space:pre-wrap">${esc(notes[id].text)}</p>` : ''}
              <p style="margin-top:8px">${bms[id] ? `<button class="w-btn" data-act="unbm" data-id="${esc(id)}">${bi('取消收藏', 'Remove bookmark')}</button> ` : ''}${notes[id] ? `<button class="w-btn" data-act="delnote" data-id="${esc(id)}">${bi('删除笔记', 'Delete note')}</button>` : ''}</p>
            </div>`).join('') + '</div>';
        }
        el.innerHTML = h;
      }
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act, id = b.dataset.id;
        if (act === 'unbm') { const m = Book.store.get('bookmarks', {}); delete m[id]; Book.store.set('bookmarks', m); }
        if (act === 'delnote') { const m = Book.store.get('notes', {}); delete m[id]; Book.store.set('notes', m); }
        if (act === 'clear' && confirm(api.t('确定清除全部收藏与笔记？', 'Clear all bookmarks and notes?'))) { Book.store.set('bookmarks', {}); Book.store.set('notes', {}); }
        if (act === 'export') {
          const bms = Book.store.get('bookmarks', {}), notes = Book.store.get('notes', {});
          const ids = [...new Set([...Object.keys(bms), ...Object.keys(notes)])];
          const md = `# ${api.t('CNT-ADPLL 阅读笔记', 'CNT-ADPLL reading notes')}\n\n` + ids.map((i) => `## ${bms[i] ? '★ ' : ''}${Book.secLabel(i)}\n\n${notes[i] ? notes[i].text : ''}\n`).join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
          a.download = 'cnt-adpll-notes.md';
          document.body.appendChild(a); a.click(); a.remove();
          return;
        }
        draw();
      });
      Book.on('page', (p) => { if (p === 'hub-notes') draw(); });
      draw();
    },
  });
})();
