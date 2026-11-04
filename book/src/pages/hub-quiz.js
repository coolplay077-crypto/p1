/* Hub page: self-test quiz and flashcards.
 * Quiz: book/data/quiz.json (40 items; each explanation cites its report section). One question at a
 *   time, immediate feedback, score, retry of wrong answers. Progress persists in this browser
 *   (Book.store key "quiz:progress").
 * Flashcards: formula cards from book/data/formulas.json (formula <-> meaning) and term cards from
 *   book/data/glossary.json (term <-> definition). Degrades gracefully if either file is missing.
 */
(function () {
  'use strict';
  const PAGE = 'hub-quiz';
  const esc = Book.esc, bi = Book.bi;

  const CSS = `
.hq-hero { padding: 18px 0 6px; }
.hq-hero h1 { font-size: clamp(1.5rem, 3vw, 2.1rem); line-height: 1.25; margin: .1em 0 .35em; }
.hq-hero .lede { color: var(--fg-2); font-size: .98rem; margin: 0; }
.hq-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 6px; align-items: center; }
.hq-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 12px 0; }
.hq-stats .stat .v { font-size: 1.3rem; }
.hq-bar { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; margin: 4px 0 12px; }
.hq-bar > i { display: block; height: 100%; background: var(--good); border-radius: 999px; transition: width .25s; }
.hq-dots { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 14px; }
.hq-dot { width: 26px; height: 26px; font: inherit; font-size: .7rem; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg-2); border-radius: 7px; cursor: pointer; padding: 0; font-variant-numeric: tabular-nums; }
.hq-dot.ok { background: color-mix(in srgb, var(--good) 22%, var(--surface)); border-color: var(--good); color: var(--good-ink); }
.hq-dot.bad { background: color-mix(in srgb, var(--critical) 18%, var(--surface)); border-color: var(--critical); color: var(--critical-ink); }
.hq-dot[aria-current="true"] { outline: 2px solid var(--accent); outline-offset: 1px; }
.hq-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; overflow-wrap: anywhere; }
.hq-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: .78rem; color: var(--muted); margin-bottom: 6px; }
.hq-type { font-weight: 650; border: 1px solid var(--border-strong); border-radius: 999px; padding: 0 8px; color: var(--fg-2); }
.hq-q { font-size: 1.02rem; line-height: 1.55; margin: 4px 0 12px; font-weight: 600; }
.hq-opts { display: grid; gap: 8px; }
.hq-opt { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; text-align: left; font: inherit; font-size: .9rem; line-height: 1.5; padding: 9px 12px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg); border-radius: 9px; cursor: pointer; }
.hq-opt:hover { border-color: var(--accent); }
.hq-opt[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-wash); }
.hq-opt .hq-box { width: 16px; height: 16px; margin-top: 2px; border: 1.5px solid var(--border-strong); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: .75rem; line-height: 1; }
.hq-opt[data-multi="0"] .hq-box { border-radius: 50%; }
.hq-opt[aria-pressed="true"] .hq-box { background: var(--accent); border-color: var(--accent); color: #fff; }
.hq-opt.good { border-color: var(--good); background: color-mix(in srgb, var(--good) 12%, var(--surface)); }
.hq-opt.bad { border-color: var(--critical); background: color-mix(in srgb, var(--critical) 10%, var(--surface)); }
.hq-opt:disabled { cursor: default; }
.hq-exp { margin-top: 12px; padding: 10px 12px; border-radius: 9px; background: var(--surface-2); border-left: 3px solid var(--accent); font-size: .88rem; line-height: 1.55; }
.hq-exp .hq-verdict { font-weight: 700; margin-right: 6px; }
.hq-exp .hq-verdict.ok { color: var(--good-ink); }
.hq-exp .hq-verdict.bad { color: var(--critical-ink); }
.hq-nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
.hq-fc { min-height: 220px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: 10px; cursor: pointer; }
.hq-fc .hq-front { font-size: 1.12rem; line-height: 1.6; }
.hq-fc .hq-front .katex-display { margin: .2em 0; }
.hq-back { font-size: .95rem; line-height: 1.6; text-align: left; width: 100%; }
.hq-back .hq-sub { color: var(--fg-2); font-size: .86rem; margin-top: 6px; }
.hq-empty { padding: 22px; text-align: center; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: 12px; }
.hq-reset { margin-top: 16px; }
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
  const TYPE = { single: ['单选', 'Single choice'], multi: ['多选', 'Multiple choice'], tf: ['判断', 'True / false'] };
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(n, seed) {
    const r = mulberry32(seed), a = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const safeGet = (k, d) => { try { return Book.store.get(k, d); } catch (e) { return d; } };
  const safeSet = (k, v) => { try { Book.store.set(k, v); } catch (e) { /* storage unavailable */ } };
  // inline $...$ math -> KaTeX html; everything else escaped
  function richTex(s) {
    return String(s == null ? '' : s).split(/(\$[^$]+\$)/).map((p) => (p.length > 2 && p[0] === '$' && p[p.length - 1] === '$' ? Book.tex(p.slice(1, -1)) : esc(p))).join('');
  }
  Book.registerPage({
    id: PAGE,
    group: 'hub',
    order: 70,
    icon: '✓',
    title: { zh: '测验与闪卡', en: 'Quiz & flashcards' },
    summary: {
      zh: '40 道分章测验（立即反馈，每题给出依据章节，可重做错题），以及公式与术语闪卡。进度保存在本机浏览器。',
      en: '40 chapter-spread quiz questions with immediate feedback, each citing its section, with retry of wrong answers; plus formula and term flashcards. Progress stays in this browser.',
    },
    render(el, api) {
      injectCss('hq-css-quiz', CSS);
      const QUIZ = ((Book.data.data.quiz && Book.data.data.quiz.items) || []);
      const FORM = (Book.data.data.formulas && Book.data.data.formulas.items) || [];
      const GLOSS = (Book.data.data.glossary && Book.data.data.glossary.terms) || [];

      const st = {
        tab: 'quiz',
        filter: 'all',         // all | todo | wrong
        pos: 0,                // position inside the current pool
        picked: new Set(),
        submitted: false,
        deck: 'formulas',      // formulas | terms
        fi: 0, flip: false, seed: 1,
      };
      let progress = safeGet('quiz:progress', { answers: {} });
      if (!progress || typeof progress !== 'object' || !progress.answers) progress = { answers: {} };
      const answered = () => Object.keys(progress.answers).filter((k) => QUIZ.some((q) => q.id === k));
      const correctCount = () => answered().filter((k) => progress.answers[k].ok).length;

      el.innerHTML = `<div class="hq-hero"><div class="kicker">${bi('知识汇总 · 测验与闪卡', 'Knowledge hub · Quiz & flashcards')}</div>
        <h1>${bi('检验你是否读懂了这份报告', 'Check whether the report has been understood')}</h1>
        <p class="lede">${bi('每道题的答案都以报告原文为依据，反馈中注明章节。题目覆盖 §1–§13 的关键修正、单位陷阱、不变量与验证边界。', 'Every answer rests on the report text and the feedback names its section. Questions cover the key corrections, unit traps, invariants and verification limits from §1 to §13.')}</p></div>
        <div class="hq-tabs" role="tablist"><button type="button" class="w-seg-btn w-btn" role="tab" data-tab="quiz">${bi('测验', 'Quiz')}</button><button type="button" class="w-btn" role="tab" data-tab="cards">${bi('闪卡', 'Flashcards')}</button></div>
        <div data-role="body"></div>`;
      const body = el.querySelector('[data-role="body"]');

      function pool() {
        const ids = QUIZ.map((q, i) => i);
        if (st.filter === 'todo') return ids.filter((i) => !progress.answers[QUIZ[i].id]);
        if (st.filter === 'wrong') return ids.filter((i) => progress.answers[QUIZ[i].id] && !progress.answers[QUIZ[i].id].ok);
        return ids;
      }

      function drawQuiz() {
        const P = pool();
        const total = QUIZ.length;
        const done = answered().length, ok = correctCount();
        const pct = total ? Math.round((done / total) * 100) : 0;
        let h = `<div class="hq-stats">
            <div class="stat"><div class="k">${bi('已作答', 'Answered')}</div><div class="v">${done} / ${total}</div></div>
            <div class="stat"><div class="k">${bi('正确', 'Correct')}</div><div class="v">${ok}</div></div>
            <div class="stat"><div class="k">${bi('正确率', 'Accuracy')}</div><div class="v">${done ? Math.round((ok / done) * 100) : 0}%</div></div>
          </div>
          <div class="hq-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
          <div class="hq-tabs">
            <button type="button" class="w-btn" data-filter="all" aria-pressed="${st.filter === 'all'}">${bi('全部', 'All')}</button>
            <button type="button" class="w-btn" data-filter="todo" aria-pressed="${st.filter === 'todo'}">${bi('未作答', 'Unanswered')}</button>
            <button type="button" class="w-btn" data-filter="wrong" aria-pressed="${st.filter === 'wrong'}">${bi('错题', 'Wrong answers')}</button>
            <button type="button" class="w-btn" data-act="resetq" style="margin-left:auto">${bi('清空测验进度', 'Clear quiz progress')}</button>
          </div>`;
        if (!P.length) {
          h += `<div class="hq-empty">${bi('这一组没有题目。', 'No questions in this group.')}</div>`;
          body.innerHTML = h;
          return;
        }
        if (st.pos >= P.length) st.pos = 0;
        const qi = P[st.pos];
        const q = QUIZ[qi];
        const prev = progress.answers[q.id];
        const submitted = st.submitted || !!prev;
        if (!st.submitted && prev && !st.picked.size) {
          // restore a previously submitted answer for this question
          prev.picked.forEach((x) => st.picked.add(x));
          st.submitted = true;
        }
        const isMulti = q.type === 'multi';
        const sub = submitted;
        const dots = P.map((i, n) => {
          const a = progress.answers[QUIZ[i].id];
          const cls = a ? (a.ok ? ' ok' : ' bad') : '';
          return `<button type="button" class="hq-dot${cls}" data-pos="${n}" aria-current="${n === st.pos}" aria-label="${'第 ' + (i + 1) + ' 题 / Question ' + (i + 1)}">${i + 1}</button>`;
        }).join('');
        h += `<div class="hq-dots" aria-label="题目导航 / Question navigator">${dots}</div>`;
        h += `<article class="hq-card">
            <div class="hq-meta"><span>${bi(`第 ${qi + 1} 题 · ${st.pos + 1} / ${P.length}`, `Question ${qi + 1} · ${st.pos + 1} of ${P.length}`)}</span><span class="hq-type">${bi(TYPE[q.type][0], TYPE[q.type][1])}</span><span>${secRef(q.section)}</span></div>
            <p class="hq-q">${bi(esc(q.q.zh), esc(q.q.en))}</p>
            <div class="hq-opts" role="${isMulti ? 'group' : 'radiogroup'}">${q.options.map((o, j) => {
              const picked = st.picked.has(j);
              let cls = '';
              if (sub) cls = o.correct ? ' good' : (picked ? ' bad' : '');
              return `<button type="button" class="hq-opt${cls}" data-multi="${isMulti ? 1 : 0}" data-opt="${j}" aria-pressed="${picked}" ${sub ? 'disabled' : ''}>
                <span class="hq-box" aria-hidden="true">${picked ? '✓' : ''}</span>
                <span>${bi(esc(o.zh), esc(o.en))}${sub && o.correct ? ` <b>${bi('（正确）', '(correct)')}</b>` : ''}</span></button>`;
            }).join('')}</div>`;
        if (sub) {
          const a = progress.answers[q.id];
          const okNow = a ? a.ok : false;
          h += `<div class="hq-exp"><span class="hq-verdict ${okNow ? 'ok' : 'bad'}">${okNow ? bi('✓ 正确', '✓ Correct') : bi('✗ 不正确', '✗ Incorrect')}</span>${bi(esc(q.explain.zh), esc(q.explain.en))} <span>${bi('依据', 'Basis')}: ${secRef(q.section)}</span></div>`;
        }
        h += `<div class="hq-nav">
            <button type="button" class="w-btn" data-act="prev" ${st.pos === 0 ? 'disabled' : ''}>${bi('← 上一题', '← Previous')}</button>
            ${sub ? '' : `<button type="button" class="w-btn primary" data-act="submit" ${st.picked.size ? '' : 'disabled'}>${bi('提交答案', 'Submit answer')}</button>`}
            <button type="button" class="w-btn" data-act="next" ${st.pos >= P.length - 1 ? 'disabled' : ''}>${bi('下一题 →', 'Next →')}</button>
          </div>
          <p class="hq-meta" style="margin-top:10px">${bi('多选题须选中全部正确项且不选错误项才算正确；判断题按一个选项作答。', 'A multiple-choice item is correct only if every correct option is selected and no wrong one is. True/false items take one option.')}</p>
        </article>`;
        body.innerHTML = h;
      }

      function submit() {
        const P = pool();
        const q = QUIZ[P[st.pos]];
        if (!q || !st.picked.size) return;
        const correct = q.options.map((o, j) => (o.correct ? j : -1)).filter((j) => j >= 0);
        const picked = [...st.picked].sort((a, b) => a - b);
        const ok = picked.length === correct.length && picked.every((x, i) => x === correct[i]);
        progress.answers[q.id] = { ok, picked };
        safeSet('quiz:progress', progress);
        st.submitted = true;
      }

      // ---------- flashcards
      function deckItems() {
        if (st.deck === 'formulas') return FORM.map((f) => ({ kind: 'f', f }));
        return GLOSS.map((t) => ({ kind: 't', t }));
      }
      function drawCards() {
        const items = deckItems();
        const hasF = FORM.length > 0, hasG = GLOSS.length > 0;
        let h = `<div class="hq-tabs">
          <button type="button" class="w-btn" data-deck="formulas" aria-pressed="${st.deck === 'formulas'}" ${hasF ? '' : 'disabled'}>${bi('公式卡', 'Formula cards')}${hasF ? ' · ' + FORM.length : ''}</button>
          <button type="button" class="w-btn" data-deck="terms" aria-pressed="${st.deck === 'terms'}" ${hasG ? '' : 'disabled'}>${bi('术语卡', 'Term cards')}${hasG ? ' · ' + GLOSS.length : ''}</button>
          <button type="button" class="w-btn" data-act="shuffle" style="margin-left:auto">${bi('打乱顺序', 'Shuffle')}</button>
        </div>`;
        if (!items.length) {
          h += `<div class="hq-empty">${bi('闪卡数据暂不可用（book/data 中缺少对应文件或内容为空）。测验仍可正常使用。', 'Flashcard data is not available (the matching file in book/data is missing or empty). The quiz still works.')}</div>`;
          body.innerHTML = h;
          return;
        }
        const order = shuffled(items.length, st.seed === 1 ? 0 : st.seed * 7919 + items.length);
        if (st.fi >= items.length) st.fi = 0;
        const it = items[order[st.fi]];
        let front, back;
        if (it.kind === 'f') {
          const f = it.f;
          front = `<div class="hq-front">${api.tex(String(f.tex).replace(/\s*\\tag\{[^}]*\}\s*$/, '').trim(), true)}</div>`;
          back = `<div class="hq-back"><b>${bi(richTex(f.title.zh), richTex(f.title.en))}</b>
              <div class="hq-sub">${bi(richTex(f.meaning.zh), richTex(f.meaning.en))}</div>
              <div class="hq-sub">${bi('式', 'Eq.')} (${esc(f.n)}) · ${secRef(f.section)} · <a href="#hub-formulas-eq-${esc(f.n)}">${bi('推导卡', 'Card')}</a></div></div>`;
        } else {
          const t = it.t;
          const sym = t.symbol ? `<div class="hq-front" style="font-size:.95rem">${api.tex(String(t.symbol), false)}</div>` : '';
          front = `${sym}<div class="hq-front"><b>${bi(esc(t.zh.term), esc(t.en.term))}</b></div>`;
          back = `<div class="hq-back">${bi(esc(t.zh.def), esc(t.en.def))}
              <div class="hq-sub">${secRef(t.section)}${t.unit ? ' · ' + bi(esc(t.unit.zh), esc(t.unit.en)) : ''}</div></div>`;
        }
        h += `<article class="hq-card hq-fc" data-role="flash" tabindex="0" aria-label="翻面 / Flip card">
            <div class="hq-meta" style="justify-content:center">${bi(`${st.fi + 1} / ${items.length}`, `${st.fi + 1} / ${items.length}`)} · ${bi('点击翻面', 'Click to flip')}</div>
            ${st.flip ? back : front}
          </article>
          <div class="hq-nav" style="justify-content:center">
            <button type="button" class="w-btn" data-act="cprev" ${st.fi === 0 ? 'disabled' : ''}>${bi('← 上一张', '← Previous')}</button>
            <button type="button" class="w-btn" data-act="flip">${bi('翻面', 'Flip')}</button>
            <button type="button" class="w-btn" data-act="cnext" ${st.fi >= items.length - 1 ? 'disabled' : ''}>${bi('下一张 →', 'Next →')}</button>
          </div>`;
        body.innerHTML = h;
      }

      function draw() {
        el.querySelectorAll('[role="tab"]').forEach((b) => {
          const on = b.dataset.tab === st.tab;
          b.classList.toggle('primary', on);
          b.setAttribute('aria-selected', String(on));
        });
        if (st.tab === 'quiz') drawQuiz(); else drawCards();
      }

      el.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) { st.tab = tab.dataset.tab; st.flip = false; draw(); return; }
        if (st.tab === 'quiz') {
          const P = pool();
          const f = e.target.closest('[data-filter]');
          if (f) { st.filter = f.dataset.filter; st.pos = 0; st.picked = new Set(); st.submitted = false; draw(); return; }
          const d = e.target.closest('[data-pos]');
          if (d) { st.pos = Number(d.dataset.pos); st.picked = new Set(); st.submitted = false; draw(); return; }
          const o = e.target.closest('[data-opt]');
          if (o && !st.submitted && !(progress.answers[QUIZ[P[st.pos]].id])) {
            const j = Number(o.dataset.opt);
            const q = QUIZ[P[st.pos]];
            if (q.type === 'multi') { if (st.picked.has(j)) st.picked.delete(j); else st.picked.add(j); }
            else { st.picked = new Set([j]); }
            draw(); return;
          }
          const a = e.target.closest('[data-act]');
          if (!a) return;
          if (a.dataset.act === 'submit') { submit(); draw(); return; }
          if (a.dataset.act === 'next') { st.pos = Math.min(P.length - 1, st.pos + 1); st.picked = new Set(); st.submitted = false; draw(); return; }
          if (a.dataset.act === 'prev') { st.pos = Math.max(0, st.pos - 1); st.picked = new Set(); st.submitted = false; draw(); return; }
          if (a.dataset.act === 'resetq') {
            if (!confirm(api.t('清空全部测验作答记录？', 'Clear all quiz answers?'))) return;
            progress = { answers: {} }; safeSet('quiz:progress', progress);
            st.pos = 0; st.picked = new Set(); st.submitted = false; draw(); return;
          }
        } else {
          const dk = e.target.closest('[data-deck]');
          if (dk && !dk.disabled) { st.deck = dk.dataset.deck; st.fi = 0; st.flip = false; draw(); return; }
          const a = e.target.closest('[data-act]');
          const fc = e.target.closest('[data-role="flash"]');
          if (fc) { st.flip = !st.flip; draw(); return; }
          if (!a) return;
          if (a.dataset.act === 'flip') { st.flip = !st.flip; draw(); return; }
          if (a.dataset.act === 'cnext') { st.fi += 1; st.flip = false; draw(); return; }
          if (a.dataset.act === 'cprev') { st.fi = Math.max(0, st.fi - 1); st.flip = false; draw(); return; }
          if (a.dataset.act === 'shuffle') { st.seed += 1; st.fi = 0; st.flip = false; draw(); return; }
        }
      });
      el.addEventListener('keydown', (e) => {
        if (st.tab !== 'cards') return;
        if (e.target.getAttribute && e.target.getAttribute('data-role') === 'flash' && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault(); st.flip = !st.flip; draw();
        }
      });
      draw();
    },
  });
})();
