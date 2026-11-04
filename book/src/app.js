/* CNT-ADPLL interactive book — application shell.
 *
 * Public API (used by widgets in src/widgets and hub pages in src/pages):
 *
 *   Book.registerWidget({ id, group, title:{zh,en}, summary:{zh,en}, sections:[secId], eqs:['1','2'],
 *                         mount(root, api) -> { destroy?(), reset?() } })
 *   Book.registerPage({ id, group:'hub', order, icon, title:{zh,en}, summary:{zh,en},
 *                       render(el, api), search?: () => [{ target, kind, title:{zh,en}, text:{zh,en} }] })
 *   Book.lang()  -> 'zh' | 'en' (side-by-side mode reports 'zh' for UI text)
 *   Book.go(hash) / Book.toast(msg)
 *
 *   api (passed to mount/render):
 *     api.t(zh, en)       pick a string for the current language
 *     api.lang()          'zh' | 'en'
 *     api.onLang(fn)      subscribe to language changes (returns unsubscribe)
 *     api.onTheme(fn)     subscribe to theme changes (returns unsubscribe)
 *     api.css(name)       computed CSS custom property (e.g. api.css('--sig-clk'))
 *     api.tex(src, display=false) -> KaTeX HTML string
 *     api.loop(fn)        rAF loop: fn(dt, t). Returns { start(), stop(), toggle(), running }.
 *                         Automatically paused while the widget is off-screen or the tab is hidden.
 *     api.reducedMotion   boolean (prefers-reduced-motion)
 *     api.root            the mount element
 */
(function () {
  'use strict';
  const DATA = JSON.parse(document.getElementById('book-data').textContent);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('cntbook:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cntbook:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const html = document.documentElement;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const L = (o) => (o == null ? '' : typeof o === 'string' ? o : (Book.lang() === 'en' ? (o.en || o.zh) : (o.zh || o.en)) || '');
  const bi = (zh, en) => `<span class="i18n-zh">${zh}</span><span class="i18n-en">${en}</span>`;
  const biO = (o) => (o == null ? '' : typeof o === 'string' ? esc(o) : bi(esc(o.zh || o.en || ''), esc(o.en || o.zh || '')));

  const listeners = { lang: new Set(), theme: new Set(), page: new Set() };
  const emit = (k, v) => listeners[k].forEach((fn) => { try { fn(v); } catch (e) { console.error(e); } });
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const Book = (window.Book = {
    data: DATA,
    widgets: new Map(),
    pages: new Map(),
    esc, bi, biO, L,
    lang() { return html.getAttribute('data-lang') === 'en' ? 'en' : 'zh'; },
    langMode() { return html.getAttribute('data-lang') || 'zh'; },
    registerWidget(def) {
      if (!def || !def.id) throw new Error('registerWidget: id required');
      Book.widgets.set(def.id, def);
    },
    registerPage(def) {
      if (!def || !def.id) throw new Error('registerPage: id required');
      Book.pages.set(def.id, def);
    },
    tex(src, display) {
      try { return window.katex.renderToString(String(src), { displayMode: !!display, throwOnError: false, strict: 'ignore' }); }
      catch (e) { return `<code>${esc(src)}</code>`; }
    },
    on(kind, fn) { listeners[kind].add(fn); return () => listeners[kind].delete(fn); },
    go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
    toast,
    store: LS,
  });

  // ---------------------------------------------------------------------------
  // Widget / page API factory
  // ---------------------------------------------------------------------------
  function makeApi(root) {
    const subs = [];
    let visible = false;
    const loops = new Set();
    const api = {
      root,
      t: (zh, en) => (Book.lang() === 'en' ? en : zh),
      lang: () => Book.lang(),
      onLang: (fn) => { const u = Book.on('lang', fn); subs.push(u); return u; },
      onTheme: (fn) => { const u = Book.on('theme', fn); subs.push(u); return u; },
      css: (name) => getComputedStyle(root).getPropertyValue(name).trim(),
      tex: (src, display) => Book.tex(src, display),
      reducedMotion,
      loop(fn) {
        let raf = 0, last = 0, t = 0, wanted = false;
        const ctl = {
          get running() { return wanted; },
          start() { wanted = true; tick.armed || arm(); return ctl; },
          stop() { wanted = false; cancelAnimationFrame(raf); raf = 0; tick.armed = false; return ctl; },
          toggle() { return wanted ? ctl.stop() : ctl.start(); },
          _wake() { if (wanted && !tick.armed) arm(); },
        };
        function arm() { tick.armed = true; last = performance.now(); raf = requestAnimationFrame(tick); }
        function tick(now) {
          tick.armed = false;
          if (!wanted) return;
          if (!visible || document.hidden) return; // resumes via _wake()
          const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
          try { fn(dt, t); } catch (e) { console.error(e); ctl.stop(); return; }
          tick.armed = true; raf = requestAnimationFrame(tick);
        }
        loops.add(ctl);
        return ctl;
      },
      _setVisible(v) { visible = v; if (v) loops.forEach((l) => l._wake()); },
      _destroy() { subs.forEach((u) => u()); loops.forEach((l) => l.stop()); loops.clear(); },
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loops.forEach((l) => l._wake()); });
    return api;
  }

  // ---------------------------------------------------------------------------
  // Widgets: lazy mounting into .wslot elements
  // ---------------------------------------------------------------------------
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      const slot = e.target;
      if (e.isIntersecting && !slot._mounted) mountSlot(slot);
      if (slot._api) slot._api._setVisible(e.isIntersecting);
    }
  }, { rootMargin: '200px 0px' }) : null;

  function widgetFrame(def, slot, opts = {}) {
    const fig = document.createElement('figure');
    fig.className = 'widget';
    const links = (def.sections || []).filter((s) => !opts.inSection || s !== opts.inSection).map((s) => `<a href="#${s}">§ ${esc(secLabel(s))}</a>`).join('')
      + (def.eqs || []).map((n) => `<a href="#eq-${n}">${bi('式', 'Eq.')} (${n})</a>`).join('');
    fig.innerHTML = `
      <figcaption class="w-head">
        <span class="w-badge">${bi('交互建模', 'INTERACTIVE MODEL')}</span>
        <span class="w-title">${biO(def.title)}</span>
        <span class="w-actions">
          <button data-act="reset" title="重置 / Reset">↺</button>
          <button data-act="expand" title="放大 / Expand">⛶</button>
        </span>
      </figcaption>
      ${def.summary ? `<div class="w-sum">${biO(def.summary)}</div>` : ''}
      <div class="w-root"></div>
      ${links ? `<div class="w-links">${bi('相关：', 'Related: ')}${links}</div>` : ''}`;
    slot.appendChild(fig);
    const rootEl = $('.w-root', fig);
    const doMount = () => {
      rootEl.innerHTML = '';
      if (slot._inst && slot._inst.destroy) try { slot._inst.destroy(); } catch (e) { console.error(e); }
      if (slot._api) slot._api._destroy();
      const api = makeApi(rootEl);
      slot._api = api;
      api._setVisible(true);
      try { slot._inst = def.mount(rootEl, api) || {}; }
      catch (e) { console.error(e); rootEl.innerHTML = `<div class="w-err">Widget "${esc(def.id)}" failed: ${esc(e && e.stack || e)}</div>`; }
    };
    fig.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'reset') doMount();
      if (b.dataset.act === 'expand') {
        fig.classList.toggle('expanded');
        document.body.style.overflow = fig.classList.contains('expanded') ? 'hidden' : '';
        window.dispatchEvent(new Event('resize'));
      }
    });
    doMount();
  }

  function mountSlot(slot) {
    slot._mounted = true;
    const def = Book.widgets.get(slot.dataset.widget);
    if (!def) {
      slot.innerHTML = `<div class="widget"><div class="w-root muted">${bi('（交互模型尚未提供：', '(Interactive model not available: ')}${esc(slot.dataset.widget)})</div></div>`;
      return;
    }
    widgetFrame(def, slot, { inSection: slot.dataset.sec, lab: slot.dataset.lab === '1' });
  }

  function observeSlots(root) {
    $$('.wslot', root).forEach((s) => {
      if (s._observed) return;
      s._observed = true;
      if (io) io.observe(s); else mountSlot(s);
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation model
  // ---------------------------------------------------------------------------
  const navPages = DATA.nav; // doc pages in reading order
  const secToPage = new Map();
  const secTitle = new Map();
  for (const p of navPages) for (const s of p.sections) { secToPage.set(s.id, p.id); secTitle.set(s.id, s); }
  function secLabel(id) {
    const s = secTitle.get(id);
    if (!s) return id;
    const num = /^[A-Z]$/.test(s.num) ? (Book.lang() === 'en' ? 'Appendix ' : '附录 ') + s.num : (s.num === '0' ? '' : s.num);
    return `${num} ${L(s.title)}`.trim();
  }
  Book.secLabel = secLabel;

  function readingOrder() {
    const hub = [...Book.pages.values()].filter((p) => p.group === 'hub').sort((a, b) => (a.order || 0) - (b.order || 0));
    return [
      { id: 'home', title: { zh: '首页', en: 'Home' } },
      ...navPages.map((p) => ({ id: p.id, title: p.title, num: p.num })),
      { id: 'lab', title: { zh: '交互实验室', en: 'Interactive Lab' } },
      ...hub.map((p) => ({ id: p.id, title: p.title })),
    ];
  }

  // ---------------------------------------------------------------------------
  // Sidebar TOC
  // ---------------------------------------------------------------------------
  function buildToc() {
    const read = LS.get('read', {});
    const intro = navPages.filter((p) => p.doc === 'intro');
    const report = navPages.filter((p) => p.doc === 'report');
    const hub = [...Book.pages.values()].filter((p) => p.group === 'hub').sort((a, b) => (a.order || 0) - (b.order || 0));
    const link = (id, title, num, extra = '') => `<a class="toc-link" href="#${id}" data-toc="${id}"><span class="n">${num != null ? esc(num) : ''}</span><span class="t">${title}</span>${read[id] ? '<span class="done" title="已读 / read">✓</span>' : ''}${extra}</a><div class="toc-sub" data-sub="${id}"></div>`;
    let h = '';
    h += `<div class="toc-group"><div class="toc-group-title">${bi('开始', 'Start')}</div>${link('home', bi('首页 · 导读', 'Home · Guide'), '⌂')}${intro.map((p) => link(p.id, biO(p.title), '★')).join('')}</div>`;
    h += `<div class="toc-group"><div class="toc-group-title">${bi('调研整合报告', 'Research report')}</div>${report.map((p) => link(p.id, biO(p.title), p.num === '0' ? '§' : /^[A-Z]$/.test(p.num || '') ? p.num : p.num)).join('')}</div>`;
    h += `<div class="toc-group"><div class="toc-group-title">${bi('交互与知识', 'Interactive & knowledge')}</div>${link('lab', bi('交互实验室', 'Interactive lab'), '▶')}${hub.map((p) => link(p.id, biO(p.title), p.icon || '•')).join('')}</div>`;
    $('#toc').innerHTML = h;
    updateProgress();
  }

  function updateProgress() {
    const read = LS.get('read', {});
    const total = navPages.length;
    const done = navPages.filter((p) => read[p.id]).length;
    const pct = Math.round((done / Math.max(1, total)) * 100);
    $('#side-progress').innerHTML = `${bi('阅读进度', 'Reading progress')} · ${done}/${total}<div class="bar"><i style="width:${pct}%"></i></div>`;
  }

  function fillSubToc(pageId) {
    $$('.toc-sub').forEach((el) => { el.innerHTML = ''; });
    const p = navPages.find((x) => x.id === pageId);
    const sub = $(`.toc-sub[data-sub="${CSS.escape(pageId)}"]`);
    if (!p || !sub) return;
    sub.innerHTML = p.sections.filter((s) => s.level === (p.doc === 'intro' ? 2 : 2)).map((s) => `<a href="#${s.id}" data-subtoc="${s.id}">${esc(s.num === '0' ? '' : s.num)} ${biO(s.title)}</a>`).join('');
  }

  // right rail
  function fillRail(pageEl, pageId) {
    const p = navPages.find((x) => x.id === pageId);
    let items = [];
    if (p) items = p.sections.filter((s) => s.level >= 2).map((s) => ({ id: s.id, lvl: s.level + 1, label: `${s.num} ${biO(s.title)}` }));
    else items = $$('h2[id], h3[id]', pageEl).map((h) => ({ id: h.id, lvl: h.tagName === 'H2' ? 2 : 3, label: h.innerHTML.replace(/<a[^>]*class="h-anchor"[^>]*>.*?<\/a>/, '') }));
    const widgets = $$('.wslot', pageEl).map((s) => Book.widgets.get(s.dataset.widget)).filter(Boolean);
    let h = items.map((i) => `<a class="lvl-${i.lvl}" href="#${i.id}" data-rail="${i.id}">${i.label}</a>`).join('');
    if (widgets.length && p) h += `<div class="rail-title" style="margin-top:16px">${bi('本页交互模型', 'Models on this page')}</div>` + widgets.map((w) => `<a href="#w-${w.id}">▶ ${biO(w.title)}</a>`).join('');
    $('#rail-toc').innerHTML = h;
    $('#rail').style.visibility = h ? '' : 'hidden';
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------
  let currentPage = null;
  function showPage(id) {
    const el = $(`.page[data-page="${CSS.escape(id)}"]`);
    if (!el) return null;
    if (currentPage !== id) {
      $$('main > .page').forEach((p) => { p.hidden = p !== el; });
      currentPage = id;
      ensureRendered(el, id);
      $$('.toc-link').forEach((a) => a.classList.toggle('active', a.dataset.toc === id));
      fillSubToc(id);
      fillRail(el, id);
      buildPageNav(id);
      observeSlots(el);
      const title = readingOrder().find((x) => x.id === id);
      document.title = `${title ? L(title.title) + ' · ' : ''}CNT-ADPLL`;
      LS.set('last', id);
      emit('page', id);
      decoratePage(el);
    }
    return el;
  }

  function ensureRendered(el, id) {
    if (el._rendered) return;
    el._rendered = true;
    if (id === 'home') renderHome(el);
    else if (id === 'lab') renderLab(el);
    else if (Book.pages.has(id)) {
      const def = Book.pages.get(id);
      const api = makeApi(el);
      api._setVisible(true);
      try { def.render(el, api); } catch (e) { console.error(e); el.innerHTML += `<div class="w-err">${esc(e.stack || e)}</div>`; }
    }
  }

  function resolveTarget(hash) {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    if (!id) return { page: 'home' };
    if ($(`.page[data-page="${CSS.escape(id)}"]`)) return { page: id };
    const mEq = id.match(/^eq-(\d+)$/);
    if (mEq) {
      const info = DATA.eqIndex[mEq[1]];
      if (info) return { page: info.page, find: () => visibleIn($$(`.eq[data-eq="${mEq[1]}"]`)) };
    }
    const mRef = id.match(/^ref-([RH]\d{2})$/);
    if (mRef) {
      const els = $$(`[data-refdef="${mRef[1]}"]`);
      if (els.length) return { page: els[0].closest('.page').dataset.page, find: () => visibleIn(els) };
    }
    if (secToPage.has(id)) return { page: secToPage.get(id), find: () => document.getElementById(id) };
    // any element id (hub pages, widgets)
    const el = document.getElementById(id);
    if (el && el.closest('.page')) return { page: el.closest('.page').dataset.page, find: () => document.getElementById(id) };
    // ids inside not-yet-rendered dynamic pages: "<pageId>/<anchor>" or registered page prefix
    for (const [pid] of Book.pages) if (id.startsWith(pid + '-') || id.startsWith(pid + '/')) return { page: pid, find: () => document.getElementById(id) };
    return { page: 'home' };
  }
  function visibleIn(els) {
    const lang = Book.lang();
    return els.find((e) => { const c = e.closest('.sec-lang'); return !c || c.dataset.l === lang; }) || els[0];
  }

  function route() {
    const t = resolveTarget(location.hash);
    const el = showPage(t.page);
    if (!el) return;
    if (t.find) {
      requestAnimationFrame(() => {
        const target = t.find();
        if (target) {
          target.scrollIntoView({ block: 'start' });
          if (target.classList.contains('eq')) { target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash'); }
        }
      });
    } else window.scrollTo(0, 0);
    document.body.classList.remove('menu-open');
  }
  window.addEventListener('hashchange', route);

  function buildPageNav(id) {
    const order = readingOrder();
    const i = order.findIndex((x) => x.id === id);
    const prev = order[i - 1], next = order[i + 1];
    const label = (x) => `${x.num && x.num !== '0' ? esc(x.num) + ' · ' : ''}${biO(x.title)}`;
    $('#page-nav').innerHTML = (prev ? `<a class="prev" href="#${prev.id}"><small>← ${bi('上一篇', 'Previous')}</small>${label(prev)}</a>` : '<span style="flex:1"></span>')
      + (next ? `<a class="next" href="#${next.id}"><small>${bi('下一篇', 'Next')} →</small>${label(next)}</a>` : '<span style="flex:1"></span>');
  }

  // ---------------------------------------------------------------------------
  // Page decoration: equation tools, heading tools (bookmark / notes)
  // ---------------------------------------------------------------------------
  function widgetsForEq(n) { return [...Book.widgets.values()].filter((w) => (w.eqs || []).map(String).includes(String(n))); }

  function decoratePage(el) {
    if (el._decorated) return;
    el._decorated = true;
    // chapter meta line + key takeaways box (doc pages only)
    const pid = el.dataset.page;
    const navP = navPages.find((p) => p.id === pid);
    if (navP) {
      const first = $('.sec', el);
      const zhChars = DATA.search.filter((r) => r.p === pid && r.l === 'zh').reduce((a, r) => a + r.x.length, 0);
      const mins = Math.max(1, Math.round(zhChars / 450));
      const nW = $$('.wslot', el).length, nE = $$('.sec-lang[data-l="zh"] .eq', el).length;
      const meta = document.createElement('div');
      meta.className = 'page-meta';
      meta.innerHTML = `<span>⏱ ${bi(`约 ${mins} 分钟`, `~${mins} min read`)}</span>${nE ? `<span>∑ ${bi(`${nE} 个公式`, `${nE} equations`)}</span>` : ''}${nW ? `<span>▶ ${bi(`${nW} 个交互模型`, `${nW} interactive model${nW > 1 ? 's' : ''}`)}</span>` : ''}`;
      const sums = DATA.data.summaries && DATA.data.summaries[pid];
      let box = null;
      if (sums) {
        box = document.createElement('aside');
        box.className = 'takeaways';
        const list = (arr) => `<ul>${(arr || []).map((x) => `<li>${String(x).replace(/\$([^$]+)\$/g, (_, t) => Book.tex(t))}</li>`).join('')}</ul>`;
        box.innerHTML = `<div class="tk-title">${bi('本章要点', 'Key takeaways')}</div><div class="i18n-zh">${list(sums.zh)}</div><div class="i18n-en">${list(sums.en)}</div>`;
      }
      if (first) { first.after(meta); if (box) meta.after(box); }
    }
    $$('.eq', el).forEach((eq) => {
      const tools = document.createElement('div');
      tools.className = 'eq-tools';
      const n = eq.dataset.eq;
      let b = `<button data-eqact="copy" title="Copy LaTeX">LaTeX</button>`;
      if (n && Book.pages.has('hub-formulas')) b += `<button data-eqact="card" title="推导卡片 / Derivation card">${bi('推导', 'Derivation')}</button>`;
      if (n && widgetsForEq(n).length) b += `<button data-eqact="demo" title="交互演示 / Demo">▶ ${bi('演示', 'Demo')}</button>`;
      tools.innerHTML = b;
      eq.appendChild(tools);
    });
    $$('.sec', el).forEach((sec) => {
      $$('.sec-lang > .h', sec).forEach((h) => {
        const t = document.createElement('span');
        t.className = 'h-tools';
        t.innerHTML = `<button data-hact="bm" title="收藏 / Bookmark (B)">☆</button><button data-hact="note" title="笔记 / Note">✎</button>`;
        h.appendChild(t);
      });
      refreshSectionMarks(sec);
    });
  }

  function refreshSectionMarks(sec) {
    const bms = LS.get('bookmarks', {});
    const notes = LS.get('notes', {});
    $$('[data-hact="bm"]', sec).forEach((b) => { b.textContent = bms[sec.id] ? '★' : '☆'; b.classList.toggle('on', !!bms[sec.id]); b.closest('.h-tools').classList.toggle('on', !!bms[sec.id] || !!notes[sec.id]); });
    $$('.note-view', sec).forEach((n) => n.remove());
    if (notes[sec.id]) {
      $$('.sec-lang', sec).forEach((col) => {
        const h = $('.h', col);
        const v = document.createElement('div');
        v.className = 'note-view';
        v.textContent = '✎ ' + notes[sec.id].text;
        if (h) h.after(v); else col.prepend(v);
      });
    }
  }

  document.addEventListener('click', (ev) => {
    const eqBtn = ev.target.closest('[data-eqact]');
    if (eqBtn) {
      const eq = eqBtn.closest('.eq');
      const n = eq.dataset.eq;
      if (eqBtn.dataset.eqact === 'copy') {
        copyText(eq.dataset.tex);
      } else if (eqBtn.dataset.eqact === 'card') Book.go('#hub-formulas-eq-' + n);
      else if (eqBtn.dataset.eqact === 'demo') {
        const w = widgetsForEq(n)[0];
        const inPage = document.getElementById('w-' + w.id);
        if (inPage && !inPage.closest('.page').hidden) inPage.scrollIntoView({ block: 'start', behavior: 'smooth' });
        else Book.go('#w-' + w.id);
      }
      return;
    }
    const hBtn = ev.target.closest('[data-hact]');
    if (hBtn) {
      const sec = hBtn.closest('.sec');
      if (hBtn.dataset.hact === 'bm') toggleBookmark(sec.id);
      else openNoteEditor(sec, hBtn.closest('.sec-lang'));
    }
  });

  function toggleBookmark(id) {
    const bms = LS.get('bookmarks', {});
    if (bms[id]) delete bms[id]; else bms[id] = { t: Date.now() };
    LS.set('bookmarks', bms);
    const sec = document.getElementById(id);
    if (sec) refreshSectionMarks(sec);
    toast(bms[id] ? (Book.lang() === 'en' ? 'Bookmarked' : '已收藏') : (Book.lang() === 'en' ? 'Bookmark removed' : '已取消收藏'));
  }

  function openNoteEditor(sec, col) {
    if ($('.note-editor', col)) return;
    const notes = LS.get('notes', {});
    const box = document.createElement('div');
    box.className = 'note-editor';
    box.innerHTML = `<textarea placeholder="${Book.lang() === 'en' ? 'Your note for this section (saved locally)…' : '写下本节笔记（仅保存在本机浏览器）…'}"></textarea>
      <div style="display:flex;gap:6px;margin-top:4px"><button class="w-btn primary" data-n="save">${bi('保存', 'Save')}</button><button class="w-btn" data-n="del">${bi('删除', 'Delete')}</button><button class="w-btn" data-n="cancel">${bi('取消', 'Cancel')}</button></div>`;
    const ta = $('textarea', box);
    ta.value = notes[sec.id] ? notes[sec.id].text : '';
    const h = $('.h', col);
    (h || col.firstChild).after(box);
    ta.focus();
    box.addEventListener('click', (e) => {
      const a = e.target.closest('[data-n]');
      if (!a) return;
      const n = LS.get('notes', {});
      if (a.dataset.n === 'save' && ta.value.trim()) n[sec.id] = { text: ta.value.trim(), t: Date.now() };
      if (a.dataset.n === 'del' || (a.dataset.n === 'save' && !ta.value.trim())) delete n[sec.id];
      if (a.dataset.n !== 'cancel') LS.set('notes', n);
      box.remove();
      refreshSectionMarks(sec);
    });
  }

  function copyText(text) {
    const done = () => toast(Book.lang() === 'en' ? 'Copied' : '已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      ta.remove();
    }
  }
  Book.copy = copyText;

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1600);
  }

  // ---------------------------------------------------------------------------
  // Popovers: citations, glossary terms, equation references
  // ---------------------------------------------------------------------------
  const pop = $('#popover');
  let popAnchor = null, popTimer = 0;
  function refInfo(id) {
    const refs = (DATA.data.references && DATA.data.references.items) || [];
    const r = refs.find((x) => x.id === id);
    let h = '';
    if (r) {
      h += `<h5>[${esc(id)}] ${esc(L(r.short) || r.title)}</h5>`;
      if (r.level) h += `<span class="badge lvl-${esc(r.level.replace('-', ''))}">${esc(r.level)}</span> `;
      if (r.kind) h += `<span class="chip">${esc(L(r.kind))}</span>`;
      h += `<div>${esc(r.title || '')}</div>`;
      if (r.focus) h += `<div class="muted">${esc(L(r.focus))}</div>`;
      if (r.role) h += `<div class="muted">${esc(L(r.role))}</div>`;
    } else {
      const def = visibleIn($$(`[data-refdef="${id}"]`));
      if (def) h += def.closest('p').innerHTML;
    }
    h += `<div class="pop-foot"><a href="#ref-${esc(id)}">${bi('查看参考文献条目 →', 'Open reference entry →')}</a>${Book.pages.has('hub-evidence') ? ` · <a href="#hub-evidence-${esc(id)}">${bi('证据库', 'Evidence explorer')}</a>` : ''}</div>`;
    return h;
  }
  function termInfo(id) {
    const t = ((DATA.data.glossary && DATA.data.glossary.terms) || []).find((x) => x.id === id);
    if (!t) return '';
    const loc = t[Book.lang()] || t.zh;
    let h = `<h5>${esc(loc.term)}${t.symbol ? ' ' + Book.tex(t.symbol) : ''}</h5><div>${esc(loc.def || '')}</div>`;
    if (t.unit) h += `<div class="muted">${bi('单位：', 'Unit: ')}${esc(L(t.unit))}</div>`;
    h += `<div class="pop-foot">${t.section ? `<a href="#${esc(t.section)}">§ ${esc(secLabel(t.section))}</a> · ` : ''}<a href="#hub-glossary-${esc(id)}">${bi('术语表', 'Glossary')}</a></div>`;
    return h;
  }
  function eqInfo(n) {
    const eq = visibleIn($$(`.eq[data-eq="${n}"]`));
    if (!eq) return '';
    return `<div class="pop-eq">${$('.eq-body', eq).innerHTML}</div><div class="pop-foot"><a href="#eq-${n}">${bi('跳转到公式', 'Go to equation')} (${n})</a>${Book.pages.has('hub-formulas') ? ` · <a href="#hub-formulas-eq-${n}">${bi('推导卡片', 'Derivation card')}</a>` : ''}</div>`;
  }
  function showPop(anchor, content) {
    if (!content) return;
    popAnchor = anchor;
    pop.innerHTML = content;
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    let y = r.bottom + 6;
    if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 6);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function hidePop() { pop.hidden = true; popAnchor = null; }
  function popContentFor(a) {
    if (a.classList.contains('cite')) return refInfo(a.dataset.ref);
    if (a.classList.contains('term')) return termInfo(a.dataset.term);
    if (a.classList.contains('eqref')) return eqInfo(a.dataset.eqRef);
    return '';
  }
  const POP_SEL = '.cite, .term, .eqref';
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest(POP_SEL);
    if (a && a !== popAnchor) { clearTimeout(popTimer); popTimer = setTimeout(() => showPop(a, popContentFor(a)), 220); }
    else if (!a && !e.target.closest('#popover')) { clearTimeout(popTimer); popTimer = setTimeout(hidePop, 260); }
  });
  document.addEventListener('focusin', (e) => { const a = e.target.closest(POP_SEL); if (a) showPop(a, popContentFor(a)); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.term');
    if (a) { e.preventDefault(); showPop(a, popContentFor(a)); return; }
    if (!e.target.closest('#popover') && !e.target.closest(POP_SEL)) hidePop();
  });
  window.addEventListener('scroll', () => { if (!pop.hidden) hidePop(); }, { passive: true });

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  let searchDocs = null;
  let searchKind = 'all';
  const KINDS = { all: { zh: '全部', en: 'All' }, text: { zh: '正文', en: 'Text' }, eq: { zh: '公式', en: 'Equations' }, term: { zh: '术语', en: 'Terms' }, ref: { zh: '文献', en: 'References' }, demo: { zh: '交互', en: 'Demos' }, hub: { zh: '知识卡', en: 'Knowledge' } };
  function buildSearchDocs() {
    const docs = [];
    for (const r of DATA.search) docs.push({ kind: 'text', target: '#' + r.s, lang: r.l, title: r.t, text: r.x, page: r.p });
    for (const [n, e] of Object.entries(DATA.eqIndex)) for (const lang of ['zh', 'en']) docs.push({ kind: 'eq', target: '#eq-' + n, lang, title: (lang === 'en' ? 'Eq. ' : '式 ') + `(${n})`, text: e.tex, page: e.page });
    for (const w of Book.widgets.values()) for (const lang of ['zh', 'en']) docs.push({ kind: 'demo', target: '#w-' + w.id, lang, title: (w.title || {})[lang] || '', text: ((w.summary || {})[lang] || '') + ' ' + (w.keywords || []).join(' ') });
    for (const p of Book.pages.values()) {
      for (const lang of ['zh', 'en']) docs.push({ kind: 'hub', target: '#' + p.id, lang, title: (p.title || {})[lang] || '', text: (p.summary || {})[lang] || '' });
      if (p.search) { try { for (const e of p.search()) for (const lang of ['zh', 'en']) docs.push({ kind: e.kind || 'hub', target: e.target, lang, title: (e.title || {})[lang] || '', text: (e.text || {})[lang] || '' }); } catch (err) { console.error(err); } }
    }
    for (const d of docs) { d._t = (d.title || '').toLowerCase(); d._x = (d.text || '').toLowerCase(); }
    return docs;
  }
  function openSearch(q) {
    if (!searchDocs) searchDocs = buildSearchDocs();
    const m = $('#search-modal');
    m.hidden = false;
    const inp = $('#search-input');
    if (q != null) inp.value = q;
    inp.focus(); inp.select();
    renderFilters();
    doSearch();
  }
  function closeModal(m) { m.hidden = true; }
  function renderFilters() {
    $('#search-filters').innerHTML = Object.entries(KINDS).map(([k, v]) => `<button data-kind="${k}" aria-pressed="${k === searchKind}">${biO(v)}</button>`).join('');
  }
  let selIdx = 0, lastResults = [];
  function doSearch() {
    const q = $('#search-input').value.trim().toLowerCase();
    const box = $('#search-results');
    if (!q) { box.innerHTML = `<div class="search-empty">${bi('输入关键字：中文、英文、符号或公式片段均可（如 “撕裂”、“epoch”、“MC+q”、“R08”）。', 'Type keywords in Chinese or English, symbols or formula fragments (e.g. “torn”, “epoch”, “MC+q”, “R08”).')}</div>`; lastResults = []; return; }
    const terms = q.split(/\s+/).filter(Boolean);
    const allLang = $('#search-all-lang').checked || Book.langMode() === 'both';
    const lang = Book.lang();
    const res = [];
    for (const d of searchDocs) {
      if (!allLang && d.lang !== lang) continue;
      if (searchKind !== 'all' && d.kind !== searchKind) continue;
      let score = 0, ok = true;
      for (const t of terms) {
        const inT = d._t.includes(t), inX = d._x.includes(t);
        if (!inT && !inX) { ok = false; break; }
        score += (inT ? 10 : 0) + (inX ? 1 + Math.min(5, d._x.split(t).length - 2) * 0.3 : 0);
      }
      if (!ok) continue;
      if (d.kind === 'term' || d.kind === 'eq') score += 2;
      res.push({ d, score });
    }
    res.sort((a, b) => b.score - a.score);
    lastResults = res.slice(0, 60);
    selIdx = 0;
    if (!lastResults.length) { box.innerHTML = `<div class="search-empty">${bi('没有找到匹配内容。可以勾选“两种语言”或换个关键词。', 'No matches. Try “Both languages” or another keyword.')}</div>`; return; }
    box.innerHTML = lastResults.map((r, i) => {
      const d = r.d;
      const snip = snippet(d.text || '', terms);
      const kind = KINDS[d.kind] ? L(KINDS[d.kind]) : d.kind;
      const where = d.page ? (readingOrder().find((x) => x.id === d.page) || {}).title : null;
      return `<a class="sr${i === 0 ? ' sel' : ''}" href="${esc(d.target)}" data-i="${i}"><div class="sr-meta"><span class="sr-kind">${esc(kind)}</span>${where ? `<span>${esc(L(where))}</span>` : ''}<span>${d.lang === 'zh' ? '中' : 'EN'}</span></div><div class="sr-title">${hlText(d.title, terms)}</div>${snip ? `<div class="sr-snip">${snip}</div>` : ''}</a>`;
    }).join('');
  }
  function hlText(s, terms) {
    let out = esc(s);
    for (const t of terms) { if (!t) continue; out = out.replace(new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`); }
    return out;
  }
  function snippet(text, terms) {
    const lower = text.toLowerCase();
    let at = -1;
    for (const t of terms) { at = lower.indexOf(t); if (at >= 0) break; }
    if (at < 0) return esc(text.slice(0, 120));
    const start = Math.max(0, at - 50);
    return (start > 0 ? '…' : '') + hlText(text.slice(start, at + 110), terms) + (at + 110 < text.length ? '…' : '');
  }
  function goResult(i) {
    const r = lastResults[i];
    if (!r) return;
    const terms = $('#search-input').value.trim().split(/\s+/).filter(Boolean);
    closeModal($('#search-modal'));
    Book.go(r.d.target);
    setTimeout(() => highlightIn(r.d.target, terms), 120);
  }
  function highlightIn(target, terms) {
    $$('mark.hl').forEach((m) => { m.replaceWith(document.createTextNode(m.textContent)); });
    let el = null;
    try { el = $(target); } catch (e) { /* invalid selector */ }
    if (!el) return;
    const lang = Book.lang();
    const scope = el.classList.contains('sec') ? ($(`.sec-lang[data-l="${lang}"]`, el) || el) : el;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('.katex, script, style, .eq-tools, .h-tools') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let first = null;
    for (const node of nodes) {
      for (const t of terms) {
        const i = node.textContent.toLowerCase().indexOf(t.toLowerCase());
        if (i < 0 || !t) continue;
        const r = document.createRange();
        r.setStart(node, i); r.setEnd(node, i + t.length);
        const m = document.createElement('mark'); m.className = 'hl';
        try { r.surroundContents(m); first = first || m; } catch (e) { /* ignore */ }
        break;
      }
    }
    if (first) first.scrollIntoView({ block: 'center' });
    setTimeout(() => $$('mark.hl').forEach((m) => m.replaceWith(document.createTextNode(m.textContent))), 8000);
  }
  $('#search-input').addEventListener('input', doSearch);
  $('#search-all-lang').addEventListener('change', doSearch);
  $('#search-filters').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) { searchKind = b.dataset.kind; renderFilters(); doSearch(); } });
  $('#search-results').addEventListener('click', (e) => { const a = e.target.closest('.sr'); if (a) { e.preventDefault(); goResult(+a.dataset.i); } });
  $('#search-input').addEventListener('keydown', (e) => {
    const items = $$('.sr');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selIdx = Math.max(0, Math.min(items.length - 1, selIdx + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((a, i) => a.classList.toggle('sel', i === selIdx));
      if (items[selIdx]) items[selIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); goResult(selIdx); }
  });
  Book.search = openSearch;

  // ---------------------------------------------------------------------------
  // Language / theme / font / focus
  // ---------------------------------------------------------------------------
  function setLang(l) {
    html.setAttribute('data-lang', l);
    html.lang = l === 'en' ? 'en' : 'zh-CN';
    LS.set('lang', l);
    $$('[data-lang-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.langSet === l)));
    $('#search-input').placeholder = l === 'en' ? 'Search… (e.g. epoch, N=MC+q, SAT, Havens)' : '搜索… (例如: epoch、N=MC+q、SAT、Havens)';
    if (currentPage) {
      const el = $(`.page[data-page="${CSS.escape(currentPage)}"]`);
      const title = readingOrder().find((x) => x.id === currentPage);
      document.title = `${title ? L(title.title) + ' · ' : ''}CNT-ADPLL`;
      fillRail(el, currentPage);
    }
    emit('lang', Book.lang());
  }
  const THEMES = ['auto', 'light', 'dark'];
  function setTheme(t) {
    html.setAttribute('data-theme', t);
    LS.set('theme', t);
    $('#btn-theme').textContent = t === 'auto' ? '◐' : t === 'light' ? '☀' : '☾';
    $('#btn-theme').title = `主题 / Theme: ${t}`;
    emit('theme', t);
  }
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => emit('theme', html.getAttribute('data-theme')));
  function setFont(px) { px = Math.max(14, Math.min(22, px)); html.style.setProperty('--fs', px + 'px'); LS.set('fs', px); window.dispatchEvent(new Event('resize')); }

  $('#lang-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-lang-set]'); if (b) setLang(b.dataset.langSet); });
  $('#btn-theme').addEventListener('click', () => setTheme(THEMES[(THEMES.indexOf(html.getAttribute('data-theme')) + 1) % 3]));
  $('#btn-font-inc').addEventListener('click', () => setFont(LS.get('fs', 17) + 1));
  $('#btn-font-dec').addEventListener('click', () => setFont(LS.get('fs', 17) - 1));
  $('#btn-focus').addEventListener('click', () => { document.body.classList.toggle('focus'); $('#btn-focus').setAttribute('aria-pressed', String(document.body.classList.contains('focus'))); });
  $('#btn-help').addEventListener('click', () => { $('#help-modal').hidden = false; });
  $('#btn-search').addEventListener('click', () => openSearch());
  $('#btn-menu').addEventListener('click', () => document.body.classList.toggle('menu-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('menu-open'));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(m); }));

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (e.key === 'Escape') {
      $$('.modal').forEach((m) => closeModal(m)); hidePop();
      const ex = $('.widget.expanded'); if (ex) { ex.classList.remove('expanded'); document.body.style.overflow = ''; }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    else if (e.key === '?') $('#help-modal').hidden = false;
    else if (e.key === 'l' || e.key === 'L') { const m = ['zh', 'en', 'both']; setLang(m[(m.indexOf(Book.langMode()) + 1) % 3]); }
    else if (e.key === 't' || e.key === 'T') $('#btn-theme').click();
    else if (e.key === 'f' || e.key === 'F') $('#btn-focus').click();
    else if (e.key === '[' || e.key === ']') { const a = $(`#page-nav a.${e.key === '[' ? 'prev' : 'next'}`); if (a) location.hash = a.getAttribute('href'); }
    else if (e.key === 'b' || e.key === 'B') { const s = currentSection(); if (s) toggleBookmark(s.id); }
  });

  // ---------------------------------------------------------------------------
  // Scroll spy, progress, read tracking
  // ---------------------------------------------------------------------------
  function currentSection() {
    const page = currentPage && $(`.page[data-page="${CSS.escape(currentPage)}"]`);
    if (!page) return null;
    const secs = $$('.sec', page);
    let cur = secs[0] || null;
    const y = (parseInt(getComputedStyle(html).getPropertyValue('--top')) || 56) + 40;
    for (const s of secs) { if (s.getBoundingClientRect().top - y <= 0) cur = s; else break; }
    return cur;
  }
  let spyRaf = 0;
  window.addEventListener('scroll', () => {
    if (spyRaf) return;
    spyRaf = requestAnimationFrame(() => {
      spyRaf = 0;
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
      $('#progress').style.width = pct + '%';
      const s = currentSection();
      if (s) {
        $$('#rail-toc a').forEach((a) => a.classList.toggle('active', a.dataset.rail === s.id));
        $$('.toc-sub a').forEach((a) => a.classList.toggle('active', a.dataset.subtoc === s.id || (s.id.startsWith(a.dataset.subtoc + '-'))));
      }
      if (pct > 92 && currentPage && navPages.some((p) => p.id === currentPage)) {
        const read = LS.get('read', {});
        if (!read[currentPage]) { read[currentPage] = Date.now(); LS.set('read', read); buildToc(); $$('.toc-link').forEach((a) => a.classList.toggle('active', a.dataset.toc === currentPage)); fillSubToc(currentPage); }
      }
    });
  }, { passive: true });

  // ---------------------------------------------------------------------------
  // Home and Lab pages
  // ---------------------------------------------------------------------------
  function renderHome(el) {
    const nW = Book.widgets.size;
    const nEq = Object.keys(DATA.eqIndex).length;
    const refs = (DATA.data.references && DATA.data.references.items) || [];
    const checks = DATA.checks ? DATA.checks.total_cases : 9860;
    const last = LS.get('lastSection', null);
    const hub = [...Book.pages.values()].filter((p) => p.group === 'hub').sort((a, b) => (a.order || 0) - (b.order || 0));
    const report = navPages.filter((p) => p.doc === 'report');
    const card = (href, ico, title, desc) => `<a class="card" href="${href}"><div class="card-ico">${ico}</div><h4>${title}</h4><p>${desc}</p></a>`;
    el.innerHTML = `
      <div class="hero">
        <div class="kicker">${bi('交互式技术书 · 整合复核版 V1.0', 'Interactive technical book · consolidated review V1.0')}</div>
        <h1>${bi('CNT-based ADPLL：整数相位保留、相干快照与短量程 TDC', 'CNT-based ADPLL: Integer-Phase Preservation, Coherent Snapshots and Short-Range TDC')}</h1>
        <p class="lede">${bi('把宽位整数相位计数器的高位降到 CKV/4 或 CKV/8 运行，同时不丢失任何一个原始 CKV 周期的编号；再让低位状态、参考相关快照与真正被选中的物理边沿关联起来，使有限量程 TDC 只测局部时间残差，并在进位、异步采样、选沿切换与饱和等边界下仍得到坐标一致、可判断有效性的完整相位观测。', 'Run the high bits of a wide integer phase counter at CKV/4 or CKV/8 without losing the index of any raw CKV cycle; tie the low-bit state, reference-related snapshots and the physically selected edge together so that a finite-range TDC only measures a local time residual — and still obtain a coordinate-consistent, validity-checked phase observation across carries, asynchronous sampling, edge-selection switching and saturation.')}</p>
      </div>
      <div class="stats">
        <div class="stat"><div class="v">${report.length}</div><div class="k">${bi('报告章节（含前言/附录）', 'Report chapters (incl. preface/appendices)')}</div></div>
        <div class="stat"><div class="v">${nEq}</div><div class="k">${bi('编号公式', 'Numbered equations')}</div></div>
        <div class="stat"><div class="v">${nW}</div><div class="k">${bi('交互建模与动画', 'Interactive models')}</div></div>
        <div class="stat"><div class="v">${refs.length || 19}</div><div class="k">${bi('参考文献', 'References')}</div></div>
        <div class="stat"><div class="v">${checks.toLocaleString()}</div><div class="k">${bi('逻辑检查案例（可在浏览器复跑）', 'Logical check cases (re-runnable here)')}</div></div>
      </div>
      ${last ? `<p><a class="w-btn primary" href="#${esc(last)}">${bi('继续阅读 →', 'Continue reading →')} ${esc(secLabel(last))}</a></p>` : ''}
      <h2 class="section-title">${bi('从这里开始', 'Start here')}</h2>
      <div class="cards">
        ${card('#intro', '★', bi('工程介绍（15 分钟速览）', 'Engineering introduction (15-min overview)'), bi('目标、两条链、统一坐标、四大难点、接口与不变量、进展与下一步。', 'Goals, the two chains, unified coordinates, four core difficulties, interface & invariants, progress and next steps.'))}
        ${card('#r-1', '§', bi('调研整合报告（全文）', 'Research report (full text)'), bi('14 章 + 2 个附录，含 22 个编号公式、证据矩阵与修订记录。', '14 chapters + 2 appendices with 22 numbered equations, evidence matrix and revision log.'))}
        ${card('#lab', '▶', bi('交互实验室', 'Interactive lab'), bi('计数分解、撕裂采样、锚点减残差、匹配延迟、选沿 deadline、饱和、事件级 golden model……', 'Split counting, torn capture, anchor-minus-residual, matched-delay sampling, edge deadlines, saturation, event-level golden model…'))}
        ${hub.map((p) => card('#' + p.id, esc(p.icon || '•'), biO(p.title), biO(p.summary))).join('')}
      </div>
      <h2 class="section-title">${bi('本书最重要的三处纠正', 'The three key corrections')}</h2>
      <div class="cards">
        ${card('#w-multiphase-units', '①', bi('不能通用地写 8C + q + e/8 + ε', 'No generic “8C + q + e/8 + ε”'), bi('q 与多相区域码可能重复表示同一相位区间，e/8 的单位可能是分频后周期。改用“锚点减残差”。', 'q and the multiphase region code may encode the same interval twice, and e/8 may be in divided-clock units. Use “anchor minus residual”.'))}
        ${card('#w-torn-capture', '②', bi('epoch 错配不全是 ±1 原周期', 'Epoch mismatches are not all ±1 raw cycle'), bi('高低位在组边界撕裂采样时，典型错误是 −M 与 +M（一整组）。修正必须带单位。', 'High/low tearing at a group boundary yields −M and +M (a whole group). Corrections must carry units.'))}
        ${card('#r-4-6', '③', bi('Sony 不是共享状态方法的最早先例', 'Sony is not the earliest shared-state precedent'), bi('Havens（US8692598B2）已同时包含整数计数、小数检测、sub-fractional TDC 与 one-count uncertainty 处理。', 'Havens (US8692598B2) already combines integer counting, fractional detection, a sub-fractional TDC and one-count-uncertainty handling.'))}
      </div>
      <h2 class="section-title">${bi('系统功能数据流（交互）', 'System data flow (interactive)')}</h2>
      <div class="wslot" data-widget="arch-flow" data-lab="1"></div>
      <h2 class="section-title">${bi('阅读路线', 'Reading route')}</h2>
      <div class="cards">
        ${card('#r-1', '①', bi('第 1–3 章 · 问题与坐标', 'Ch. 1–3 · Problem & coordinates'), bi('核心问题、需求冻结、统一时钟节点与相位坐标。', 'Core question, frozen requirements, unified clock node and phase coordinates.'))}
        ${card('#r-4', '②', bi('第 4–5 章 · 文献证据与边界', 'Ch. 4–5 · Evidence & limits'), bi('逐项解释各文献的价值和边界，跨文献证据矩阵。', 'What each source proves and where it stops; cross-source evidence matrix.'))}
        ${card('#r-6', '③', bi('第 6–10 章 · 时序、选沿与接口', 'Ch. 6–10 · Timing, edges & interface'), bi('epoch 分类、snapshot 路线、执行因果性、fine 量程、EventFrame。', 'Epoch taxonomy, snapshot routes, execution causality, fine range, EventFrame.'))}
        ${card('#r-11', '④', bi('第 11–13 章 · 修订、验证与未决', 'Ch. 11–13 · Revisions, verification, open items'), bi('前轮修订、六组逻辑检查与三层验证、未闭合问题。', 'Revisions, six logical checks and three-layer verification, open problems.'))}
      </div>`;
  }

  function renderLab(el) {
    const groups = [
      ['counter', { zh: '计数与分解', en: 'Counting & decomposition' }],
      ['phase', { zh: '相位坐标与单位', en: 'Phase coordinates & units' }],
      ['epoch', { zh: 'epoch 错误与修正', en: 'Epoch errors & correction' }],
      ['snapshot', { zh: '快照与采样时序', en: 'Snapshot & sampling timing' }],
      ['executor', { zh: '执行链与因果性', en: 'Execution chain & causality' }],
      ['fine', { zh: 'fine 量程、饱和与校准', en: 'Fine range, saturation & calibration' }],
      ['system', { zh: '系统级建模', en: 'System-level models' }],
      ['verify', { zh: '验证与检查', en: 'Verification' }],
      ['other', { zh: '其他', en: 'Other' }],
    ];
    const ws = [...Book.widgets.values()];
    let h = `<div class="hero"><div class="kicker">${bi('交互实验室', 'Interactive lab')}</div><h1>${bi('公式推导与行为级建模', 'Derivations & behavioural models')}</h1>
      <p class="lede">${bi('每个模型都对应书中的公式或论证；它们是依据文字描述重建的理想化/行为级模型，用于理解机制与边界，不代表原文插图或芯片指标。点击卡片即可在此展开。', 'Each model maps to an equation or argument in the book. They are idealised/behavioural reconstructions from the text, meant to explain mechanisms and limits — not reproductions of original figures or silicon numbers. Click a card to open it here.')}</p></div>`;
    for (const [g, title] of groups) {
      const list = ws.filter((w) => (w.group || 'other') === g);
      if (!list.length) continue;
      h += `<h2 class="lab-group">${biO(title)}</h2><div class="cards">`;
      h += list.map((w) => `<button class="card" data-labopen="${esc(w.id)}"><h4>▶ ${biO(w.title)}</h4><p>${biO(w.summary)}</p><p style="margin-top:6px">${(w.sections || []).map((s) => `<span class="chip">§ ${esc((secTitle.get(s) || {}).num || s)}</span>`).join('')}${(w.eqs || []).map((n) => `<span class="chip">(${esc(n)})</span>`).join('')}</p></button>`).join('');
      h += `</div><div class="lab-slot" data-labgroup="${g}"></div>`;
    }
    el.innerHTML = h;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-labopen]');
      if (!b) return;
      const id = b.dataset.labopen;
      const def = Book.widgets.get(id);
      const host = $(`.lab-slot[data-labgroup="${def.group || 'other'}"]`, el);
      let slot = $(`.wslot[data-widget="${CSS.escape(id)}"]`, host);
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'wslot'; slot.dataset.widget = id; slot.dataset.lab = '1';
        host.prepend(slot);
        observeSlots(el);
      }
      slot.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  // remember last section for "continue reading"
  setInterval(() => { const s = currentSection(); if (s) LS.set('lastSection', s.id); }, 4000);

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  Book.start = function () {
    setLang(Book.langMode());
    setTheme(html.getAttribute('data-theme') || 'auto');
    // dynamic hub pages get an <article> each
    const main = $('#main');
    const nav = $('#page-nav');
    for (const def of Book.pages.values()) {
      if ($(`.page[data-page="${CSS.escape(def.id)}"]`)) continue;
      const art = document.createElement('article');
      art.className = 'page hub-page'; art.dataset.page = def.id; art.hidden = true;
      main.insertBefore(art, nav);
    }
    buildToc();
    route();
  };
})();
