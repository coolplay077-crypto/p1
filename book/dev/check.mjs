// Smoke-test the built book in headless Chromium.
//
//   node book/dev/check.mjs [--file book/dev/out/me.html] [--build] [--widget id1,id2] [--page r-3,lab]
//                           [--shots book/dev/out/shots] [--mobile] [--themes light,dark] [--langs zh,en]
//
// --build      run the build first into --file (default book/dev/out/check.html)
//              (with --only-widgets a,b / --only-pages p,q to include only your own files — recommended
//               while other people edit other widgets in parallel)
// --widget     scroll each widget into view, wait, and screenshot it (per language/theme)
// --page       screenshot the top of each page id
// Prints console errors/page errors and exits 1 if any occurred.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : d; };
const flag = (name) => process.argv.includes('--' + name);

const file = path.resolve(ROOT, arg('file', 'book/dev/out/check.html'));
if (flag('build')) {
  const bargs = [path.join(ROOT, 'book/build.mjs'), '--out', path.relative(ROOT, file)];
  if (arg('only-widgets')) bargs.push('--only-widgets', arg('only-widgets'));
  if (arg('only-pages')) bargs.push('--only-pages', arg('only-pages'));
  execFileSync('node', bargs, { stdio: 'inherit', cwd: ROOT });
}
const shots = path.resolve(ROOT, arg('shots', 'book/dev/out/shots'));
fs.mkdirSync(shots, { recursive: true });
const widgets = (arg('widget', '') || '').split(',').filter(Boolean);
const pages = (arg('page', '') || '').split(',').filter(Boolean);
const themes = (arg('themes', 'light') || '').split(',').filter(Boolean);
const langs = (arg('langs', 'zh,en') || '').split(',').filter(Boolean);
const mobile = flag('mobile');

const errors = [];
const browser = await chromium.launch();
const viewports = [{ name: 'desktop', width: 1280, height: 900 }];
if (mobile) viewports.push({ name: 'phone', width: 390, height: 844 });
const written = [];
for (const vp of viewports) {
  for (const theme of themes) {
    for (const lang of langs) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      await ctx.addInitScript(([l, t]) => { localStorage.setItem('cntbook:lang', JSON.stringify(l)); localStorage.setItem('cntbook:theme', JSON.stringify(t)); }, [lang, theme]);
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${vp.name}/${theme}/${lang}] console: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`[${vp.name}/${theme}/${lang}] pageerror: ${e.message}`));
      await page.goto('file://' + file + '#home');
      await page.waitForTimeout(300);
      for (const p of pages) {
        await page.evaluate((h) => { location.hash = h; }, '#' + p);
        await page.waitForTimeout(600);
        const out = path.join(shots, `page-${p}-${vp.name}-${theme}-${lang}.png`);
        await page.screenshot({ path: out });
        written.push(out);
      }
      for (const w of widgets) {
        await page.evaluate((h) => { location.hash = h; }, '#w-' + w);
        await page.waitForTimeout(400);
        const loc = page.locator(`#w-${w}`);
        if (!(await loc.count())) { errors.push(`widget slot #w-${w} not found (is it in book/data/widget-map.json?)`); continue; }
        await loc.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1500); // let animations run
        const err = await loc.locator('.w-err').count();
        if (err) errors.push(`[${vp.name}/${theme}/${lang}] widget ${w} reported a mount error: ` + (await loc.locator('.w-err').innerText()));
        const out = path.join(shots, `w-${w}-${vp.name}-${theme}-${lang}.png`);
        await loc.screenshot({ path: out });
        written.push(out);
        // horizontal overflow check
        const overflow = await loc.evaluate((el) => el.scrollWidth - el.clientWidth);
        if (overflow > 2) errors.push(`[${vp.name}/${theme}/${lang}] widget ${w} overflows horizontally by ${overflow}px`);
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log(`Screenshots:\n  ${written.join('\n  ')}`);
if (errors.length) { console.log(`\n${errors.length} problem(s):\n  ` + errors.join('\n  ')); process.exit(1); }
console.log('\nOK: no console errors.');
