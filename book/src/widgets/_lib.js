/* Widget helper kit — global `W`. Loaded before every widget file.
 *
 * Conventions for widget authors
 * ------------------------------
 *  - One file per widget in book/src/widgets/<id>.js, wrapped in an IIFE, calling Book.registerWidget({...}).
 *  - Vanilla JS + SVG (or <canvas> for dense/fast plots). No external libraries. No network.
 *  - Bilingual text: W.L(zh, en) for HTML labels (switches via CSS, no re-render needed),
 *    W.sL(zh, en, attrs) for SVG <text>. For dynamic strings use api.t(zh, en) and re-render on api.onLang.
 *  - Colors: CSS variables only (var(--sig-clk) etc.) so light/dark themes work. In canvas, read them via
 *    api.css('--sig-clk') and re-read on api.onTheme().
 *  - Animations: api.loop((dt, t) => ...) — auto-paused when off-screen; respect api.reducedMotion
 *    (start paused if true).
 *  - Must work at 360px width (phones): use viewBox-scaled SVG (W.svg) and wrapping control rows.
 */
(function () {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';

  function applyProps(el, props, isSvg) {
    if (!props) return el;
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (!isSvg && (k in el) && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const W = {
    /** HTML element builder: W.h('div', {class:'x', onClick: fn}, child, ...) */
    h(tag, props, ...children) { return append(applyProps(document.createElement(tag), props, false), children); },
    /** SVG element builder */
    s(tag, attrs, ...children) { return append(applyProps(document.createElementNS(SVGNS, tag), attrs, true), children); },
    /** Responsive SVG root with a fixed coordinate system (viewBox). */
    svg(width, height, attrs = {}) {
      return W.s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'w-svg', role: 'img', preserveAspectRatio: 'xMidYMid meet', ...attrs });
    },
    /** Bilingual HTML label (CSS-switched). */
    L(zh, en) { const f = document.createDocumentFragment(); f.append(W.h('span', { class: 'i18n-zh' }, zh), W.h('span', { class: 'i18n-en' }, en == null ? zh : en)); return f; },
    /** Bilingual SVG text: returns <g> holding two <text> nodes. attrs apply to both (x, y, class, text-anchor...). */
    sL(zh, en, attrs = {}) {
      return W.s('g', null, W.s('text', { ...attrs, class: ((attrs.class || '') + ' i18n-zh').trim() }, zh), W.s('text', { ...attrs, class: ((attrs.class || '') + ' i18n-en').trim() }, en == null ? zh : en));
    },
    /** Remove all children. */
    clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; },

    // ------------------------------------------------------------------ controls
    controls(...children) { return W.h('div', { class: 'w-controls' }, ...children); },
    /** Slider. opts: {label:[zh,en]|string, min, max, step, value, fmt(v)->string, onInput(v)} */
    slider(opts) {
      const out = W.h('output');
      const input = W.h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step || 1 });
      input.value = opts.value;
      const fmt = opts.fmt || ((v) => String(v));
      const show = () => { out.textContent = fmt(+input.value); };
      input.addEventListener('input', () => { show(); opts.onInput && opts.onInput(+input.value); });
      show();
      const wrap = W.h('label', { class: 'w-ctl' }, W.lbl(opts.label), input, out);
      Object.defineProperty(wrap, 'value', { get: () => +input.value, set: (v) => { input.value = v; show(); } });
      wrap.input = input;
      return wrap;
    },
    /** Select. opts: {label, options:[{value, label:[zh,en]|string}], value, onChange(v)} */
    select(opts) {
      const sel = W.h('select');
      const build = () => {
        W.clear(sel);
        for (const o of opts.options) sel.appendChild(W.h('option', { value: o.value }, W.txt(o.label)));
        sel.value = String(opts.value);
      };
      build();
      Book.on('lang', () => { const v = sel.value; build(); sel.value = v; });
      sel.addEventListener('change', () => { opts.value = sel.value; opts.onChange && opts.onChange(sel.value); });
      const wrap = W.h('label', { class: 'w-ctl' }, opts.label ? W.lbl(opts.label) : null, sel);
      Object.defineProperty(wrap, 'value', { get: () => sel.value, set: (v) => { sel.value = v; opts.value = v; } });
      return wrap;
    },
    /** Segmented buttons. opts: {label?, options:[{value, label}], value, onChange(v)} */
    seg(opts) {
      const box = W.h('div', { class: 'w-seg', role: 'group' });
      let cur = opts.value;
      const btns = opts.options.map((o) => W.h('button', { type: 'button', onClick: () => set(o.value, true) }, W.lbl(o.label)));
      btns.forEach((b, i) => { b.dataset.v = opts.options[i].value; box.appendChild(b); });
      function set(v, fire) { cur = v; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(String(opts.options[i].value) === String(v)))); if (fire && opts.onChange) opts.onChange(v); }
      set(cur, false);
      const wrap = W.h('div', { class: 'w-ctl' }, opts.label ? W.lbl(opts.label) : null, box);
      Object.defineProperty(wrap, 'value', { get: () => cur, set: (v) => set(v, false) });
      return wrap;
    },
    /** Checkbox toggle. opts: {label, value, onChange(bool)} */
    toggle(opts) {
      const input = W.h('input', { type: 'checkbox' });
      input.checked = !!opts.value;
      input.addEventListener('change', () => opts.onChange && opts.onChange(input.checked));
      const wrap = W.h('label', { class: 'w-toggle' }, input, W.lbl(opts.label));
      Object.defineProperty(wrap, 'value', { get: () => input.checked, set: (v) => { input.checked = !!v; } });
      return wrap;
    },
    /** Button. label: [zh,en] | string | Node */
    button(label, onClick, opts = {}) {
      return W.h('button', { type: 'button', class: 'w-btn' + (opts.primary ? ' primary' : ''), onClick, title: opts.title }, W.lbl(label));
    },
    /** Play/pause button bound to an api.loop controller. */
    playButton(loop, api) {
      const b = W.h('button', { type: 'button', class: 'w-btn primary' });
      const sync = () => { W.clear(b); b.append(loop.running ? W.L('❚❚ 暂停', '❚❚ Pause') : W.L('▶ 播放', '▶ Play')); };
      b.addEventListener('click', () => { loop.toggle(); sync(); });
      sync();
      b.sync = sync;
      return b;
    },
    /** Key/value readout grid. Returns {el, set(key, value, label?)} */
    readout(items) {
      const el = W.h('div', { class: 'w-readout' });
      const cells = {};
      for (const it of items) {
        const v = W.h('div', { class: 'v' }, it.value == null ? '—' : String(it.value));
        el.appendChild(W.h('div', { class: 'w-kv' }, W.h('div', { class: 'k' }, W.lbl(it.label)), v));
        cells[it.key] = v;
      }
      return { el, set(key, value) { if (cells[key]) { if (value instanceof Node) { W.clear(cells[key]).append(value); } else cells[key].textContent = value; } }, cell: (k) => cells[k] };
    },
    /** Status pill: kind in 'good'|'warn'|'bad'. */
    status(kind, label) { return W.h('span', { class: 'w-status ' + kind }, W.lbl(label)); },
    /** Note box (kind optional: good|warn|bad). */
    note(content, kind) { return W.h('div', { class: 'w-note' + (kind ? ' ' + kind : '') }, typeof content === 'string' || Array.isArray(content) ? W.lbl(content) : content); },
    /** Legend: items [{color:'var(--sig-clk)', label:[zh,en]}] */
    legend(items) {
      return W.h('div', { class: 'w-legend' }, items.map((it) => W.h('span', null, W.h('i', { style: { background: it.color, height: it.dash ? '0' : '3px', borderTop: it.dash ? `2px dashed ${it.color}` : '' } }), W.lbl(it.label))));
    },
    /** Normalise a label: [zh,en] | {zh,en} | string | Node */
    lbl(l) {
      if (l == null) return null;
      if (l instanceof Node) return l;
      if (Array.isArray(l)) return W.L(l[0], l[1]);
      if (typeof l === 'object') return W.L(l.zh, l.en);
      return document.createTextNode(String(l));
    },
    /** Plain text for the current language from a label */
    txt(l) {
      if (l == null) return '';
      const en = window.Book && Book.lang() === 'en';
      if (Array.isArray(l)) return en ? l[1] : l[0];
      if (typeof l === 'object') return en ? l.en : l.zh;
      return String(l);
    },
    /** Math HTML node (KaTeX) */
    tex(src, display) { const span = W.h('span'); span.innerHTML = Book.tex(src, display); return span; },

    // ------------------------------------------------------------------ waveform helpers
    /**
     * Path data for a digital waveform.
     * edges: sorted array of {t, v} (value after time t); v0 initial value (0/1).
     * x(t) maps time to x; yHi, yLo pixel rows for logic 1 / 0; t0..t1 drawing window.
     */
    digitalPath(edges, v0, x, yHi, yLo, t0, t1) {
      let v = v0, d = `M${x(t0).toFixed(2)},${(v ? yHi : yLo).toFixed(2)}`;
      for (const e of edges) {
        if (e.t <= t0) { v = e.v; d = `M${x(t0).toFixed(2)},${(v ? yHi : yLo).toFixed(2)}`; continue; }
        if (e.t >= t1) break;
        const X = x(e.t).toFixed(2);
        d += `L${X},${(v ? yHi : yLo).toFixed(2)}L${X},${(e.v ? yHi : yLo).toFixed(2)}`;
        v = e.v;
      }
      d += `L${x(t1).toFixed(2)},${(v ? yHi : yLo).toFixed(2)}`;
      return d;
    },
    /** Square clock edges between t0..t1 for period T, phase offset ph (time of a rising edge), duty 0..1 */
    clockEdges(T, ph, t0, t1, duty = 0.5) {
      const edges = [];
      let k = Math.floor((t0 - ph) / T) - 1;
      for (; ph + k * T < t1 + T; k++) {
        const r = ph + k * T;
        edges.push({ t: r, v: 1, k }, { t: r + duty * T, v: 0, k });
      }
      return edges.filter((e) => e.t > t0 - T && e.t < t1 + T).sort((a, b) => a.t - b.t);
    },
    /**
     * Bus waveform (hexagon-style value boxes) as an SVG group.
     * segs: [{t0, t1, label, cls?}] ; x(t) mapping; y center; h height.
     */
    busGroup(segs, x, y, h, opts = {}) {
      const g = W.s('g', { class: 'bus' });
      const k = Math.min(4, h / 2);
      for (const sg of segs) {
        const a = x(sg.t0), b = x(sg.t1);
        if (b - a < 0.5) continue;
        const kk = Math.min(k, (b - a) / 2);
        const d = `M${a},${y}L${a + kk},${y - h / 2}L${b - kk},${y - h / 2}L${b},${y}L${b - kk},${y + h / 2}L${a + kk},${y + h / 2}Z`;
        g.appendChild(W.s('path', { d, fill: sg.fill || opts.fill || 'none', 'fill-opacity': sg.fill ? 0.14 : 1, stroke: sg.stroke || opts.stroke || 'var(--fg-2)', 'stroke-width': 1.2 }));
        if (sg.label != null && b - a > (opts.minLabelW || 14)) g.appendChild(W.s('text', { x: (a + b) / 2, y: y + 3.8, 'text-anchor': 'middle', class: 'mono', style: 'font-size:10.5px;fill:var(--fg)' }, String(sg.label)));
      }
      return g;
    },
    /** Linear scale helper: W.scale([d0,d1],[r0,r1]) -> fn with .invert */
    scale(domain, range) {
      const [d0, d1] = domain, [r0, r1] = range;
      const f = (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
      f.invert = (p) => d0 + ((p - r0) / (r1 - r0)) * (d1 - d0);
      f.domain = domain; f.range = range;
      return f;
    },
    /** Nice ticks */
    ticks(a, b, n = 5) {
      const span = b - a; if (!(span > 0)) return [a];
      const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
      const err = step0 / mag;
      const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
      const out = [];
      for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(+v.toFixed(12));
      return out;
    },
    /** Format a number with fixed decimals, trimming trailing zeros */
    fmt(v, d = 3) { if (!isFinite(v)) return String(v); const s = (+v).toFixed(d); return s.includes('.') ? s.replace(/\.?0+$/, '') : s; },
    clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
    mod(a, m) { return ((a % m) + m) % m; },
    /** Deterministic PRNG (mulberry32) for reproducible simulations */
    rng(seed = 1) {
      let a = seed >>> 0;
      const r = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      r.normal = () => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
      return r;
    },
    /** Hover tooltip attached to a positioned container. Returns {show(x,y,html), hide()} */
    tooltip(container) {
      container.style.position = container.style.position || 'relative';
      const tip = W.h('div', { class: 'w-tip' }); tip.hidden = true; container.appendChild(tip);
      return {
        show(x, y, html) {
          tip.innerHTML = html; tip.hidden = false;
          const cw = container.clientWidth;
          const tw = tip.offsetWidth;
          tip.style.left = Math.max(0, Math.min(cw - tw, x + 12)) + 'px';
          tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
        },
        hide() { tip.hidden = true; },
      };
    },
    /** Map a pointer event to SVG viewBox coordinates. */
    svgPoint(svg, ev) {
      const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
      const m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
      const p = pt.matrixTransform(m.inverse()); return { x: p.x, y: p.y };
    },
    /** Canvas sized to its CSS width with devicePixelRatio; returns {canvas, ctx, w, h, resize()} */
    canvas(heightPx, onResize) {
      const canvas = W.h('canvas', { class: 'w-canvas' });
      const o = { canvas, ctx: canvas.getContext('2d'), w: 0, h: heightPx };
      o.resize = () => {
        const w = canvas.clientWidth || canvas.parentElement && canvas.parentElement.clientWidth || 600;
        const dpr = window.devicePixelRatio || 1;
        o.w = w; canvas.width = Math.round(w * dpr); canvas.height = Math.round(heightPx * dpr);
        canvas.style.height = heightPx + 'px';
        o.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        onResize && onResize(o);
      };
      if ('ResizeObserver' in window) new ResizeObserver(() => o.resize()).observe(canvas);
      requestAnimationFrame(o.resize);
      return o;
    },
  };

  // ------------------------------------------------------------------ exact rationals (BigInt)
  function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; }
  class Frac {
    constructor(n, d = 1n) {
      n = BigInt(n); d = BigInt(d);
      if (d === 0n) throw new Error('zero denominator');
      if (d < 0n) { n = -n; d = -d; }
      const g = gcd(n, d) || 1n;
      this.n = n / g; this.d = d / g;
    }
    static of(x) { return x instanceof Frac ? x : new Frac(x); }
    add(o) { o = Frac.of(o); return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { o = Frac.of(o); return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { o = Frac.of(o); return new Frac(this.n * o.n, this.d * o.d); }
    div(o) { o = Frac.of(o); return new Frac(this.n * o.d, this.d * o.n); }
    neg() { return new Frac(-this.n, this.d); }
    cmp(o) { o = Frac.of(o); const l = this.n * o.d, r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
    eq(o) { return this.cmp(o) === 0; }
    valueOf() { return Number(this.n) / Number(this.d); }
    toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
  }
  W.Frac = Frac;
  W.F = (n, d) => new Frac(n, d == null ? 1n : d);

  window.W = W;
})();
