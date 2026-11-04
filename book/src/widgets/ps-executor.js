/* ps-executor — report §8.1, §8.2, §8.4, Eq. (16)–(17): P/S as "execute a specified edge", with deadline and late policy.
 *
 * Idealized behavioural model, time in units of T0 (raw CK0 rising edge k occurs at t = k), NOT a circuit:
 *   - the slow domain has period T_d = M·T0 and issues the command at slow edge k_issue (t = M·k_issue);
 *   - t_arrive = t_issue + t_compute + t_CDC;  Eq. (17):  t_arrive + t_setup,exec + t_guard <= t_target = J_plan  (J_plan = M·H_J + s_J, Eq. 16);
 *   - on a miss: LATE/MISS flag, re-plan to the earliest feasible edge (receipt and phase coordinate change), or the
 *     FORBIDDEN "silently fire in a later slot but report J_plan";
 *   - fault injection acts on the PHYSICAL pulses; an independent receipt (J_observed) sees only what is really emitted.
 *   - assumption for the "duplicated edge" fault: the TDC stop path re-triggers on the extra pulse (uses the last edge).
 */
(function () {
  'use strict';
  const CSS = `
.px-tbl { width: 100%; border-collapse: collapse; font-size: .78rem; font-variant-numeric: tabular-nums; margin: 0; }
.px-tbl th, .px-tbl td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
.px-tbl th { background: var(--surface-2); font-weight: 650; position: static; }
.px-tbl tr:last-child td { border-bottom: 0; }
.px-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); margin-top: 10px; }
.px-eq { overflow-x: auto; overflow-y: hidden; }
.px-eq .katex-display { margin: .3em 0; }
.px-st { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-top: 8px; }
`;

  function model(P) {
    const M = P.M;
    const Jplan = M * P.HJ + P.sJ;
    const tIssue = M * P.kIssue;
    const tArrive = tIssue + P.Lc + P.Dcdc;
    const tNeed = tArrive + P.setup + P.guard;
    const slack = Jplan - tNeed;
    const late = slack < 0;
    const Jfeas = Math.ceil(tNeed - 1e-9);
    let Jexec = Jplan, Jrep = Jplan, label = null;
    if (late) {
      if (P.policy === 'flag') { Jexec = null; Jrep = null; label = 'LATE/MISS'; }
      else if (P.policy === 'replan') { Jexec = Jfeas; Jrep = Jfeas; label = 'REPLAN'; }
      else { Jexec = Jfeas; Jrep = Jplan; label = 'SILENT'; }
    }
    // physical pulses reaching the TDC / receipt: {s, w} (rising edge index, width in T0)
    let pulses = [];
    const planned = Jexec == null ? [] : [Jexec];
    if (P.fault === 'merge' && Jexec != null) planned.push(Jexec + 1);
    if (Jexec != null) {
      if (P.fault === 'none') pulses = [{ s: Jexec, w: 0.5 }];
      else if (P.fault === 'drop') pulses = [];
      else if (P.fault === 'dup') pulses = [{ s: Jexec, w: 0.5 }, { s: Jexec + 1, w: 0.5 }];
      else if (P.fault === 'gate') pulses = [{ s: Jexec + 1, w: 0.5 }];
      else if (P.fault === 'merge') pulses = [{ s: Jexec, w: 1.5 }]; // PISO-like continuous level: second edge never appears
    }
    const used = pulses.length ? (P.fault === 'dup' ? pulses[pulses.length - 1].s : pulses[0].s) : null;
    const obs = pulses.map((p) => p.s);
    const err = used != null && Jrep != null ? Jrep - used : null; // raw cycles a plan-trusting chain would mis-anchor
    const mismatch = !(obs.length === planned.length && obs.every((o, i) => o === planned[i]) && Jrep === Jexec);
    return { M, Jplan, tIssue, tArrive, tNeed, slack, late, Jfeas, Jexec, Jrep, label, planned, pulses, used, obs, err, mismatch };
  }

  Book.registerWidget({
    id: 'ps-executor',
    group: 'executor',
    title: { zh: 'P/S 执行器：选沿 deadline（式 16–17）与 late 策略', en: 'P/S executor: edge-select deadline (Eq. 16–17) and late policy' },
    summary: {
      zh: '目标沿 J_plan = M·H_J + s_J；慢速域发命令，命令到达执行器后还需建立时间与 guard，才能在 t_target 前使能 slot。观察满足/违反式 (17) 时的波形，比较 LATE 标记、重新规划与被禁止的“悄悄补发却报原编号”，并注入丢沿/重复沿/门控晚到/相邻脉冲合并故障，看独立回执 J_observed 与计划值 J_plan 的差。',
      en: 'The target edge is J_plan = M·H_J + s_J. The slow domain issues the command; after it arrives, setup time plus guard must still fit before t_target to enable the slot. See waveforms when Eq. (17) holds or fails, compare a LATE flag, re-planning and the FORBIDDEN "silently fire later but report the original ID", and inject dropped / duplicated edges, a late gate control and merged adjacent pulses to see how the independent receipt J_observed differs from the plan J_plan.',
    },
    sections: ['r-8-4', 'r-8-1', 'r-8-2'],
    eqs: ['16', '17'],
    keywords: ['P/S', 'executor', 'J_plan', 'J_observed', 'deadline', 'late', 'slot', '执行器', '回执', '选沿'],
    mount(root, api) {
      if (!document.getElementById('px-css')) { const s = document.createElement('style'); s.id = 'px-css'; s.textContent = CSS; document.head.appendChild(s); }
      const S = { M: 8, HJ: 3, sJ: 2, kIssue: 1, Lc: 6, Dcdc: 4, setup: 2, guard: 1, policy: 'replan', fault: 'none' };
      const PRESETS = {
        ok: { M: 8, HJ: 3, sJ: 2, kIssue: 1, Lc: 6, Dcdc: 4, setup: 2, guard: 1, policy: 'replan', fault: 'none' },
        late: { M: 8, HJ: 2, sJ: 3, kIssue: 1, Lc: 6, Dcdc: 5, setup: 2, guard: 1, policy: 'flag', fault: 'none' },
        replan: { M: 8, HJ: 2, sJ: 3, kIssue: 1, Lc: 6, Dcdc: 5, setup: 2, guard: 1, policy: 'replan', fault: 'none' },
        silent: { M: 8, HJ: 2, sJ: 3, kIssue: 1, Lc: 6, Dcdc: 5, setup: 2, guard: 1, policy: 'silent', fault: 'none' },
        drop: { M: 8, HJ: 3, sJ: 2, kIssue: 1, Lc: 6, Dcdc: 4, setup: 2, guard: 1, policy: 'replan', fault: 'drop' },
        dup: { M: 8, HJ: 3, sJ: 2, kIssue: 1, Lc: 6, Dcdc: 4, setup: 2, guard: 1, policy: 'replan', fault: 'dup' },
        gate: { M: 8, HJ: 3, sJ: 2, kIssue: 1, Lc: 6, Dcdc: 4, setup: 2, guard: 1, policy: 'replan', fault: 'gate' },
        merge: { M: 4, HJ: 4, sJ: 1, kIssue: 1, Lc: 3, Dcdc: 2, setup: 1, guard: 1, policy: 'replan', fault: 'merge' },
      };
      const svgHost = W.h('div');
      const eqHost = W.h('div', { class: 'px-eq' });
      const stHost = W.h('div', { class: 'px-st' });
      const tblHost = W.h('div');

      const ctl = {};
      ctl.M = W.seg({ label: ['M', 'M'], options: [{ value: 4, label: 'M = 4' }, { value: 8, label: 'M = 8' }], value: S.M, onChange: (v) => { S.M = +v; S.sJ = Math.min(S.sJ, S.M - 1); ctl.sJ.value = S.sJ; ctl.sJ.input.max = S.M - 1; draw(); } });
      ctl.HJ = W.slider({ label: ['高位目标 H_J', 'High target H_J'], min: 1, max: 6, step: 1, value: S.HJ, fmt: (v) => String(v), onInput: (v) => { S.HJ = v; draw(); } });
      ctl.sJ = W.slider({ label: ['slot s_J', 'Slot s_J'], min: 0, max: S.M - 1, step: 1, value: S.sJ, fmt: (v) => String(v), onInput: (v) => { S.sJ = v; draw(); } });
      ctl.kIssue = W.slider({ label: ['发令慢沿序号', 'Issue slow edge #'], min: 0, max: 6, step: 1, value: S.kIssue, fmt: (v) => `${v}`, onInput: (v) => { S.kIssue = v; draw(); } });
      ctl.Lc = W.slider({ label: ['计算延迟', 'Compute latency'], min: 0, max: 30, step: 1, value: S.Lc, fmt: (v) => `${v} T₀`, onInput: (v) => { S.Lc = v; draw(); } });
      ctl.Dcdc = W.slider({ label: ['CDC 延迟', 'CDC latency'], min: 0, max: 20, step: 1, value: S.Dcdc, fmt: (v) => `${v} T₀`, onInput: (v) => { S.Dcdc = v; draw(); } });
      ctl.setup = W.slider({ label: ['t_setup,exec', 't_setup,exec'], min: 0, max: 8, step: 0.5, value: S.setup, fmt: (v) => `${W.fmt(v, 1)} T₀`, onInput: (v) => { S.setup = v; draw(); } });
      ctl.guard = W.slider({ label: ['t_guard', 't_guard'], min: 0, max: 6, step: 0.5, value: S.guard, fmt: (v) => `${W.fmt(v, 1)} T₀`, onInput: (v) => { S.guard = v; draw(); } });
      ctl.policy = W.select({ label: ['late 策略', 'Late policy'], options: [
        { value: 'flag', label: ['标记 LATE/MISS（不发沿）', 'Flag LATE/MISS (no edge)'] },
        { value: 'replan', label: ['重新规划 J（回执随之改变）', 'Re-plan J (receipt changes)'] },
        { value: 'silent', label: ['✗ 悄悄补发仍报原 J_plan（禁止）', '✗ Silently fire later, report J_plan (forbidden)'] }], value: S.policy, onChange: (v) => { S.policy = v; draw(); } });
      ctl.fault = W.select({ label: ['故障注入', 'Fault injection'], options: [
        { value: 'none', label: ['无', 'none'] },
        { value: 'drop', label: ['丢沿', 'dropped edge'] },
        { value: 'dup', label: ['重复沿', 'duplicated edge'] },
        { value: 'gate', label: ['gate 控制晚到', 'gate control late'] },
        { value: 'merge', label: ['相邻脉冲合并（连续电平 PISO）', 'adjacent pulses merge (level-type PISO)'] }], value: S.fault, onChange: (v) => { S.fault = v; draw(); } });

      function apply(name) {
        Object.assign(S, PRESETS[name]);
        ctl.sJ.input.max = S.M - 1;
        for (const k of ['M', 'HJ', 'sJ', 'kIssue', 'Lc', 'Dcdc', 'setup', 'guard', 'policy', 'fault']) ctl[k].value = S[k];
        draw();
      }
      const presets = W.controls(
        W.h('span', { class: 'w-ctl' }, W.L('场景：', 'Scenarios:')),
        W.button(['按时', 'On time'], () => apply('ok'), { primary: true }),
        W.button(['迟到·标记', 'Late · flag'], () => apply('late')),
        W.button(['迟到·重新规划', 'Late · re-plan'], () => apply('replan')),
        W.button(['迟到·悄悄补发 ✗', 'Late · silent ✗'], () => apply('silent')),
        W.button(['丢沿', 'Dropped'], () => apply('drop')),
        W.button(['重复沿', 'Duplicated'], () => apply('dup')),
        W.button(['gate 晚到', 'Gate late'], () => apply('gate')),
        W.button(['脉冲合并', 'Merged pulses'], () => apply('merge')),
      );
      root.append(
        presets,
        W.controls(ctl.M, ctl.HJ, ctl.sJ, ctl.kIssue),
        W.controls(ctl.Lc, ctl.Dcdc, ctl.setup, ctl.guard),
        W.controls(ctl.policy, ctl.fault),
        W.legend([
          { color: 'var(--sig-clk)', label: ['CK₀ / 慢时钟', 'CK₀ / slow clock'] },
          { color: 'var(--sig-plan)', label: ['J_plan / 目标 t_target', 'J_plan / target t_target'] },
          { color: 'var(--sig-sel)', label: ['实际输出脉冲', 'actual output pulse'] },
          { color: 'var(--sig-ref)', label: ['独立回执 J_observed', 'independent receipt J_observed'] },
          { color: 'var(--sig-err)', label: ['迟到 / 错误', 'late / error'] },
        ]),
        svgHost, eqHost, stHost, tblHost,
        W.note([
          '要点：式 (17) 是“建立时间 + guard 必须在目标沿之前完成”的硬 deadline；不满足时只能标记 LATE/MISS 或重新规划一个不同的 J（回执与相位坐标随之改变），不能悄悄在后面的 slot 补发却仍返回原 edge ID（不变量 I4/I7）。丢沿、重复沿、gate 晚到、相邻脉冲合并都可能完全不改变数字计划 J_plan，只有独立于命令的回执 J_observed 才能发现；若测量链信任 J_plan，相位就差整数个原周期。以上为理想化行为示意（时间单位 T₀），不是电路或芯片指标；“重复沿”假设 TDC 停止路径取最后一个沿。',
          'Key points: Eq. (17) is a hard deadline — setup plus guard must fit before the target edge. If it fails you can only flag LATE/MISS or re-plan a different J (the receipt and phase coordinate change); you must not silently fire in a later slot while still returning the original edge ID (invariants I4/I7). Dropped, duplicated, late-gated or merged pulses can leave the digital plan J_plan untouched; only a receipt J_observed independent of the command exposes them, and a chain that trusts J_plan is off by whole raw cycles. Idealized behavioural illustration in T₀ units, not a circuit or chip spec; "duplicated edge" assumes the TDC stop path re-triggers on the last edge.',
        ]),
      );

      function draw() {
        const m = model(S);
        const M = S.M;
        const tEnd = Math.max(m.Jplan, m.Jfeas, m.tNeed) + 6;
        let t0 = Math.max(0, Math.floor(m.tIssue - 2)), t1 = Math.ceil(tEnd + (S.fault === 'dup' || S.fault === 'merge' || S.fault === 'gate' ? 3 : 0));
        t1 = Math.max(t1, t0 + 24);
        const VW = 760, PADL = 84, PADR = 12;
        const x = W.scale([t0, t1], [PADL, VW - PADR]);
        const rowsDef = ['clk', 'slow', 'cmd', 'hit', 'en', 'out', 'rcpt'];
        const RH = 20, GAP = 15, TOP = 24;
        const Y = {}; rowsDef.forEach((k, i) => { Y[k] = TOP + i * (RH + GAP) + RH / 2; });
        const VH = TOP + rowsDef.length * (RH + GAP) + 28;
        const svg = W.svg(VW, VH);
        const gridTop = 10, gridBot = VH - 22;
        for (let k = Math.ceil(t0); k <= t1; k++) {
          const wrap = k % M === 0;
          svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: gridTop, y2: gridBot, class: 'grid', style: wrap ? 'stroke:var(--axis)' : '' }));
        }
        const lab = (k, zh, en) => svg.appendChild(W.sL(zh, en, { x: 6, y: Y[k] + 4, class: 'lbl' }));
        const lab1 = (k, t) => svg.appendChild(W.s('text', { x: 6, y: Y[k] + 4, class: 'lbl' }, t));
        const wave = (k, edges, v0, color, w = 2) => svg.appendChild(W.s('path', { d: W.digitalPath(edges, v0, x, Y[k] - RH / 2, Y[k] + RH / 2, t0, t1), fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linejoin': 'round' }));
        const box = (k, a, b, fill, stroke, opacity = 0.28, dash) => {
          const aa = Math.max(a, t0), bb = Math.min(b, t1);
          if (bb <= aa) return;
          svg.appendChild(W.s('rect', { x: x(aa), y: Y[k] - RH / 2, width: x(bb) - x(aa), height: RH, style: `fill:${fill};fill-opacity:${opacity};stroke:${stroke};stroke-width:1.3${dash ? ';stroke-dasharray:4 3' : ''}` }));
        };
        // CK0
        lab1('clk', 'CK₀');
        wave('clk', W.clockEdges(1, 0, t0, t1), 0, 'var(--sig-clk)');
        const dense = x(t0 + 1) - x(t0) < 11;
        for (let k = Math.ceil(t0); k < t1; k++) {
          if (dense && k % M !== 0 && k !== m.Jplan) continue;
          svg.appendChild(W.s('text', { x: x(k + 0.5), y: Y.clk - RH / 2 - 3, 'text-anchor': 'middle', style: `font-size:9px;${k === m.Jplan ? 'font-weight:700;fill:var(--sig-plan)' : ''}` }, String(k)));
        }
        // slow clock T_d = M T0
        lab('slow', '慢时钟 T_d', 'slow clk T_d');
        wave('slow', W.clockEdges(M, 0, t0, t1), 0, 'var(--sig-clk)', 1.8);
        // command timeline
        lab('cmd', '命令', 'command');
        box('cmd', m.tIssue, m.tIssue + S.Lc, 'var(--sig-low)', 'var(--sig-low)');
        box('cmd', m.tIssue + S.Lc, m.tArrive, 'var(--sig-high)', 'var(--sig-high)');
        box('cmd', m.tArrive, m.tNeed, 'var(--warning)', 'var(--warning)', 0.4);
        if (m.slack >= 0) box('cmd', m.tNeed, m.Jplan, 'var(--good)', 'var(--good)', 0.22);
        else box('cmd', m.Jplan, m.tNeed, 'var(--sig-err)', 'var(--sig-err)', 0.4);
        const segLab = (a, b, zh, en) => { if (x(Math.min(b, t1)) - x(Math.max(a, t0)) > 34) svg.appendChild(W.sL(zh, en, { x: (x(Math.max(a, t0)) + x(Math.min(b, t1))) / 2, y: Y.cmd + 3.6, 'text-anchor': 'middle', style: 'font-size:9.5px;fill:var(--fg)' })); };
        segLab(m.tIssue, m.tIssue + S.Lc, '计算', 'compute');
        segLab(m.tIssue + S.Lc, m.tArrive, 'CDC', 'CDC');
        segLab(m.tArrive, m.tNeed, '建立+guard', 'setup+guard');
        segLab(Math.min(m.tNeed, m.Jplan), Math.max(m.tNeed, m.Jplan), m.slack >= 0 ? '余量' : '超时', m.slack >= 0 ? 'slack' : 'overrun');
        // high-bit hit & slot enable (for executed edge group; dashed for the missed/plan one)
        lab('hit', '高位命中', 'high-bit hit');
        lab('en', 'slot 使能', 'slot enable');
        const hitBox = (J, dash) => box('hit', M * Math.floor(J / M), M * Math.floor(J / M) + M, 'var(--sig-high)', 'var(--sig-high)', dash ? 0.06 : 0.28, dash);
        if (m.Jexec == null || m.Jexec !== m.Jplan) hitBox(m.Jplan, true);
        if (m.Jexec != null) hitBox(m.Jexec, false);
        const enBox = (a, b, dash) => box('en', a, b, 'var(--sig-sel)', 'var(--sig-sel)', dash ? 0.05 : 0.3, dash);
        if (m.Jexec == null || m.Jexec !== m.Jplan || S.fault === 'gate') enBox(m.Jexec == null || m.Jexec !== m.Jplan ? m.Jplan - 1 : m.Jexec - 1, (m.Jexec == null || m.Jexec !== m.Jplan ? m.Jplan : m.Jexec) + 0.5, true);
        if (m.Jexec != null) {
          if (S.fault === 'gate') enBox(m.Jexec + 0.35, m.Jexec + 1.5, false);
          else if (S.fault === 'drop') { /* enable asserted but edge is lost downstream */ enBox(m.Jexec - 1, m.Jexec + 0.5, false); }
          else if (S.fault === 'merge') enBox(m.Jexec - 1, m.Jexec + 2.5, false);
          else enBox(m.Jexec - 1, m.Jexec + 0.5, false);
        }
        // output pulses
        lab('out', '输出脉冲', 'output pulse');
        const outE = []; for (const p of m.pulses) outE.push({ t: p.s, v: 1 }, { t: p.s + p.w, v: 0 });
        wave('out', outE, 0, 'var(--sig-sel)', 2.2);
        // receipt (independent path, +1 T0 fixed pipeline)
        lab('rcpt', '回执', 'receipt');
        const rE = []; for (const p of m.pulses) rE.push({ t: p.s + 1, v: 1 }, { t: p.s + 1 + 0.5, v: 0 });
        wave('rcpt', rE, 0, 'var(--sig-ref)', 2);
        for (const p of m.pulses) svg.appendChild(W.s('text', { x: x(p.s + 1.25), y: Y.rcpt - RH / 2 - 3, 'text-anchor': 'middle', style: 'font-size:9.5px;fill:var(--sig-ref);font-weight:700' }, `J=${p.s}`));
        if (!m.pulses.length) svg.appendChild(W.sL('无回执', 'no receipt', { x: x(t0) + 8, y: Y.rcpt + 4, style: 'font-size:10px' }));
        // vertical markers
        const vmark = (t, color, zh, en, dy = 0, anchor = 'start', dash = true) => {
          if (t < t0 || t > t1) return;
          svg.appendChild(W.s('line', { x1: x(t), x2: x(t), y1: gridTop, y2: gridBot, style: `stroke:${color};stroke-width:1.8${dash ? ';stroke-dasharray:5 3' : ''}` }));
          svg.appendChild(W.sL(zh, en, { x: x(t) + (anchor === 'end' ? -3 : 3), y: VH - 8 + dy, 'text-anchor': anchor, style: `font-size:10px;fill:${color};font-weight:700` }));
        };
        vmark(m.Jplan, 'var(--sig-plan)', 't_target = J_plan', 't_target = J_plan', 0, 'start', false);
        vmark(m.tArrive, 'var(--sig-ref)', 't_arrive', 't_arrive', 0, 'end');
        if (S.setup + S.guard > 0 || m.late) vmark(m.tNeed, m.late ? 'var(--sig-err)' : 'var(--good-ink)', 't_arrive+setup+guard', 't_arrive+setup+guard', 0, m.tNeed < m.Jplan ? 'end' : 'start');
        W.clear(svgHost).appendChild(svg);
        // Eq. 16/17 live
        const f = (v) => W.fmt(v, 1);
        W.clear(eqHost).append(
          W.tex(`J_{\\mathrm{plan}}=MH_J+s_J=${M}\\cdot${S.HJ}+${S.sJ}=${m.Jplan}\\qquad(16)`, true),
          W.tex(`t_{\\mathrm{arrive}}+t_{\\mathrm{setup,exec}}+t_{\\mathrm{guard}}=${f(m.tArrive)}+${f(S.setup)}+${f(S.guard)}=${f(m.tNeed)}\\;${m.late ? '>' : '\\le'}\\;t_{\\mathrm{target}}=${m.Jplan}\\qquad(17)`, true));
        // status
        W.clear(stHost);
        stHost.append(
          m.late ? W.status('bad', [`式 (17) 不满足：超时 ${f(-m.slack)} T₀`, `Eq. (17) violated: overrun ${f(-m.slack)} T₀`]) : W.status('good', [`式 (17) 满足：余量 ${f(m.slack)} T₀`, `Eq. (17) satisfied: slack ${f(m.slack)} T₀`]));
        if (m.late) {
          stHost.append(S.policy === 'flag' ? W.status('warn', ['LATE/MISS：不发沿，本次不产生 fine 测量', 'LATE/MISS: no edge, no fine measurement'])
            : S.policy === 'replan' ? W.status('good', [`重新规划为 J = ${m.Jfeas}（H_J = ${Math.floor(m.Jfeas / M)}, s_J = ${m.Jfeas % M}），回执与相位坐标随之更新`, `re-planned to J = ${m.Jfeas} (H_J = ${Math.floor(m.Jfeas / M)}, s_J = ${m.Jfeas % M}); receipt and phase coordinate follow`])
              : W.status('bad', [`禁止：实际在 J = ${m.Jfeas} 发沿，却仍报告 J_plan = ${m.Jplan}`, `forbidden: fired at J = ${m.Jfeas} but still reports J_plan = ${m.Jplan}`]));
        }
        // table
        const nstr = (v, none) => (v == null ? none : String(v));
        const none = api.t('无', 'none');
        const tb = W.h('table', { class: 'px-tbl' });
        tb.append(W.h('tbody', null,
          W.h('tr', null, W.h('th', null, 'J_plan'), W.h('td', null, String(m.Jplan))),
          W.h('tr', null, W.h('th', null, W.L('报告给测量链的 J', 'J reported to measurement chain')), W.h('td', null, m.Jrep == null ? 'LATE/MISS' : String(m.Jrep))),
          W.h('tr', null, W.h('th', null, W.L('J_observed（独立回执）', 'J_observed (independent receipt)')), W.h('td', null, m.obs.length ? m.obs.join(', ') : none)),
          W.h('tr', null, W.h('th', null, W.L('TDC 实际使用的沿', 'Edge the TDC actually used')), W.h('td', null, nstr(m.used, none))),
          W.h('tr', null, W.h('th', null, W.L('若信任 J_plan/报告值：锚点偏差', 'If the report/plan is trusted: anchor error')),
            W.h('td', null, m.err == null ? api.t('无可测边沿（缺失）', 'no edge to measure (missing)') : `${m.err > 0 ? '+' : ''}${m.err} ${api.t('原周期', 'raw cycles')}${m.err ? ' ✗' : ' ✓'}`)),
          W.h('tr', null, W.h('th', null, W.L('回执对账（I4）', 'Receipt cross-check (I4)')),
            W.h('td', null, m.mismatch ? W.status('bad', ['不一致 → 不进入 fine_valid', 'mismatch → not fine_valid']) : W.status('good', ['一致', 'consistent']))),
          S.fault === 'merge' ? W.h('tr', null, W.h('th', null, W.L('相邻事件', 'Adjacent events')), W.h('td', null, api.t(`计划 2 个沿（J = ${m.planned.join(', ')}），输出 ${m.obs.length} 个上升沿`, `${m.planned.length} edges planned (J = ${m.planned.join(', ')}), ${m.obs.length} rising edge(s) emitted`))) : null));
        W.clear(tblHost).appendChild(W.h('div', { class: 'px-tblw' }, tb));
      }
      draw();
      const off = api.onLang(() => draw());
      return { destroy() { off && off(); } };
    },
  });
})();
