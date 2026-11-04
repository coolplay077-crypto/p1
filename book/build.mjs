// Build the interactive bilingual HTML edition of the CNT-ADPLL book.
//
//   node book/build.mjs            -> book/dist/index.html (single self-contained file)
//
// Chinese sources are read directly from the repository documents (single source of truth);
// English translations live in book/content/en/. Sections are paired across languages by
// their heading number (e.g. "3.2", "A"), so translations must keep the same heading tree.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import katex from 'katex';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const abs = (p) => path.resolve(ROOT, p);
const read = (p) => fs.readFileSync(abs(p), 'utf8');
const exists = (p) => fs.existsSync(abs(p));
const readJSON = (p, fallback) => (exists(p) ? JSON.parse(read(p)) : fallback);
// a source may be a file or a directory of *.md parts (concatenated in name order)
const readSource = (p) => {
  if (!exists(p)) return null;
  if (fs.statSync(abs(p)).isDirectory()) {
    const files = fs.readdirSync(abs(p)).filter((f) => f.endsWith('.md')).sort();
    if (!files.length) return null;
    return files.map((f) => read(path.join(p, f)).replace(/\s+$/, '')).join('\n\n');
  }
  return read(p);
};
const argOut = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : 'book/dist/index.html'; })();

const warnings = [];
const warn = (msg) => { warnings.push(msg); };

// ---------------------------------------------------------------------------
// Source documents
// ---------------------------------------------------------------------------
const DOCS = [
  {
    key: 'intro', prefix: 'i',
    zh: 'docs/CNT_ADPLL_工程介绍.md',
    en: 'book/content/en/intro.en.md',
    title: { zh: '工程介绍', en: 'Engineering Introduction' },
    splitPagesAt: 0, // single page
  },
  {
    key: 'report', prefix: 'r',
    zh: 'research/CNT_ADPLL_调研整合与核心问题报告.md',
    en: 'book/content/en/report', // directory: all *.md files concatenated in name order
    title: { zh: '调研整合与核心问题报告', en: 'Research Synthesis & Core Problems Report' },
    splitPagesAt: 1, // one page per H1 chapter
  },
];

const glossary = readJSON('book/data/glossary.json', { terms: [] });
const widgetMap = readJSON('book/data/widget-map.json', {});

// ---------------------------------------------------------------------------
// Markdown -> sections
// ---------------------------------------------------------------------------
function stripFrontMatter(md) {
  const fm = {};
  if (md.startsWith('---\n')) {
    const end = md.indexOf('\n---', 4);
    const block = md.slice(4, end);
    for (const line of block.split('\n')) {
      const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
      if (m) fm[m[1]] = m[2];
    }
    md = md.slice(md.indexOf('\n', end + 1) + 1);
  }
  return { fm, md };
}

function headingNum(title) {
  let m = title.match(/^(\d+(?:\.\d+)*)\.?\s+/);
  if (m) return m[1];
  m = title.match(/^(?:附录|Appendix)\s*([A-Z])(?=[\s.．:：]|$)/);
  if (m) return m[1];
  return null;
}

function stripNum(title) {
  return title
    .replace(/^(\d+(?:\.\d+)*)\.?\s+/, '')
    .replace(/^(?:附录|Appendix)\s*([A-Z])[.．:：]?\s*/, '');
}

function parseSections(md, doc) {
  const lines = md.split('\n');
  const sections = [];
  let cur = { level: 0, num: '0', rawTitle: '', lines: [] };
  let inFence = false;
  let unnamed = 0;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const hm = !inFence && line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (hm) {
      sections.push(cur);
      const level = hm[1].length;
      let num = headingNum(hm[2]);
      if (num == null) num = level === 1 && sections.length <= 1 ? '0' : `x${++unnamed}`;
      cur = { level, num, rawTitle: hm[2], lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  sections.push(cur);
  // merge a leading empty preface into the title section when the doc starts with an H1 title
  const out = [];
  for (const s of sections) {
    const body = s.lines.join('\n').trim();
    if (s.level === 0 && !body) continue;
    if (s.level === 0 && out.length === 0 && sections[1] && sections[1].num === '0') {
      sections[1].lines.unshift(...s.lines);
      continue;
    }
    out.push({ ...s, body, id: `${doc.prefix}-${s.num.replace(/\./g, '-')}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
const mdit = new MarkdownIt({ html: true, linkify: false, typographer: false });
// open external links in a new tab
const defaultLinkOpen = mdit.renderer.rules.link_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
mdit.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (/^https?:/.test(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener');
    tokens[idx].attrJoin('class', 'ext');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};
// wrap tables so they can scroll horizontally on phones
mdit.renderer.rules.table_open = () => '<div class="tbl-wrap"><table>\n';
mdit.renderer.rules.table_close = () => '</table></div>\n';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tex(src, display) {
  try {
    return katex.renderToString(src, {
      displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml', trust: false,
    });
  } catch (e) {
    warn(`KaTeX error: ${e.message} in ${src}`);
    return `<code>${esc(src)}</code>`;
  }
}

/**
 * Pre-process one markdown chunk: protect code, extract math, add cross-references,
 * citations and glossary terms. Returns markdown with placeholders + a restore() function.
 */
function preprocess(md, ctx) {
  const ph = [];
  const put = (html) => `@@P${ph.push(html) - 1}@@`;
  const out = [];
  const parts = md.split(/(^```[\s\S]*?^```\s*$)/m);
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    if (pi % 2 === 1) { out.push(part); continue; } // fenced code as-is
    let s = part;
    // display math $$...$$ (possibly multi-line)
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, body) => {
      const src = body.trim();
      const tag = (src.match(/\\tag\{([^}]+)\}/) || [])[1];
      ctx.eqs.push({ tag, tex: src });
      const attrs = tag ? ` data-eq="${esc(tag)}"` : '';
      return `\n\n${put(`<div class="eq"${attrs} data-tex="${esc(src)}"><div class="eq-body">${tex(src, true)}</div></div>`)}\n\n`;
    });
    // split by inline code spans so we never touch them
    const segs = s.split(/(`[^`\n]+`)/);
    for (let si = 0; si < segs.length; si += 2) {
      let t = segs[si];
      // inline math
      t = t.replace(/\$([^$\n]+?)\$/g, (_, body) => put(`<span class="im" data-tex="${esc(body)}">${tex(body, false)}</span>`));
      // reference definitions at paragraph start: **[R01] ...
      t = t.replace(/^\*\*\[((?:R|H)\d{2})\]/gm, (_, id) => `**${put(`<span class="refdef" id="${ctx.lang === 'zh' ? 'ref-' + id : 'ref-' + id + '-en'}" data-refdef="${id}">[${id}]</span>`)}`);
      // citations [R01], [R01–R04], [H01]
      t = t.replace(/\[((?:R|H)\d{2})(?:\s*[–\-]\s*((?:R|H)\d{2}))?\](?!\()/g, (m, a, b) =>
        put(`<a class="cite" href="#ref-${a}" data-ref="${a}"${b ? ` data-ref-end="${b}"` : ''}>${esc(m)}</a>`));
      // equation references: 式 (1)–(2), Eq. (5), Eqs. (7)–(8)
      t = t.replace(/(式|Eqs?\.|[Ee]quations?)(\s*)((?:\(\d{1,2}\)(?:\s*(?:–|—|-|~|、|,|，|and|&|和|与|及|or|或)\s*(?=\())?)+)/g,
        (m, w, sp, grp) => w + sp + grp.replace(/\((\d{1,2})\)/g, (mm, n) => put(`<a class="xref eqref" href="#eq-${n}" data-eq-ref="${n}">(${n})</a>`)));
      // section references
      t = t.replace(/(报告)?第\s*(\d+(?:\.\d+)?)\s*(节|章)/g, (m, rep, n, unit) => {
        const prefix = rep ? 'r' : ctx.prefix;
        return linkSec(m, prefix, n, put);
      });
      t = t.replace(/\b(Sections?|Chapters?|§)\s*(\d+(?:\.\d+)?)(?![\d.]*\d)/g, (m, w, n) => linkSec(m, ctx.prefix, n, put));
      t = t.replace(/(附录|Appendix)\s*([AB])(?![A-Za-z])/g, (m, w, n) => linkSec(m, 'r', n, put));
      segs[si] = t;
    }
    out.push(segs.join(''));
  }
  let text = out.join('');
  text = linkGlossary(text, ctx, put);
  const restore = (html) => {
    html = html.replace(/<p>@@P(\d+)@@<\/p>/g, (_, i) => ph[+i]);
    for (let k = 0; k < 3; k++) html = html.replace(/@@P(\d+)@@/g, (_, i) => ph[+i]);
    return html;
  };
  return { text, restore };
}

function linkSec(m, prefix, n, put) {
  const id = `${prefix}-${n.replace(/\./g, '-')}`;
  if (!ALL_IDS.has(id)) return m;
  return put(`<a class="xref secref" href="#${id}">${esc(m)}</a>`);
}

// Wrap the first occurrence of each glossary term per section (outside placeholders/code).
function linkGlossary(text, ctx, put) {
  const terms = glossary.terms || [];
  if (!terms.length) return text;
  const lines = text.split('\n');
  let inFence = false;
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence || /^#{1,6}\s/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) continue;
    for (const term of terms) {
      if (!term.autolink || ctx.usedTerms.has(term.id)) continue;
      const loc = term[ctx.lang];
      if (!loc) continue;
      const aliases = [loc.term, ...(loc.aliases || [])].filter(Boolean).sort((a, b) => b.length - a.length);
      for (const a of aliases) {
        const isAscii = /^[\x20-\x7e]+$/.test(a);
        const re = new RegExp((isAscii ? '(^|[^A-Za-z0-9_@`/-])(' : '()(') + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (isAscii ? ')(?![A-Za-z0-9_])' : ')'));
        // only search text outside code spans and placeholders
        const segs = line.split(/(`[^`]+`|@@P\d+@@)/);
        let done = false;
        for (let si = 0; si < segs.length && !done; si += 2) {
          const mm = segs[si].match(re);
          if (mm) {
            const at = mm.index + mm[1].length;
            segs[si] = segs[si].slice(0, at) + put(`<span class="term" tabindex="0" data-term="${term.id}">${esc(mm[2])}</span>`) + segs[si].slice(at + mm[2].length);
            done = true;
          }
        }
        if (done) { line = segs.join(''); ctx.usedTerms.add(term.id); break; }
      }
    }
    lines[li] = line;
  }
  return lines.join('\n');
}

function plainText(md) {
  return md
    .replace(/^```[\s\S]*?^```/gm, (m) => m.replace(/```\w*/g, ''))
    .replace(/\$\$?/g, ' ')
    .replace(/\\(qquad|quad|,|;|!)/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
    .replace(/[|>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderTitle(raw, ctx) {
  const pre = preprocess(stripNum(raw), { ...ctx, usedTerms: new Set(['*all*']), eqs: [] });
  return pre.restore(mdit.renderInline(pre.text));
}

// ---------------------------------------------------------------------------
// Assemble pages
// ---------------------------------------------------------------------------
const ALL_IDS = new Set();
const parsed = DOCS.map((doc) => {
  const zhRaw = stripFrontMatter(read(doc.zh));
  const enSrc = readSource(doc.en);
  const enRaw = enSrc ? stripFrontMatter(enSrc) : { fm: {}, md: '' };
  if (!enSrc) warn(`English source missing: ${doc.en}`);
  const zh = parseSections(zhRaw.md, doc);
  const en = enRaw.md ? parseSections(enRaw.md, doc) : [];
  zh.forEach((s) => ALL_IDS.add(s.id));
  return { doc, zh, en, fm: { zh: zhRaw.fm, en: enRaw.fm } };
});

// primary slot of each widget (gets id="w-<widget>"): first report section listing it, else first intro section
const primarySlot = {};
for (const pass of ['r-', 'i-']) for (const [sec, ws] of Object.entries(widgetMap)) if (sec.startsWith(pass)) for (const w of ws) if (!primarySlot[w]) primarySlot[w] = sec;

const nav = [];
const searchIndex = [];
const pagesHtml = [];
const eqIndex = {};

for (const { doc, zh, en, fm } of parsed) {
  const enById = new Map(en.map((s) => [s.id, s]));
  for (const s of en) if (!zh.find((z) => z.id === s.id)) warn(`[${doc.key}] English section ${s.id} ("${s.rawTitle}") has no Chinese counterpart`);
  for (const s of zh) if (en.length && !enById.has(s.id)) warn(`[${doc.key}] Chinese section ${s.id} ("${s.rawTitle}") has no English counterpart`);

  // group into pages
  const pages = [];
  for (const s of zh) {
    const pageId = doc.splitPagesAt === 0 ? doc.key : `${doc.prefix}-${s.num.split('.')[0]}`;
    let page = pages.find((p) => p.id === pageId);
    if (!page) { page = { id: pageId, sections: [] }; pages.push(page); }
    page.sections.push(s);
  }

  for (const page of pages) {
    const ctxBase = { prefix: doc.prefix, doc: doc.key };
    const usedTerms = { zh: new Set(), en: new Set() };
    const navPage = { id: page.id, doc: doc.key, title: {}, num: null, sections: [] };
    let html = '';
    for (const s of page.sections) {
      const pair = { zh: s, en: enById.get(s.id) };
      const titles = {};
      let cols = '';
      for (const lang of ['zh', 'en']) {
        const sec = pair[lang];
        const ctx = { ...ctxBase, lang, usedTerms: usedTerms[lang], eqs: [] };
        let titleRaw = sec ? sec.rawTitle : '';
        if (s.num === '0' && doc.key === 'report') titleRaw = (fm[lang] && fm[lang].title) || (lang === 'zh' ? '前言' : 'Preface');
        const titleHtml = titleRaw ? renderTitle(titleRaw, ctx) : '';
        titles[lang] = stripNum(titleRaw).replace(/\$([^$]+)\$/g, '$1').replace(/\*\*/g, '');
        let bodyMd = sec ? sec.body : '';
        if (s.num === '0' && doc.key === 'report' && fm[lang]) {
          const f = fm[lang];
          bodyMd = [f.subtitle && `*${f.subtitle}*`, f.date && `<span class="doc-date">${f.date}</span>`].filter(Boolean).join('\n\n') + '\n\n' + bodyMd;
        }
        const pre = preprocess(bodyMd, ctx);
        const body = pre.restore(mdit.render(pre.text));
        for (const e of ctx.eqs) if (e.tag && lang === 'zh') eqIndex[e.tag] = { tex: e.tex, section: s.id, page: page.id };
        const level = s.level || 1;
        const hTag = `h${Math.min(level + 1, 6)}`;
        const numLabel = /^x/.test(s.num) || s.num === '0' ? '' : (/^[A-Z]$/.test(s.num) ? (lang === 'zh' ? `附录 ${s.num}` : `Appendix ${s.num}`) : s.num);
        const heading = titleHtml || numLabel
          ? `<${hTag} class="h"><a class="h-anchor" href="#${s.id}" aria-label="link">#</a>${numLabel ? `<span class="h-num">${numLabel}</span> ` : ''}${titleHtml}</${hTag}>`
          : '';
        const missing = !sec ? `<p class="missing">${lang === 'zh' ? '（本节暂无中文内容）' : '(English translation pending for this section.)'}</p>` : '';
        cols += `<div class="sec-lang" data-l="${lang}" lang="${lang === 'zh' ? 'zh-CN' : 'en'}">${heading}${body}${missing}</div>`;
        searchIndex.push({ s: s.id, p: page.id, l: lang, t: (numLabel ? numLabel + ' ' : '') + titles[lang], x: plainText(bodyMd) });
      }
      html += `<section class="sec lvl-${s.level || 1}" id="${s.id}" data-num="${s.num}">${cols}</section>\n`;
      for (const w of widgetMap[s.id] || []) html += `<div class="wslot"${primarySlot[w] === s.id ? ` id="w-${w}"` : ''} data-widget="${w}" data-sec="${s.id}"></div>\n`;
      if (s.level <= (doc.splitPagesAt || 1) && !navPage.title.zh) {
        navPage.title = titles; navPage.num = /^x/.test(s.num) ? null : s.num;
      }
      navPage.sections.push({ id: s.id, num: s.num, level: s.level || 1, title: titles });
    }
    if (doc.key === 'intro') { navPage.title = doc.title; navPage.num = null; }
    if (page.id === 'r-0') navPage.title = { zh: '前言 · 报告定位', en: 'Preface · Scope of the report' };
    nav.push(navPage);
    pagesHtml.push(`<article class="page doc-page" data-page="${page.id}" data-doc="${doc.key}" hidden>\n${html}</article>`);
  }
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
function katexCss() {
  const dir = abs('book/node_modules/katex/dist');
  let css = fs.readFileSync(path.join(dir, 'katex.min.css'), 'utf8');
  css = css.replace(/src:([^;}]+)/g, (m, list) => {
    const woff2 = list.match(/url\((fonts\/[^)]+\.woff2)\)/);
    if (!woff2) return m;
    const data = fs.readFileSync(path.join(dir, woff2[1])).toString('base64');
    return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
  });
  return css;
}

const srcDir = abs('book/src');
const widgetFiles = fs.readdirSync(path.join(srcDir, 'widgets')).filter((f) => f.endsWith('.js') && !f.startsWith('.')).sort((a, b) => (a.startsWith('_') ? -1 : b.startsWith('_') ? 1 : a.localeCompare(b)));
const pageFiles = exists('book/src/pages') ? fs.readdirSync(path.join(srcDir, 'pages')).filter((f) => f.endsWith('.js')).sort() : [];

const dataFiles = fs.readdirSync(abs('book/data')).filter((f) => f.endsWith('.json'));
const data = {};
for (const f of dataFiles) data[f.replace(/\.json$/, '')] = JSON.parse(read(`book/data/${f}`));

const bookData = {
  built: new Date().toISOString().slice(0, 10),
  nav,
  eqIndex,
  search: searchIndex,
  data,
  checks: readJSON('research/logical_check_results.json', null),
  verifyScript: exists('research/verify_invariants.py') ? read('research/verify_invariants.py') : '',
};

const scriptTag = (code) => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
const jsonTag = (id, obj) => `<script type="application/json" id="${id}">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

const template = read('book/src/template.html');
const outHtml = template
  .replace('/*__KATEX_CSS__*/', () => katexCss())
  .replace('/*__APP_CSS__*/', () => read('book/src/app.css'))
  .replace('<!--__PAGES__-->', () => pagesHtml.join('\n'))
  .replace('<!--__DATA__-->', () => jsonTag('book-data', bookData))
  .replace('<!--__SCRIPTS__-->', () => [
    scriptTag(fs.readFileSync(abs('book/node_modules/katex/dist/katex.min.js'), 'utf8')),
    scriptTag(read('book/src/app.js')),
    ...widgetFiles.map((f) => `<!-- widget: ${f} -->\n` + scriptTag(read(`book/src/widgets/${f}`))),
    ...pageFiles.map((f) => `<!-- page: ${f} -->\n` + scriptTag(read(`book/src/pages/${f}`))),
    scriptTag('Book.start();'),
  ].join('\n'));

fs.mkdirSync(path.dirname(abs(argOut)), { recursive: true });
fs.writeFileSync(abs(argOut), outHtml);

// sanity checks
const mappedWidgets = Object.values(widgetMap).flat();
for (const w of mappedWidgets) {
  if (!widgetFiles.some((f) => f.replace(/\.js$/, '') === w)) warn(`widget-map references "${w}" but book/src/widgets/${w}.js does not exist`);
}
for (const id of Object.keys(widgetMap)) if (!ALL_IDS.has(id)) warn(`widget-map section "${id}" does not exist`);

const kb = (fs.statSync(abs(argOut)).size / 1024).toFixed(0);
console.log(`Built ${argOut} (${kb} KB): ${nav.length} pages, ${searchIndex.length} indexed section-languages, ${Object.keys(eqIndex).length} numbered equations, ${widgetFiles.length - 1} widgets, ${pageFiles.length} hub pages.`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log('  - ' + w);
}
if (process.argv.includes('--strict') && warnings.length) process.exit(1);
