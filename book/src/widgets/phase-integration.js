/* phase-integration — report §10.1 (EventFrame), §10.2 (invariants I1–I8), §10.3 (pseudo-code), §9.3 Eq. (20).
 *
 * Implements the book's decision rule exactly:
 *   FINE   iff coarse.valid ∧ observed.valid ∧ fine_is_usable,   F_usable = V_code ∧ V_range ∧ V_anchor ∧ V_epoch ∧ V_cal   (Eq. 20)
 *   COARSE iff not FINE and coarse.valid
 *   INVALID otherwise.
 * Mapping of frame fields to validity terms is an idealized, labelled interpretation of the interface suggestion:
 *   V_code  = fine_valid (code legal) ∧ ¬encoding_invalid          V_range = ¬sat_hi ∧ ¬sat_lo
 *   V_anchor = J_observed proven, equal to J_plan, no late/miss/duplicate       V_epoch = coordinates coherent (not torn beyond the
 *   covered correction set, boundary candidates equivalent)          V_cal = tdc_gain/period/path epochs all current
 *   coarse.valid = clock-node & reset_epoch match ∧ ¬encoding_invalid ∧ unwrap window respected ∧ not torn outside the covered set
 * Fine normalisation uses an ILLUSTRATIVE μ = code / 64 (code_0 = 0) — not a TDC specification.
 */
(function () {
  'use strict';
  const CSS = `
.pi-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 215px), 1fr)); gap: 8px; margin-top: 6px; }
.pi-card { border: 1px solid var(--border); border-top: 3px solid var(--c, var(--accent)); border-radius: 10px; padding: 6px 9px 8px; background: var(--surface); font-size: .76rem; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.pi-card h5 { margin: 0 0 1px; font-size: .78rem; color: var(--fg); }
.pi-card .w-ctl { display: flex; width: 100%; flex-wrap: wrap; gap: 3px 8px; }
.pi-card .w-ctl input[type="range"] { flex: 1; min-width: 70px; width: auto; }
.pi-card .w-ctl select { max-width: 100%; }
.pi-card .w-toggle { font-size: .76rem; }
.pi-card code, .pi-card .f { font-family: var(--mono); font-size: .72rem; color: var(--fg); }
.pi-card .kv { display: flex; justify-content: space-between; gap: 8px; font-variant-numeric: tabular-nums; }
.pi-card .kv span:first-child { color: var(--muted); font-family: var(--mono); font-size: .72rem; }
.pi-h { margin: 14px 0 6px; font-size: .8rem; font-weight: 700; color: var(--fg); }
.pi-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 760px) { .pi-two { grid-template-columns: minmax(0, 1fr); } }
.pi-code { margin: 0; padding: 8px 0; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); font-family: var(--mono); font-size: .74rem; line-height: 1.55; overflow-x: auto; }
.pi-code .ln { display: flex; gap: 8px; padding: 0 10px; white-space: pre; border-left: 3px solid transparent; }
.pi-code .ln .no { color: var(--muted); width: 1.4em; text-align: right; user-select: none; }
.pi-code .ln.run { background: var(--accent-wash); border-left-color: var(--accent); }
.pi-code .ln.done { color: var(--fg); }
.pi-code .ln.skip { color: var(--muted); }
.pi-code .ln .cm { color: var(--accent-ink); margin-left: 12px; }
.pi-tblw { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.pi-tbl { width: 100%; border-collapse: collapse; font-size: .75rem; margin: 0; }
.pi-tbl th, .pi-tbl td { padding: 3px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.pi-tbl th { background: var(--surface-2); font-weight: 650; position: static; }
.pi-tbl tr:last-child td { border-bottom: 0; }
.pi-tbl tr.viol td { background: color-mix(in srgb, var(--critical) 9%, transparent); }
.pi-verdict { display: inline-block; padding: 2px 14px; border-radius: 999px; font-weight: 700; font-size: .9rem; border: 2px solid currentColor; }
.pi-verdict.FINE { color: var(--good-ink); } .pi-verdict.COARSE { color: #a86500; } .pi-verdict.INVALID { color: var(--critical-ink); }
.pi-res { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin: 10px 0 4px; font-size: .82rem; }
`;
  const CUR = 7; // current calibration epoch (illustrative)
  const LSBN = 64; // illustrative: μ = code / 64 raw cycles

  function model(S) {
    const checkOK = S.reset_ok && S.node_ok;
    const kC = S.capClass === 'torn_in' ? -1 : 0;
    const Ncor = S.M * (S.C_cap + kC) + S.q_cap;
    const coarseValid = checkOK && !S.enc_invalid && !S.rollover && S.capClass !== 'torn_out';
    const obsValid = S.obsState === 'proven' && !S.late && !S.miss && !S.dup;
    const Jobs = S.obsState === 'mismatch' ? S.J_plan + 1 : S.J_plan;
    const alpha = S.polarity === 'fall' ? 0.5 : 0;
    const V = {
      code: S.code_valid && !S.enc_invalid,
      range: !S.sat_hi && !S.sat_lo,
      anchor: obsValid,
      epoch: checkOK && (S.capClass === 'legal' || S.capClass === 'torn_in'),
      cal: S.gain_ok && S.period_ok && S.path_ok,
    };
    const Fusable = V.code && V.range && V.anchor && V.epoch && V.cal;
    const cond = coarseValid && obsValid && Fusable;
    const out = cond ? 'FINE' : coarseValid ? 'COARSE' : 'INVALID';
    const anchor = Jobs + alpha, mu = S.fine_raw / LSBN, phase = anchor - mu;
    const inv = [
      { id: 'I1', v: !S.reset_ok || !S.node_ok || S.enc_invalid },
      { id: 'I2', v: S.obsState === 'mismatch' },
      { id: 'I3', v: S.capClass === 'torn_out' },
      { id: 'I4', v: S.obsState !== 'proven' || S.dup },
      { id: 'I5', v: S.sat_hi || S.sat_lo || !S.code_valid || !V.cal },
      { id: 'I6', v: S.capClass === 'cand_mismatch' },
      { id: 'I7', v: S.late || S.miss },
      { id: 'I8', v: S.rollover },
    ];
    return { checkOK, kC, Ncor, coarseValid, obsValid, Jobs, alpha, V, Fusable, cond, out, anchor, mu, phase, inv };
  }

  const CODE = [
    'on complete_event(frame):',
    '    check_clock_node_and_reset_epoch(frame)',
    '    coarse = decode_and_align_coarse(frame)',
    '    observed = verify_physical_edge_identity(frame)',
    '',
    '    if coarse.valid and observed.valid and fine_is_usable(frame):',
    '        anchor = observed.J + frame.alpha_sel',
    '        mu = normalize_fine_with_matching_calibration(frame)',
    '        phase = anchor - mu',
    '        return FINE, phase, fine_error_bound',
    '',
    '    if coarse.valid:',
    '        return COARSE, coarse.phase_estimate, coarse.error_bound',
    '',
    '    return INVALID, no_new_measurement',
  ];

  Book.registerWidget({
    id: 'phase-integration',
    group: 'system',
    title: { zh: 'EventFrame 与相位整合决策（§10.1–10.3，式 20）', en: 'EventFrame and the phase-integration decision (§10.1–10.3, Eq. 20)' },
    summary: {
      zh: '按 §10.1 表格分组编辑一个 EventFrame，逐行执行 §10.3 伪代码，观察 F_usable = V_code ∧ V_range ∧ V_anchor ∧ V_epoch ∧ V_cal（式 20）的与门，以及输出 FINE / COARSE / INVALID 的判定和被违反的不变量 I1–I8。',
      en: 'Edit an EventFrame grouped like the §10.1 table, run the §10.3 pseudo-code line by line, and watch the AND gate F_usable = V_code ∧ V_range ∧ V_anchor ∧ V_epoch ∧ V_cal (Eq. 20), the FINE / COARSE / INVALID decision and the violated invariants I1–I8.',
    },
    sections: ['r-10-3', 'r-9-3', 'r-10-1'],
    eqs: ['20'],
    keywords: ['EventFrame', 'F_usable', 'FINE', 'COARSE', 'INVALID', 'invariant', 'pseudo-code', '不变量', '相位整合', '伪代码'],
    mount(root, api) {
      if (!document.getElementById('pi-css')) { const s = document.createElement('style'); s.id = 'pi-css'; s.textContent = CSS; document.head.appendChild(s); }
      const BASE = { reset_ok: true, node_ok: true, M: 8, C_cap: 3, q_cap: 5, capClass: 'legal', J_plan: 26, obsState: 'proven', polarity: 'rise', fine_raw: 12, code_valid: true, sat_hi: false, sat_lo: false, gain_ok: true, period_ok: true, path_ok: true, late: false, miss: false, dup: false, enc_invalid: false, rollover: false };
      const S = { ...BASE };
      let cur = 99; // stepper position (index into trace); 99 = fully executed
      let trace = [];

      const ctl = {};
      const T = (zh, en) => [zh, en];
      const mk = {
        tog: (k, zh, en) => (ctl[k] = W.toggle({ label: [zh, en], value: S[k], onChange: (v) => { S[k] = v; refresh(true); } })),
        sl: (k, label, min, max, fmt) => (ctl[k] = W.slider({ label, min, max, step: 1, value: S[k], fmt: fmt || String, onInput: (v) => { S[k] = v; refresh(true); } })),
        sel: (k, label, options) => (ctl[k] = W.select({ label, options, value: S[k], onChange: (v) => { S[k] = v; refresh(true); } })),
      };
      const cardsHost = W.h('div', { class: 'pi-cards' });
      const kvHost = {}; // derived read-only cards
      const card = (c, zh, en, ...kids) => W.h('div', { class: 'pi-card', style: { '--c': c } }, W.h('h5', null, W.L(zh, en)), ...kids);
      const kv = (name, key) => { const v = W.h('span'); kvHost[key] = v; return W.h('div', { class: 'kv' }, W.h('span', null, name), v); };

      ctl.M = W.seg({ label: ['M', 'M'], options: [{ value: 4, label: '4' }, { value: 8, label: '8' }], value: S.M, onChange: (v) => { S.M = +v; S.q_cap = Math.min(S.q_cap, S.M - 1); ctl.q_cap.input.max = S.M - 1; ctl.q_cap.value = S.q_cap; refresh(true); } });
      cardsHost.append(
        card('var(--s1)', '事件身份', 'Event identity',
          W.h('div', { class: 'kv' }, W.h('span', null, 'event_id'), W.h('span', null, '1024')),
          mk.tog('reset_ok', 'reset_epoch 与当前一致', 'reset_epoch matches current')),
        card('var(--s3)', '计数坐标', 'Count coordinates',
          mk.tog('node_ok', 'clock_node_id 与当前一致', 'clock_node_id matches current'),
          ctl.M,
          mk.sl('C_cap', ['C_cap', 'C_cap'], 0, 15),
          mk.sl('q_cap', ['q_cap', 'q_cap'], 0, 7)),
        card('var(--s7)', '捕获来源', 'Capture source',
          mk.sel('capClass', ['捕获状态', 'Capture state'], [
            { value: 'legal', label: ['合法状态', 'legal state'] },
            { value: 'torn_in', label: ['撕裂·在覆盖集内（κ_C = −1 已校正）', 'torn · inside covered set (κ_C = −1 corrected)'] },
            { value: 'torn_out', label: ['撕裂·超出覆盖集', 'torn · outside covered set'] },
            { value: 'cand_mismatch', label: ['边界候选不一致（I6）', 'boundary candidates inconsistent (I6)'] }]),
          kv('wrap_tag', 'tag')),
        card('var(--s4)', '计划 / 执行', 'Plan / execution',
          mk.sl('J_plan', ['J_plan', 'J_plan'], 8, 63),
          mk.sel('obsState', ['J_observed', 'J_observed'], [
            { value: 'proven', label: ['独立回执，等于 J_plan', 'independent receipt = J_plan'] },
            { value: 'unproven', label: ['未证实（由计划自证）', 'unproven (self-certified by plan)'] },
            { value: 'mismatch', label: ['回执 ≠ J_plan（差 +1）', 'receipt ≠ J_plan (off by +1)'] }]),
          mk.sel('polarity', ['edge_polarity', 'edge_polarity'], [
            { value: 'rise', label: ['上升沿（α = 0）', 'rising (α = 0)'] }, { value: 'fall', label: ['下降沿（α = 0.5）', 'falling (α = 0.5)'] }])),
        card('var(--s2)', '修正（派生）', 'Correction (derived)', kv('kappa_C', 'kC'), kv('kappa_N', 'kN'), kv('alpha_sel', 'alpha')),
        card('var(--s5)', 'Fine', 'Fine',
          mk.sl('fine_raw', ['fine_raw', 'fine_raw'], -31, 31),
          mk.tog('code_valid', 'fine_valid（码合法）', 'fine_valid (legal code)'),
          mk.tog('sat_hi', 'sat_hi', 'sat_hi'), mk.tog('sat_lo', 'sat_lo', 'sat_lo')),
        card('var(--s6)', '校准', 'Calibration',
          mk.tog('gain_ok', 'tdc_gain_epoch 为当前', 'tdc_gain_epoch current'),
          mk.tog('period_ok', 'period_epoch 为当前', 'period_epoch current'),
          mk.tog('path_ok', 'path_epoch 为当前', 'path_epoch current')),
        card('var(--s8)', '异常', 'Anomalies',
          mk.tog('late', 'late', 'late'), mk.tog('miss', 'miss', 'miss'), mk.tog('dup', 'duplicate', 'duplicate'),
          mk.tog('enc_invalid', 'encoding_invalid', 'encoding_invalid'),
          mk.tog('rollover', 'rollover 窗口越界（I8）', 'rollover window exceeded (I8)')),
        card('var(--accent)', '输出（派生）', 'Output (derived)', kv('phase_source', 'src'), kv('phase_value', 'val'), kv('uncertainty', 'unc')),
      );
      ctl.q_cap.input.max = S.M - 1;

      const PRESETS = [
        [['正常 → FINE', 'Normal → FINE'], {}],
        [['TDC 饱和 → COARSE', 'TDC saturated → COARSE'], { sat_hi: true }],
        [['撕裂·覆盖集内 → FINE', 'Torn inside set → FINE'], { capClass: 'torn_in' }],
        [['撕裂·超出覆盖集 → INVALID', 'Torn outside set → INVALID'], { capClass: 'torn_out' }],
        [['J_observed 未证实 → COARSE', 'J_observed unproven → COARSE'], { obsState: 'unproven' }],
        [['回执不符 → COARSE', 'Receipt mismatch → COARSE'], { obsState: 'mismatch' }],
        [['校准 epoch 不符 → COARSE', 'Calibration epoch mismatch → COARSE'], { period_ok: false }],
        [['reset_epoch 不符 → INVALID', 'reset_epoch mismatch → INVALID'], { reset_ok: false }],
        [['clock_node 不符 → INVALID', 'clock_node mismatch → INVALID'], { node_ok: false }],
        [['late → COARSE', 'late → COARSE'], { late: true }],
        [['miss → COARSE', 'miss → COARSE'], { miss: true }],
        [['候选不一致 → COARSE', 'Candidates inconsistent → COARSE'], { capClass: 'cand_mismatch' }],
      ];
      function applyPreset(p) {
        Object.assign(S, BASE, p);
        for (const k of Object.keys(ctl)) if (k in S) ctl[k].value = S[k];
        ctl.q_cap.input.max = S.M - 1;
        refresh(true);
      }
      const presetBar = W.controls(W.h('span', { class: 'w-ctl' }, W.L('场景：', 'Scenarios:')), ...PRESETS.map(([l, p], i) => W.button(l, () => applyPreset(p), { primary: i === 0 })));

      const resHost = W.h('div', { class: 'pi-res' });
      const codeHost = W.h('div');
      const gateHost = W.h('div');
      const invHost = W.h('div');
      const eqHost = W.h('div');
      const stepBtn = W.button(['单步 ▸', 'Step ▸'], () => { cur = Math.min(trace.length - 1, (cur >= trace.length - 1 ? -1 : cur) + 1); drawCode(); });
      let auto = false, acc = 0;
      const loop = api.loop((dt) => { if (!auto) return; acc += dt; if (acc > 0.75) { acc = 0; if (cur < trace.length - 1) { cur++; drawCode(); } else auto = false; } });
      const replay = W.button(['⟲ 逐行重放', '⟲ Replay line by line'], () => { cur = -1; auto = true; acc = 0.7; loop.start(); drawCode(); });
      const allBtn = W.button(['全部执行', 'Run all'], () => { auto = false; cur = trace.length - 1; drawCode(); });

      root.append(
        presetBar,
        W.h('div', { class: 'pi-h' }, W.L('EventFrame（按 §10.1 分组；字段到有效性的映射为理想化示意）', 'EventFrame (grouped as in §10.1; the field → validity mapping is an idealized illustration)')),
        cardsHost, resHost,
        W.h('div', { class: 'pi-two' },
          W.h('div', null, W.h('div', { class: 'pi-h' }, W.L('§10.3 伪代码执行', '§10.3 pseudo-code execution')), W.controls(stepBtn, replay, allBtn), codeHost),
          W.h('div', null, W.h('div', { class: 'pi-h' }, W.L('式 (20) 与最终判决的与门', 'Eq. (20) and the final decision as AND gates')), gateHost, eqHost)),
        W.h('div', { class: 'pi-h' }, W.L('不变量 I1–I8（§10.2）：当前帧', 'Invariants I1–I8 (§10.2) for this frame')),
        invHost,
        W.note([
          '要点：FINE 仅当 coarse.valid ∧ observed.valid ∧ fine 可用（式 20 的五项全为真）；fine 不可用但 coarse 有效则 COARSE；coarse 也无法判定则 INVALID，而不是强行拼接。饱和只可作单独定义的限幅控制策略的方向信息，不是精确 fine。伪代码刻意不指定 coarse 控制器的增益与积分动作。本图把帧字段映射到 V 项、μ = fine_raw/64 与误差上界均为理想化示意，不是已发布 RTL 或 TDC 指标。',
          'Key point: FINE only when coarse.valid ∧ observed.valid ∧ fine is usable (all five terms of Eq. 20 true); if fine is unusable but coarse is valid the result is COARSE; if even coarse cannot be established the result is INVALID rather than a forced stitch. Saturation may serve only as direction information for a separately defined limiting policy — it is not a precise fine residual. The pseudo-code deliberately specifies no coarse-controller gain or integrator action. The mapping of frame fields to V terms, μ = fine_raw/64 and the error bounds are idealized illustrations, not published RTL or TDC specifications.',
        ]),
      );

      function buildTrace(m) {
        const L = api.t.bind(api);
        const tr = [];
        tr.push({ ln: 0, cm: '' });
        tr.push({ ln: 1, cm: m.checkOK ? L('✓ clock_node、reset_epoch 一致', '✓ clock_node and reset_epoch match') : L('✗ 不一致 → coarse 视为无效', '✗ mismatch → coarse treated as invalid') });
        tr.push({ ln: 2, cm: `${L('N', 'N')} = ${S.M}·(${S.C_cap}${m.kC ? m.kC : ''}) + ${S.q_cap} = ${m.Ncor}，valid = ${m.coarseValid ? '✓' : '✗'}` });
        tr.push({ ln: 3, cm: `J = ${m.Jobs}，valid = ${m.obsValid ? '✓' : '✗'}` });
        tr.push({ ln: 5, cm: `${m.coarseValid ? '✓' : '✗'} ∧ ${m.obsValid ? '✓' : '✗'} ∧ F_usable ${m.Fusable ? '✓' : '✗'} → ${m.cond ? 'true' : 'false'}` });
        if (m.cond) {
          tr.push({ ln: 6, cm: `${m.Jobs} + ${m.alpha} = ${W.fmt(m.anchor, 1)}` });
          tr.push({ ln: 7, cm: `μ = ${S.fine_raw}/${LSBN} = ${W.fmt(m.mu, 4)}` });
          tr.push({ ln: 8, cm: `${W.fmt(m.anchor, 1)} − ${W.fmt(m.mu, 4)} = ${W.fmt(m.phase, 4)}` });
          tr.push({ ln: 9, cm: 'FINE' });
        } else {
          tr.push({ ln: 11, cm: `coarse.valid = ${m.coarseValid ? 'true' : 'false'}` });
          if (m.coarseValid) tr.push({ ln: 12, cm: `COARSE，N = ${m.Ncor}` });
          else tr.push({ ln: 14, cm: 'INVALID' });
        }
        return tr;
      }

      function drawCode() {
        const ex = new Set(trace.map((t) => t.ln));
        const box = W.h('div', { class: 'pi-code' });
        CODE.forEach((txt, i) => {
          const idx = trace.findIndex((t) => t.ln === i);
          const reached = idx >= 0 && idx <= cur;
          const isRun = idx >= 0 && idx === cur;
          const finished = cur >= trace.length - 1;
          const cls = isRun ? 'run' : reached ? 'done' : (finished && !ex.has(i) && txt.trim() ? 'skip' : '');
          box.appendChild(W.h('div', { class: 'ln ' + cls }, W.h('span', { class: 'no' }, String(i + 1)), W.h('span', null, txt || ' '),
            reached && trace[idx].cm ? W.h('span', { class: 'cm' }, '// ' + trace[idx].cm) : null));
        });
        W.clear(codeHost).appendChild(box);
      }

      function drawGates(m) {
        const VW = 470, VH = 196;
        const svg = W.svg(VW, VH);
        const col = (ok) => (ok ? 'var(--good)' : 'var(--critical)');
        const lamp = (x, y, ok) => svg.appendChild(W.s('circle', { cx: x, cy: y, r: 6.5, style: `fill:${col(ok)};stroke:var(--surface);stroke-width:1.5` }));
        const wire = (x1, y1, x2, y2, ok) => svg.appendChild(W.s('path', { d: `M${x1},${y1}L${x2},${y2}`, fill: 'none', style: `stroke:${col(ok)};stroke-width:2` }));
        const body = (x, y0, y1, ok) => { const r = (y1 - y0) / 2; svg.appendChild(W.s('path', { d: `M${x},${y0}H${x + 22}A${r},${r} 0 0 1 ${x + 22},${y1}H${x}Z`, style: `fill:var(--surface-2);stroke:${col(ok)};stroke-width:2.4` })); svg.appendChild(W.s('text', { x: x + 14, y: (y0 + y1) / 2 + 4, 'text-anchor': 'middle', style: 'font-size:11px;font-weight:700;fill:var(--fg)' }, '∧')); };
        const ins = [['V_code', m.V.code], ['V_range', m.V.range], ['V_anchor', m.V.anchor], ['V_epoch', m.V.epoch], ['V_cal', m.V.cal]];
        const ys = [24, 52, 80, 108, 136];
        const g1x = 118;
        ins.forEach(([n, ok], i) => {
          lamp(12, ys[i], ok);
          svg.appendChild(W.s('text', { x: 24, y: ys[i] + 4, class: 'mono', style: 'font-size:11px;fill:var(--fg)' }, n));
          wire(84, ys[i], g1x, ys[i], ok);
        });
        body(g1x, 8, 152, m.Fusable);
        wire(g1x + 48, 80, 214, 80, m.Fusable);
        svg.appendChild(W.s('text', { x: g1x + 50, y: 72, class: 'mono', style: 'font-size:11px;font-weight:700;fill:var(--fg)' }, 'F_usable'));
        // gate 2
        const g2x = 330;
        const y2 = [60, 100, 140];
        svg.appendChild(W.s('path', { d: `M214,80L238,80L238,${y2[0]}L${g2x},${y2[0]}`, fill: 'none', style: `stroke:${col(m.Fusable)};stroke-width:2` }));
        lamp(214, 80, m.Fusable);
        const sec = [['coarse.valid', m.coarseValid, y2[1]], ['observed.valid', m.obsValid, y2[2]]];
        for (const [n, ok, y] of sec) {
          svg.appendChild(W.s('text', { x: 208, y: y - 8, class: 'mono', style: 'font-size:10.5px;fill:var(--fg)' }, n));
          lamp(300, y, ok); wire(300, y, g2x, y, ok);
        }
        body(g2x, 44, 156, m.cond);
        wire(g2x + 50, 100, 400, 100, m.cond);
        svg.appendChild(W.s('rect', { x: 400, y: 84, width: 62, height: 32, rx: 16, style: `fill:${col(m.cond)};fill-opacity:.2;stroke:${col(m.cond)};stroke-width:2` }));
        svg.appendChild(W.s('text', { x: 431, y: 105, 'text-anchor': 'middle', style: 'font-size:13px;font-weight:700;fill:var(--fg)' }, m.cond ? 'FINE' : '¬FINE'));
        svg.appendChild(W.sL('否则 coarse.valid → COARSE，再否则 INVALID', 'else coarse.valid → COARSE, else INVALID', { x: VW / 2, y: VH - 18, 'text-anchor': 'middle', style: 'font-size:10.5px' }));
        W.clear(gateHost).appendChild(svg);
        W.clear(eqHost).appendChild(W.tex('F_{\\mathrm{usable}}=V_{\\mathrm{code}}\\land V_{\\mathrm{range}}\\land V_{\\mathrm{anchor}}\\land V_{\\mathrm{epoch}}\\land V_{\\mathrm{cal}}\\qquad(20)', true));
      }

      const INV = {
        I1: [['CK₀ 周期连续，N = MC + q 的原点与 carry 一致', 'CK₀ period continuous; origin and carry of N = MC + q consistent'], ['阻断有效相位；检查复位/极性/计数实现', 'Block valid phase; check reset / polarity / counter implementation']],
        I2: [['coarse 与 fine 同锚点，或显式记录锚点变换', 'Coarse and fine share an anchor, or the transform is recorded'], ['校正或 INVALID，不静默相加', 'Correct or INVALID — never add silently']],
        I3: [['correction 的单位和可覆盖错误集合明确', 'Correction units and covered error set are explicit'], ['超界置无效；不截断成 ±1', 'Out of bounds → invalid; never truncate to ±1']],
        I4: [['J_observed 反映真实执行，不由 J_plan 自证', 'J_observed reflects real execution, not self-certified by J_plan'], ['标记回执未证实，不进入 fine_valid', 'Mark receipt unproven; do not enter fine_valid']],
        I5: [['fine 量程、码合法性和校准全部满足', 'Fine range, code legality and calibration all satisfied'], ['降级使用 coarse / 区间 / 无效', 'Degrade to coarse / interval / invalid']],
        I6: [['两种边界候选在共同坐标下等价', 'Both boundary candidates are equivalent in a common coordinate'], ['不一致视为 coarse/fine stitching 错误', 'Inconsistent → coarse/fine stitching error']],
        I7: [['低速计算符合选沿 deadline', 'Slow-domain computation meets the edge-select deadline'], ['late/miss 或重新规划并更新 J', 'late/miss, or re-plan and update J']],
        I8: [['全 counter rollover 采用明确模运算窗口', 'Full-counter rollover uses an explicit modular window'], ['超出可展开范围时 reset/reacquire', 'Outside the unwrap range → reset / reacquire']],
      };
      function drawInv(m) {
        const tb = W.h('table', { class: 'pi-tbl' });
        tb.append(W.h('thead', null, W.h('tr', null, W.h('th', null, ''), W.h('th', null, W.L('不变量', 'Invariant')), W.h('th', null, W.L('状态', 'Status')), W.h('th', null, W.L('违反后的处理', 'Prescribed handling')))));
        const body = W.h('tbody');
        for (const it of m.inv) {
          const d = INV[it.id];
          body.appendChild(W.h('tr', { class: it.v ? 'viol' : '' }, W.h('td', null, W.h('b', null, it.id)), W.h('td', null, W.lbl(d[0])),
            W.h('td', null, it.v ? W.status('bad', ['违反', 'violated']) : W.status('good', ['满足', 'ok'])),
            W.h('td', null, it.v ? W.lbl(d[1]) : W.h('span', { style: { color: 'var(--muted)' } }, '—'))));
        }
        tb.appendChild(body);
        W.clear(invHost).appendChild(W.h('div', { class: 'pi-tblw' }, tb));
      }

      function refresh(resetStep) {
        const m = model(S);
        trace = buildTrace(m);
        if (resetStep) { cur = trace.length - 1; auto = false; }
        kvHost.tag.textContent = String(S.C_cap % 4);
        kvHost.kC.textContent = `${m.kC} ${api.t('（组单位）', '(group units)')}`;
        kvHost.kN.textContent = `0 ${api.t('（原周期单位）', '(raw-cycle units)')}`;
        kvHost.alpha.textContent = String(m.alpha);
        kvHost.src.textContent = m.out;
        kvHost.val.textContent = m.out === 'FINE' ? `${W.fmt(m.phase, 4)} ${api.t('原周期', 'raw cyc.')}` : m.out === 'COARSE' ? `${m.Ncor} ${api.t('原周期', 'raw cyc.')}` : api.t('无新测量', 'no new measurement');
        kvHost.unc.textContent = m.out === 'FINE' ? `± ${W.fmt(0.5 / LSBN, 4)}` : m.out === 'COARSE' ? '± 1' : '—';
        W.clear(resHost);
        const viol = m.inv.filter((i) => i.v).map((i) => i.id).join(', ');
        resHost.append(W.L('判决：', 'Decision: '), W.h('span', { class: 'pi-verdict ' + m.out }, m.out),
          W.h('span', { style: { color: 'var(--fg-2)' } }, W.L(`被违反的不变量：${viol || '无'}`, `Violated invariants: ${viol || 'none'}`)));
        drawCode(); drawGates(m); drawInv(m);
      }
      refresh(true);
      const off = api.onLang(() => refresh(false));
      return { destroy() { auto = false; loop.stop(); off && off(); } };
    },
  });
})();
