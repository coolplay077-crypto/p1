/* Hub page: interactive concept map — nodes and labelled relations from book/data/concepts.json.
 * Layout is a deterministic Fruchterman–Reingold force layout computed in JS (no randomness).
 * Interaction: drag / pinch / Ctrl+wheel / +− buttons to pan and zoom; hover or tap a node to
 * highlight its neighbourhood and relation labels; click (or Enter) to pin it and open the card
 * with links to the section and widget; filter by kind. Works with the keyboard and on phones.
 */
(function () {
  'use strict';
  const PAGE = 'hub-map';
  const esc = Book.esc, bi = Book.bi;
  const W = 1000, H = 760;               // layout canvas (user units)
  const KINDS = [
    { k: 'quantity', zh: '量', en: 'Quantity', c: 'var(--s1)' },
    { k: 'mechanism', zh: '机制', en: 'Mechanism', c: 'var(--s2)' },
    { k: 'interface', zh: '接口', en: 'Interface', c: 'var(--s4)' },
    { k: 'risk', zh: '风险', en: 'Risk', c: 'var(--critical)' },
    { k: 'verification', zh: '验证', en: 'Verification', c: 'var(--good)' },
  ];
  const KIND = new Map(KINDS.map((x) => [x.k, x]));

  const CSS = `
.hm-hero { padding: 18px 0 6px; }
.hm-hero h1 { font-size: clamp(1.5rem, 3vw, 2.1rem); line-height: 1.25; margin: .1em 0 .35em; }
.hm-hero .lede { color: var(--fg-2); font-size: .98rem; margin: 0; }
.hm-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 12px 0 8px; }
.hm-chip { font: inherit; font-size: .76rem; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg-2); border-radius: 999px; padding: 2px 10px; cursor: pointer; line-height: 1.6; }
.hm-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.hm-chip i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
.hm-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
.hm-stage { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; touch-action: none; }
.hm-svg { display: block; width: 100%; height: clamp(400px, 68vh, 640px); cursor: grab; user-select: none; -webkit-user-select: none; }
.hm-svg.drag { cursor: grabbing; }
.hm-zoom { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; gap: 4px; }
.hm-zoom button { width: 32px; height: 32px; font: inherit; font-size: 1.05rem; line-height: 1; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg); border-radius: 8px; cursor: pointer; }
.hm-zoom button:focus-visible, .hm-node:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.hm-hint { position: absolute; left: 10px; bottom: 6px; font-size: .72rem; color: var(--muted); pointer-events: none; }
.hm-edge { stroke: var(--border-strong); stroke-width: 1.2; fill: none; transition: opacity .15s; }
.hm-edge.hot { stroke: var(--accent); stroke-width: 2; }
.hm-edge.dim, .hm-node.dim { opacity: .16; }
.hm-elab { font-size: 12.5px; fill: var(--accent-ink); paint-order: stroke; stroke: var(--surface); stroke-width: 3px; pointer-events: none; }
.hm-node { cursor: pointer; }
.hm-node .hm-hit { pointer-events: all; }
.hm-node circle { stroke: var(--surface); stroke-width: 2; transition: r .12s; }
.hm-node.sel circle { stroke: var(--fg); stroke-width: 2.5; }
.hm-node.hov circle, .hm-node.nb circle { stroke: var(--accent); stroke-width: 2.5; }
.hm-node text { font-size: 14px; fill: var(--fg); paint-order: stroke; stroke: var(--surface); stroke-width: 3px; pointer-events: none; }
.hm-node.sel text { font-weight: 700; }
.hm-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; font-size: .88rem; line-height: 1.55; overflow-wrap: anywhere; }
.hm-card h3 { margin: 0 0 4px; font-size: 1rem; }
.hm-card .hm-kind { display: inline-block; font-size: .72rem; border: 1px solid currentColor; border-radius: 999px; padding: 0 8px; margin-bottom: 6px; }
.hm-card ul { margin: 6px 0 0; padding-left: 1.1em; }
.hm-card li { margin: 3px 0; }
.hm-card .hm-nbbtn { font: inherit; font-size: .8rem; background: none; border: 0; padding: 0; color: var(--accent-ink); cursor: pointer; text-align: left; text-decoration: underline; text-underline-offset: 2px; }
.hm-card .hm-rel { color: var(--fg-2); font-size: .8rem; }
.hm-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 10px 0 0; font-size: .76rem; color: var(--fg-2); }
.hm-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; }
.hm-note { margin-top: 10px; font-size: .8rem; color: var(--muted); }
`;
  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }
  function secRef(id) {
    const m = String(id).replace(/^r-/, '').replace(/-/g, '.');
    const app = /^[A-Z]$/.test(m);
    return `<a href="#${esc(id)}">${bi(esc(app ? '附录 ' + m : '§' + m), esc(app ? 'App. ' + m : '§' + m))}</a>`;
  }

  // Deterministic force-directed layout (Fruchterman–Reingold). No randomness: same output every time.
  function layout(nodes, edges) {
    const n = nodes.length;
    const idx = new Map(nodes.map((d, i) => [d.id, i]));
    const kindOrder = KINDS.map((x) => x.k);
    const order = nodes.map((d, i) => i).sort((a, b) => kindOrder.indexOf(nodes[a].kind) - kindOrder.indexOf(nodes[b].kind) || a - b);
    order.forEach((i, r) => {
      const a = (2 * Math.PI * r) / n - Math.PI / 2;
      nodes[i].x = W / 2 + Math.cos(a) * W * 0.36;
      nodes[i].y = H / 2 + Math.sin(a) * H * 0.36;
    });
    const k = Math.sqrt((W * H) / n) * 0.95;
    let t = W / 6;
    const links = edges.map((e) => [idx.get(e.from), idx.get(e.to)]).filter((p) => p[0] != null && p[1] != null);
    for (let it = 0; it < 420; it++) {
      const dx = new Array(n).fill(0), dy = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const ex = nodes[i].x - nodes[j].x, ey = nodes[i].y - nodes[j].y;
        const d = Math.max(Math.hypot(ex, ey), 0.01), f = (k * k) / d;
        dx[i] += (ex / d) * f; dy[i] += (ey / d) * f;
        dx[j] -= (ex / d) * f; dy[j] -= (ey / d) * f;
      }
      for (const [i, j] of links) {
        const ex = nodes[i].x - nodes[j].x, ey = nodes[i].y - nodes[j].y;
        const d = Math.max(Math.hypot(ex, ey), 0.01), f = (d * d) / k;
        dx[i] -= (ex / d) * f; dy[i] -= (ey / d) * f;
        dx[j] += (ex / d) * f; dy[j] += (ey / d) * f;
      }
      for (let i = 0; i < n; i++) {
        dx[i] -= (nodes[i].x - W / 2) * 0.02; dy[i] -= (nodes[i].y - H / 2) * 0.02;
        const m = Math.hypot(dx[i], dy[i]);
        if (m > 0) { const s = Math.min(m, t); nodes[i].x += (dx[i] / m) * s; nodes[i].y += (dy[i] / m) * s; }
      }
      t *= 0.985;
    }
    // normalise into the canvas with margins for labels
    const mx = 90, my = 40;
    const xs = nodes.map((d) => d.x), ys = nodes.map((d) => d.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = (W - 2 * mx) / Math.max(x1 - x0, 1), sy = (H - 2 * my) / Math.max(y1 - y0, 1);
    nodes.forEach((d) => { d.x = mx + (d.x - x0) * sx; d.y = my + (d.y - y0) * sy; });
    // label-aware de-overlap in canvas units: each node is a box sized for its longest label
    const box = nodes.map((d) => ({ w: Math.max(String(d.zh || '').length * 14, String(d.en || '').length * 7.6) + 12, h: 34 }));
    for (let it = 0; it < 1500; it++) {
      let moved = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j];
        const ox = (box[i].w + box[j].w) / 2 - Math.abs(a.x - b.x);
        const oy = (box[i].h + box[j].h) / 2 - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy / (box[i].h + box[j].h) < ox / (box[i].w + box[j].w)) { const s = (a.y <= b.y ? -1 : 1) * (oy / 2 + 0.5); a.y += s; b.y -= s; }
        else { const s = (a.x <= b.x ? -1 : 1) * (ox / 2 + 0.5); a.x += s; b.x -= s; }
      }
      for (let i = 0; i < n; i++) {
        nodes[i].x = Math.min(W - box[i].w / 2, Math.max(box[i].w / 2, nodes[i].x));
        nodes[i].y = Math.min(H - 20, Math.max(20, nodes[i].y));
      }
      if (!moved) break;
    }
  }

  Book.registerPage({
    id: PAGE,
    group: 'hub',
    order: 60,
    icon: '⌘',
    title: { zh: '概念图', en: 'Concept map' },
    summary: {
      zh: '概念与关系的交互图：悬停或点按高亮邻接关系，点击打开小节与模型链接，可按类别筛选、缩放与平移。',
      en: 'Interactive map of concepts and relations: hover or tap to highlight neighbours, click for links to sections and models, filter by kind, pan and zoom.',
    },
    render(el, api) {
      injectCss('hm-css-map', CSS);
      const D = Book.data.data.concepts || { nodes: [], edges: [] };
      const nodes = (D.nodes || []).map((d) => Object.assign({}, d));
      const edges = (D.edges || []).filter((e) => nodes.some((d) => d.id === e.from) && nodes.some((d) => d.id === e.to));
      const byId = new Map(nodes.map((d) => [d.id, d]));
      layout(nodes, edges);
      const nb = new Map(nodes.map((d) => [d.id, new Set()]));
      edges.forEach((e) => { nb.get(e.from).add(e.to); nb.get(e.to).add(e.from); });

      const state = { sel: null, hov: null, kind: null, k: 1, x: 0, y: 0 };
      const narrow = window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
      if (narrow) { state.k = 1.5; state.x = (W - W * state.k) / 2; state.y = (H - H * state.k) / 2; }

      const kindChips = `<button type="button" class="hm-chip" data-kind="" aria-pressed="true">${bi('全部', 'All')} · ${nodes.length}</button>` + KINDS.map((x) =>
        `<button type="button" class="hm-chip" data-kind="${x.k}" aria-pressed="false"><i style="background:${x.c}"></i>${bi(x.zh, x.en)} · ${nodes.filter((d) => d.kind === x.k).length}</button>`).join('');

      el.innerHTML = `
        <div class="hm-hero"><div class="kicker">${bi('知识汇总 · 概念图', 'Knowledge hub · Concept map')}</div>
          <h1>${bi('概念、机制与风险之间的关系', 'How concepts, mechanisms and risks connect')}</h1>
          <p class="lede">${bi('节点是报告中的量、机制、风险、接口与验证；连线上的文字是关系。点击节点可跳转到对应小节和模型。', 'Nodes are quantities, mechanisms, risks, interfaces and verification steps from the report; the text on each line is the relation. Click a node to jump to its section and model.')}</p></div>
        <div class="hm-bar" role="group" aria-label="按类别筛选 / Filter by kind" data-role="kinds">${kindChips}</div>
        <div class="hm-grid">
          <div>
            <div class="hm-stage">
              <svg class="hm-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="概念图 / Concept map" data-role="svg">
                <g class="hm-view" data-role="view"></g>
              </svg>
              <div class="hm-zoom"><button type="button" data-zoom="in" aria-label="放大 / Zoom in">+</button><button type="button" data-zoom="out" aria-label="缩小 / Zoom out">−</button><button type="button" data-zoom="reset" aria-label="重置视图 / Reset view" title="重置视图 / Reset view" style="font-size:.7rem">⟲</button></div>
              <div class="hm-hint">${bi('拖动平移 · 双指或 Ctrl+滚轮缩放', 'Drag to pan · pinch or Ctrl+wheel to zoom')}</div>
            </div>
            <div class="hm-legend">${KINDS.map((x) => `<span><i style="background:${x.c}"></i>${bi(x.zh, x.en)}</span>`).join('')}</div>
          </div>
          <aside class="hm-card" data-role="card" aria-live="polite"></aside>
        </div>`;

      const svg = el.querySelector('[data-role="svg"]');
      const view = el.querySelector('[data-role="view"]');
      const card = el.querySelector('[data-role="card"]');
      const NS = 'http://www.w3.org/2000/svg';
      const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

      // edges (drawn first, under nodes)
      const edgeEls = edges.map((e, i) => {
        const g = mk('g', { 'data-edge': String(i) });
        const p = mk('line', { class: 'hm-edge' });
        const t = mk('text', { class: 'hm-elab', 'text-anchor': 'middle', display: 'none' });
        t.dataset.zh = e.zh; t.dataset.en = e.en;
        g.appendChild(p); g.appendChild(t);
        view.appendChild(g);
        return { e, g, p, t };
      });
      // nodes
      const nodeEls = new Map();
      nodes.forEach((d) => {
        const g = mk('g', { class: 'hm-node', 'data-id': d.id, tabindex: '0', role: 'button' });
        const hit = mk('circle', { r: 16, fill: 'transparent', class: 'hm-hit' });
        const c = mk('circle', { r: 8, style: `fill:${KIND.get(d.kind) ? KIND.get(d.kind).c : 'var(--s8)'}` });
        const t = mk('text', { x: 0, y: 22, 'text-anchor': 'middle' });
        t.dataset.zh = d.zh; t.dataset.en = d.en;
        g.appendChild(hit); g.appendChild(c); g.appendChild(t);
        g.setAttribute('transform', `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})`);
        view.appendChild(g);
        nodeEls.set(d.id, { d, g, t });
      });
      function labels() {
        const en = api.lang() === 'en';
        view.querySelectorAll('text[data-zh]').forEach((t) => { t.textContent = en ? t.dataset.en : t.dataset.zh; });
      }
      function setView() { view.setAttribute('transform', `translate(${state.x.toFixed(1)} ${state.y.toFixed(1)}) scale(${state.k.toFixed(3)})`); }
      // user-space coordinates of a client point
      function toUser(cx, cy) {
        const ctm = svg.getScreenCTM();
        if (!ctm) return { x: 0, y: 0 };
        const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
        const u = p.matrixTransform(ctm.inverse());
        return { x: u.x, y: u.y };
      }
      function zoomAt(ux, uy, factor) {
        const k2 = Math.min(4, Math.max(0.6, state.k * factor));
        const r = k2 / state.k;
        state.x = ux - (ux - state.x) * r;
        state.y = uy - (uy - state.y) * r;
        state.k = k2;
        setView();
      }

      function applyFocus() {
        const f = state.hov || state.sel;
        const near = f ? nb.get(f) : null;
        nodeEls.forEach(({ d, g }) => {
          const kindOff = state.kind && d.kind !== state.kind;
          const dim = kindOff || (f && d.id !== f && !near.has(d.id));
          g.classList.toggle('dim', !!dim);
          g.classList.toggle('sel', d.id === state.sel);
          g.classList.toggle('hov', d.id === state.hov);
          g.classList.toggle('nb', !!(f && d.id !== f && near.has(d.id)));
        });
        edgeEls.forEach(({ e, p, t }) => {
          const on = !!f && (e.from === f || e.to === f);
          const kindOff = state.kind && (byId.get(e.from).kind !== state.kind || byId.get(e.to).kind !== state.kind);
          p.setAttribute('class', 'hm-edge' + (on ? ' hot' : '') + (kindOff || (f && !on) ? ' dim' : ''));
          t.setAttribute('display', on ? '' : 'none');
          if (on) {
            const a = byId.get(e.from), b = byId.get(e.to);
            t.setAttribute('x', ((a.x + b.x) / 2).toFixed(1));
            t.setAttribute('y', ((a.y + b.y) / 2 - 4).toFixed(1));
          }
        });
        edgeEls.forEach(({ e, p }) => {
          const a = byId.get(e.from), b = byId.get(e.to);
          p.setAttribute('x1', a.x.toFixed(1)); p.setAttribute('y1', a.y.toFixed(1));
          p.setAttribute('x2', b.x.toFixed(1)); p.setAttribute('y2', b.y.toFixed(1));
        });
        renderCard();
      }

      function renderCard() {
        const d = state.sel && byId.get(state.sel);
        if (!d) {
          card.innerHTML = `<h3>${bi('怎么读这张图', 'How to read this map')}</h3>
            <p style="margin:0">${bi('点击或轻触一个节点，可高亮它的邻接关系并在此查看链接。键盘用户可用 Tab 聚焦节点后按 Enter。', 'Click or tap a node to highlight its neighbours and see its links here. Keyboard users can Tab to a node and press Enter.')}</p>
            <p class="hm-note">${bi('图是对报告关系的编辑性整理，不是电路框图；节点之间的连线表示报告中的依赖或约束，不代表物理连接。', 'The map is an editorial arrangement of the report\'s relations, not a circuit diagram; a line means a dependency or constraint stated in the report, not a physical connection.')}</p>`;
          return;
        }
        const K = KIND.get(d.kind);
        const w = d.widget && Book.widgets && Book.widgets.has(d.widget) ? Book.widgets.get(d.widget) : null;
        const outs = edges.filter((e) => e.from === d.id);
        const ins = edges.filter((e) => e.to === d.id);
        const rel = (e, dir) => {
          const other = byId.get(dir === 'out' ? e.to : e.from);
          return `<li><button type="button" class="hm-nbbtn" data-nb="${esc(other.id)}">${dir === 'out' ? '→' : '←'} ${bi(esc(other.zh), esc(other.en))}</button> <span class="hm-rel">${bi(esc(e.zh), esc(e.en))}</span></li>`;
        };
        card.innerHTML = `
          <span class="hm-kind" style="color:${K ? K.c : 'inherit'}">${K ? bi(K.zh, K.en) : esc(d.kind)}</span>
          <h3>${bi(esc(d.zh), esc(d.en))}</h3>
          <p style="margin:4px 0">${secRef(d.section)}</p>
          <p style="margin:4px 0;display:flex;flex-wrap:wrap;gap:8px">
            ${w ? `<a href="#w-${esc(d.widget)}">▶ ${bi(esc(w.title.zh), esc(w.title.en || w.title.zh))}</a>` : `<span class="hm-rel">${bi('无对应交互模型', 'No interactive model')}</span>`}
          </p>
          ${outs.length ? `<p style="margin:8px 0 0;font-weight:650">${bi('指向', 'Points to')}</p><ul>${outs.map((e) => rel(e, 'out')).join('')}</ul>` : ''}
          ${ins.length ? `<p style="margin:8px 0 0;font-weight:650">${bi('来自', 'From')}</p><ul>${ins.map((e) => rel(e, 'in')).join('')}</ul>` : ''}
          <p style="margin:10px 0 0"><button type="button" class="w-btn" data-act="clear">${bi('取消选中', 'Clear selection')}</button></p>`;
      }

      function select(id) {
        state.sel = state.sel === id ? null : id;
        state.hov = null;
        applyFocus();
      }

      // pointer: pan (one pointer), pinch zoom (two pointers), click to select
      const pointers = new Map();
      let drag = null, moved = false, pinch = null;
      svg.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = false;
        if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, sx: state.x, sy: state.y };
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: state.k };
        }
        svg.classList.add('drag');
      });
      window.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2 && pinch) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          const mid = toUser((a.x + b.x) / 2, (a.y + b.y) / 2);
          const target = Math.min(4, Math.max(0.6, pinch.k * (d / pinch.d)));
          zoomAt(mid.x, mid.y, target / state.k);
          moved = true;
          return;
        }
        if (drag && pointers.size === 1) {
          const p0 = toUser(drag.x, drag.y), p1 = toUser(e.clientX, e.clientY);
          const dx = p1.x - p0.x, dy = p1.y - p0.y;
          if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) moved = true;
          if (moved) { state.x = drag.sx + dx; state.y = drag.sy + dy; setView(); }
        }
      });
      const up = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size === 0) { drag = null; pinch = null; svg.classList.remove('drag'); }
        if (pointers.size === 1) { const [p] = [...pointers.values()]; drag = { x: p.x, y: p.y, sx: state.x, sy: state.y }; pinch = null; }
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);

      svg.addEventListener('click', (e) => {
        if (moved) { moved = false; return; }
        const g = e.target.closest('.hm-node');
        if (g) { select(g.dataset.id); return; }
        if (state.sel) { state.sel = null; applyFocus(); }
      });
      svg.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse') return;
        const g = e.target.closest('.hm-node');
        if (g && state.hov !== g.dataset.id) { state.hov = g.dataset.id; applyFocus(); }
      });
      svg.addEventListener('pointerout', (e) => {
        if (e.pointerType !== 'mouse') return;
        const g = e.target.closest('.hm-node');
        if (g && !g.contains(e.relatedTarget) && state.hov === g.dataset.id) { state.hov = null; applyFocus(); }
      });
      svg.addEventListener('keydown', (e) => {
        const g = e.target.closest && e.target.closest('.hm-node');
        if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(g.dataset.id); }
      });
      svg.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const u = toUser(e.clientX, e.clientY);
        zoomAt(u.x, u.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      }, { passive: false });

      el.addEventListener('click', (e) => {
        const kb = e.target.closest('[data-kind]');
        if (kb) {
          state.kind = kb.dataset.kind || null;
          el.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.kind || null) === state.kind)));
          applyFocus();
          return;
        }
        const z = e.target.closest('[data-zoom]');
        if (z) {
          if (z.dataset.zoom === 'reset') { state.k = narrow ? 1.5 : 1; state.x = (W - W * state.k) / 2; state.y = (H - H * state.k) / 2; setView(); }
          else zoomAt(W / 2, H / 2, z.dataset.zoom === 'in' ? 1.25 : 0.8);
          return;
        }
        const nbb = e.target.closest('[data-nb]');
        if (nbb) { state.sel = nbb.dataset.nb; state.hov = null; applyFocus(); return; }
        const clr = e.target.closest('[data-act="clear"]');
        if (clr) { state.sel = null; applyFocus(); }
      });
      // keep node elements' keyboard focus accessible
      nodeEls.forEach(({ g, d }) => {
        g.setAttribute('aria-label', `${d.zh} / ${d.en}`);
      });

      setView();
      labels();
      applyFocus();
      api.onLang(() => { labels(); renderCard(); });
    },
  });
})();
