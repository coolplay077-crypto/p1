// Structural fidelity check for English translations against the Chinese sources.
//
//   node book/dev/check-translation.mjs [intro|report] [--sections r-3,r-4]
//
// Per section (paired by heading number) it compares:
//   - presence of the section in both languages
//   - math: multiset of $...$ / $$...$$ bodies must be identical
//   - citations [R01] / [H01] multiset must be identical
//   - number of table rows and fenced code blocks must match
//   - equation \tag{n} set must match
// Exit code 1 if any mismatch is found.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const read = (p) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
const readSource = (p) => {
  const a = path.resolve(ROOT, p);
  if (!fs.existsSync(a)) return null;
  if (fs.statSync(a).isDirectory()) {
    const files = fs.readdirSync(a).filter((f) => f.endsWith('.md')).sort();
    return files.length ? files.map((f) => fs.readFileSync(path.join(a, f), 'utf8').replace(/\s+$/, '')).join('\n\n') : null;
  }
  return fs.readFileSync(a, 'utf8');
};
const DOCS = {
  intro: { prefix: 'i', zh: 'docs/CNT_ADPLL_工程介绍.md', en: 'book/content/en/intro.en.md' },
  report: { prefix: 'r', zh: 'research/CNT_ADPLL_调研整合与核心问题报告.md', en: 'book/content/en/report' },
};
const which = process.argv[2] && !process.argv[2].startsWith('--') ? [process.argv[2]] : Object.keys(DOCS);
const secArg = (() => { const i = process.argv.indexOf('--sections'); return i > 0 ? process.argv[i + 1].split(',') : null; })();

function strip(md) { if (md.startsWith('---\n')) { const e = md.indexOf('\n---', 4); md = md.slice(md.indexOf('\n', e + 1) + 1); } return md; }
function num(title) {
  let m = title.match(/^(\d+(?:\.\d+)*)\.?\s+/); if (m) return m[1];
  m = title.match(/^(?:附录|Appendix)\s*([A-Z])(?=[\s.．:：]|$)/); if (m) return m[1];
  return null;
}
function sections(md, prefix) {
  const out = new Map();
  let cur = { id: `${prefix}-0`, title: '(preface)', lines: [] };
  let inFence = false, first = true;
  for (const line of strip(md).split('\n')) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) {
      if (cur.lines.join('').trim() || !first || cur.id !== `${prefix}-0`) out.set(cur.id, cur);
      first = false;
      const n = num(h[2]);
      const id = n ? `${prefix}-${n.replace(/\./g, '-')}` : (h[1].length === 1 && out.size === 0 ? `${prefix}-0` : `${prefix}-?${h[2]}`);
      cur = { id, title: h[2], lines: [] };
    } else cur.lines.push(line);
  }
  out.set(cur.id, cur);
  return out;
}
function features(text) {
  const fences = (text.match(/^```/gm) || []).length / 2;
  const noCode = text.replace(/^```[\s\S]*?^```/gm, '');
  const math = [];
  let t = noCode.replace(/\$\$([\s\S]+?)\$\$/g, (_, b) => { math.push('$$' + b.replace(/\s+/g, ' ').trim()); return ' '; });
  t.replace(/`[^`\n]+`/g, ' ').replace(/\$([^$\n]+?)\$/g, (_, b) => { math.push(b.replace(/\s+/g, ' ').trim()); return ' '; });
  const cites = (noCode.match(/\[(?:R|H)\d{2}(?:\s*[–-]\s*(?:R|H)\d{2})?\]/g) || []).map((c) => c.replace(/\s/g, '').replace('-', '–'));
  const rows = (noCode.match(/^\|.*\|\s*$/gm) || []).length;
  const tags = (noCode.match(/\\tag\{[^}]+\}/g) || []);
  return { fences, math: math.sort(), cites: cites.sort(), rows, tags: tags.sort() };
}
const diff = (a, b) => {
  const ca = new Map(), cb = new Map();
  a.forEach((x) => ca.set(x, (ca.get(x) || 0) + 1)); b.forEach((x) => cb.set(x, (cb.get(x) || 0) + 1));
  const onlyA = [], onlyB = [];
  for (const [k, v] of ca) { const w = cb.get(k) || 0; if (v > w) onlyA.push(`${k}${v - w > 1 ? ` ×${v - w}` : ''}`); }
  for (const [k, v] of cb) { const w = ca.get(k) || 0; if (v > w) onlyB.push(`${k}${v - w > 1 ? ` ×${v - w}` : ''}`); }
  return { onlyA, onlyB };
};

let problems = 0;
for (const key of which) {
  const d = DOCS[key];
  const enSrc = readSource(d.en);
  if (!enSrc) { console.log(`[${key}] English source not found (${d.en}) — skipped`); continue; }
  const zh = sections(read(d.zh), d.prefix);
  const en = sections(enSrc, d.prefix);
  const ids = [...new Set([...zh.keys(), ...en.keys()])].filter((id) => !secArg || secArg.some((s) => id === s || id.startsWith(s + '-')));
  let checked = 0;
  for (const id of ids) {
    const a = zh.get(id), b = en.get(id);
    if (!b) { if (!secArg) { /* untranslated yet */ } else { console.log(`✗ ${id}: missing in English`); problems++; } continue; }
    if (!a) { console.log(`✗ ${id}: English heading "${b.title}" has no Chinese counterpart`); problems++; continue; }
    checked++;
    const fa = features(a.lines.join('\n')), fb = features(b.lines.join('\n'));
    const msgs = [];
    const dm = diff(fa.math, fb.math);
    if (dm.onlyA.length || dm.onlyB.length) msgs.push(`math differs\n      only zh: ${dm.onlyA.join(' | ') || '-'}\n      only en: ${dm.onlyB.join(' | ') || '-'}`);
    const dc = diff(fa.cites, fb.cites);
    if (dc.onlyA.length || dc.onlyB.length) msgs.push(`citations differ (zh-only: ${dc.onlyA.join(' ') || '-'}; en-only: ${dc.onlyB.join(' ') || '-'})`);
    if (fa.rows !== fb.rows) msgs.push(`table rows ${fa.rows} (zh) vs ${fb.rows} (en)`);
    if (fa.fences !== fb.fences) msgs.push(`code blocks ${fa.fences} (zh) vs ${fb.fences} (en)`);
    if (fa.tags.join() !== fb.tags.join()) msgs.push(`equation tags differ: ${fa.tags.join(',')} vs ${fb.tags.join(',')}`);
    const hz = (a.title.match(/^(#*)/) || [])[0];
    if (msgs.length) { problems += msgs.length; console.log(`✗ ${id} (${b.title}):\n    - ${msgs.join('\n    - ')}`); }
  }
  const missing = [...zh.keys()].filter((id) => !en.has(id) && (!secArg || secArg.some((s) => id === s || id.startsWith(s + '-'))));
  console.log(`[${key}] checked ${checked} paired sections; ${missing.length} Chinese section(s) not yet translated${missing.length && missing.length < 40 ? ': ' + missing.join(', ') : ''}`);
}
if (problems) { console.log(`\n${problems} problem(s) found.`); process.exit(1); }
console.log('OK');
