/* arch-flow — report §8.1 / intro §6: functional data flow of the CNT-ADPLL as an animated, clickable block diagram.
 *
 * This is the book's architecture SYNTHESIS (not a redraw of any paper figure) and a qualitative illustration:
 *   measurement chain  CK0 → persistent high/low count → REF-safe snapshot → coarse anchor
 *   execution chain    J_plan → high-bit hit + slot control → physical edge select/gating → actual edge → J_observed
 *   REF → local fine measurement ← selected real edge
 *   → tuple consistency + VALID/SAT + coordinate reconstruction → phase error (FINE / COARSE / INVALID).
 * The verdict follows report §10.3: FINE needs coarse.valid ∧ observed.valid ∧ fine usable; COARSE if coarse.valid; else INVALID.
 */
(function () {
  'use strict';
  const CSS = `
.af-box { cursor: pointer; }
.af-box rect.bg { transition: stroke .15s; }
.af-box:hover rect.bg { stroke: var(--accent); }
.af-info { margin-top: 10px; padding: 10px 14px; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 8px; background: var(--surface-2); font-size: .82rem; line-height: 1.6; color: var(--fg-2); }
.af-info h4 { margin: 0 0 4px; font-size: .88rem; color: var(--fg); }
.af-info .lk { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: .78rem; }
.af-info .lk b { color: var(--fg); font-weight: 650; }
.af-verdict { display: inline-block; padding: 2px 12px; border-radius: 999px; font-weight: 700; font-size: .82rem; border: 1px solid var(--border-strong); }
.af-verdict.FINE { color: var(--good-ink); }
.af-verdict.COARSE { color: #a86500; }
.af-verdict.INVALID { color: var(--critical-ink); }
.af-res { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-top: 8px; font-size: .8rem; color: var(--fg-2); }
`;
  const ORDER = ['clk', 'cnt', 'snap', 'coarse', 'plan', 'hit', 'gate', 'edge', 'obs', 'ref', 'fine', 'integ'];
  // grid position (col 0..4, row 0..2) in the wide layout
  const POS = {
    clk: [0, 0], cnt: [1, 0], snap: [2, 0], coarse: [3, 0],
    ref: [2, 1], fine: [3, 1], integ: [4, 1],
    plan: [0, 2], hit: [1, 2], gate: [2, 2], edge: [3, 2], obs: [4, 2],
  };
  const T = {
    clk: { l: [['实际 CK₀'], ['Actual CK₀']] },
    cnt: { l: [['持续高/低', '计数状态'], ['Persistent', 'high/low count']] },
    snap: { l: [['REF 相关', '安全快照'], ['REF-related', 'safe snapshot']] },
    coarse: { l: [['coarse', 'anchor'], ['coarse', 'anchor']] },
    plan: { l: [['计划', 'J_plan'], ['Plan', 'J_plan']] },
    hit: { l: [['高位命中', '+ slot 控制'], ['High-bit hit', '+ slot control']] },
    gate: { l: [['物理选沿', '/ 门控'], ['Physical edge', 'select / gate']] },
    edge: { l: [['实际边沿'], ['Actual edge']] },
    obs: { l: [['执行侧观察', 'J_observed'], ['Execution-side', 'J_observed']] },
    ref: { l: [['REF'], ['REF']] },
    fine: { l: [['局部 fine', '测量（短 TDC）'], ['Local fine', 'measure (short TDC)']] },
    integ: { l: [['元组一致性', '+ VALID/SAT', '+ 坐标重建'], ['Tuple check', '+ VALID/SAT', '+ coord. rebuild']] },
  };
  const INFO = {
    clk: {
      zh: '被工程选定、需要完整保留周期编号的时钟节点 CK₀（可能是 DCO，也可能是明确选定的预分频节点）。改变 CK₀ 时，所有 CNT 权重、FCW、fine 归一化与 edge ID 必须一起换算。',
      en: 'The clock node chosen as CK₀, whose cycle index must be preserved completely (it may be the DCO or an explicitly selected prescaler output). Changing CK₀ forces a joint conversion of CNT weights, FCW, fine normalisation and edge IDs.',
      secs: ['r-3-1'], w: ['clock-node-units'],
    },
    cnt: {
      zh: '持续计数器（CNT）：低 log₂M 位以 CK₀ 速率保存状态（二进制、Johnson/Gray、shift state 等），高位在 T_d = M·T₀ 域累加。高位时钟必须与低位 wrap 在逻辑上同源，不能是任意同频 /M 时钟。N = M·C + q 只是对对齐状态的定义。',
      en: 'Persistent counter (CNT): the low log₂M bits hold state at CK₀ rate (binary, Johnson/Gray, shift state, …) and the high part accumulates in the T_d = M·T₀ domain. The high clock must be logically derived from the low wrap — not any arbitrary /M clock of the same frequency. N = M·C + q only defines aligned states.',
      secs: ['r-3-2'], w: ['split-counter'],
    },
    snap: {
      zh: '相干快照：在参考事件附近捕获 {C, q} 及边界侧信息。“相干”的本质是同一逻辑 epoch，不要求所有位物理上同一时刻锁存。路线 A 用多候选捕获，路线 B 沿计数传播方向匹配采样时刻，路线 C 用有界错配加冗余校正。',
      en: 'Coherent snapshot: capture {C, q} and boundary-side information near the reference event. "Coherent" means the same logical epoch — not that all bits are latched at the same physical instant. Route A uses multi-candidate capture, route B matches sampling times along the count-propagation direction, route C uses bounded mismatch with redundant correction.',
      secs: ['r-6-1', 'r-7-1', 'r-7-2'], w: ['torn-capture', 'matched-delay-sampling'],
    },
    coarse: {
      zh: 'coarse anchor：对快照解码并对齐到统一坐标，得到整数周期编号（含 κ 修正）。它在 fine 不可用时仍可作为 COARSE 相位估计（带误差上界）；若快照撕裂且无法校正，则 coarse 也无效。',
      en: 'Coarse anchor: decode the snapshot and align it to the common coordinate to get the integer cycle index (with the κ correction). It remains usable as a COARSE phase estimate (with an error bound) when fine is unusable; if the snapshot is torn beyond correction, coarse is invalid too.',
      secs: ['r-6-2', 'r-6-4'], w: ['torn-capture', 'anchor-equivalence'],
    },
    plan: {
      zh: '计划 J_plan：目标沿编号 J_plan = M·H_J + s_J（式 16），由慢速域提前规划。计划只是命令，不是已执行的证据。后知后觉的低速 snapshot 不能生成已经过去的最近边沿，因此选沿必须在目标前提交（§8.3）。',
      en: 'Plan J_plan: the target edge number J_plan = M·H_J + s_J (Eq. 16), planned ahead in the slow domain. A plan is a command, not evidence of execution. A late low-speed snapshot cannot generate an edge that has already passed, so the selection must be committed before the target (§8.3).',
      secs: ['r-8-1', 'r-8-3'], w: ['ps-executor'],
    },
    hit: {
      zh: '慢速域做高位匹配与未来计划；高速少量状态负责 slot / phase-local enable、脉冲形成及根时钟重定时。命令必须满足式 (17) 的 deadline。',
      en: 'The slow domain handles high-bit matching and future plans; a small amount of fast state provides the slot / phase-local enable, pulse formation and root-clock retiming. The command must meet the deadline of Eq. (17).',
      secs: ['r-8-4', 'r-8-1'], w: ['ps-executor'],
    },
    gate: {
      zh: '物理选沿 / 门控：把被选中的那一条真实 CK₀ 边沿送出。错沿、丢沿、重复沿、gate control 晚到或相邻脉冲合并都可能不改变数字计划，却使物理边沿偏移一拍。',
      en: 'Physical edge selection / gating: lets exactly the selected real CK₀ edge through. A wrong, dropped or duplicated edge, a late gate control or merged adjacent pulses can leave the digital plan unchanged while the physical edge is off by a cycle.',
      secs: ['r-8-4', 'r-8-3'], w: ['ps-executor'],
    },
    edge: {
      zh: '实际被选中的物理边沿——TDC 测量的对象，也是执行侧观察的对象。fine 测的是参考沿与这条真实边沿之间的局部残差。',
      en: 'The physical edge that was actually selected — what the TDC measures and what the execution-side observer sees. Fine measures the local residue between REF and this real edge.',
      secs: ['r-8-1'], w: ['ps-executor'],
    },
    obs: {
      zh: '执行回执：独立产生 J_observed，不能由 J_plan 延迟几拍改名得到。若测量链只信命令值，错沿会让重建相位看似正确而物理上差一拍（不变量 I4）。',
      en: 'Execution receipt: produces J_observed independently — it cannot be the delayed plan renamed. If the measurement chain trusts only the command value, a wrong edge leaves the reconstructed phase looking right while being one cycle off physically (invariant I4).',
      secs: ['r-8-2'], w: ['ps-executor'],
    },
    ref: {
      zh: '参考事件 REF：同时触发相干快照（coarse 链）与局部 fine 测量；它与被选真实边沿之间的有符号间隔就是 μ（以 T₀ 归一化）。',
      en: 'The reference event REF triggers both the coherent snapshot (coarse chain) and the local fine measurement; its signed interval to the selected real edge is μ (normalised by T₀).',
      secs: ['r-3-3'], w: ['phase-anchor'],
    },
    fine: {
      zh: '短 TDC：只测参考沿与被选真实物理边沿之间的局部残差，携带 SAT/VALID。量程小，饱和后不能再当作精确 fine；路径延迟、DTC 与校准版本必须一致。',
      en: 'Short TDC: measures only the local residue between REF and the selected real physical edge and carries SAT/VALID. Its range is small; once saturated it is no longer a precise fine value; path delays, DTC and calibration epochs must agree.',
      secs: ['r-9-1', 'r-9-2', 'r-9-3'], w: ['saturation-tdc', 'path-delay-dtc'],
    },
    integ: {
      zh: '相位整合：校验元组一致性，计算 F_usable（式 20），输出 FINE / COARSE / INVALID 三态之一及误差上界。FINE 仅当 coarse.valid ∧ observed.valid ∧ fine 可用；否则 coarse 有效则 COARSE，再否则 INVALID。',
      en: 'Phase integration: checks tuple consistency, evaluates F_usable (Eq. 20) and outputs one of FINE / COARSE / INVALID with an error bound. FINE only when coarse.valid ∧ observed.valid ∧ fine usable; otherwise COARSE if coarse is valid, else INVALID.',
      secs: ['r-10-3', 'r-9-3', 'r-10-1'], w: ['phase-integration'],
    },
  };
  const FAULTS = [
    { k: 'torn', zh: '撕裂快照', en: 'Torn snapshot', at: 'snap' },
    { k: 'late', zh: '选沿迟到', en: 'Late select', at: 'hit' },
    { k: 'drop', zh: '丢沿', en: 'Dropped edge', at: 'gate' },
    { k: 'sat', zh: 'TDC 饱和', en: 'TDC saturation', at: 'fine' },
    { k: 'cal', zh: '校准不匹配', en: 'Calibration mismatch', at: 'fine' },
  ];
  // token routes: consecutive blocks; t0..t1 in the event cycle; kind decides colour
  const TOKENS = [
    { id: 'cnt', route: ['clk', 'cnt', 'snap', 'coarse', 'integ'], t0: 0.0, t1: 0.58, color: 'var(--sig-clk)' },
    { id: 'ref1', route: ['ref', 'snap'], t0: 0.18, t1: 0.3, color: 'var(--sig-ref)' },
    { id: 'ref2', route: ['ref', 'fine'], t0: 0.18, t1: 0.3, color: 'var(--sig-ref)' },
    { id: 'plan', route: ['plan', 'hit', 'gate', 'edge'], t0: 0.0, t1: 0.46, color: 'var(--sig-plan)' },
    { id: 'edge1', route: ['edge', 'obs', 'integ'], t0: 0.46, t1: 0.82, color: 'var(--sig-sel)' },
    { id: 'edge2', route: ['edge', 'fine'], t0: 0.46, t1: 0.62, color: 'var(--sig-sel)' },
    { id: 'fine', route: ['fine', 'integ'], t0: 0.62, t1: 0.86, color: 'var(--sig-fine)' },
  ];

  function verdict(F) {
    const coarseValid = !F.torn;
    const observedValid = !F.late && !F.drop;
    const fineUsable = !F.sat && !F.cal;
    const out = coarseValid && observedValid && fineUsable ? 'FINE' : coarseValid ? 'COARSE' : 'INVALID';
    return { coarseValid, observedValid, fineUsable, out };
  }

  Book.registerWidget({
    id: 'arch-flow',
    group: 'system',
    title: { zh: '系统功能数据流（动画架构图）', en: 'System functional data flow (animated architecture)' },
    summary: {
      zh: '把 §8.1 的功能数据流画成可点击的动画框图：测量链（CK₀ → 计数 → 快照 → coarse）、执行链（J_plan → 高位命中/slot → 选沿 → 实际边沿 → J_observed）、REF 与局部 fine 测量，最终汇入相位整合。注入故障观察哪里出错，以及输出变为 FINE / COARSE / INVALID 中的哪一个。',
      en: 'The functional data flow of §8.1 as a clickable, animated block diagram: measurement chain (CK₀ → count → snapshot → coarse), execution chain (J_plan → high-bit hit / slot → edge select → actual edge → J_observed), REF with the local fine measurement, all feeding phase integration. Inject faults to see where things break and whether the output becomes FINE, COARSE or INVALID.',
    },
    sections: ['r-8-1', 'i-6'],
    eqs: [],
    keywords: ['architecture', 'data flow', 'FINE', 'COARSE', 'INVALID', 'J_observed', '架构', '数据流', '系统'],
    mount(root, api) {
      if (!document.getElementById('af-css')) { const s = document.createElement('style'); s.id = 'af-css'; s.textContent = CSS; document.head.appendChild(s); }
      const S = { sel: 'snap', faults: { torn: false, late: false, drop: false, sat: false, cal: false }, u: 0, narrow: false };
      const svgHost = W.h('div');
      const infoHost = W.h('div');
      const resHost = W.h('div', { class: 'af-res' });
      const loop = api.loop((dt) => { S.u = (S.u + dt / 7) % 1; tick(); });
      const play = W.playButton(loop, api);
      const togs = FAULTS.map((f) => W.toggle({ label: [f.zh, f.en], value: false, onChange: (v) => { S.faults[f.k] = v; build(); } }));
      const reset = W.button(['清除故障', 'Clear faults'], () => { FAULTS.forEach((f, i) => { S.faults[f.k] = false; togs[i].value = false; }); build(); });
      root.append(
        W.controls(play, W.h('span', { class: 'w-ctl' }, W.L('故障注入：', 'Fault injection:')), ...togs, reset),
        W.legend([
          { color: 'var(--sig-clk)', label: ['计数/CK₀ 令牌', 'count / CK₀ token'] },
          { color: 'var(--sig-plan)', label: ['计划 J_plan', 'plan J_plan'] },
          { color: 'var(--sig-sel)', label: ['被选真实边沿', 'selected real edge'] },
          { color: 'var(--sig-ref)', label: ['REF', 'REF'] },
          { color: 'var(--sig-fine)', label: ['fine 结果', 'fine result'] },
          { color: 'var(--sig-err)', label: ['故障 / 无效', 'fault / invalid'] },
        ]),
        svgHost, resHost, infoHost,
        W.note([
          '要点：这是报告 §8.1 / 工程介绍 §6 的架构综合，不是某篇原图的重绘；令牌动画只示意因果顺序，不含时序数值。持续计数、快照、执行、回执、fine 与整合必须各自独立可证：任一环节无法证明时，结果降级为 COARSE 或 INVALID，而不是被其它环节“自证”。点击任一方框查看职责并跳转到对应章节和交互模型。',
          'Key point: this is the architecture synthesis of report §8.1 / intro §6, not a redraw of any paper figure; the token animation shows causal order only, no timing numbers. Counting, snapshot, execution, receipt, fine and integration must each be provable on their own: when one cannot be proven the result degrades to COARSE or INVALID instead of being "self-certified" by another block. Click any block to see its responsibility and jump to the matching section and widget.',
        ]),
      );

      // ---------------------------------------------------------------- geometry
      let G = null; // {pos:{id:{x,y,w,h}}, VW, VH, edges:{'a>b':[pts]}}
      function layout() {
        const narrow = S.narrow;
        const g = { pos: {}, edges: {} };
        let bw, bh, ox, oy, sx, sy;
        if (!narrow) { bw = 128; bh = 58; ox = 16; oy = 42; sx = 150; sy = 112; g.VW = 760; g.VH = oy + 2 * sy + bh + 16; }
        else { bw = 108; bh = 62; ox = 8; oy = 36; sx = 126; sy = 90; g.VW = 360; g.VH = oy + 4 * sy + bh + 12; }
        for (const id of ORDER) {
          const [c, r] = POS[id];
          const u = narrow ? r : c, v = narrow ? c : r; // transpose on phones
          g.pos[id] = { x: ox + u * sx, y: oy + v * sy, w: bw, h: bh, cx: ox + u * sx + bw / 2, cy: oy + v * sy + bh / 2 };
        }
        const P = g.pos;
        // the integration block is taller: it also hosts the verdict badge (wide: grows upwards, narrow: downwards)
        { const q = P.integ; q.h += 30; if (!narrow) q.y -= 30; q.cy = q.y + q.h / 2; if (narrow) g.VH += 30; }
        const cc = (id) => [P[id].cx, P[id].cy];
        const straight = (a, b) => [cc(a), cc(b)];
        const elbow = (a, b, viaA) => { const A = cc(a), B = cc(b); return [A, viaA ? [B[0], A[1]] : [A[0], B[1]], B]; };
        const E = g.edges;
        E['clk>cnt'] = straight('clk', 'cnt'); E['cnt>snap'] = straight('cnt', 'snap'); E['snap>coarse'] = straight('snap', 'coarse');
        E['plan>hit'] = straight('plan', 'hit'); E['hit>gate'] = straight('hit', 'gate'); E['gate>edge'] = straight('gate', 'edge');
        E['ref>snap'] = straight('ref', 'snap'); E['ref>fine'] = straight('ref', 'fine');
        E['edge>fine'] = straight('edge', 'fine'); E['edge>obs'] = straight('edge', 'obs');
        E['fine>integ'] = straight('fine', 'integ');
        E['coarse>integ'] = elbow('coarse', 'integ', !narrow); // wide: right then down; narrow: down then right
        E['obs>integ'] = straight('obs', 'integ');
        return g;
      }
      const clipEnd = (pts, id) => { // shorten last segment to the target box boundary
        const b = G.pos[id]; const p = pts.slice();
        const a = p[p.length - 2], z = p[p.length - 1];
        const horiz = Math.abs(a[1] - z[1]) < 0.5;
        const d = horiz ? b.w / 2 : b.h / 2;
        const dir = horiz ? Math.sign(z[0] - a[0]) : Math.sign(z[1] - a[1]);
        p[p.length - 1] = horiz ? [z[0] - dir * d, z[1]] : [z[0], z[1] - dir * d];
        return p;
      };
      const polyLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
      const polyAt = (pts, f) => {
        const L = polyLen(pts); let d = f * L;
        for (let i = 1; i < pts.length; i++) {
          const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          if (d <= seg || i === pts.length - 1) { const k = seg ? Math.min(1, d / seg) : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]; }
          d -= seg;
        }
        return pts[pts.length - 1];
      };

      // ---------------------------------------------------------------- build (static part) + tick (tokens)
      let tokenLayer = null, badge = null, blocksG = {};
      function faultBlocks() {
        const m = {};
        for (const f of FAULTS) if (S.faults[f.k]) m[f.at] = (m[f.at] || []).concat(f);
        return m;
      }
      function build() {
        G = layout();
        const V = verdict(S.faults);
        const fb = faultBlocks();
        const svg = W.svg(G.VW, G.VH);
        const defs = W.s('defs');
        svg.appendChild(defs);
        // captions
        const cap = (zh, en, id, below) => { const p = G.pos[id]; svg.appendChild(W.sL(zh, en, { x: p.x, y: p.y - 9, style: 'font-size:10.5px;font-weight:700;fill:var(--fg-2)' })); };
        cap('测量链', 'Measurement chain', 'clk');
        cap('REF 与局部 fine', 'REF and local fine', S.narrow ? 'ref' : 'ref');
        cap('执行链', 'Execution chain', 'plan');
        // edges
        for (const key of Object.keys(G.edges)) {
          const [a, b] = key.split('>');
          const pts = clipEnd(G.edges[key], b);
          const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
          svg.appendChild(W.s('path', { d, fill: 'none', style: 'stroke:var(--axis);stroke-width:2' }));
          const e = pts[pts.length - 1], q = pts[pts.length - 2];
          const ang = Math.atan2(e[1] - q[1], e[0] - q[0]);
          const ah = (dx, dy) => `${(e[0] + dx * Math.cos(ang) - dy * Math.sin(ang)).toFixed(1)},${(e[1] + dx * Math.sin(ang) + dy * Math.cos(ang)).toFixed(1)}`;
          svg.appendChild(W.s('path', { d: `M${ah(0, 0)}L${ah(-8, -4.5)}L${ah(-8, 4.5)}Z`, style: 'fill:var(--fg-2)' }));
        }
        // blocks
        blocksG = {};
        for (const id of ORDER) {
          const p = G.pos[id];
          const isSel = S.sel === id;
          const faulty = !!fb[id];
          const stroke = faulty ? 'var(--sig-err)' : isSel ? 'var(--accent)' : 'var(--border-strong)';
          const g = W.s('g', { class: 'af-box', role: 'button', tabindex: 0, onClick: () => { S.sel = id; build(); renderInfo(); }, onKeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); S.sel = id; build(); renderInfo(); } } });
          g.appendChild(W.s('rect', { class: 'bg', x: p.x, y: p.y, width: p.w, height: p.h, rx: 10, style: `fill:${isSel ? 'var(--accent-wash)' : 'var(--surface-2)'};stroke:${stroke};stroke-width:${faulty || isSel ? 2.6 : 1.3}` }));
          const lines = T[id].l;
          const n = lines[0].length;
          const lh = 14, area = id === 'integ' ? p.h - 30 : p.h, y0 = p.y + area / 2 - ((n - 1) * lh) / 2 + 4;
          for (let i = 0; i < n; i++) {
            g.appendChild(W.sL(lines[0][i], lines[1][i], { x: p.cx, y: y0 + i * lh, 'text-anchor': 'middle', style: `font-size:${S.narrow ? 10.5 : 11.5}px;fill:var(--fg);font-weight:${i === 0 ? 650 : 500}` }));
          }
          if (faulty) {
            g.appendChild(W.s('circle', { cx: p.x + p.w - 4, cy: p.y + 4, r: 9, style: 'fill:var(--sig-err)' }));
            g.appendChild(W.s('text', { x: p.x + p.w - 4, y: p.y + 8, 'text-anchor': 'middle', style: 'fill:#fff;font-size:12px;font-weight:700' }, '!'));
          }
          if (id === 'integ') {
            badge = W.s('g');
            const by = p.y + p.h - 31;
            const col = V.out === 'FINE' ? 'var(--good)' : V.out === 'COARSE' ? 'var(--warning)' : 'var(--critical)';
            badge.appendChild(W.s('rect', { x: p.x + 8, y: by, width: p.w - 16, height: 24, rx: 12, style: `fill:${col};fill-opacity:.22;stroke:${col};stroke-width:2` }));
            badge.appendChild(W.s('text', { x: p.cx, y: by + 16.5, 'text-anchor': 'middle', style: 'fill:var(--fg);font-size:12.5px;font-weight:700' }, '→ ' + V.out));
            g.appendChild(badge);
          }
          svg.appendChild(g);
          blocksG[id] = g;
        }
        tokenLayer = W.s('g');
        svg.appendChild(tokenLayer);
        W.clear(svgHost).appendChild(svg);
        renderRes(V);
        tick();
      }

      function renderRes(V) {
        W.clear(resHost);
        const cls = V.out;
        const names = { FINE: ['FINE（精细）', 'FINE'], COARSE: ['COARSE（粗）', 'COARSE'], INVALID: ['INVALID（无效）', 'INVALID'] };
        resHost.append(W.L('输出：', 'Output: '), W.h('span', { class: 'af-verdict ' + cls }, W.lbl(names[cls])),
          W.h('span', null, W.L(
            `coarse.valid = ${V.coarseValid ? '✓' : '✗'}，observed.valid = ${V.observedValid ? '✓' : '✗'}，fine 可用 = ${V.fineUsable ? '✓' : '✗'}`,
            `coarse.valid = ${V.coarseValid ? '✓' : '✗'}, observed.valid = ${V.observedValid ? '✓' : '✗'}, fine usable = ${V.fineUsable ? '✓' : '✗'}`)));
      }

      function tick() {
        if (!tokenLayer || !G) return;
        W.clear(tokenLayer);
        const F = S.faults;
        const bad = 'var(--sig-err)';
        for (const tk of TOKENS) {
          // faults: which tokens exist / turn red after which block
          let redFrom = null, stopAt = null;
          if (tk.id === 'cnt' && F.torn) redFrom = 'snap';
          if (tk.id === 'plan') { if (F.late) redFrom = 'hit'; if (F.drop) stopAt = 'gate'; }
          if ((tk.id === 'edge1' || tk.id === 'edge2') && F.drop) continue;
          if ((tk.id === 'edge1') && F.late) redFrom = 'obs';
          if (tk.id === 'ref2' && F.sat) redFrom = 'fine';
          if (tk.id === 'fine') { if (F.sat) redFrom = 'fine'; if (F.cal) redFrom = 'fine'; }
          const u = S.u;
          if (u < tk.t0) continue;
          const f = Math.min(1, (u - tk.t0) / (tk.t1 - tk.t0));
          // build multi-block polyline
          const segs = [];
          for (let i = 0; i < tk.route.length - 1; i++) {
            const key = tk.route[i] + '>' + tk.route[i + 1];
            segs.push({ key, pts: clipEnd(G.edges[key], tk.route[i + 1]), from: tk.route[i], to: tk.route[i + 1] });
          }
          const lens = segs.map((s) => polyLen(s.pts)); const total = lens.reduce((a, b) => a + b, 0);
          let d = f * total, k = 0;
          while (k < segs.length - 1 && d > lens[k]) { d -= lens[k]; k++; }
          // stop at a block (dropped edge)
          let stopped = false;
          if (stopAt) { const si = segs.findIndex((s) => s.to === stopAt); if (si >= 0 && (k > si || (k === si && d >= lens[si]))) { k = si; d = lens[si]; stopped = true; } }
          const pt = polyAt(segs[k].pts, lens[k] ? d / lens[k] : 1);
          const ri = redFrom ? tk.route.indexOf(redFrom) : -1;
          const passedBad = ri >= 0 && (ri <= k || (ri === k + 1 && d >= lens[k] - 0.01));
          const col = passedBad || stopped ? bad : tk.color;
          tokenLayer.appendChild(W.s('circle', { cx: pt[0].toFixed(1), cy: pt[1].toFixed(1), r: 6.5, style: `fill:${col};stroke:var(--surface);stroke-width:1.8` }));
          if (stopped) {
            tokenLayer.appendChild(W.s('path', { d: `M${pt[0] - 4},${pt[1] - 4}L${pt[0] + 4},${pt[1] + 4}M${pt[0] + 4},${pt[1] - 4}L${pt[0] - 4},${pt[1] + 4}`, style: 'stroke:#fff;stroke-width:1.8' }));
          }
        }
      }

      function renderInfo() {
        const id = S.sel, I = INFO[id];
        W.clear(infoHost);
        const secLabel = (s) => (s.startsWith('i-') ? api.t('工程介绍 §', 'Intro §') + s.slice(2).replace(/-/g, '.') : api.t('报告 §', 'Report §') + s.slice(2).replace(/-/g, '.'));
        const box = W.h('div', { class: 'af-info' },
          W.h('h4', null, W.lbl(T[id].l[0].length > 1 ? [T[id].l[0].join(' '), T[id].l[1].join(' ')] : [T[id].l[0][0], T[id].l[1][0]])),
          W.h('div', null, W.L(I.zh, I.en)),
          W.h('div', { class: 'lk' },
            W.h('b', null, W.L('章节：', 'Sections:')), ...I.secs.map((s) => W.h('a', { href: '#' + s }, secLabel(s))),
            I.w && I.w.length ? W.h('b', null, W.L('交互模型：', 'Widgets:')) : null,
            ...I.w.map((w) => W.h('a', { href: '#w-' + w }, '▶ ' + w))));
        infoHost.appendChild(box);
      }

      function pickLayout() {
        const w = root.clientWidth || 700;
        const narrow = w < 520;
        if (narrow !== S.narrow || !G) { S.narrow = narrow; build(); }
      }
      S.narrow = (root.clientWidth || 700) < 520;
      build(); renderInfo();
      let ro = null;
      if ('ResizeObserver' in window) { ro = new ResizeObserver(() => pickLayout()); ro.observe(root); }
      const off = api.onLang(() => renderInfo());
      S.u = 0.9; tick();
      if (!api.reducedMotion) { S.u = 0; loop.start(); play.sync(); }
      return { destroy() { loop.stop(); ro && ro.disconnect(); off && off(); } };
    },
  });
})();
