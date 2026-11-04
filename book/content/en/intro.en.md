# CNT-based ADPLL Engineering Introduction

**Full project title:** An all-digital phase-locked loop (ADPLL) based on a persistent integer phase counter (CNT) — integer-phase preservation, coherent snapshots, and a short-range TDC

**Document nature:** Engineering Introduction. It is written for engineers, reviewers and collaborators who are new to the project, and summarizes the project goals, core problems, architecture, key constraints, current progress and next steps. All content is drawn from the research package "CNT_ADPLL Research Synthesis and Core Problems Report" (consolidated review edition V1.0, 2026-10-03) and its accompanying logical-check script.

**Project stage:** Literature evidence consolidation, problem definition, the unified phase model and the verification framework are complete; the project has not yet reached RTL freeze, transistor-level verification, or any patent novelty conclusion.

---

## 1. One-Sentence Positioning

In a CNT / VPA / phase-domain ADPLL, run the high bits of the wide integer phase counter at CKV/4 or CKV/8 rate **without losing the index of any raw CKV cycle**; then associate the low-bit state, the reference-related snapshot and the physical edge that is actually selected, so that a finite-range TDC only has to measure the local time residue, and a complete phase observation with consistent coordinates and a judgeable validity is still obtained under boundary scenarios such as counter carry, asynchronous sampling, edge-selection switching and TDC saturation.

## 2. Background and Motivation

A traditional ADPLL (the Staszewski/Bogdan baseline) uses a full-rate variable phase accumulator to record the integer cycles the DCO has traversed, and a TDC to measure the fractional phase from the reference edge to the DCO edge. As the DCO frequency moves into the range of several GHz to 20 GHz, the power, timing and routing pressure of a wide counter running at full rate keeps rising. The industry already has several "high-bit rate reduction" approaches (/4 and /8 split counting) and several "physical phase selection + short TDC" approaches.

What this project sets out to solve is not any single one of these, but to **connect** the two classes of mechanism and to guarantee that the interface is self-consistent under all boundary conditions. The survey found that the public literature supports each local piece separately, but no implementation strictly isomorphic to the following complete combination has been verified:

> /8 high-bit counting of the raw CKV + 3-bit raw-cycle residue + that state directly controlling physical edge selection + short TDC + a complete epoch/validity interface

"Not verified" describes only the current evidence set; it is not the same as "there is no prior art", and it does not imply that the timing and causality of the stitched-together design have been verified.

## 3. Two Chains: Measurement Chain and Execution Chain

The project contains two related tasks that must not be conflated:

| Chain | Responsibility | Candidate implementations |
|---|---|---|
| **Measurement chain** | Continuously record the cycles the oscillator has actually traversed, and form a joint coarse and fine timestamp near the reference event | Split counter + coherent snapshot + short TDC |
| **Execution chain** | How a low-rate parallel state or a predicted command generates a specified physical edge on the high-speed side | P/S (parallel-to-serial), one-hot, shift state machine, multiphase selector |

An executor such as P/S is only a candidate implementation of the execution chain and **cannot replace the measurement function of the CNT**. The project is also concerned with whether the low-bit counting state can, directly or through a deterministic mapping, double as the control information for the physical-edge identity / selector.

## 4. Engineering Goals (Requirements Freeze)

| ID | Requirement | Acceptance semantics |
|---|---|---|
| G1 | Continuous integer-phase observation | The CNT records the actual CKV cycles, rather than recording the command state only when a target is hit |
| G2 | High-bit rate reduction | The wide high bits may run in the /4 or /8 domain, while a few low-bit states may keep running at high speed |
| G3 | Raw-cycle index not lost | The phase model can be traced back to the selected raw CKV node, rather than retaining only slow-clock edges |
| G4 | Coarse and fine observations consistent | Coarse and fine refer to the same physical anchor, or carry an explicit, verifiable coordinate transformation |
| G5 | Real fine range under control | The target is about one raw CKV cycle or less; it must be checked against the real input interval |
| G6 | Boundaries and faults identifiable | Wrap, sampling mismatch, invalid codes, saturation, dropped edges and duplicated edges must not silently turn into a valid phase |
| G7 | P/S does not replace CNT | The P/S or slot executor is responsible for physical edge execution and does not remove the reference-related coarse measurement |

## 5. Unified Phase Coordinates and Terminology

### 5.1 First define "which clock is being counted"

The CKV in different publications is not a node at the same level (the CKV of the Bogdan baseline, the multiphase CKV of Kuo, and the CKV of Zong after /4·/2 prescaling are all different). This project uniformly denotes **the clock node whose cycle index is to be fully preserved** as $CK_0$, with period $T_0$ and frequency $f_0$. After $CK_0$ is changed, the CNT weights, FCW, fine normalization and edge IDs must all be converted.

| Symbol | Definition | Unit / range |
|---|---|---|
| $CK_0, T_0, f_0$ | Target raw counting clock and its period and frequency | s, Hz |
| $M$ | High/low counting group ratio | 4 or 8 |
| $C$ | High-bit group count (aligned) | One count = $M$ $CK_0$ cycles |
| $q$ | In-group raw-cycle residue | $0 \ldots M-1$; **not** the TDC fractional code |
| $N$ | Raw-cycle integer index | $N = MC + q$ |
| $J$ | Absolute index of an actual raw rising edge | Raw cycles |
| $\alpha$ | Intra-cycle offset of the selected edge relative to that rising edge | Raw cycles |
| $\mu$ | Signed phase interval from the reference to the selected edge | Raw cycles |
| $T_d$ | Period of the grouped slow clock | $T_d = M T_0$ |

### 5.2 Core formulas

**Integer decomposition (a definition, not a proof of CDC correctness):**

$$N = MC + q,\qquad (C, M-1) \rightarrow (C+1, 0)$$

**Complete phase expression (anchor minus residual):**

$$A_k = J_k + \alpha_k,\qquad \Phi_0(t_{R,k}) = A_k - \mu_k,\qquad \mu_k = \int_{t_{R,k}}^{t_{E,k}} f_0(t)\,dt$$

The sign of $\mu$ is determined by the integration limits, and the preceding edge and the following edge share the same formula. Only when the local frequency is approximately constant may one normalize with $\hat\mu \approx \widehat{\Delta t} / \hat T_0$; an overly long selected-edge interval should not be normalized by a fixed period alone.

### 5.3 Three statements that have been corrected

1. **One cannot write $8C + q + e/8 + \epsilon$ generically.** $q$ and the multiphase region code $e$ may represent the same phase interval redundantly, and the unit of $e/8$ may be the divided-clock period rather than the raw cycle. This is replaced by "anchor minus residual".
2. **Not all epoch mismatches can be attributed to ±1 raw cycle.** When the high and low bits are sampled torn at a group boundary, the typical errors are $-M$ and $+M$ (one whole group), which is a different fault from a one-cycle error of the raw CKV.
3. **The Sony patent is not the earliest precedent of the shared-state method.** Havens (US8692598B2) already contains integer counting, fractional detection, a sub-fractional TDC, and the use of the fractional state to eliminate one-count uncertainty.

## 6. System Architecture

The figure below is the functional data-flow synthesis given in the report (it is not a redrawing of any original figure):

```text
Actual CK0 → continuous high/low count state → REF-related safe snapshot → coarse anchor
                     │
Plan J_plan → high-bit match + slot control → physical edge selection/gating → actual edge
                                                       │
                                            execution side observes J_observed
                                                       │
REF → local fine measurement ← selected real edge ──────────────────────┘
                     │
             tuple consistency + VALID/SAT + coordinate reconstruction → phase error
```

Module responsibilities:

- **Continuous counter (CNT):** The low $\log_2 M$ bits hold the state at the $CK_0$ rate (which may be binary, Johnson/Gray, shift state, etc.), and the high bits accumulate in the $T_d$ domain. The high-bit clock must be logically derived from the same source as the low-bit wrap, and cannot be an arbitrary same-frequency /M clock.
- **Coherent snapshot:** Captures $\{C, q\}$ and boundary-side information near the reference event. The essence of "coherent" is the same logical epoch; it does not require all bits to be latched at physically the same instant.
- **Executor (P/S / slot executor):** The target edge is $J_{plan} = M H_J + s_J$; the slow domain performs the high-bit match and future planning, and the few high-speed states perform slot enable, pulse formation and root-clock retiming.
- **Execution receipt:** Independently produces $J_{observed}$; it cannot be obtained by delaying $J_{plan}$ by a few cycles and renaming it.
- **Short TDC:** Measures only the local residue between the reference edge and the selected real physical edge, and carries SAT/VALID.
- **Phase integration:** Checks tuple consistency and outputs one of the three states FINE / COARSE / INVALID together with an error bound.

## 7. Four Core Difficulties

### 7.1 Epoch errors must be classified by level

Take $M=8$ and an old state $C=10, q=7$ crossing a group boundary as an example:

| State | $C$ | $q$ | $8C+q$ | Meaning |
|---|---:|---:|---:|---|
| Before crossing | 10 | 7 | 87 | Legal old state |
| After crossing | 11 | 0 | 88 | Legal new state |
| Old high + new low | 10 | 0 | 80 | −8 relative to 88 |
| New high + old low | 11 | 7 | 95 | +8 relative to 87 |

Conclusions:

- The correction interface must separate units: $N_{corr} = M(C_{cap} + \kappa_C) + q_{corr} + \kappa_N$, where $\kappa_C$ is in groups and $\kappa_N$ is in raw cycles; $\kappa_C \in \{-1, 0, +1\}$ holds only when the sampling delay has been proven to span at most one group.
- **Low-bit blind spot:** $(N+M) \bmod M = N \bmod M$ and $(N+M) \bmod 2 = N \bmod 2$. A whole-group error changes neither $q$ nor the raw-cycle parity, so directly reusing the low-bit XOR of Havens/Sony may not detect a high-bit group error; extra state that retains the group-crossing toggle is needed (an independent observation of the high-bit LSB, a wrap toggle, etc.).
- **The boundary admits two coordinates:** $J - \mu = (J+1) - (\mu+1)$. Coarse and fine must be transformed together; one chain must not choose $J+1$ while the other is still relative to $J$.
- Metastability is an analog risk; Gray/Johnson encoding only constrains digital code adjacency and does not eliminate metastability. Acceptance has two layers: the digital model proves there is no silent wrong code; the transistor/PVT model evaluates the residual failure rate.

### 7.2 Three implementation routes for the snapshot

| Route | Idea | Literature basis | Still to be proven independently |
|---|---|---|---|
| A Multi-candidate capture | Rising/falling or multiphase edges generate several retimed candidates, and a safe candidate is chosen by boundary-side information | TI, Kuo, Havens, Marvell | Select stability, atomic tuple selection |
| B Matched-delay sampling | Each counter group is sampled at staggered times according to its propagation delay $[d^{min}, d^{max}]$, then resampled uniformly | CN105071798, Zong Fig.9 | PVT min/max, all groups belong to the same epoch |
| C Bounded mismatch + redundant correction | Allows capture ambiguity of known types, and identifies the correction from redundant state | Havens, Sony | Fault-set coverage, correction units, INVALID on ambiguity |

Timing constraints of Route B:

$$t_{S,i}^{min} \ge t_E + d_i^{max} + t_{su,i},\qquad t_{S,i}^{max} + t_{h,i} \le t_{next,i} + d_{next,i}^{min}$$

The acceptance condition is that every group has margins $m_i > 0, h_i > 0$ and that all groups belong to the same epoch. The three routes can be combined, but after combination the joint state space must be re-checked. It is recommended to take the candidate tuple `{coarse, low_state, boundary_side, fine_anchor_id, candidate_id}` as the unit of atomic selection.

### 7.3 Causality of P/S and physical edge execution

- **A plan is not execution evidence.** A wrong edge, a dropped edge, a duplicated edge and a late gate control may leave the digital plan completely unchanged, so $J_{observed}$ must be produced by the real execution path.
- **An after-the-fact low-rate snapshot cannot generate an edge that has already passed.** After REF arrives, passing through the snapshot, CDC, decoding and low-rate computation before controlling the selector, the nearby CKV edge may already be long gone. Only three kinds of path can close: predict in advance and commit the selection before the target; capture candidates in parallel in a high-speed front end and decode them slowly afterwards; or choose a future edge that can still be executed and accept its range cost.
- **Edge-selection deadline:** $t_{arrive} + t_{setup,exec} + t_{guard} \le t_{target}$. When it is not satisfied, `LATE/MISS` must be raised explicitly, or a different $J$ must be re-planned; any re-issue must change the receipt and the phase coordinate.
- MASH future-edge planning belongs to the extension layer; it only provides the target sequence on top of the interface above and is not part of the basic measurement problem.

### 7.4 Real fine range, saturation and calibration

- The CNT can represent multi-cycle differences, but it **does not change the physical time interval already present at the two inputs of the TDC**. The saturation function $Q(x)$ outputs the same value for $x \ge R$, and subtracting whole cycles digitally afterwards cannot recover the information already compressed. "Digital can do modulo" is not the same as "the analog TDC can be shrunk to one cycle".
- Path delay is handled uniformly as $\widehat{\Delta t} = \hat d_{pin} - (\hat\tau_E - \hat\tau_R)$; a DTC placed in the reference path is counted in $\tau_R$, and in the feedback path in $\tau_E$, and it must not be compensated twice.
- Fine usability condition: $F_{usable} = V_{code} \land V_{range} \land V_{anchor} \land V_{epoch} \land V_{cal}$. `range_ok` must come from a circuit-realizable saturation/overflow check, not from the ideal phase in a simulator.
- When fine is invalid, the coarse phase error $e_c[k] = R[k] - N_R[k]$ can take over. The CNT by itself does not automatically constitute an FLL; only when a frequency-error controller is separately designed can it be called FLL-assisted.
- Numerical example (ideal calculation, not a chip specification): at $f_0 = 8$ GHz, $T_0 = 125$ ps, the period after /4 is 500 ps, and the uniform eight-phase spacing is 62.5 ps. The TDC range must be derived from the actual measurement flow, and one cannot write ±31.25 ps directly just because "there are eight phases".

## 8. Implementation-Oriented Event Interface and Invariants

### 8.1 EventFrame (an interface proposal, not published RTL)

| Field group | Suggested fields | Definition notes |
|---|---|---|
| Event identity | `event_id, ref_kind, reset_epoch` | Distinguishes this reference, the dual-edge category and the reset generation |
| Count coordinate | `clock_node_id, M, C_cap, q_cap` | States explicitly which clock node is counted; unitless mixed connection is forbidden |
| Capture source | `candidate_id, capture_epoch, wrap_tag` | Indicates the candidate and the group-crossing state |
| Plan/execution | `J_plan, J_observed, edge_polarity` | The actual receipt is independent of the command |
| Correction | `kappa_C, kappa_N, alpha_sel` | In group units, raw-cycle units, and intra-cycle offset respectively |
| Fine | `fine_raw, fine_valid, sat_hi, sat_lo` | Code value separated from trustworthiness |
| Calibration | `tdc_gain_epoch, period_epoch, path_epoch` | Fine and coarse weights use compatible calibration versions |
| Exceptions | `late, miss, duplicate, encoding_invalid` | Execution errors must not be masked by an ordinary phase code |
| Output | `phase_source, phase_value, uncertainty` | fine/coarse/invalid and the error bound |

### 8.2 Eight invariants

| ID | Invariant | Handling on violation |
|---|---|---|
| I1 | The actual $CK_0$ cycles are continuous, and the origin of $N = MC + q$ is consistent with the carry | Block the valid phase; check reset/polarity/counter implementation |
| I2 | Coarse and fine share the same anchor, or the anchor transformation is recorded explicitly | Correct, or INVALID; never add silently |
| I3 | The unit of the correction and the set of errors it covers are explicit | Out of bounds sets invalid; do not truncate to ±1 |
| I4 | $J_{observed}$ reflects real execution and is not self-certified by $J_{plan}$ | Mark the receipt unconfirmed; it does not enter fine_valid |
| I5 | Fine range, code legality and calibration are all satisfied | Downgrade to coarse/interval/invalid |
| I6 | The two boundary candidates are equivalent in the common coordinate | An inconsistency is treated as a stitching error |
| I7 | The low-rate computation meets the edge-selection deadline | late/miss, or re-plan and update $J$ |
| I8 | The full-counter rollover uses an explicit modular-arithmetic window | Reset/reacquire when beyond the unwrappable range |

### 8.3 Phase-integration pseudo-code

```text
on complete_event(frame):
    check_clock_node_and_reset_epoch(frame)
    coarse = decode_and_align_coarse(frame)
    observed = verify_physical_edge_identity(frame)

    if coarse.valid and observed.valid and fine_is_usable(frame):
        anchor = observed.J + frame.alpha_sel
        mu = normalize_fine_with_matching_calibration(frame)
        phase = anchor - mu
        return FINE, phase, fine_error_bound

    if coarse.valid:
        return COARSE, coarse.phase_estimate, coarse.error_bound

    return INVALID, no_new_measurement
```

The control layer must have separate, verifiable state handling for COARSE / INVALID; measurement validity and controller fault recovery are not the same problem.

## 9. Literature Basis and Evidence Boundaries

### 9.1 Evidence levels

| Mark | Meaning |
|---|---|
| A-P | The patent text and related structures were checked in this round |
| A-J | The paper text and key figures were checked in this round |
| B | Official metadata/abstract can be checked; the internal circuit is not sufficiently verified |
| H | The previous-round report preserved the conclusion; the complete original evidence was not re-obtained in this round |
| D | Derivation, example or candidate engineering specification of this report |

### 9.2 Cross-literature evidence matrix

| Source | High-bit rate reduction / low-bit state | Coarse-fine consistency mechanism | Physical edge selection / fine measurement | What is still missing for this goal |
|---|---|---|---|---|
| TI US20050195917A1 [R01] | /8 explicit | Dual candidates and SEL_EDGE | TDC-side decision cooperation | P/S execution and the complete event interface |
| Xu/Lindfors WO2009053531A1 [R02] | /4, shift-state decode | Decoding coupled with the high-bit state | Connection to a short TDC not demonstrated | Direct mapping from low bits to physical edge selection |
| ETRI US20130156147A1 [R04] | /4, carry from the same source | Counting continuity | No complete fine chain | REF snapshot and fine stitching |
| CN105071798A [R05] | Asynchronous/synchronous grouping | Delay matching, final resampling | Not a core disclosure | Linkage of edge selection, residue and validity |
| Kuo TCAS-I 2018 [R06] | Eight phases after /4 | Multi-candidate retiming | Predictive phase selection and short TDC | Direct reuse of the raw integer residue |
| Havens US8692598B2 [R08] | Half-rate state doubling as integer LSB | Fractional parity check | Fractional + sub-fractional TDC | /8 block epoch and the target executor |
| Sony US11936392B2 [R07] | CNTO doubling as integer/fractional | Two XORs, 0/±1 correction | Multiphase latch | /8 residue, short TDC, execution receipt |
| MediaTek US8593182B2 [R09] | Persistent VPA | Explicit PHF2 coordinate term | Shifted edge, TDC | Complete protocol for whole-cycle slots |
| Marvell US9306586B2 [R10] | RF counter | Independent skew/boundary decision | TDC and integer boundary correction | Integration of /4-/8 high/low-bit execution |
| Zong JSSC 2019 [R11] | 2+6 split | CKS matched sampling | DTC + finite TDC | Upstream raw-cycle identity and the P/S chain |

Three complementary classes of method: TI/Xu/ETRI show how to preserve the cycle state; CN/Zong/Havens/Sony/Marvell show how to maintain or restore consistency; Kuo/MediaTek show physical phase selection and local fine measurement. The blanks in the table are interface arguments that still need to be completed, not formatting omissions. Entry points for checking, by question: for the /8 split look at TI; for shared state and correction look at Havens/Sony; for short-TDC physical phase selection look at Kuo/MediaTek; for the split-counter sampling waveform look at Zong Fig.9.

### 9.3 A few unit traps that must be remembered

- The DCO range in Kuo 2018 is 5.7–8.4 GHz, and "about 2 GHz" is the node after /4; the eight-phase spacing converted to the $T_0$ before the preceding /4 is $T_0/2$, not $T_0/8$.
- The counter reference of Zong 2019 is the CKV obtained from the roughly 20 GHz fundamental after /8; its low two bits cannot be treated as the low two bits of all 20 GHz cycles.
- For the CKVD8 of TI, one cannot assume merely from the signal name that some active edge of it equals the carry; the rising edge of the ordinary binary $q[2]$ corresponds to 3→4, and the falling edge corresponds to 7→0.

## 10. Current Progress

### 10.1 Executed: six groups of logical/dimensional checks

Executed using exact rational arithmetic in Python, with a total of **9860 well-defined logical cases**, all passed. The script and results are in the repository at `research/verify_invariants.py` and `research/logical_check_results.json`, and a re-run in this repository's environment has confirmed them.

| Check | Scope | Cases | Conclusion |
|---|---|---:|---|
| L01 Count decomposition | M=4/8; N=0…4095 | 8192 | $MC+q=N$ always holds |
| L02 Group-crossing tearing | M=4/8; 64 groups; two tearing modes | 128 | Error relative to the legal anchor is ±M |
| L03 Low-bit blind spot | M=4/8; 256 values of N | 512 | +M changes neither the residue nor the raw parity |
| L04 Clock unit conversion | 32 groups, 8 phases, 3 residuals | 768 | Divided-clock phase and raw phase expressions agree |
| L05 Anchor equivalence | 64 values of J, 4 values of μ | 256 | $J-\mu=(J+1)-(\mu+1)$ |
| L06 Saturation irreversibility | Four pairs of distinct inputs | 4 | A saturated code cannot be inverted to the input |

These checks cover only the formula and interface levels and **do not include** RTL timing, a metastability model, closed-loop noise, AMS or PVT.

### 10.2 Main revisions relative to previous rounds

| Previous-round statement | Treatment in this round |
|---|---|
| "/8 makes the fine TDC necessarily see 8 raw cycles, which the snapshot then compresses back" | Does not hold; counter rate reduction, TDC input prescaling and physical edge selection are three different things |
| "Sony was the first to find the same state participating in both integer and fractional" | Tightened; Havens is a precedent |
| "Uniformly adopt κ = −1/0/+1" | Changed to a correction with units and a fault set |
| "$8C+q+e/8+\epsilon$ can serve as a general phase formula" | Withdrawn; replaced by anchor minus residual |
| "Coherent must equal simultaneous latching" | The logical coherence definition is retained; matched-delay readout can obtain the same epoch at different times |
| "Digital integer cancellation can remove the CNT" | Explicitly not possible; the CNT remains the basis of real coarse observation and receipt verification |
| "A generic PISO is a direct precedent of the CNT-ADPLL" | Downgrade maintained; it can only demonstrate an executor primitive |

The main lines — the /4-/8 split, the persistent CNT, boundary correction, the short TDC, the selected-edge coordinate, SAT/VALID and the execution receipt — are all retained.

## 11. Verification Plan (Three Layers + Closed Loop)

1. **Event-level golden model.** Drive the persistent CNT from raw real edge times, and simulate sampling, execution and the finite TDC separately. Feeding the ideal $\Phi_0(t_R)$ directly to the decoder is forbidden. Coverage: all residues for /4 and /8, group crossing and full-width rollover, rising/falling candidate switching, different propagation delays, positive and negative fine range and saturation, late selection codes, dropped/duplicated edges, reset phase, and calibration-version mismatch. Compare $J_{observed}$, the coarse anchor, the final phase and the ground truth event by event.
2. **RTL/gate-level timing verification.** Focus on: carry polarity, shift-state decode, candidate tuple selection, snapshot lifetime, asynchronous synchronization delay, load/shift ownership, short pulses, gating latches, and root-clock retiming. Give explicit STA/CDC constraints for each class of asynchronous path, rather than simply declaring all of them false paths.
3. **Transistor/PVT verification.** Fill in what the digital model cannot prove: metastability resolution time, metastable propagation of validity/selection, illegal codes, delay-matching mismatch, duty cycle, mux/gate glitches, narrow pulses, the TDC saturation decision, and receipt-circuit perturbation. The parameterized constraints of Section 7.2 are to be turned into min/max tables for the actual circuit.
4. **Closed-loop verification cannot replace local correctness.** The order is: event identity correct → validity complete → local timing passes → only then compare noise, spurs, lock and recovery time. Record the peak and distribution of the phase error, the fine histogram, the SAT fraction, the distribution of correction triggers, the consecutive length of invalid observations, the number of edge mismatches, and the phase discontinuity at mode switches.

## 12. Open Problems and Next Steps

### 12.1 Five engineering questions that must be answered first

| Question | Deliverable that must be produced | Completion criterion |
|---|---|---|
| Q1 Which node is taken as the raw cycle? | Clock-node table and all ratios/phase origins | CNT, FCW, TDC, DTC and edge ID share the same dimension |
| Q2 How are C/q associated at the boundary? | Truth table of all residues, wrap and candidate switching | Every allowed state corresponds to a legal anchor or INVALID |
| Q3 How does the low part control the real edge selection? | raw-state → slot → physical-edge mapping and the deadline | Cannot generate a past edge; late/miss behavior is deterministic |
| Q4 Who proves the actual edge index? | $J_{observed}$ circuit and an independent verification path | Does not self-certify after plan-error/dropped-edge injection |
| Q5 When can the short TDC be trusted? | Physical range budget, SAT/VALID, calibration/downgrade specification | A saturated code is not used as an exact fine value, and coarse remains interpretable |

### 12.2 Convergence order

1. Complete the cross-check of the carry, polarity and decoding relations of TI / Xu / ETRI.
2. Migrate the redundant state of Havens/Sony into a /4-/8 epoch table with explicit error sets.
3. Check whether the physical phase selection of Kuo/MediaTek satisfies this project's execution causality, rather than merely "also having a MUX".
4. Only at the end attach extensions such as MASH, DTC/QNC and REF X2, while retaining a regression against the original baseline.

Historical leads still to be substantiated: Jiang 2011 MSc, Yin 2013 PhD, the corresponding pages of the original Bogdan/Balsara 2006 book, and the internal counter/feedback-generator figures of H. Liu JSSC 2025.

### 12.3 On how the points of difference are stated

"The low-bit state serving both integer and fractional" has already been publicly disclosed and cannot be summarized as a point of difference. The more specific research objects are: the mapping of the raw-cycle residue, the actual edge-selection receipt, two-level block/raw-cycle correction, and the validity and recovery protocol of the finite TDC. Whether this constitutes a protectable difference requires a separate comparison against the claims; this project currently gives no conclusion on novelty, infringement or patentability.

## 13. Related Files in the Repository

| Path | Content |
|---|---|
| `docs/CNT_ADPLL_工程介绍.md` | This document |
| `research/CNT_ADPLL_调研整合与核心问题报告.md` | Full text of the Research Synthesis Report (V1.0, 2026-10-03), including the Chapter 14 references and the Appendix A index of original-figure locations |
| `research/verify_invariants.py` | Script of the six logical checks in Section 10.1 |
| `research/logical_check_results.json` | Script output results |

## 14. Main References

For complete entries, evidence levels, patent families and original-figure page numbers, see Chapter 14 and Appendix A of the Research Synthesis Report.

- [R01] Staszewski, Leipold (TI). *Method and apparatus for crystal drift compensation*. US20050195917A1. A-P.
- [R02] Xu, Lindfors. *Phase accumulator for digital phase locked loop*. WO2009053531A1. A-P.
- [R03] Xu, Lindfors. "A High-Speed Variable Phase Accumulator for an ADPLL Architecture." ISCAS 2008. B.
- [R04] ETRI. *High speed counter apparatus*. US20130156147A1. A-P.
- [R05] *应用于全数字 PLL 的低功耗相位累加器* (a low-power phase accumulator for all-digital PLLs). CN105071798A. A-P.
- [R06] Kuo et al. "An All-Digital PLL for Cellular Mobile Phones in 28-nm CMOS…" IEEE TCAS-I 65(11), 2018. A-J.
- [R07] Kurihara, Fujiwara (Sony). *Phase locked loop, electronic device, and method…* US11936392B2. A-P.
- [R08] Havens (LSI). *Digital phase locked loop*. US8692598B2. A-P.
- [R09] Lin, Staszewski, Cho (MediaTek). *Frequency synthesizer and associated method*. US8593182B2. A-P.
- [R10] *Methods and devices for implementing all-digital phase locked loop*. US9306586B2. A-P.
- [R11] Zong, Chen, Staszewski. "A Low-Noise Fractional-N Digital Frequency Synthesizer With Implicit Frequency Tripling…" IEEE JSSC 54(3), 2019. A-J.
- [R12]–[R19] Jiang 2011, Staszewski/Balsara 2006, Yin 2013, Staszewski JSSC 2011, S. Liu JSSC 2016, H. Liu JSSC 2025, US8653862B2, US8050375B2: H/B-level historical and peripheral leads.
