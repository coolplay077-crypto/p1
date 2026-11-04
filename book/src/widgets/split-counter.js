/* Reference widget: split counter N = M·C + q and the legal carry (C, M−1) → (C+1, 0).
 * Eq. (1)–(2), report §3.2; also illustrates the CKVD8 polarity trap (binary q[MSB] rises at 3→4
 * and falls at 7→0 for M = 8).
 */
(function () {
  'use strict';
  Book.registerWidget({
    id: 'split-counter',
    group: 'counter',
    title: { zh: '分组计数 N = MC + q 与合法进位', en: 'Split counting N = MC + q and the legal carry' },
    summary: {
      zh: '原始时钟 CK0 每个上升沿使 N 加 1；低位 q 以 CK0 速率循环 0…M−1，高位 C 只在 q 由 M−1 回到 0 时加 1。观察二进制 q 最高位的上升/下降沿分别对应哪一次跳变（CKVD8 极性陷阱）。',
      en: 'Every rising edge of the raw clock CK0 increments N; the low residue q cycles 0…M−1 at CK0 rate while the high count C only increments when q wraps M−1 → 0. Watch which transition the rising/falling edge of the binary MSB of q corresponds to (the CKVD8 polarity trap).',
    },
    sections: ['r-3-2'],
    eqs: ['1', '2'],
    keywords: ['CKVD8', 'carry', 'residue', 'split counter', '分组计数', '进位'],
    mount(root, api) {
      const state = { M: 8, speed: 2.2, t: 77.4, showBits: true, N0: 0 };
      const VW = 760, PADL = 92, PADR = 16;

      const svgHost = W.h('div');
      const read = W.readout([
        { key: 'N', label: ['原周期编号 N', 'Raw-cycle index N'] },
        { key: 'C', label: ['高位 C（组）', 'High count C (groups)'] },
        { key: 'q', label: ['低位 residue q', 'Low residue q'] },
        { key: 'chk', label: ['M·C + q', 'M·C + q'] },
      ]);
      const loop = api.loop((dt) => { state.t += dt * state.speed; draw(); });
      const play = W.playButton(loop, api);
      const ctlM = W.seg({ label: ['分组倍率 M', 'Group ratio M'], options: [{ value: 4, label: 'M = 4' }, { value: 8, label: 'M = 8' }], value: state.M, onChange: (v) => { state.M = +v; draw(); } });
      const ctlSpeed = W.slider({ label: ['速度', 'Speed'], min: 0.5, max: 8, step: 0.1, value: state.speed, fmt: (v) => `${W.fmt(v, 1)} T₀/s`, onInput: (v) => { state.speed = v; } });
      const ctlBits = W.toggle({ label: ['显示 q 的二进制位', 'Show binary bits of q'], value: state.showBits, onChange: (v) => { state.showBits = v; draw(); } });
      const stepBtn = W.button(['单步 +1 T₀', 'Step +1 T₀'], () => { state.t = Math.floor(state.t) + 1.02; draw(); });
      const toCarry = W.button(['跳到下一次进位', 'Jump to next carry'], () => {
        const N = Math.floor(state.t);
        const next = (Math.floor(N / state.M) + 1) * state.M; // first index with q = 0
        state.t = next - 1.6; draw();
      });
      root.append(
        W.controls(play, stepBtn, toCarry, ctlM, ctlSpeed, ctlBits),
        svgHost,
        read.el,
        W.note(['要点：式 (1) 只是对“已对齐、逻辑一致”状态的定义；把 q 的最高位当作 /8 时钟时，其上升沿对应 3→4，下降沿才对应 7→0 的进位。必须核对高位触发极性、复位原点与流水延迟，不能只看信号名 CKVD8。',
          'Key point: Eq. (1) only defines aligned, logically coherent states. If the MSB of q is used as the /8 clock, its rising edge marks 3→4 and only its falling edge marks the 7→0 carry. Verify the high-bit trigger polarity, reset origin and pipeline delay — never infer them from the signal name CKVD8.']),
      );

      function draw() {
        const M = state.M;
        const bits = Math.log2(M);
        const span = 2.6 * M + 4;
        const tNow = state.t;
        const t0 = tNow - span * 0.72, t1 = tNow + span * 0.28;
        const rows = [];
        let y = 26;
        rows.push({ key: 'clk', y, h: 22 }); y += 40;
        rows.push({ key: 'q', y, h: 22 }); y += 36;
        if (state.showBits) for (let b = bits - 1; b >= 0; b--) { rows.push({ key: 'bit', b, y, h: 18 }); y += 30; }
        rows.push({ key: 'carry', y, h: 18 }); y += 34;
        rows.push({ key: 'C', y, h: 22 }); y += 36;
        rows.push({ key: 'N', y, h: 22 }); y += 30;
        const VH = y + 6;
        const x = W.scale([t0, t1], [PADL, VW - PADR]);
        const svg = W.svg(VW, VH);
        // grid at every CK0 rising edge
        for (let k = Math.ceil(t0); k <= t1; k++) {
          const isWrap = W.mod(k, M) === 0;
          svg.appendChild(W.s('line', { x1: x(k), x2: x(k), y1: 8, y2: VH - 6, class: 'grid', style: isWrap ? 'stroke:var(--axis);stroke-width:1.5' : '' }));
        }
        const Nat = (t) => Math.floor(t); // N increments on each rising edge at integer t
        for (const r of rows) {
          const top = r.y - r.h / 2, bot = r.y + r.h / 2;
          let label;
          if (r.key === 'clk') {
            label = W.s('text', { x: 8, y: r.y + 4, class: 'lbl' }, 'CK₀');
            const edges = W.clockEdges(1, 0, t0, t1);
            svg.appendChild(W.s('path', { d: W.digitalPath(edges, 0, x, top, bot, t0, t1), fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
          } else if (r.key === 'q' || r.key === 'C' || r.key === 'N') {
            label = r.key === 'q' ? W.sL('低位 q', 'low q', { x: 8, y: r.y + 4, class: 'lbl' })
              : r.key === 'C' ? W.sL('高位 C', 'high C', { x: 8, y: r.y + 4, class: 'lbl' })
                : W.s('text', { x: 8, y: r.y + 4, class: 'lbl' }, 'N = MC+q');
            const segs = [];
            for (let k = Math.floor(t0); k <= t1; k++) {
              const N = k;
              const val = r.key === 'q' ? W.mod(N, M) : r.key === 'C' ? Math.floor(N / M) : N;
              // C only changes on wrap; merge equal neighbours
              const last = segs[segs.length - 1];
              if (last && last.label === val) last.t1 = Math.min(t1, k + 1);
              else segs.push({ t0: Math.max(t0, k), t1: Math.min(t1, k + 1), label: val });
            }
            const color = r.key === 'q' ? 'var(--sig-low)' : r.key === 'C' ? 'var(--sig-high)' : 'var(--fg-2)';
            svg.appendChild(W.busGroup(segs.map((sg) => ({ ...sg, fill: color, stroke: color })), x, r.y, r.h));
          } else if (r.key === 'bit') {
            label = W.s('text', { x: 8, y: r.y + 4, class: 'lbl mono' }, `q[${r.b}]`);
            const edges = [];
            for (let k = Math.floor(t0) - 1; k <= t1 + 1; k++) edges.push({ t: k, v: (W.mod(k, M) >> r.b) & 1 });
            const v0 = (W.mod(Math.floor(t0) - 1, M) >> r.b) & 1;
            svg.appendChild(W.s('path', { d: W.digitalPath(edges, v0, x, top, bot, t0, t1), fill: 'none', stroke: 'var(--sig-low)', 'stroke-width': 1.6, 'stroke-dasharray': r.b === bits - 1 ? '' : '0' }));
            if (r.b === bits - 1) {
              // annotate MSB edges: rising = (M/2-1)->(M/2), falling = (M-1)->0 = carry
              for (let k = Math.ceil(t0); k <= t1; k++) {
                const q = W.mod(k, M);
                if (q === M / 2) svg.appendChild(W.s('text', { x: x(k) + 3, y: top - 3, style: 'font-size:10px;fill:var(--fg-2)' }, `↑ ${M / 2 - 1}→${M / 2}`));
                if (q === 0) svg.appendChild(W.s('text', { x: x(k) + 3, y: top - 3, style: 'font-size:10px;fill:var(--sig-high);font-weight:700' }, `↓ ${M - 1}→0`));
              }
            }
          } else if (r.key === 'carry') {
            label = W.sL('进位', 'carry', { x: 8, y: r.y + 4, class: 'lbl' });
            const edges = [];
            for (let k = Math.floor(t0) - 1; k <= t1 + 1; k++) if (W.mod(k, M) === 0) edges.push({ t: k, v: 1 }, { t: k + 0.5, v: 0 });
            svg.appendChild(W.s('path', { d: W.digitalPath(edges.sort((a, b) => a.t - b.t), 0, x, top, bot, t0, t1), fill: 'none', stroke: 'var(--sig-high)', 'stroke-width': 1.6 }));
            for (let k = Math.ceil(t0); k <= t1; k++) if (W.mod(k, M) === 0) {
              svg.appendChild(W.s('text', { x: x(k) + 4, y: bot + 12, style: 'font-size:10px;fill:var(--fg-2)' }, `(${Math.floor(k / M) - 1}, ${M - 1})→(${Math.floor(k / M)}, 0)`));
            }
          }
          svg.appendChild(label);
        }
        // "now" cursor
        svg.appendChild(W.s('line', { x1: x(tNow), x2: x(tNow), y1: 6, y2: VH - 4, stroke: 'var(--sig-ref)', 'stroke-width': 1.5 }));
        svg.appendChild(W.sL('当前', 'now', { x: x(tNow) + 3, y: 12, style: 'font-size:10px;fill:var(--fg-2)' }));
        W.clear(svgHost).appendChild(svg);
        const N = Nat(tNow);
        const C = Math.floor(N / M), q = W.mod(N, M);
        read.set('N', N); read.set('C', C); read.set('q', q); read.set('chk', `${M}·${C} + ${q} = ${M * C + q} ✓`);
      }
      draw();
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      return { destroy() { loop.stop(); } };
    },
  });
})();
