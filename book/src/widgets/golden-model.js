/* golden-model — event-level golden model following report §12.2 (interface §10.1, invariants §10.2,
 * integration §10.3). Idealized behavioural model, NOT a validated design or chip result.
 *
 * Mechanism (all derived from a raw CK0 edge-time sequence; no ideal phase is ever fed to the decoder):
 *   CK0 edges t_J (T0 = 1, frequency offset / truncated-Gaussian jitter / slow FM) → persistent W-bit CNT
 *   N = M·C + q (low group delay d_q, high group delay d_C; setup/hold windows; metastable samples resolve
 *   randomly to old/new) → REF events every FCW raw cycles → snapshot route A/B/C → coarse anchor;
 *   predictive (or reactive) planner → J_plan → slot executor with deadline (Eq. 17) → physical edge(s) →
 *   independent receipt J_observed (count shadow latched by the executed pulse) → short TDC (LSB, finite range,
 *   sat_hi/sat_lo) → μ̂ by Eq. (19) with calibration epochs → Eq. (20) F_usable → §10.3 FINE/COARSE/INVALID.
 *   Ground truth Φ0(t_R) is interpolated from the edge timeline and is only used for scoring.
 *
 * The engine (createSim) is DOM-free and exposed as def._createSim so book-independent scripts can re-check it.
 */
(function () {
  'use strict';
  const WRAP = (x, m) => x - m * Math.floor(x / m); // [0, m)
  const WS = (x, m) => WRAP(x + m / 2, m) - m / 2; // [-m/2, m/2)
  const FAULTS = ['late', 'drop', 'dup', 'torn', 'sat', 'cal', 'rst'];
  const PROTS = ['receipt', 'block', 'sat', 'cal', 'atomic', 'stitch'];

  const DEFAULTS = {
    seed: 1, M: 8, Wbits: 12, fcw: 13.37, eps: 0.6, jit: 0, fmA: 0, fmP: 1500, rstPhase: 0.37, N0: 4000,
    dq: 0.15, dC: 0.35, pvt: 0, route: 'A', tsu: 0.03, th: 0.02, wmeta: 0.02, dcap: 0.05, mB: 0.08,
    planner: 'pred', off: 0.4, Lproc: 4, dcmd: 1, tsetx: 0.1, tguard: 0.2, latePolicy: 'flag',
    lsbDen: 32, rlo: -0.25, rhi: 2.25, dpath: 0.07, gdrift: 0.08, calK: 50,
    pf: { late: 0, drop: 0, dup: 0, torn: 0, sat: 0, cal: 0, rst: 0 },
    prot: { receipt: true, block: true, sat: true, cal: true, atomic: true, stitch: true },
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function newStats(P) {
    const cLo = Math.round(P.rlo * P.lsbDen), cHi = Math.round(P.rhi * P.lsbDen);
    const pf = {};
    for (const f of FAULTS.concat(['tear', 'none'])) pf[f] = { n: 0, corrected: 0, detected: 0, silent: 0, FINE: 0, COARSE: 0, INVALID: 0 };
    return {
      n: 0, src: { FINE: 0, COARSE: 0, INVALID: 0 }, silentFine: 0, silentCoarse: 0, maxFine: 0, maxFineLsb: 0, sumSqFine: 0,
      maxCoarse: 0, sat: 0, mismatch: 0, late: 0, replan: 0, miss: 0, dup: 0, invRun: 0, maxInvRun: 0, natTear: 0,
      why: {}, pf, cLo, cHi, hCode: new Float64Array(cHi - cLo + 1), hErrF: new Float64Array(62), hErrC: new Float64Array(62),
    };
  }

  function createSim(Pin) {
    const P = Object.assign(clone(DEFAULTS), clone(Pin || {}));
    P.pf = Object.assign(clone(DEFAULTS.pf), (Pin && Pin.pf) || {});
    P.prot = Object.assign(clone(DEFAULTS.prot), (Pin && Pin.prot) || {});
    const MOD = 2 ** P.Wbits, Mg = P.M, MODC = MOD / Mg, LSB = 1 / P.lsbDen;
    const eps = P.eps * 1e-3, sig = P.jit * 1e-2, A = P.fmA * 1e-3;
    const delta = 5 * sig + 2.1 * A + 1e-12; // relative period-uncertainty budget used in the Eq. (6) bound
    const rngJ = W.rng(P.seed * 9973 + 11), rngF = W.rng(P.seed * 7919 + 23), rngM = W.rng(P.seed * 6151 + 37);
    const dqA = P.dq * (1 + P.pvt), dCA = P.dC * (1 + P.pvt);
    // ---------------------------------------------------------------- raw CK0 edge timeline (ring buffer)
    const CAP = 1 << 15, MASK = CAP - 1, tE = new Float64Array(CAP);
    let Jmax = 0; tE[0] = P.rstPhase;
    function gauss() { let g; do { g = rngJ.normal(); } while (Math.abs(g) > 4); return g; } // truncated at ±4σ
    function ensure(t) {
      while (tE[Jmax & MASK] < t) {
        const t0 = tE[Jmax & MASK];
        const f = (1 + eps) * (1 + A * Math.sin(2 * Math.PI * t0 / P.fmP));
        tE[(Jmax + 1) & MASK] = t0 + (1 / f) * (1 + (sig ? sig * gauss() : 0));
        Jmax++;
      }
    }
    const te = (J) => tE[J & MASK];
    function Jat(t) { // largest J with t_J <= t
      let lo = Math.max(0, Jmax - 8192), hi = Jmax;
      if (te(lo) > t) return lo - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (te(mid) <= t) lo = mid; else hi = mid - 1; }
      return lo;
    }
    const phi = (t) => { const J = Jat(t); return J + (t - te(J)) / (te(J + 1) - te(J)); }; // ground truth Φ0
    const clk = (J, frac) => te(J) + frac * (te(J + 1) - te(J));
    // ---------------------------------------------------------------- persistent counter N = M·C + q
    let origin = -P.N0, resetEpoch = 0;
    const cnt = (J) => WRAP(J - origin, MOD);
    function sample(s, d, isC) { // a group sampled at time s; returns the edge epoch it reflects
      let J = Jat(s - d), meta = false;
      const chg = (j) => !isC || WRAP(j - origin, Mg) === 0; // only value-changing transitions matter
      if (te(J) + d > s - P.tsu && chg(J)) { meta = true; if (rngM() < 0.5) J -= 1; }
      else if (te(J + 1) + d < s + P.th && chg(J + 1)) { meta = true; if (rngM() < 0.5) J += 1; }
      return { J, meta };
    }
    function capture(sq, sc) {
      const a = sample(sq, dqA, false), b = sample(sc, dCA, true);
      const nq = cnt(a.J), nc = cnt(b.J);
      return { q: nq % Mg, C: Math.floor(nc / Mg), w2: Math.floor(nq / Mg) % 4, Jq: a.J, JC: b.J, meta: a.meta || b.meta,
        tear: Math.floor(nq / Mg) !== Math.floor(nc / Mg), sq, sc };
    }
    function retime(t, frac) { // REF sampled by CK0 at phase `frac`: first clock edge at/after t (metastable near edges)
      let J = Jat(t), e = clk(J, frac);
      if (e < t) { J++; e = clk(J, frac); }
      let meta = false;
      if (t - clk(J - 1, frac) < P.wmeta) { meta = true; if (rngM() < 0.5) J--; }
      else if (e - t < P.wmeta) { meta = true; if (rngM() < 0.5) J++; }
      return { J, t: clk(J, frac), meta };
    }
    // ---------------------------------------------------------------- calibration epochs (idealized engine)
    const calCache = new Map();
    function calTab(e, tR) {
      if (e < 0) return { e, lsb: LSB, T0: 1 }; // factory default
      if (!calCache.has(e)) {
        const r = W.rng(P.seed * 31 + e * 977 + 5);
        const Jr = Jat(tR);
        calCache.set(e, { e, lsb: LSB * (1 + P.gdrift * (2 * r() - 1)), T0: (te(Jr) - te(Jr - 256)) / 256 });
        if (calCache.size > 8) calCache.delete(calCache.keys().next().value);
      }
      return calCache.get(e);
    }
    // ---------------------------------------------------------------- snapshot routes (§7.1–7.3)
    function snapshot(tR, injTorn, aux) {
      const co = { route: P.route, valid: true, kC: 0, kN: 0, amb: false, caps: [], cand: '-', tear: false, metaRef: false };
      const tornify = (cap) => { if (injTorn) cap.C = WRAP(cap.C + (aux < 0.5 ? -1 : 1), MODC); };
      if (P.route === 'A') {
        // boundary side from REF vs CK0 quadrature phases: rising-retimed candidate is safe when REF is in [¼, ¾)
        const ph = phi(tR), fr = ph - Math.floor(ph);
        let side = fr >= 0.25 && fr < 0.75 ? 'R' : 'F', metaSel = false;
        if (Math.abs(fr - 0.25) < P.wmeta || Math.abs(fr - 0.75) < P.wmeta) { metaSel = true; if (rngM() < 0.5) side = side === 'R' ? 'F' : 'R'; }
        const rr = retime(tR, 0), rf = retime(tR, 0.5);
        const cR = capture(rr.t + P.dcap, rr.t + P.dcap), cF = capture(rf.t + P.dcap, rf.t + P.dcap);
        cR.id = 'R'; cR.off = 0.5; cR.meta = cR.meta || rr.meta; cF.id = 'F'; cF.off = 0; cF.meta = cF.meta || rf.meta;
        const sel = side === 'R' ? cR : cF, oth = side === 'R' ? cF : cR;
        tornify(sel);
        sel.sel = true; co.caps = [cR, cF]; co.cand = sel.id; co.side = side; co.metaSel = metaSel;
        co.C = sel.C; co.q = sel.q; co.tear = sel.tear; co.metaRef = sel.meta;
        const conv = P.prot.atomic ? sel : oth; // non-atomic: word from one candidate, anchor convention from the other
        co.convFrom = conv.id;
        co.est = WRAP(Mg * sel.C + sel.q + conv.off, MOD);
        co.bound = 0.25 + 1.1 * P.wmeta + 1e-6;
      } else if (P.route === 'B') {
        // matched-delay sampling: each group sampled after its own (nominal) settle time, Eq. (13)–(15)
        const rr = retime(tR, 0);
        const sq = rr.t + P.dq + P.tsu + P.mB, sc = rr.t + P.dC + P.tsu + P.mB;
        const cap = capture(sq, sc); cap.id = 'B'; cap.sel = true; tornify(cap);
        co.caps = [cap]; co.cand = 'B'; co.C = cap.C; co.q = cap.q; co.tear = cap.tear; co.metaRef = rr.meta;
        co.est = WRAP(Mg * cap.C + cap.q - 0.5, MOD);
        co.bound = 0.5 + 1.1 * P.wmeta + 1e-6;
      } else {
        // route C: one unmatched capture + redundant 2-bit wrap sequence (fast domain) → explicit κ_C, κ_N (Eq. 10)
        const rr = retime(tR, 0);
        const cap = capture(rr.t + P.dcap, rr.t + P.dcap); cap.id = 'C'; cap.sel = true; tornify(cap);
        co.caps = [cap]; co.cand = 'C'; co.C = cap.C; co.q = cap.q; co.w2 = cap.w2; co.tear = cap.tear; co.metaRef = rr.meta;
        const d = WRAP(cap.w2 - cap.C, 4);
        if (P.prot.block) { co.kC = d === 1 ? 1 : d === 3 ? -1 : 0; co.amb = d === 2; }
        else { co.kN = d === 1 ? 1 : d === 3 ? -1 : 0; } // wrong unit: ±1 raw cycle only
        co.dSeq = d;
        co.valid = !co.amb;
        co.est = WRAP(Mg * (cap.C + co.kC) + cap.q + co.kN + 0.5, MOD);
        co.bound = 0.5 + 1.1 * P.wmeta + 1e-6;
      }
      return co;
    }

    // ---------------------------------------------------------------- run state
    const tR0 = 320.123;
    let K = 0, pending = null, last = null, integEpoch = 0;
    const S = newStats(P);
    const ring = []; const RING = 300;

    function step() {
      const k = K++;
      const u = FAULTS.map(() => rngF()), aux = [rngF(), rngF(), rngF(), rngF()];
      const inj = {}; FAULTS.forEach((f, i) => { inj[f] = u[i] < (P.pf[f] || 0); });
      let tR = tR0 + k * P.fcw;
      if (inj.sat) tR += (aux[0] < 0.5 ? -1 : 1) * (1.5 + 1.5 * aux[1]); // REF phase transient → large residual
      ensure(tR + 2 * P.fcw + 64);
      if (inj.rst && k === 0) inj.rst = false;
      if (inj.rst) { origin = Jat(tR - 0.5 * P.fcw); resetEpoch++; } // counter re-reset: reads 0 at that edge
      const truth = WRAP(phi(tR) - origin, MOD);
      const eHw = Math.floor(k / P.calK), eN = inj.cal ? eHw - 1 : eHw;
      const calHw = calTab(eHw, tR), calN = calTab(eN, tR);
      // ---- snapshot → coarse
      const co = snapshot(tR, inj.torn, aux[2]);
      // ---- planner / executor
      let cmd = null;
      if (P.planner === 'pred') cmd = pending;
      else if (co.valid) cmd = { Jplan: WRAP(Math.ceil(co.est + co.bound + P.Lproc + P.dcmd + P.tsetx + P.tguard + P.off), MOD), tIssue: tR + P.Lproc };
      if (!cmd) { inj.late = false; inj.drop = false; inj.dup = false; }
      const ex = { Jplan: null, Jobs: null, late: false, miss: false, dup: false, replan: false, pulses: 0, tArrive: null, tIssue: null, slack: null, tTarget: null, Jfirst: null, tFirst: null, Jt: null };
      if (!cmd) ex.miss = true;
      else {
        ex.Jplan = cmd.Jplan; ex.tIssue = cmd.tIssue;
        ex.tArrive = cmd.tIssue + P.dcmd + (inj.late ? (0.6 + 0.6 * aux[3]) * P.fcw : 0);
        const Jref = Jat(tR), d = WS(cmd.Jplan - cnt(Jref), MOD);
        let Jt = Jref + d;
        if (Math.abs(d) > P.fcw) { ex.miss = true; inj.drop = false; inj.dup = false; }
        else {
          const need = () => ex.tArrive + P.tsetx + P.tguard;
          let slack = te(Jt) - need();
          if (slack < 0) {
            if (P.latePolicy === 'replan') { let n = 0; while (te(Jt) < need()) { Jt += Mg; n++; } ex.Jplan = WRAP(ex.Jplan + n * Mg, MOD); ex.replan = true; slack = te(Jt) - need(); }
            else ex.late = true;
          }
          ex.slack = slack; ex.Jt = Jt; ex.tTarget = te(Jt);
          let Jf = Jt; while (te(Jf) < ex.tArrive + P.tsetx) Jf += Mg; // slot executor: next occurrence of the slot
          let Jfirst = Jf, pulses = 1;
          if (inj.drop) Jfirst = Jf + 1; // selected pulse swallowed; gate passes the next raw edge
          if (inj.dup) { Jfirst = Jf - 1; pulses = 2; } // gate opened one raw edge early: two pulses
          if (te(Jfirst) - tR > 0.9 * P.fcw) ex.miss = true;
          ex.Jfire = Jf; ex.Jfirst = Jfirst; ex.tFirst = te(Jfirst); ex.pulses = ex.miss ? 0 : pulses; ex.dup = !ex.miss && pulses > 1;
          ex.Jobs = ex.miss ? null : cnt(Jfirst); // independent receipt: count shadow latched by the executed pulse
        }
      }
      // ---- observed edge identity (I4)
      const anchor = P.prot.receipt ? ex.Jobs : ex.Jplan;
      const obsValid = P.prot.receipt ? (!ex.miss && !ex.late && ex.pulses === 1) : (cmd != null && !ex.late && ex.Jt != null);
      // ---- short TDC: quantize + saturate (Eq. 18–19)
      const cLo = S.cLo, cHi = S.cHi;
      let code = cHi, satHi = true, satLo = false, raw = null;
      const fineValid = !ex.miss && ex.tFirst != null;
      if (fineValid) {
        const dpin = ex.tFirst + P.dpath - tR;
        raw = Math.round(dpin / calHw.lsb);
        code = Math.min(cHi, Math.max(cLo, raw)); satHi = raw >= cHi; satLo = raw <= cLo;
      }
      const mu = (code * calN.lsb - P.dpath) / calN.T0;
      const fb = calN.lsb / (2 * calN.T0) + delta * (Math.abs(mu) + calN.lsb / calN.T0) + 1e-9;
      // ---- Eq. (20) and §10.3 integration
      const V = { code: fineValid, range: P.prot.sat ? !(satHi || satLo) : true, anchor: null, epoch: resetEpoch === integEpoch, cal: P.prot.cal ? eN === eHw : true };
      let src, phase = null, bound = null, why = '';
      if (!V.epoch) { src = 'INVALID'; why = 'epoch'; integEpoch = resetEpoch; }
      else if (co.valid && obsValid && V.code && V.range && V.cal) {
        const ph = WRAP(anchor + 0 - mu, MOD); // α_sel = 0: rising edges only in this model
        V.anchor = P.prot.stitch ? Math.abs(WS(ph - co.est, MOD)) <= co.bound + fb + 1e-9 : true;
        if (V.anchor) { src = 'FINE'; phase = ph; bound = fb; } else { src = 'INVALID'; why = 'stitch'; }
      } else if (co.valid) {
        src = 'COARSE'; phase = co.est; bound = co.bound;
        why = !V.code ? (ex.miss ? (cmd ? 'miss' : 'nocmd') : 'code') : !obsValid ? (ex.late ? 'late' : ex.dup ? 'dup' : 'obs') : !V.range ? 'sat' : !V.cal ? 'cal' : '?';
      } else { src = 'INVALID'; why = 'coarse'; }
      // ---- planner update (predictive: command for the next REF is issued Lproc after this REF)
      if (src !== 'INVALID') last = { ph: phase, k };
      else if (why === 'epoch') last = co.valid ? { ph: co.est, k } : null; // re-acquire in the new reset epoch
      if (P.planner === 'pred') {
        pending = last && k - last.k <= 8 ? { Jplan: WRAP(Math.ceil(last.ph + (k + 1 - last.k) * P.fcw + P.off), MOD), tIssue: tR + P.Lproc } : null;
      }
      // ---- scoring against ground truth (never used by the decoder)
      const err = phase == null ? null : WS(phase - truth, MOD);
      const ok = err == null ? null : Math.abs(err) <= bound + 1e-9;
      const faults = FAULTS.filter((f) => inj[f]);
      const natTear = co.tear && !inj.torn;
      const outcome = src === 'INVALID' ? 'detected' : !ok ? 'silent' : src === 'FINE' ? 'corrected' : 'detected';
      S.n++; S.src[src]++;
      if (src === 'INVALID') { S.invRun++; if (S.invRun > S.maxInvRun) S.maxInvRun = S.invRun; } else S.invRun = 0;
      const lsbPh = calN.lsb / calN.T0;
      if (src === 'FINE') {
        const a = Math.abs(err);
        if (a > S.maxFine) S.maxFine = a;
        if (a / lsbPh > S.maxFineLsb) S.maxFineLsb = a / lsbPh;
        S.sumSqFine += err * err;
        if (!ok) S.silentFine++;
        const x = err / lsbPh; S.hErrF[x < -3 ? 0 : x >= 3 ? 61 : 1 + Math.floor((x + 3) * 10)]++;
      } else if (src === 'COARSE') {
        const a = Math.abs(err); if (a > S.maxCoarse) S.maxCoarse = a;
        if (!ok) S.silentCoarse++;
        S.hErrC[err < -1.5 ? 0 : err >= 1.5 ? 61 : 1 + Math.floor((err + 1.5) * 20)]++;
      }
      if (fineValid) { S.hCode[code - cLo]++; if (satHi || satLo) S.sat++; }
      if (ex.Jobs != null && ex.Jplan != null && ex.Jobs !== ex.Jplan) S.mismatch++;
      if (ex.late) S.late++; if (ex.replan) S.replan++; if (ex.miss && cmd) S.miss++; if (ex.dup) S.dup++;
      if (natTear) S.natTear++;
      if (why) S.why[why] = (S.why[why] || 0) + 1;
      const cats = faults.slice(); if (natTear) cats.push('tear'); if (!cats.length) cats.push('none');
      for (const f of cats) { const r = S.pf[f]; r.n++; r[src]++; r[outcome]++; }
      // ---- EventFrame (§10.1) + data for the waveform view
      const tEnd = Math.min(tR + 10, Math.max(tR + 3.5, (ex.tFirst != null ? ex.tFirst : tR) + 1.6));
      const J0 = Jat(tR - 3) - 1, J1 = Jat(tEnd) + 2, edges = [];
      for (let j = J0; j <= J1; j++) edges.push(te(j));
      const fr = {
        k, reset_epoch: resetEpoch, M: Mg, route: P.route, C_cap: co.C, q_cap: co.q, candidate_id: co.cand, conv: co.convFrom || co.cand,
        side: co.side, kappa_C: co.kC, kappa_N: co.kN, w2: co.w2, dSeq: co.dSeq, amb: co.amb, J_plan: ex.Jplan, J_observed: ex.Jobs,
        fine_raw: fineValid ? code : null, raw, fine_valid: fineValid, sat_hi: fineValid && satHi, sat_lo: fineValid && satLo,
        late: ex.late, miss: ex.miss, duplicate: ex.dup, replan: ex.replan, slack: ex.slack, tdc_gain_epoch: eHw, norm_epoch: eN,
        lsb: calN.lsb, T0hat: calN.T0, mu, fb, V, obsValid, anchor, coValid: co.valid, coEst: co.est, coBound: co.bound, metaRef: co.metaRef,
        phase_source: src, phase, bound, truth, err, ok, why, faults, natTear, outcome,
        tR, origin, J0, edges, caps: co.caps.map((c) => ({ id: c.id, sq: c.sq, sc: c.sc, C: c.C, q: c.q, sel: !!c.sel, meta: c.meta, tear: c.tear })),
        tArrive: ex.tArrive, tIssue: ex.tIssue, tTarget: ex.tTarget, tFirst: ex.tFirst, Jfirst: ex.Jfirst, Jt: ex.Jt, pulses: ex.pulses,
      };
      ring.push(fr); if (ring.length > RING) ring.shift();
      return fr;
    }
    return { P, step, S, ring, MOD, LSB, delta, dqA, dCA, cLo: S.cLo, cHi: S.cHi, get k() { return K; } };
  }

  Book.registerWidget({
    id: 'golden-model',
    group: 'system',
    _createSim: createSim, _defaults: DEFAULTS,
    title: { zh: '事件级 golden model：从原始边沿到 FINE / COARSE / INVALID', en: 'Event-level golden model: from raw edges to FINE / COARSE / INVALID' },
    summary: {
      zh: '按第 12.2 节的验证方案：由原始 CK0 边沿时间驱动持久 CNT，分别模拟 snapshot（路线 A/B/C）、选沿执行与回执、有限量程 TDC 和校准世代，再按第 10.3 节整合；逐事件与插值得到的真实相位比较，并统计每类注入故障是被识别、被正确补偿还是静默出错。理想化行为模型，不是已验证设计或芯片结果。',
      en: 'Following the §12.2 plan: raw CK0 edge times drive a persistent CNT; snapshot (routes A/B/C), edge execution with receipt, a finite-range TDC and calibration epochs are simulated separately and integrated per §10.3. Every event is compared with the interpolated true phase, and each injected fault is scored as detected, correctly compensated, or silently wrong. Idealized behavioural model — not a validated design or chip result.',
    },
    sections: ['r-12-2'],
    eqs: ['1', '5', '10', '16', '17', '20'],
    keywords: ['golden model', 'EventFrame', 'J_plan', 'J_observed', 'phase_source', 'FINE', 'COARSE', 'INVALID', 'fault injection', 'SAT', 'snapshot', 'route A', 'route B', 'route C', '故障注入', '事件级', '静默错误', 'kappa_C', 'kappa_N'],
    mount(root, api) {
      const FL = {
        late: ['选择命令晚到', 'Late select command'],
        drop: ['丢沿（被选脉冲被吞）', 'Dropped edge (selected pulse swallowed)'],
        dup: ['重复沿（门控早开一沿）', 'Duplicated edge (gate opens one edge early)'],
        torn: ['撕裂捕获（高/低位不同 epoch）', 'Torn capture (high/low from different epochs)'],
        sat: ['REF 相位瞬态 → 大残差 / SAT', 'REF phase transient → large residual / SAT'],
        cal: ['校准世代错配', 'Calibration-epoch mismatch'],
        rst: ['复位世代改变', 'Reset-epoch change'],
        tear: ['自然撕裂（组延迟时序）', 'Natural tear (group-delay timing)'],
        none: ['无注入故障的事件', 'Events without injected fault'],
      };
      const PL = {
        receipt: ['使用独立回执 J_observed（关 = 信任 J_plan）', 'Use independent receipt J_observed (off = trust J_plan)'],
        block: ['按组单位修正 κ_C（关 = 只有 ±1 原周期修正）', 'Block-unit correction κ_C (off = ±1-raw-cycle-only corrector)'],
        sat: ['检查 SAT → V_range（关 = 忽略饱和）', 'Honour SAT → V_range (off = ignore saturation)'],
        cal: ['检查校准世代 V_cal（关 = 忽略世代）', 'Check calibration epoch V_cal (off = ignore epoch)'],
        atomic: ['候选元组原子选择（路线 A）', 'Atomic candidate-tuple selection (route A)'],
        stitch: ['coarse/fine 锚点交叉检查 V_anchor（I2/I6）', 'Coarse/fine anchor cross-check V_anchor (I2/I6)'],
      };
      const SRC_C = { FINE: 'var(--sig-fine)', COARSE: 'var(--sig-high)', INVALID: 'var(--fg-2)' };
      const st = { P: clone(DEFAULTS), runLen: 10000, speed: 'slow', tab: 'event', follow: true, selK: null, hist: 'fine' };
      let sim = null, runEnd = 0, prefillTimer = 0, rebuildTimer = 0, animU = 1, medAcc = 0, rate = 0, rateN = 0, rateT = 0;
      let drawPending = false, lastStatsDraw = 0, lastLogDraw = 0, shownKey = '';
      const ctl = {};
      const getP = (key) => key.split('.').reduce((o, k) => o[k], st.P);
      const setP = (key, v) => { const ks = key.split('.'); const o = ks.slice(0, -1).reduce((a, k) => a[k], st.P); o[ks[ks.length - 1]] = v; };
      const rebuildSoon = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 150); };
      const sl = (key, label, min, max, step, fmt, scale = 1) => (ctl[key] = Object.assign(W.slider({ label, min, max, step, value: getP(key) * scale, fmt, onInput: (v) => { setP(key, v / scale); rebuildSoon(); } }), { scale }));
      const sg = (key, label, options) => (ctl[key] = W.seg({ label, options, value: getP(key), onChange: (v) => { setP(key, v); rebuildSoon(); } }));
      const tg = (key, label) => (ctl[key] = W.toggle({ label, value: getP(key), onChange: (v) => { setP(key, v); rebuildSoon(); } }));
      const f2 = (v) => W.fmt(v, 2), f3 = (v) => W.fmt(v, 3);

      // ---------------------------------------------------------------- top controls + presets
      const loop = api.loop((dt) => tick(dt));
      const play = W.playButton(loop, api);
      play.addEventListener('click', () => { if (loop.running) { st.follow = true; runEnd = st.runLen === Infinity ? Infinity : sim.k + st.runLen; animU = 1; } requestDraw(); });
      const stepBtn = W.button(['单步 1 事件', 'Step 1 event'], () => { if (!sim) return; sim.step(); st.follow = true; animU = 1; requestDraw(); });
      const resetBtn = W.button(['重算', 'Re-run'], () => rebuild());
      const speedSeg = W.seg({ label: ['速度', 'Speed'], value: st.speed, options: [{ value: 'slow', label: ['逐事件动画', 'Animated'] }, { value: 'med', label: ['25 事件/s', '25 ev/s'] }, { value: 'fast', label: ['后台全速', 'Full speed'] }], onChange: (v) => { st.speed = v; animU = 1; } });
      const runSel = W.select({ label: ['每次运行', 'Run length'], value: '10000', options: [{ value: '2000', label: '+2 000' }, { value: '10000', label: '+10 000' }, { value: '100000', label: '+100 000' }, { value: 'inf', label: ['不停止', 'until paused'] }], onChange: (v) => { st.runLen = v === 'inf' ? Infinity : +v; } });
      const seedSl = sl('seed', ['随机种子', 'Seed'], 1, 50, 1, (v) => String(v));
      const STORM = { late: 0.03, drop: 0.03, dup: 0.03, torn: 0.03, sat: 0.03, cal: 0.03, rst: 0.01 };
      const OFF = { receipt: false, block: false, sat: false, cal: false, atomic: false, stitch: false };
      const PRESETS = [
        { id: 'nominal', label: ['标称：全保护、无故障', 'Nominal: all protections, no faults'], p: {} },
        { id: 'stormOn', label: ['故障风暴 + 全保护（路线 C）', 'Fault storm + all protections (route C)'], p: { route: 'C', pf: STORM } },
        { id: 'stormOff', label: ['故障风暴 + 关闭保护', 'Fault storm, protections OFF'], p: { route: 'C', pf: STORM, prot: OFF } },
        { id: 'slowA', label: ['高位慢：路线 A 撕裂', 'Slow high group: route A tears'], p: { route: 'A', dC: 0.8 } },
        { id: 'pvtB', label: ['路线 B 匹配失配（式 15）', 'Route B mismatch (Eq. 15)'], p: { route: 'B', dC: 0.8, pvt: 0.2 } },
        { id: 'cLimit', label: ['路线 C 覆盖边界 ΔC=±2', 'Route C coverage limit ΔC=±2'], p: { route: 'C', M: 4, dC: 6.5 } },
        { id: 'react', label: ['事后规划（§8.3 因果性）', 'Reactive planning (§8.3 causality)'], p: { planner: 'react' } },
        { id: 'fm', label: ['调频 + 抖动（式 6 上界）', 'FM + jitter (Eq. 6 bound)'], p: { jit: 0.3, fmA: 2 } },
      ];
      const presetBtns = PRESETS.map((pr) => W.button(pr.label, () => applyPreset(pr)));
      function applyPreset(pr) {
        const seed = st.P.seed;
        st.P = clone(DEFAULTS); st.P.seed = seed;
        for (const [k, v] of Object.entries(pr.p)) st.P[k] = typeof v === 'object' ? Object.assign(clone(DEFAULTS[k]), clone(v)) : v;
        syncControls(); rebuild();
        presetBtns.forEach((b, i) => b.classList.toggle('primary', PRESETS[i] === pr));
      }
      function syncControls() { for (const [k, c] of Object.entries(ctl)) c.value = c.scale ? getP(k) * c.scale : getP(k); }
      // ---------------------------------------------------------------- parameter panels
      const box = (zh, en, ...items) => W.h('div', { style: { border: '1px solid var(--border)', borderRadius: '10px', padding: '8px 10px', margin: '0 0 8px' } },
        W.h('div', { style: { fontSize: '.75rem', fontWeight: 650, color: 'var(--fg-2)', margin: '0 0 6px' } }, W.L(zh, en)), W.controls(...items));
      const T0 = (v) => f2(v) + ' T₀';
      const timingBox = W.h('div', { style: { overflowX: 'auto' } });
      const modelPanel = W.h('div', null,
        box('原始时钟 CK0 与持久计数器', 'Raw clock CK0 and persistent counter',
          sg('M', ['分组 M', 'Group M'], [{ value: 4, label: 'M = 4' }, { value: 8, label: 'M = 8' }]),
          sg('Wbits', ['计数宽度 W', 'Counter width W'], [10, 12, 16].map((v) => ({ value: v, label: v + ' bit' }))),
          sl('fcw', ['FCW（原周期/REF）', 'FCW (raw cycles per REF)'], 4, 40, 0.01, f2),
          sl('eps', ['频偏', 'Freq. offset'], -5, 5, 0.1, (v) => W.fmt(v, 1) + ' ‰'),
          sl('jit', ['周期抖动 σ', 'Period jitter σ'], 0, 1, 0.05, (v) => W.fmt(v, 2) + ' %'),
          sl('fmA', ['慢调频幅度', 'Slow-FM amplitude'], 0, 5, 0.1, (v) => W.fmt(v, 1) + ' ‰'),
          sl('fmP', ['调频周期', 'FM period'], 200, 5000, 50, (v) => v + ' T₀'),
          sl('rstPhase', ['复位相位（首沿时刻）', 'Reset phase (first-edge time)'], 0, 0.99, 0.01, T0),
          sl('N0', ['复位初值 N₀', 'Initial count N₀'], 0, 4095, 1, (v) => String(v))),
        box('组传播延迟、采样与 snapshot 路线', 'Group delays, sampling and snapshot route',
          sl('dq', ['低位组延迟 d_q', 'Low-group delay d_q'], 0.02, 0.6, 0.01, T0),
          sl('dC', ['高位组延迟 d_C', 'High-group delay d_C'], 0.05, 14, 0.05, T0),
          sl('pvt', ['实际延迟偏差（PVT）', 'Actual delay skew (PVT)'], -30, 30, 1, (v) => (v > 0 ? '+' : '') + v + ' %', 100),
          sl('wmeta', ['亚稳窗口', 'Metastability window'], 0, 0.1, 0.005, (v) => f3(v) + ' T₀'),
          sg('route', ['路线', 'Route'], [{ value: 'A', label: ['A 双候选', 'A two candidates'] }, { value: 'B', label: ['B 匹配延迟', 'B matched delay'] }, { value: 'C', label: ['C 冗余校正', 'C redundant corr.'] }])),
        timingBox,
        box('规划与执行器（式 16–17）', 'Planner and executor (Eqs. 16–17)',
          sg('planner', ['规划', 'Planner'], [{ value: 'pred', label: ['预测（上一 REF）', 'Predictive (prev. REF)'] }, { value: 'react', label: ['事后（本次 snapshot 后）', 'Reactive (after snapshot)'] }]),
          sl('off', ['计划偏置', 'Planned offset'], 0, 1.5, 0.05, T0),
          sl('Lproc', ['慢域处理延迟', 'Slow-domain latency'], 1, 10, 0.5, T0),
          sl('tguard', ['t_guard', 't_guard'], 0, 1, 0.05, T0),
          sg('latePolicy', ['迟到策略', 'Late policy'], [{ value: 'flag', label: ['标记 LATE', 'flag LATE'] }, { value: 'replan', label: ['重新规划 J', 're-plan J'] }])),
        box('短量程 TDC 与校准世代（式 18–19）', 'Short TDC and calibration epochs (Eqs. 18–19)',
          sg('lsbDen', ['LSB', 'LSB'], [8, 16, 32, 64].map((v) => ({ value: v, label: 'T₀/' + v }))),
          sl('rlo', ['量程下限', 'Range low'], -1, 0, 0.05, T0),
          sl('rhi', ['量程上限', 'Range high'], 0.5, 8, 0.05, T0),
          sl('dpath', ['路径差 τ_E−τ_R', 'Path skew τ_E−τ_R'], 0, 0.3, 0.01, T0),
          sl('gdrift', ['TDC 增益漂移/世代', 'TDC gain drift per epoch'], 0, 20, 0.5, (v) => W.fmt(v, 1) + ' %', 100),
          sl('calK', ['校准世代长度', 'Calibration epoch length'], 10, 200, 5, (v) => v + ' REF')));
      const coverNote = W.h('div');
      const faultPanel = W.h('div', null,
        box('故障注入概率（每个 REF 事件独立抽样）', 'Fault-injection probability (drawn independently per REF event)', ...FAULTS.map((f) => sl('pf.' + f, FL[f], 0, 10, 0.1, (v) => W.fmt(v, 1) + ' %', 100))),
        box('保护措施（关闭后可看到静默错误出现）', 'Protections (turn off to watch silent errors appear)', ...PROTS.map((p) => tg('prot.' + p, PL[p]))),
        coverNote);
      Object.values(ctl).forEach((c) => { if (c.classList.contains('w-toggle')) c.style.maxWidth = '100%'; });

      // ---------------------------------------------------------------- tabs, KPI strip, layout
      const TABS = [['event', '事件视图', 'Event view'], ['stats', '统计与直方图', 'Statistics'], ['log', '事件日志', 'Event log'], ['model', '模型参数', 'Model'], ['faults', '故障与保护', 'Faults & protections']];
      const tabBtns = TABS.map(([v, zh, en]) => W.button([zh, en], () => { st.tab = v; showTab(); }));
      const eventPanel = W.h('div'), statsPanel = W.h('div'), logPanel = W.h('div');
      const panels = { event: eventPanel, stats: statsPanel, log: logPanel, model: modelPanel, faults: faultPanel };
      function showTab() {
        TABS.forEach(([v], i) => { tabBtns[i].classList.toggle('primary', v === st.tab); tabBtns[i].setAttribute('aria-pressed', String(v === st.tab)); });
        for (const [k, el] of Object.entries(panels)) el.hidden = k !== st.tab;
        shownKey = ''; lastStatsDraw = 0; lastLogDraw = 0; requestDraw();
      }
      const kpi = W.readout([
        { key: 'n', label: ['已模拟事件', 'Events simulated'] },
        { key: 'fine', label: ['FINE', 'FINE'] },
        { key: 'coarse', label: ['COARSE', 'COARSE'] },
        { key: 'inv', label: ['INVALID', 'INVALID'] },
        { key: 'sf', label: ['静默错误 FINE', 'Silent wrong FINE'] },
        { key: 'sc', label: ['静默错误 COARSE', 'Silent wrong COARSE'] },
        { key: 'maxe', label: ['FINE 最大 |误差|', 'FINE max |error|'] },
        { key: 'rate', label: ['模拟速度', 'Simulation rate'] },
      ]);
      const status = W.h('div', { style: { fontSize: '.75rem', color: 'var(--muted)', minHeight: '1.2em', marginTop: '4px' } });
      root.append(
        W.controls(play, stepBtn, resetBtn, speedSeg, runSel, seedSl),
        W.h('div', { style: { fontSize: '.72rem', color: 'var(--muted)', margin: '-4px 0 4px' } }, W.L('场景：', 'Scenarios:')),
        W.controls(...presetBtns),
        kpi.el, status,
        W.h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '12px 0 10px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' } }, ...tabBtns),
        eventPanel, statsPanel, logPanel, modelPanel, faultPanel,
        W.note(['理想化行为模型：按第 12.2 节验证方案搭建的事件级示意（open-loop 测量，无环路滤波器）。时钟、延迟、TDC、故障与校准都是可调的玩具参数化，不是文献数据、芯片指标或已验证设计；亚稳采样只按“随机取旧值/新值”建模，不含解析时间与 MTBF；只选上升沿，α_sel = 0。它验证的是接口与有效性逻辑（第一层），不能替代第 12.3–12.5 节的 RTL/门级、晶体管/PVT 与闭环验证。',
          'Idealized behavioural model: an event-level illustration built along the §12.2 verification plan (open-loop measurement, no loop filter). Clocks, delays, TDC, faults and calibration are adjustable toy parameterizations — not data from the cited papers, chip specifications or a validated design; a metastable sample is modelled only as "randomly old or new", without resolution time or MTBF; only rising edges are selected, so α_sel = 0. It exercises interface and validity logic (layer 1) and cannot replace the RTL/gate-level, transistor/PVT and closed-loop verification of §12.3–12.5.'], 'warn'),
        W.note(['要点：只有当 coarse 有效、执行回执有效且式 (20) 全部满足时才输出 FINE，相位按式 (5) 写成 (J_observed + α) − μ̂；否则降级为带误差上界的 COARSE，或 INVALID。全部保护打开时，“静默错误 FINE”应为 0；逐个关闭保护（信任 J_plan、±1 修正器、忽略 SAT、忽略校准世代、非原子选择、关闭锚点交叉检查），静默错误就会出现——PLL 能否锁住不能代替这种逐事件比对。',
          'What to notice: FINE is produced only when coarse is valid, the execution receipt is valid and every term of Eq. (20) holds; the phase is then (J_observed + α) − μ̂ as in Eq. (5). Otherwise the event degrades to COARSE with an error bound, or INVALID. With all protections on, "silent wrong FINE" should stay 0; switch protections off one by one (trust J_plan, ±1 corrector, ignore SAT, ignore calibration epoch, non-atomic selection, no anchor cross-check) and silent errors appear — whether the PLL locks cannot replace this event-by-event comparison.']),
      );
      // ---------------------------------------------------------------- event view
      const evHead = W.h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', marginBottom: '6px' } });
      const navPrev = W.button('◀', () => browse(-1), { title: 'previous / 上一个' }), navNext = W.button('▶', () => browse(1), { title: 'next / 下一个' });
      const navLast = W.button(['最新', 'Latest'], () => { st.follow = true; st.selK = null; requestDraw(); });
      const svgHost = W.h('div');
      const eqBox = W.h('div', { style: { display: 'grid', gap: '4px', fontSize: '.82rem', marginTop: '8px', overflowX: 'auto', overflowY: 'hidden' } });
      const vBox = W.h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } });
      const frameRO = W.readout([
        { key: 'id', label: ['event_id · reset_epoch', 'event_id · reset_epoch'] },
        { key: 'cq', label: ['C_cap / q_cap', 'C_cap / q_cap'] },
        { key: 'cand', label: ['candidate_id · 修正', 'candidate_id · correction'] },
        { key: 'plan', label: ['J_plan / J_observed', 'J_plan / J_observed'] },
        { key: 'flags', label: ['late · miss · duplicate', 'late · miss · duplicate'] },
        { key: 'fine', label: ['fine_raw · VALID / SAT', 'fine_raw · VALID / SAT'] },
        { key: 'cal', label: ['tdc_gain_epoch（硬件/归一化表）', 'tdc_gain_epoch (hw / normaliser)'] },
        { key: 'src', label: ['phase_source · uncertainty', 'phase_source · uncertainty'] },
        { key: 'ph', label: ['重建相位 / 真值', 'Reconstructed / ground truth'] },
        { key: 'err', label: ['误差（原周期）', 'Error (raw cycles)'] },
      ]);
      eventPanel.append(W.h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '6px' } }, navPrev, navNext, navLast, evHead), svgHost,
        W.legend([{ color: 'var(--sig-clk)', label: 'CK₀' }, { color: 'var(--sig-ref)', label: 'REF' }, { color: 'var(--sig-low)', label: ['低位 q', 'low q'] }, { color: 'var(--sig-high)', label: ['高位 C', 'high C'] },
          { color: 'var(--fg)', label: ['采样时刻', 'sampling instants'] }, { color: 'var(--sig-plan)', label: 'J_plan', dash: true }, { color: 'var(--sig-sel)', label: ['实际执行沿 / J_observed', 'executed edge / J_observed'] }, { color: 'var(--sig-fine)', label: ['TDC 区间', 'TDC interval'] }]),
        vBox, eqBox, frameRO.el);
      function browse(d) {
        if (!sim || !sim.ring.length) return;
        const ring = sim.ring, cur = currentFrame();
        let i = ring.indexOf(cur) + d; i = Math.max(0, Math.min(ring.length - 1, i));
        st.selK = ring[i].k; st.follow = i === ring.length - 1; requestDraw();
      }
      function currentFrame() {
        if (!sim || !sim.ring.length) return null;
        if (st.follow || st.selK == null) return sim.ring[sim.ring.length - 1];
        return sim.ring.find((f) => f.k === st.selK) || sim.ring[sim.ring.length - 1];
      }
      const fmtPh = (v) => (v == null ? '—' : v.toFixed(4));
      const yes = (b) => (b ? '✓' : '✗');
      function chip(ok, text, title) {
        const c = ok === null ? 'var(--muted)' : ok ? 'var(--good-ink)' : 'var(--critical-ink)';
        return W.h('span', { title, class: 'mono', style: { fontSize: '.72rem', border: '1px solid var(--border-strong)', borderRadius: '999px', padding: '1px 8px', color: c } }, text + ' ' + (ok === null ? '—' : yes(ok)));
      }
      function drawWave(fr, u) {
        const P = sim.P, MOD = sim.MOD, Mg = P.M;
        const narrow = (root.clientWidth || 760) < 560;
        const VW = narrow ? 420 : 760, PADL = narrow ? 54 : 74, PADR = 10, VH = 292;
        const tR = fr.tR, tE_ = fr.tFirst != null ? fr.tFirst : tR;
        const t0 = tR - (narrow ? 1.5 : 2.6), t1 = Math.min(tR + (narrow ? 6.5 : 10), Math.max(tR + (narrow ? 2.4 : 3.4), tE_ + (narrow ? 0.9 : 1.4)));
        const E = fr.edges, nE = E.length, Tav = (E[nE - 1] - E[0]) / (nE - 1);
        const tOf = (J) => { const i = J - fr.J0; return i < 0 ? E[0] + i * Tav : i >= nE ? E[nE - 1] + (i - nE + 1) * Tav : E[i]; };
        const cnt = (J) => WRAP(J - fr.origin, MOD);
        const x = W.scale([t0, t1], [PADL, VW - PADR]);
        const svg = W.svg(VW, VH);
        const Y = { clk: 26, n: 50, ref: 72, q: 104, C: 138, let: 160, cap: 180, ex: 214, tdc: 252 };
        const lab = (zh, en, y) => svg.appendChild(en == null ? W.s('text', { x: 6, y: y + 4, class: 'lbl' }, zh) : W.sL(zh, en, { x: 6, y: y + 4, class: 'lbl' }));
        // grid at raw rising edges + edge counter values
        const Ja = fr.J0, Jb = fr.J0 + nE - 1;
        for (let J = Ja; J <= Jb; J++) {
          const t = tOf(J); if (t < t0 || t > t1) continue;
          svg.appendChild(W.s('line', { x1: x(t), x2: x(t), y1: 14, y2: VH - 26, class: 'grid', style: cnt(J) % Mg === 0 ? 'stroke:var(--axis);stroke-width:1.4' : '' }));
          svg.appendChild(W.s('text', { x: x(t), y: Y.n + 3, 'text-anchor': 'middle', class: 'mono', style: 'font-size:9.5px;fill:var(--fg-2)' }, String(cnt(J))));
        }
        // CK0
        const ce = [];
        for (let J = Ja - 1; J <= Jb; J++) { const a = tOf(J), b = tOf(J + 1); ce.push({ t: a, v: 1 }, { t: a + 0.5 * (b - a), v: 0 }); }
        svg.appendChild(W.s('path', { d: W.digitalPath(ce, 0, x, Y.clk - 9, Y.clk + 9, t0, t1), fill: 'none', stroke: 'var(--sig-clk)', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
        lab('CK₀', null, Y.clk); lab('N', null, Y.n);
        // q bus (transitions at t_J + d_q) and C bus (transitions at t_J + d_C when the count wraps)
        const bus = (key, d, val, y, color) => {
          const segs = [];
          const span = Math.ceil(d + 2 * Mg + 3);
          let Jc = null, tc = t0;
          for (let J = Ja - span; J <= Jb + 1; J++) {
            if (key === 'C' && cnt(J) % Mg !== 0) continue;
            const tt = tOf(J) + d;
            if (tt <= t0) { Jc = J; continue; }
            if (tt >= t1) break;
            segs.push({ t0: tc, t1: tt, label: Jc == null ? '' : val(Jc) }); Jc = J; tc = tt;
          }
          segs.push({ t0: tc, t1, label: Jc == null ? '' : val(Jc) });
          svg.appendChild(W.busGroup(segs.map((s) => ({ ...s, fill: color, stroke: color })), x, y, 20));
        };
        bus('q', sim.dqA, (J) => cnt(J) % Mg, Y.q, 'var(--sig-low)');
        bus('C', sim.dCA, (J) => Math.floor(cnt(J) / Mg), Y.C, 'var(--sig-high)');
        lab('低位 q', 'low q', Y.q); lab('高位 C', 'high C', Y.C);
        // sampling instants (capture) per route
        lab('捕获', 'capture', Y.cap);
        let capTxt = [];
        for (const c of fr.caps) {
          const style = c.sel ? 'stroke:var(--fg);stroke-width:1.6' : 'stroke:var(--muted);stroke-width:1.2;stroke-dasharray:3 3';
          for (const [s, y] of [[c.sq, Y.q], [c.sc, Y.C]]) {
            if (s < t0 || s > t1) continue;
            svg.appendChild(W.s('line', { x1: x(s), x2: x(s), y1: y - 14, y2: y + 14, style }));
            svg.appendChild(W.s('circle', { cx: x(s), cy: y - 14, r: 3, fill: c.sel ? 'var(--fg)' : 'var(--surface)', stroke: c.sel ? 'var(--fg)' : 'var(--muted)' }));
          }
          const sx = Math.max(c.sq, c.sc);
          if (sx >= t0 && sx <= t1 && (fr.route === 'A')) svg.appendChild(W.s('text', { x: x(Math.min(c.sq, c.sc)) + 4, y: Y.let, class: 'mono', style: `font-size:10px;font-weight:700;fill:${c.sel ? 'var(--fg)' : 'var(--muted)'}` }, c.id));
          capTxt.push(`${fr.route === 'A' ? c.id + (c.sel ? '★' : '') + ' ' : ''}(C,q)=(${c.C},${c.q})${c.tear ? ' tear' : ''}`);
        }
        if (fr.route === 'C') capTxt.push(`w₂=${fr.w2} → κ_C=${fr.kappa_C}, κ_N=${fr.kappa_N}${fr.amb ? ' AMBIG.' : ''}`);
        svg.appendChild(W.s('text', { x: PADL + 2, y: Y.cap + 4, class: 'mono', style: 'font-size:10.5px;fill:var(--fg)' }, capTxt.join('   ')));
        // REF
        svg.appendChild(W.s('line', { x1: x(tR), x2: x(tR), y1: 12, y2: VH - 22, stroke: 'var(--sig-ref)', 'stroke-width': 1.6 }));
        svg.appendChild(W.s('path', { d: `M${x(tR) - 5},${Y.ref - 9}L${x(tR) + 5},${Y.ref - 9}L${x(tR)},${Y.ref}Z`, fill: 'var(--sig-ref)' }));
        svg.appendChild(W.s('text', { x: x(tR) + 7, y: Y.ref + 1, style: 'font-size:10.5px;fill:var(--fg)' }, `REF #${fr.k}  Φ₀(t_R)=${fr.truth.toFixed(3)}`));
        lab('REF', null, Y.ref);
        // executor: J_plan target, command arrival, executed pulse(s)
        lab('执行', 'exec', Y.ex);
        if (fr.tTarget != null && fr.tTarget >= t0 && fr.tTarget <= t1) {
          svg.appendChild(W.s('line', { x1: x(fr.tTarget), x2: x(fr.tTarget), y1: Y.ex - 22, y2: Y.ex + 10, stroke: 'var(--sig-plan)', 'stroke-width': 2, 'stroke-dasharray': '5 3' }));
          svg.appendChild(W.s('text', { x: x(fr.tTarget) - 3, y: Y.ex + 20, 'text-anchor': 'end', class: 'mono', style: 'font-size:10px;fill:var(--fg-2)' }, `J_plan=${fr.J_plan}`));
        }
        if (fr.tArrive != null) {
          if (fr.tArrive >= t0 && fr.tArrive <= t1) {
            svg.appendChild(W.s('path', { d: `M${x(fr.tArrive)},${Y.ex + 9}l-5,9h10z`, fill: 'var(--sig-plan)' }));
            svg.appendChild(W.sL('命令到达', 'cmd arrives', { x: x(fr.tArrive) + 7, y: Y.ex + 19, style: 'font-size:9.5px;fill:var(--fg-2)' }));
          }
        }
        if (fr.tFirst != null && !fr.miss) {
          const pe = [];
          for (let i = 0; i < fr.pulses; i++) { const a = tOf(fr.Jfirst + i), b = tOf(fr.Jfirst + i + 1); pe.push({ t: a, v: 1 }, { t: a + 0.5 * (b - a), v: 0 }); }
          svg.appendChild(W.s('path', { d: W.digitalPath(pe, 0, x, Y.ex - 8, Y.ex + 8, t0, t1), fill: 'none', stroke: 'var(--sig-sel)', 'stroke-width': 2 }));
          svg.appendChild(W.s('text', { x: x(fr.tFirst) + 4, y: Y.ex - 11, class: 'mono', style: 'font-size:10px;fill:var(--fg);font-weight:600' }, `J_obs=${fr.J_observed}${fr.pulses > 1 ? ' ×2' : ''}`));
        } else svg.appendChild(fr.J_plan == null ? W.sL('无命令（获取阶段）', 'no command (acquisition)', { x: PADL + 2, y: Y.ex + 4, style: 'font-size:10.5px;fill:var(--critical-ink)' })
          : W.sL('MISS：窗口内无执行沿', 'MISS: no executed edge in window', { x: PADL + 2, y: Y.ex + 4, style: 'font-size:10.5px;fill:var(--critical-ink)' }));
        // TDC: range band, measured interval, saturation
        lab('TDC', null, Y.tdc);
        const ra = Math.max(t0, tR + P.rlo - P.dpath), rb = Math.min(t1, tR + P.rhi - P.dpath);
        if (rb > ra) svg.appendChild(W.s('rect', { x: x(ra), y: Y.tdc - 9, width: x(rb) - x(ra), height: 18, fill: 'var(--sig-fine)', 'fill-opacity': 0.12, stroke: 'var(--sig-fine)', 'stroke-opacity': 0.5, 'stroke-dasharray': '3 3' }));
        if (fr.fine_valid) {
          const te_ = Math.min(t1, fr.tFirst);
          svg.appendChild(W.s('line', { x1: x(tR), x2: x(te_), y1: Y.tdc, y2: Y.tdc, stroke: 'var(--sig-fine)', 'stroke-width': 3.5, 'stroke-linecap': 'round' }));
          const satTxt = fr.sat_hi ? ' SAT_hi' : fr.sat_lo ? ' SAT_lo' : '';
          svg.appendChild(W.s('text', { x: x(tR) + (te_ >= tR ? 4 : -4), y: Y.tdc + 22, 'text-anchor': te_ >= tR ? 'start' : 'end', class: 'mono', style: `font-size:10.5px;fill:${satTxt ? 'var(--critical-ink)' : 'var(--fg)'}` }, `code=${fr.fine_raw}${satTxt} → μ̂=${fr.mu.toFixed(4)}`));
        }
        // reveal cursor (animated mode)
        if (u < 1) {
          const xc = x(t0 + u * (t1 - t0));
          svg.appendChild(W.s('rect', { x: xc, y: 0, width: Math.max(0, VW - xc), height: VH, fill: 'var(--surface)', 'fill-opacity': 0.8 }));
          svg.appendChild(W.s('line', { x1: xc, x2: xc, y1: 4, y2: VH - 4, stroke: 'var(--sig-ref)', 'stroke-width': 1.2, 'stroke-dasharray': '2 3' }));
        }
        // time axis (relative to REF)
        for (const tk of W.ticks(t0 - tR, t1 - tR, 8)) svg.appendChild(W.s('text', { x: x(tR + tk), y: VH - 6, 'text-anchor': 'middle', style: 'font-size:9.5px;fill:var(--muted)' }, (tk > 0 ? '+' : '') + tk));
        svg.appendChild(W.s('text', { x: 6, y: VH - 6, style: 'font-size:9.5px;fill:var(--muted)' }, '[T₀]'));
        W.clear(svgHost).appendChild(svg);
      }
      const WHY = {
        sat: ['TDC 饱和：V_range 不成立', 'TDC saturated: V_range false'], cal: ['校准世代不符：V_cal 不成立', 'calibration epoch mismatch: V_cal false'],
        late: ['选沿命令迟到（式 17）→ LATE', 'edge command late (Eq. 17) → LATE'], dup: ['回执脉冲数 ≠ 1（duplicate）', 'receipt pulse count ≠ 1 (duplicate)'],
        obs: ['执行回执无效', 'execution receipt invalid'], miss: ['MISS：窗口内无执行沿', 'MISS: no executed edge in window'],
        nocmd: ['尚无命令（获取阶段）', 'no command yet (acquisition)'], code: ['码无效', 'invalid code'],
        epoch: ['复位世代改变 → INVALID 并重新获取', 'reset epoch changed → INVALID, re-acquire'],
        stitch: ['coarse/fine 锚点不一致（I2/I6）→ INVALID', 'coarse/fine anchors disagree (I2/I6) → INVALID'],
        coarse: ['coarse 歧义（超出覆盖集）→ INVALID', 'coarse ambiguous (outside covered set) → INVALID'],
      };
      const tx = (s) => W.tex(s);
      function drawEventInfo(fr) {
        const P = sim.P, M = P.M;
        const srcKind = fr.phase_source === 'FINE' ? 'good' : fr.phase_source === 'COARSE' ? 'warn' : 'bad';
        W.clear(evHead).append(W.h('b', null, W.L(`事件 #${fr.k}`, `Event #${fr.k}`)), W.status(srcKind, fr.phase_source));
        if (fr.phase != null) evHead.append(fr.ok ? W.status('good', ['在误差上界内', 'within bound']) : W.status('bad', ['静默错误！', 'SILENT WRONG!']));
        if (fr.why) evHead.append(W.h('span', { style: { fontSize: '.75rem', color: 'var(--fg-2)' } }, W.lbl(WHY[fr.why] || fr.why)));
        for (const f of fr.faults) evHead.append(W.h('span', { style: { fontSize: '.72rem', border: '1px solid var(--critical)', color: 'var(--critical-ink)', borderRadius: '999px', padding: '0 8px' } }, '⚡ ', W.lbl(FL[f])));
        if (fr.natTear) evHead.append(W.h('span', { style: { fontSize: '.72rem', border: '1px solid var(--warning)', borderRadius: '999px', padding: '0 8px' } }, W.lbl(FL.tear)));
        const V = fr.V, fineOk = fr.coValid && fr.obsValid && V.code && V.range && V.cal && V.epoch;
        W.clear(vBox).append(chip(fr.coValid, 'coarse.valid'), chip(fr.obsValid, 'observed.valid'), chip(V.code, 'V_code'), chip(V.range, 'V_range'),
          chip(V.anchor, 'V_anchor'), chip(V.epoch, 'V_epoch'), chip(V.cal, 'V_cal'), chip(fineOk && V.anchor !== false ? true : false, 'F_usable (20)'));
        // equations with the current numbers
        const n = (v, d = 4) => (v == null ? '\\text{—}' : (+v).toFixed(d).replace(/\.?0+$/, ''));
        const sgn = (v) => (v >= 0 ? '+' + v : String(v));
        const L = [];
        if (fr.route === 'A') {
          const off = fr.conv === 'R' ? '\\tfrac12' : '0';
          L.push([`\\hat\\Phi_c=MC_{cap}+q_{cap}+o_{${fr.conv}}=${M}\\cdot${fr.C_cap}+${fr.q_cap}+${off}=${n(fr.coEst, 2)}\\;(\\pm${n(fr.coBound, 3)})`, fr.conv !== fr.candidate_id ? ['非原子选择：数据字来自 ' + fr.candidate_id + '，锚点约定来自 ' + fr.conv, 'non-atomic: word from ' + fr.candidate_id + ', anchor convention from ' + fr.conv] : ['候选 ' + fr.candidate_id + '（边界侧选择）', 'candidate ' + fr.candidate_id + ' (boundary-side select)']]);
        } else if (fr.route === 'B') {
          L.push([`\\hat\\Phi_c=MC_{cap}+q_{cap}-\\tfrac12=${M}\\cdot${fr.C_cap}+${fr.q_cap}-\\tfrac12=${n(fr.coEst, 2)}\\;(\\pm${n(fr.coBound, 3)})`, ['匹配延迟采样', 'matched-delay sampling']]);
        } else {
          const Nc = WRAP(M * (fr.C_cap + fr.kappa_C) + fr.q_cap + fr.kappa_N, sim.MOD);
          L.push([`N_{corr}=M(C_{cap}+\\kappa_C)+q_{cap}+\\kappa_N=${M}(${fr.C_cap}${sgn(fr.kappa_C)})+${fr.q_cap}${sgn(fr.kappa_N)}=${Nc},\\;\\hat\\Phi_c=N_{corr}+\\tfrac12`, ['式 (10)', 'Eq. (10)']]);
        }
        if (fr.J_plan != null) {
          const need = fr.tArrive + P.tsetx + P.tguard - fr.tR, tgt = fr.tTarget == null ? null : fr.tTarget - fr.tR;
          L.push([`J_{plan}=MH_J+s_J=${M}\\cdot${Math.floor(fr.J_plan / M)}+${fr.J_plan % M}=${fr.J_plan}`, ['式 (16)', 'Eq. (16)']]);
          if (tgt != null) L.push([`t_{arrive}+t_{setup}+t_{guard}=${n(need, 2)}\\;${need <= tgt ? '\\le' : '>'}\\;t_{target}=${n(tgt, 2)}\\;${need <= tgt ? '\\checkmark' : '\\Rightarrow\\text{LATE}'}`, ['式 (17)，时间相对 t_R', 'Eq. (17), times relative to t_R']]);
        }
        if (fr.fine_valid) L.push([`\\hat\\mu=\\frac{\\text{code}\\cdot\\mathrm{LSB}_t-\\hat\\tau}{\\hat T_0}=\\frac{${fr.fine_raw}\\cdot${n(fr.lsb, 5)}-${n(P.dpath, 3)}}{${n(fr.T0hat, 5)}}=${n(fr.mu)}`, ['式 (19)，归一化表世代 ' + fr.norm_epoch, 'Eq. (19), normaliser epoch ' + fr.norm_epoch]]);
        if (fr.phase_source === 'FINE') L.push([`\\hat\\Phi=(J_{${P.prot.receipt ? 'obs' : 'plan'}}+\\alpha)-\\hat\\mu=(${fr.anchor}+0)-${n(fr.mu)}=${n(fr.phase)}`, ['式 (5)，§10.3 FINE', 'Eq. (5), §10.3 FINE']]);
        else if (fr.phase_source === 'COARSE') L.push([`\\hat\\Phi=\\hat\\Phi_c=${n(fr.phase)}\\;(\\pm${n(fr.bound, 3)})`, ['§10.3 COARSE', '§10.3 COARSE']]);
        else L.push(['\\text{INVALID: no new measurement}', ['§10.3 INVALID', '§10.3 INVALID']]);
        L.push([`\\Phi_0(t_R)=${n(fr.truth)}` + (fr.err == null ? '' : `,\\;e=${n(fr.err, 5)},\\;|e|${fr.ok ? '\\le' : '>'}${n(fr.bound, 5)}`), ['真值：由边沿时间插值（只用于评分）', 'truth: interpolated from edge times (scoring only)']]);
        W.clear(eqBox);
        for (const [s, note] of L) eqBox.append(W.h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px' } }, tx(s), W.h('span', { style: { fontSize: '.72rem', color: 'var(--muted)' } }, W.lbl(note))));
        const fl = (b) => (b ? '1' : '0');
        frameRO.set('id', `${fr.k} · ${fr.reset_epoch}`);
        frameRO.set('cq', `${fr.C_cap} / ${fr.q_cap}`);
        frameRO.set('cand', `${fr.candidate_id} · κ_C=${fr.kappa_C}, κ_N=${fr.kappa_N}`);
        frameRO.set('plan', `${fr.J_plan == null ? '—' : fr.J_plan} / ${fr.J_observed == null ? '—' : fr.J_observed}`);
        frameRO.set('flags', `${fl(fr.late)} · ${fl(fr.miss)} · ${fl(fr.duplicate)}${fr.replan ? ' · replan' : ''}`);
        frameRO.set('fine', `${fr.fine_raw == null ? '—' : fr.fine_raw} · ${fr.fine_valid ? 'VALID' : 'INVALID'}${fr.sat_hi ? ' / SAT_hi' : fr.sat_lo ? ' / SAT_lo' : ''}`);
        frameRO.set('cal', `${fr.tdc_gain_epoch} / ${fr.norm_epoch}`);
        frameRO.set('src', `${fr.phase_source} · ${fr.bound == null ? '—' : '±' + fr.bound.toFixed(4)}`);
        frameRO.set('ph', `${fmtPh(fr.phase)} / ${fmtPh(fr.truth)}`);
        frameRO.set('err', fr.err == null ? '—' : (fr.err >= 0 ? '+' : '') + fr.err.toFixed(5));
        frameRO.cell('err').style.color = fr.err == null ? '' : fr.ok ? 'var(--good-ink)' : 'var(--critical-ink)';
      }

      // ---------------------------------------------------------------- statistics panel
      const statTable = W.h('div', { class: 'tbl-wrap', style: { margin: '0 0 10px' } });
      const statExtra = W.readout([
        { key: 'rms', label: ['FINE 误差 rms', 'FINE error rms'] }, { key: 'sat', label: ['SAT 次数', 'SAT count'] },
        { key: 'mm', label: ['J_observed ≠ J_plan', 'J_observed ≠ J_plan'] }, { key: 'late', label: ['LATE / 重新规划', 'LATE / re-planned'] },
        { key: 'run', label: ['最长连续 INVALID', 'Longest INVALID run'] }, { key: 'tear', label: ['自然撕裂（组延迟）', 'Natural tears (group delay)'] },
      ]);
      const whyBox = W.h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: '.75rem', color: 'var(--fg-2)', margin: '8px 0' } });
      const histSeg = W.seg({ label: ['误差直方图', 'Error histogram'], value: st.hist, options: [{ value: 'fine', label: ['FINE（LSB 单位）', 'FINE (in LSB)'] }, { value: 'coarse', label: ['COARSE（原周期）', 'COARSE (raw cycles)'] }], onChange: (v) => { st.hist = v; lastStatsDraw = 0; requestDraw(); } });
      const hCodeHost = W.h('div'), hErrHost = W.h('div'), tPlotHost = W.h('div');
      const statDef = W.h('div', { style: { fontSize: '.72rem', color: 'var(--muted)', margin: '-4px 0 8px' } }, W.L('静默错误 = 输出 FINE/COARSE 但误差超过其声明上界；已识别 = 降级为 COARSE（在上界内）或 INVALID；已补偿 = 仍输出 FINE 且在上界内（如回执纠正了丢沿、κ_C 纠正了撕裂）。一个事件可同时计入多类故障。', 'Silent wrong = FINE/COARSE output whose error exceeds its declared bound; detected = degraded to COARSE (within bound) or INVALID; compensated = still FINE and within bound (e.g. the receipt fixed a dropped edge, κ_C fixed a tear). One event can count under several fault types.'));
      statsPanel.append(statTable, statDef, statExtra.el, whyBox,
        W.h('div', { class: 'w-grid2' },
          W.h('div', null, W.h('div', { style: { fontSize: '.78rem', fontWeight: 650 } }, W.L('fine 码直方图（含饱和端码）', 'Fine-code histogram (incl. saturated end codes)')), hCodeHost),
          W.h('div', null, histSeg, hErrHost)),
        W.h('div', { style: { fontSize: '.78rem', fontWeight: 650, marginTop: '10px' } }, W.L('最近 300 个事件的相位误差（原周期）', 'Phase error of the last 300 events (raw cycles)')),
        W.legend([{ color: SRC_C.FINE, label: 'FINE' }, { color: SRC_C.COARSE, label: 'COARSE' }, { color: SRC_C.INVALID, label: ['INVALID（底部刻度）', 'INVALID (ticks at bottom)'] }]),
        tPlotHost);
      function histSvg(counts, opts) {
        const VW = 380, VH = 170, PL = 40, PR = 8, PT = 10, PB = 34;
        const svg = W.svg(VW, VH);
        const nB = counts.length, max = Math.max(1, ...counts);
        const x = W.scale([0, nB], [PL, VW - PR]), y = W.scale([0, max], [VH - PB, PT]);
        for (const tk of W.ticks(0, max, 4)) { svg.appendChild(W.s('line', { x1: PL, x2: VW - PR, y1: y(tk), y2: y(tk), class: 'grid' })); svg.appendChild(W.s('text', { x: PL - 4, y: y(tk) + 3, 'text-anchor': 'end', style: 'font-size:9.5px' }, tk >= 1000 ? W.fmt(tk / 1000, 1) + 'k' : String(tk))); }
        const bw = (VW - PL - PR) / nB;
        counts.forEach((c, i) => { if (!c) return; svg.appendChild(W.s('rect', { x: x(i) + (bw > 3 ? 0.5 : 0), y: y(c), width: Math.max(0.8, bw - (bw > 3 ? 1 : 0)), height: VH - PB - y(c), fill: opts.color(i) })); });
        svg.appendChild(W.s('line', { x1: PL, x2: VW - PR, y1: VH - PB, y2: VH - PB, class: 'axis' }));
        for (const [i, t] of opts.xt) svg.appendChild(W.s('text', { x: x(i), y: VH - PB + 13, 'text-anchor': 'middle', class: 'mono', style: 'font-size:9.5px' }, t));
        if (opts.marks) for (const i of opts.marks) svg.appendChild(W.s('line', { x1: x(i), x2: x(i), y1: PT, y2: VH - PB, stroke: 'var(--sig-err)', 'stroke-dasharray': '3 3', 'stroke-width': 1.2 }));
        svg.appendChild(opts.xl);
        return svg;
      }
      function drawStats() {
        const S = sim.S, P = sim.P;
        const head = ['', '事件数|events', '静默错误|silent wrong', '已识别|detected', '已补偿|compensated', 'FINE', 'COARSE', 'INVALID'];
        const th = head.map((h) => { const [zh, en] = h.split('|'); return `<th>${en ? Book.bi(zh, en) : zh}</th>`; }).join('');
        const rows = FAULTS.concat(['tear', 'none']).map((f) => {
          const r = S.pf[f];
          const sil = r.silent ? `<b style="color:var(--critical-ink)">${r.silent}</b>` : '<span style="color:var(--good-ink)">0</span>';
          return `<tr${r.n ? '' : ' style="color:var(--muted)"'}><td style="min-width:11em">${Book.bi(FL[f][0], FL[f][1])}</td><td>${r.n}</td><td>${r.n ? sil : '—'}</td><td>${r.detected}</td><td>${f === 'none' ? r.FINE : r.corrected}</td><td>${r.FINE}</td><td>${r.COARSE}</td><td>${r.INVALID}</td></tr>`;
        }).join('');
        statTable.innerHTML = `<table class="w-table"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
        statDef.hidden = false;
        statExtra.set('rms', S.src.FINE ? Math.sqrt(S.sumSqFine / S.src.FINE).toExponential(2) : '—');
        statExtra.set('sat', String(S.sat)); statExtra.set('mm', String(S.mismatch)); statExtra.set('late', `${S.late} / ${S.replan}`);
        statExtra.set('run', String(S.maxInvRun)); statExtra.set('tear', String(S.natTear));
        W.clear(whyBox).append(W.h('b', null, W.L('降级原因：', 'Downgrade reasons: ')));
        for (const [k, v] of Object.entries(S.why).sort((a, b) => b[1] - a[1])) whyBox.append(W.h('span', null, W.lbl(WHY[k] || k), ` × ${v}`));
        // fine-code histogram
        const nC = S.hCode.length, cLo = S.cLo;
        const xt = W.ticks(cLo, S.cHi, 5).map((c) => [c - cLo + 0.5, String(c)]);
        W.clear(hCodeHost).appendChild(histSvg(Array.from(S.hCode), { color: (i) => (i === 0 || i === nC - 1 ? 'var(--sig-err)' : 'var(--sig-fine)'), xt, xl: W.sL('码值（两端 = 饱和）', 'code (ends = saturated)', { x: 210, y: 166, 'text-anchor': 'middle', style: 'font-size:10px' }) }));
        // error histogram
        if (st.hist === 'fine') {
          const xtE = [[0.5, '<−3'], [1, '−3'], [16, '−1.5'], [31, '0'], [46, '1.5'], [61, '3'], [61.5, '>3']];
          W.clear(hErrHost).appendChild(histSvg(Array.from(S.hErrF), { color: (i) => (i === 0 || i === 61 ? 'var(--sig-err)' : 'var(--sig-fine)'), xt: xtE, marks: [26, 36], xl: W.sL('FINE 误差 / LSB（虚线 = ±½ LSB 量化界）', 'FINE error / LSB (dashed = ±½ LSB quantization)', { x: 210, y: 166, 'text-anchor': 'middle', style: 'font-size:10px' }) }));
        } else {
          const b = sim.ring.length ? sim.ring[sim.ring.length - 1].coBound : 0.5;
          const xtE = [[0.5, '<−1.5'], [1, '−1.5'], [21, '−0.5'], [31, '0'], [41, '0.5'], [61, '1.5'], [61.5, '>1.5']];
          W.clear(hErrHost).appendChild(histSvg(Array.from(S.hErrC), { color: (i) => (i === 0 || i === 61 ? 'var(--sig-err)' : 'var(--sig-high)'), xt: xtE, marks: [31 - b * 20, 31 + b * 20], xl: W.sL('COARSE 误差（虚线 = 声明的误差上界）', 'COARSE error (dashed = declared bound)', { x: 210, y: 166, 'text-anchor': 'middle', style: 'font-size:10px' }) }));
        }
        // error vs event (last 300)
        const VW = (root.clientWidth || 760) < 560 ? 420 : 760, VH = 190, PL = 40, PR = 10, PT = 22, PB = 26, R = 0.6;
        const svg = W.svg(VW, VH), ring = sim.ring;
        const k0 = ring.length ? ring[0].k : 0, k1 = ring.length ? Math.max(k0 + 1, ring[ring.length - 1].k) : 1;
        const x = W.scale([k0, k1], [PL, VW - PR]), y = W.scale([-R, R], [VH - PB - 8, PT]);
        for (const tk of [-0.5, -0.25, 0, 0.25, 0.5]) { svg.appendChild(W.s('line', { x1: PL, x2: VW - PR, y1: y(tk), y2: y(tk), class: tk === 0 ? 'axis' : 'grid' })); svg.appendChild(W.s('text', { x: PL - 4, y: y(tk) + 3, 'text-anchor': 'end', style: 'font-size:9.5px' }, String(tk))); }
        for (const tk of W.ticks(k0, k1, 6)) svg.appendChild(W.s('text', { x: x(tk), y: VH - 6, 'text-anchor': 'middle', class: 'mono', style: 'font-size:9.5px' }, String(tk)));
        for (const fr of ring) {
          if (fr.phase_source === 'INVALID') { svg.appendChild(W.s('line', { x1: x(fr.k), x2: x(fr.k), y1: VH - PB - 6, y2: VH - PB + 2, stroke: SRC_C.INVALID, 'stroke-width': 1.5 })); continue; }
          const e = fr.err, out = Math.abs(e) > R;
          const yy = y(W.clamp(e, -R, R));
          svg.appendChild(out ? W.s('path', { d: `M${x(fr.k)},${yy + (e > 0 ? -1 : 1)}l-4,${e > 0 ? 7 : -7}h8z`, fill: SRC_C[fr.phase_source] })
            : W.s('circle', { cx: x(fr.k), cy: yy, r: fr.ok ? 2 : 3.2, fill: fr.ok ? SRC_C[fr.phase_source] : 'none', stroke: fr.ok ? 'none' : SRC_C[fr.phase_source], 'stroke-width': 1.6 }));
        }
        svg.appendChild(W.sL('▲▼ 超出 ±0.6；空心 = 超出声明上界', '▲▼ beyond ±0.6; hollow = outside declared bound', { x: VW - PR, y: 12, 'text-anchor': 'end', style: 'font-size:9.5px' }));
        W.clear(tPlotHost).appendChild(svg);
      }

      // ---------------------------------------------------------------- event log
      const logHost = W.h('div', { class: 'tbl-wrap', style: { maxHeight: '440px', overflow: 'auto', margin: '0' } });
      logPanel.append(W.h('div', { style: { fontSize: '.75rem', color: 'var(--fg-2)', marginBottom: '6px' } }, W.L('最近 150 个事件（最新在上）。点击一行可在“事件视图”中查看该事件的波形与公式；红色行为静默错误。', 'Last 150 events (newest first). Click a row to open its waveform and equations in the event view; red rows are silent errors.')), logHost);
      logHost.addEventListener('click', (ev) => { const tr = ev.target.closest('tr[data-k]'); if (!tr) return; st.selK = +tr.dataset.k; st.follow = false; st.tab = 'event'; showTab(); });
      function drawLog() {
        const head = ['#', 'C_cap/q_cap', 'cand', 'κ_C/κ_N', 'J_plan/J_obs', 'fine_raw', 'VALID/SAT', '故障|faults', 'phase_source', '重建相位|phase', '真值|truth', '误差|error'];
        const th = head.map((h) => { const [zh, en] = h.split('|'); return `<th>${en ? Book.bi(zh, en) : zh}</th>`; }).join('');
        const rows = sim.ring.slice(-150).reverse().map((f) => {
          const bad = f.phase != null && !f.ok;
          const fl = f.faults.map((x) => x).concat(f.natTear ? ['tear'] : []).join(',') || '—';
          const vs = f.fine_raw == null ? '—' : (f.fine_valid ? 'V' : 'X') + (f.sat_hi ? '/SAT↑' : f.sat_lo ? '/SAT↓' : '');
          return `<tr data-k="${f.k}" style="cursor:pointer${bad ? ';background:color-mix(in srgb, var(--critical) 14%, transparent)' : ''}"><td>${f.k}</td><td>${f.C_cap}/${f.q_cap}</td><td>${f.candidate_id}${f.conv !== f.candidate_id ? '≠' + f.conv : ''}</td><td>${f.kappa_C}/${f.kappa_N}</td><td>${f.J_plan == null ? '—' : f.J_plan}/${f.J_observed == null ? '—' : f.J_observed}</td><td>${f.fine_raw == null ? '—' : f.fine_raw}</td><td>${vs}</td><td>${fl}</td><td style="color:${SRC_C[f.phase_source]};font-weight:650">${f.phase_source}</td><td>${fmtPh(f.phase)}</td><td>${fmtPh(f.truth)}</td><td style="color:${f.err == null ? 'inherit' : f.ok ? 'var(--good-ink)' : 'var(--critical-ink)'}">${f.err == null ? '—' : (f.err >= 0 ? '+' : '') + f.err.toFixed(4)}</td></tr>`;
        }).join('');
        logHost.innerHTML = `<table class="w-table mono" style="white-space:nowrap"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
      }
      // ---------------------------------------------------------------- timing margins (Eqs. 13–15) and route-C coverage
      function dCmaxStale(P, dCA) { const w = Math.max(0, Math.ceil(dCA + P.tsu - P.dcap) - 1); return Math.ceil(w / P.M); }
      function drawTiming() {
        const P = sim.P, dq = sim.dqA, dC = sim.dCA, rows = [];
        const add = (path, d, s, m, h) => rows.push({ path, d, s, m, h });
        if (P.route === 'A') {
          for (const [g, d] of [['q', dq], ['C', dC]]) add(`R · ${g}`, d, 1 + P.dcap, 1 + P.dcap - d - P.tsu, d - P.dcap - P.th);
          for (const [g, d] of [['q', dq], ['C', dC]]) add(`F · ${g}`, d, 0.5 + P.dcap, 0.5 + P.dcap - d - P.tsu, 0.5 + d - P.dcap - P.th);
        } else if (P.route === 'B') {
          add('B · q', dq, P.dq + P.tsu + P.mB, P.dq + P.mB - dq, 1 + dq - (P.dq + P.tsu + P.mB) - P.th);
          add('B · C', dC, P.dC + P.tsu + P.mB, P.dC + P.mB - dC, 1 + dC - (P.dC + P.tsu + P.mB) - P.th);
        } else {
          add('C · q', dq, 1 + P.dcap, 1 + P.dcap - dq - P.tsu, dq - P.dcap - P.th);
          add('C · C', dC, 1 + P.dcap, 1 + P.dcap - dC - P.tsu, dC - P.dcap - P.th);
        }
        const cell = (v) => `<td style="color:${v > 0 ? 'var(--good-ink)' : 'var(--critical-ink)'};font-weight:650">${v.toFixed(3)}</td>`;
        const ref = P.route === 'B' ? Book.bi('相对 t_E = 目标逻辑沿', 'relative to t_E = target logical edge') : Book.bi('相对被捕获 epoch 的边沿', 'relative to the edge of the captured epoch');
        timingBox.innerHTML = `<div style="font-size:.75rem;color:var(--fg-2);margin:0 0 4px">${Book.bi('采样余量（式 13–15，按标称 T₀ = 1，实际延迟含 PVT 偏差；', 'Sampling margins (Eqs. 13–15, nominal T₀ = 1, actual delays incl. PVT skew; ')}${ref}${Book.bi('）：m 或 h ≤ 0 表示该组可能采到相邻 epoch。', '): m or h ≤ 0 means the group may be captured from an adjacent epoch.')}</div>
          <div class="tbl-wrap" style="margin:0 0 8px"><table class="w-table mono"><thead><tr><th>${Book.bi('候选·组', 'cand.·group')}</th><th>d</th><th>t_S</th><th>m (13)</th><th>h (14)</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.path}</td><td>${r.d.toFixed(3)}</td><td>${r.s.toFixed(3)}</td>${cell(r.m)}${cell(r.h)}</tr>`).join('')}</tbody></table></div>`;
        const n = dCmaxStale(P, dC);
        coverNote.innerHTML = '';
        coverNote.append(W.note(W.h('div', null,
          W.h('b', null, W.L('路线 C 的显式覆盖错误集（本模型）：', 'Explicit covered error set of route C (this model): ')),
          W.L('冗余信息是与 q 同一快域、同一 epoch 捕获的 2 位 wrap 序列 w₂ = ⌊N/M⌋ mod 4。d = (w₂ − C_cap) mod 4：d = 0 → κ_C = 0；d = 1 → κ_C = +1（高位滞后一组）；d = 3 → κ_C = −1；d = 2 → ΔC = ±2 有歧义 → INVALID；ΔC ≡ 0 (mod 4)（如 ±4）会别名、无法发现，必须由时序上界排除。κ_N（原周期单位）在此捕获模型中没有对应错误类，恒为 0。关闭“按组单位修正”后，同样的 d 被错误地当作 ±1 原周期（κ_N），留下 ±M∓1 的错误。',
            'The redundant information is a 2-bit wrap sequence w₂ = ⌊N/M⌋ mod 4 captured in the fast domain with q (same epoch). d = (w₂ − C_cap) mod 4: d = 0 → κ_C = 0; d = 1 → κ_C = +1 (high count one group stale); d = 3 → κ_C = −1; d = 2 → ΔC = ±2 is ambiguous → INVALID; ΔC ≡ 0 (mod 4), e.g. ±4, aliases and is undetectable, so it must be excluded by the timing bound. κ_N (raw-cycle unit) has no error class in this capture model and stays 0. With "block-unit correction" off, the same d is wrongly applied as ±1 raw cycle (κ_N), leaving a ±M∓1 error.'),
          W.h('div', { style: { marginTop: '4px' } }, W.L(`当前时序下高位最多滞后 ΔC_max = ${n} 组（d_C = ${dC.toFixed(2)} T₀，M = ${P.M}）`, `With the current timing the high count can lag by up to ΔC_max = ${n} group(s) (d_C = ${dC.toFixed(2)} T₀, M = ${P.M})`),
            ' → ', n <= 1 ? W.L('在覆盖集内。', 'inside the covered set.') : n < 4 ? W.L('超出 ±1：出现 INVALID。', 'beyond ±1: INVALID events appear.') : W.L('可达 ±4：出现别名静默错误。', 'can reach ±4: aliased silent errors appear.'))), n <= 1 ? 'good' : 'bad'));
      }

      // ---------------------------------------------------------------- simulation control + drawing (≤ once per frame)
      function rebuild() {
        clearTimeout(rebuildTimer); clearTimeout(prefillTimer);
        sim = createSim(st.P); st.selK = null; st.follow = true; animU = 1; shownKey = ''; lastStatsDraw = 0; lastLogDraw = 0;
        runEnd = st.runLen === Infinity ? Infinity : st.runLen;
        drawTiming();
        const PRE = 2000;
        const chunk = () => {
          if (!sim) return;
          const t0 = performance.now();
          while (sim.k < PRE && performance.now() - t0 < 12) sim.step();
          shownKey = ''; requestDraw();
          if (sim.k < PRE) prefillTimer = setTimeout(chunk, 0);
        };
        chunk();
      }
      function tick(dt) {
        if (!sim) return;
        const t0 = performance.now(); let n = 0;
        if (st.speed === 'fast') {
          if (sim.k >= runEnd) runEnd = st.runLen === Infinity ? Infinity : sim.k + st.runLen;
          while (sim.k < runEnd && performance.now() - t0 < 10) for (let i = 0; i < 50 && sim.k < runEnd; i++) { sim.step(); n++; }
          if (sim.k >= runEnd) { loop.stop(); play.sync(); }
          animU = 1;
        } else if (st.speed === 'med') { medAcc += dt * 25; while (medAcc >= 1) { sim.step(); n++; medAcc -= 1; } animU = 1; }
        else { animU += dt / 1.8; if (animU >= 1.25) { sim.step(); n++; animU = 0; } }
        rateN += n; rateT += dt;
        if (rateT > 0.5) { rate = rateN / rateT; rateN = 0; rateT = 0; }
        requestDraw();
      }
      function requestDraw() { if (drawPending) return; drawPending = true; requestAnimationFrame(() => { drawPending = false; draw(); }); }
      let lastWave = '', lastEvDraw = 0;
      function draw() {
        if (!sim) return;
        const S = sim.S, now = performance.now(), n = Math.max(1, S.n), pct = (v) => `${v} (${W.fmt(100 * v / n, 1)}%)`;
        kpi.set('n', S.n.toLocaleString()); kpi.set('fine', pct(S.src.FINE)); kpi.set('coarse', pct(S.src.COARSE)); kpi.set('inv', pct(S.src.INVALID));
        kpi.set('sf', String(S.silentFine)); kpi.set('sc', String(S.silentCoarse));
        kpi.cell('sf').style.color = S.silentFine ? 'var(--critical-ink)' : 'var(--good-ink)';
        kpi.cell('sc').style.color = S.silentCoarse ? 'var(--critical-ink)' : 'var(--good-ink)';
        kpi.set('maxe', S.src.FINE ? `${S.maxFineLsb.toFixed(3)} LSB` : '—');
        const rv = st.speed === 'slow' ? 1 / 2.25 : st.speed === 'med' ? 25 : rate;
        kpi.set('rate', loop.running ? `${rv < 10 ? W.fmt(rv, 2) : Math.round(rv).toLocaleString()} ${api.t('事件/s', 'ev/s')}` : api.t('（暂停）', '(paused)'));
        const P = sim.P;
        status.textContent = api.t(`路线 ${P.route} · M=${P.M} · W=${P.Wbits} bit · FCW=${P.fcw} · LSB=T₀/${P.lsbDen} · TDC 量程 [${P.rlo}, ${P.rhi}] T₀ · 种子 ${P.seed}`, `route ${P.route} · M=${P.M} · W=${P.Wbits} bit · FCW=${P.fcw} · LSB=T₀/${P.lsbDen} · TDC range [${P.rlo}, ${P.rhi}] T₀ · seed ${P.seed}`);
        if (st.tab === 'event') {
          const fr = currentFrame();
          const throttled = loop.running && st.speed === 'fast' && now - lastEvDraw < 150;
          if (fr && !throttled) {
            lastEvDraw = now;
            const animating = st.follow && st.speed === 'slow' && loop.running;
            const u = animating ? Math.min(1, animU) : 1;
            const key = fr.k + '|' + api.lang();
            if (key !== shownKey) { shownKey = key; drawEventInfo(fr); }
            const wk = key + '|' + u.toFixed(3);
            if (wk !== lastWave) { lastWave = wk; drawWave(fr, u); }
          } else if (!fr) W.clear(svgHost);
          navPrev.disabled = !fr || sim.ring.indexOf(fr) <= 0; navNext.disabled = !fr || st.follow;
        }
        if (st.tab === 'stats' && now - lastStatsDraw > (loop.running ? 350 : 0)) { lastStatsDraw = now; drawStats(); }
        if (st.tab === 'log' && now - lastLogDraw > (loop.running ? 600 : 0)) { lastLogDraw = now; drawLog(); }
      }
      let lastW = 0;
      const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { const w = root.clientWidth; if (Math.abs(w - lastW) > 4) { lastW = w; lastWave = ''; lastStatsDraw = 0; requestDraw(); } }) : null;
      if (ro) ro.observe(root);
      api.onLang(() => { shownKey = ''; lastWave = ''; lastStatsDraw = 0; lastLogDraw = 0; drawTiming(); requestDraw(); });
      showTab();
      rebuild();
      if (!api.reducedMotion) { loop.start(); play.sync(); }
      return { destroy() { if (ro) ro.disconnect(); loop.stop(); clearTimeout(prefillTimer); clearTimeout(rebuildTimer); sim = null; } };
    },
  });
})();
