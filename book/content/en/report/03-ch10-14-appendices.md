# 10. Implementation-Oriented Event Interface and Invariants

## 10.1 Proposed EventFrame

The following is an interface proposal, not published RTL.

| Field group | Proposed fields | Key points of the definition |
|---|---|---|
| Event identity | `event_id, ref_kind, reset_epoch` | Distinguishes the current reference event, the dual-edge category and the reset generation |
| Count coordinates | `clock_node_id, M, C_cap, q_cap` | States explicitly which clock node is being counted; mixing quantities without units is forbidden |
| Capture source | `candidate_id, capture_epoch, wrap_tag` | Identifies the candidate and the group-boundary-crossing state; keeping only the numeric value is not enough |
| Plan/execution | `J_plan, J_observed, edge_polarity` | The actual receipt is independent of the command; the polarity affects the origin of the fine phase |
| Correction | `kappa_C, kappa_N, alpha_sel` | In group units, in raw-cycle units, and the intra-cycle offset, respectively |
| Fine | `fine_raw, fine_valid, sat_hi, sat_lo` | The code value and its trustworthiness are kept separate; saturation is not the same as an exact residual |
| Calibration | `tdc_gain_epoch, period_epoch, path_epoch` | The fine and coarse weights must use mutually compatible calibrations |
| Exceptions | `late, miss, duplicate, encoding_invalid` | Execution errors must not be masked by an ordinary phase code |
| Output | `phase_source, phase_value, uncertainty` | fine/coarse/invalid, plus an explicit error bound or interval |

Neither the original `{C,q,TDC}` nor the later four-tuple that added edge/correction is sufficient to fully express the execution, units and validity described above. The interface need not implement every field as a wide bus, but its semantics must have a hardware counterpart.

## 10.2 Invariants That Must Be Maintained

| No. | Invariant | Handling upon violation |
|---|---|---|
| I1 | The actual CK0 cycles are continuous, and the origin of $N=MC+q$ is consistent with the carry | Block the valid phase; check the reset/polarity/counter implementation |
| I2 | Coarse and fine share the same anchor, or the anchor transformation is explicitly recorded | Correct, or INVALID; never add them silently |
| I3 | The units of the correction and the set of errors it can cover are explicit | Mark invalid when out of bounds; do not truncate to ±1 |
| I4 | J_observed reflects the real execution and is not self-certified by J_plan | Mark the receipt as unverified; it does not enter fine_valid |
| I5 | The fine range, code legality and calibration are all satisfied | Downgrade to coarse / an interval / invalid |
| I6 | The two boundary candidates are equivalent in a common coordinate | Inconsistency is treated as a coarse/fine stitching error |
| I7 | The low-speed computation meets the edge-selection deadline | late/miss, or re-plan and update J |
| I8 | Full-counter rollover uses an explicit modular-arithmetic window | Reset/reacquire when beyond the range that can be unwrapped |

For a W-bit total count, when a modular difference is converted into a signed difference, it must be guaranteed that the expected difference and the sampling interval fall within a window that can be uniquely unwrapped; the typical condition is that the magnitude is less than $2^{W-1}$. This is a joint constraint on the count width and the observation interval; it does not hold automatically just because a sign bit is added.

## 10.3 Pseudo-code for Phase Consolidation

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

This pseudo-code deliberately does not specify the gain or the integral action of the coarse controller, because measurement validity and controller fault recovery are not the same problem. The control layer must have separate, verifiable state handling for `COARSE/INVALID`.

# 11. Record of Revisions to and Retentions of Previous Rounds' Conclusions

| Previous-round statement or tendency | Treatment in this report | Reason |
|---|---|---|
| “/8 makes the fine TDC necessarily see 8 raw cycles, which the snapshot then folds back” | Does not hold; must be checked node by node | Counter rate reduction, pre-division of the TDC input and physical edge selection are three different things [R01][R06][R11] |
| “Sony was the first to have the same state take part in both the integer and the fractional part” | Tightened to “another direct implementation” | Havens already had a shared half-rate state, fractional correction and a sub-fractional TDC [R08] |
| “Uniformly adopt κ=−1/0/+1” | Changed to a correction with units and with a fault set | Raw-cycle and block-cycle differ; high/low-bit tearing can be wrong by ±M |
| “$8C+q+e/8+\epsilon$ can serve as a general phase formula” | Generality withdrawn; anchor minus residual used instead | q and e may redundantly represent the same phase interval; the clock units of e/8 were not unified |
| “Kuo's raw DCO is about 2 GHz, then /4” | Clock hierarchy corrected | Its DCO range is 5.7–8.4 GHz; about 2 GHz is the order of magnitude after /4 [R06] |
| “Zong's /4 split preserves all cycles of the raw 20 GHz” | This conclusion is not drawn | The counter reference in Fig.9 is the CKV after the upstream /8 [R11] |
| “Coherence must equal simultaneous latching” | The logical-coherence definition is retained | Matched-delay readout can obtain the same logical epoch at different instants [R05][R11] |
| “Every boundary must recover the unique physical edge” | Changed to “a consistent candidate, or invalid” | Different anchors can represent the same reference phase; an absolute guarantee must not be claimed in the face of device metastability risk |
| “Digital integer cancellation is enough to delete the CNT” | States explicitly that this cannot be inferred | The CNT remains the real coarse observation, the receipt check and the measurement basis when fine is invalid |
| “A generic PISO is a direct precedent for the CNT-ADPLL” | The previous round's downgrade is maintained | It only proves the executor primitive, not that the coarse/fine phase chain is complete [R18] |

This consolidation does not erase the previous rounds' results: the main lines — the /4-/8 split, the persistent CNT, boundary correction, the short TDC, the selected-edge coordinate, SAT/VALID and the execution receipt — are all retained. What is revised is the scope of the evidence, the units, the timing assumptions, and the conclusions that cannot be directly generalized.

# 12. Checks Performed in This Round and the Follow-up Verification Plan

## 12.1 Performed: Six Groups of Logical/Dimensional Checks

In this round, the following checks were executed using exact rational arithmetic in Python. They serve to find errors at the formula and interface level; they do not cover RTL timing, metastability models, closed-loop noise, AMS or PVT.

| Check | Scope | Cases | Result |
|---|---|---:|---|
| L01 Count decomposition | M=4/8; N=0…4095 | 8192 | Passed |
| L02 Group-boundary tearing | M=4/8; 64 groups; two tearing modes | 128 case sets | Confirmed: ±M relative to the corresponding legal anchor |
| L03 Low-bit blind spot | M=4/8; 256 values of N | 512 | Confirmed that +M changes neither the residue nor the raw parity |
| L04 Clock-unit conversion | 32 groups, 8 phases, 3 signed residuals | 768 | The divided-clock phase and raw phase expressions agree |
| L05 Anchor equivalence | 64 values of J, 4 values of μ | 256 | $J-\mu=(J+1)-(\mu+1)$ |
| L06 Irreversibility of saturation | Four pairs of different inputs | 4 | Outputs can be identical; the input cannot be inferred back from a saturated code |

In total, **9860 well-defined logical cases**. This count is not “9860 circuit simulations”; each L02 case checks two torn results internally, and the table follows the script's definition of a case count. The source code and the JSON results are included in the consolidation package.

## 12.2 Layer 1: Event-Level Golden Model

The model must drive the persistent CNT from the raw, true edge times, and then separately model sampling, execution and the finite-range TDC. It is forbidden to feed the ideal $\Phi_0(t_R)$ directly to the decoder, or to use it to generate a VALID that the circuit could not obtain.

Recommended coverage: all residues for /4 and /8; group-boundary crossing and full-width rollover; rising/falling candidate switching; different propagation delays for the high and low bits; the positive and negative fine range and saturation; late-arriving selection codes; missing edges, duplicate edges and adjacent pulses; different reset phases; fixed path delays and calibration-version mismatches.

The acceptance output is not just a check that the PLL locks; instead, `J_observed`, the coarse anchor and the final phase are compared with the ground truth event by event, and statistics are collected on whether each class of fault can be identified or correctly compensated.

## 12.3 Layer 2: RTL/Gate-Level Timing Verification

The key items to check are carry polarity, shift-state decode, candidate-tuple selection, snapshot lifetime, the synchronization latency of asynchronous inputs, load/shift ownership, short pulses, gating latches and root-clock retiming. Explicit STA/CDC constraints should be given for each class of asynchronous path, rather than simply declaring them all false paths.

The minimum output should include, for each event: the raw edge index, the raw C/q codes, the candidate ID, the boundary tag, the correction amount and its units, J_plan/J_observed, fine_raw, VALID/SAT, the final phase and the actual delay. When an error is found, it should be possible to trace it back to the physical edge with the same index, rather than only to a timestamped log line.

## 12.4 Layer 3: Transistor/PVT Verification

This layer must fill in what a digital model cannot prove: metastability resolution time, metastability propagation in the validity/selection logic itself, illegal Johnson/Gray codes, delay-matching mismatch, duty cycle, the supply sensitivity of the paths, mux/gate glitches, narrow pulses, the TDC saturation decision, and disturbances to the receipt circuit.

This report has not run the above verification, nor does it give any fabricated worst-case PVT margin. The parameterized constraints of Chapter 7 should be converted into min/max tables for the actual circuit, rather than filling in a seemingly definitive ps value before the process/load has been chosen.

## 12.5 Closed-Loop Verification Cannot Replace Local Correctness

Periodic epoch errors may show up as spurs, and occasional wrong-group errors may show up as long-tail jitter or cycle slips. The fact that the PLL can pull itself back into lock does not mean that the detector is correct. The order should therefore be: correct event identity → complete validity → local timing passes → only then compare closed-loop noise, spurs, lock time and recovery time.

The following must be recorded: the peak and distribution of the phase error, the fine min/max/histogram, the SAT ratio, the distribution of correction triggers, the run lengths of consecutive invalid observations, the number of edge mismatches, and phase discontinuities at mode switches. All spectral tests must also state the sampling rate, the coherent window, the length and the normalization units.

# 13. Core Problems Not Yet Closed and the Next-Step Research List

## 13.1 The Real Gap in the Current Literature

The basic intersection is still: **a /4 or /8 split counter on an explicitly identified raw clock node, whose low residue is directly linked to the selected physical edge, with a short TDC measuring the residual near that edge, and with an explicitly specified epoch/validity mechanism for the same observation.**

Public sources already support the constituent links separately, and some of them cover several of these links. What is still missing is closing all of the connections, encodings and timing simultaneously in a single verifiable implementation; the gap cannot be filled by appealing to “common industry practice”.

## 13.2 Five Engineering Questions That Must Be Answered First

| Question | Concrete deliverable that must be produced | Completion criterion |
|---|---|---|
| Q1: Which node exactly serves as the raw cycle? | Clock-node table with all ratios/phase origins | CNT, FCW, TDC, DTC and edge ID in the same units |
| Q2: How are C and q related at the boundary? | Truth table covering all residues, wraps and candidate switches | Every permitted state corresponds to a legal anchor or INVALID |
| Q3: How do the low bits control the real edge selection? | raw-state→slot→physical-edge mapping and deadline | No past edge can be generated; late/miss behaviour is deterministic |
| Q4: Who proves the actual edge index? | J_observed circuit and an independent check path | After injection of plan errors/missing edges, it does not self-certify as passing |
| Q5: When can the short TDC be trusted? | Physical range budget, SAT/VALID, calibration/downgrade specification | Saturated codes are not used as an exact fine value; coarse remains interpretable |

## 13.3 Order of Convergence for the Research

First, complete the carry, polarity and decoding relationships of TI / Xu / ETRI; then migrate the redundant state of Havens/Sony into a /4-/8 epoch table **with an explicit error set**. Third, check whether the physical phase selection used by Kuo/MediaTek satisfies this project's execution causality, rather than merely noting that it likewise contains a MUX. Finally, attach extensions such as MASH, DTC/QNC and REF X2, while retaining regression against the original baseline.

Jiang, Yin and the original Bogdan book remain historical leads whose original pages are worth retrieving; the internal counter/feedback-generator figures of H. Liu 2025 are another priority item for supplementary evidence. These tasks constitute the follow-up research list of this report and do not mean that automatic background execution has already been arranged.

## 13.4 On How to State the Points of Difference

“The low-bit state serves both the integer and the fractional part” has in itself already been publicly disclosed in related work, so this sentence alone cannot be used to summarize a potential difference. The more specific objects of study should be: the mapping of the raw-cycle residue, the receipt for the actual edge selection, the two-level block/raw-cycle correction, and the validity and recovery protocol of the finite-range TDC.

Whether this constitutes a protectable difference still requires an item-by-item comparison against patent claims, embodiments and more complete prior art; this report only provides technical evidence and gaps, and does not give any conclusion on novelty, infringement or patentability.

# 14. References and Original-Source Entry Points

The following links are provided for reviewing the original texts. For the meanings of A-P/A-J/B/H, see Section 2.3. Members of the same patent family are not counted again as independent technical precedents; this report does not regard its search list as an exhaustive search.

**[R01] TI / Staszewski–Leipold.** *Method and apparatus for crystal drift compensation*. US20050195917A1, published 2005-09-08; family member WO2005086759A2. **A-P**. Focus: Fig.4, mod-8, the RV high/low bits, CKVD8 and SEL_EDGE. Original text: [US publication text](https://patents.google.com/patent/US20050195917A1/en); [WO family text](https://patents.google.com/patent/WO2005086759A2/en).

**[R02] L. Xu, S. Lindfors.** *Phase accumulator for digital phase locked loop*. WO2009053531A1. **A-P**. Focus: Fig.6–7, the upper six bits at /4, the shift state, and the encoder after sampling. Original text: [patent text](https://patents.google.com/patent/WO2009053531A1/en).

**[R03] L. Xu, S. Lindfors.** “A High-Speed Variable Phase Accumulator for an ADPLL Architecture.” *IEEE ISCAS*, 2008, pp. 1736–1739. DOI: **10.1109/ISCAS.2008.4541773**. **B (paper metadata; internal details are supported by the checked original text of R02)**. Entry points: [DOI](https://doi.org/10.1109/ISCAS.2008.4541773); [Aalto publication record](https://research.aalto.fi/en/publications/a-high-speed-variable-phase-accumulator-for-an-adpll-architecture/).

**[R04] ETRI.** *High speed counter apparatus*. US20130156147A1. **A-P**. Focus: the lower two bits, CKVD4, the 11→00 carry and combined counting. Original text: [patent text](https://patents.google.com/patent/US20130156147A1/en).

**[R05]** *应用于全数字PLL的低功耗相位累加器* (Low-power phase accumulator for an all-digital PLL). CN105071798A. **A-P**. Focus: Fig.4–6, the staged CKR delays, the sampling of each group and the final resampling. Original text: [Chinese patent text](https://patents.google.com/patent/CN105071798A/zh).

**[R06] F.-W. Kuo et al.** “An All-Digital PLL for Cellular Mobile Phones in 28-nm CMOS With −55 dBc Fractional and −91 dBc Reference Spurs.” *IEEE Transactions on Circuits and Systems I*, 65(11), 2018, pp. 3756–3768. DOI: **10.1109/TCSI.2018.2855972**. **A-J**. Focus: Fig.2, 5–6, the DCO/CKV nodes, and the tuning range given in the experimental section. Entry points: [DOI](https://doi.org/10.1109/TCSI.2018.2855972); [TU Delft record](https://repository.tudelft.nl/record/uuid:bd6e56fd-2ea1-4a7f-8dbe-0154ce63742d); [author-institution PDF](https://pure.tudelft.nl/ws/portalfiles/portal/47074026/46622583_08438325.pdf).

**[R07] T. Kurihara, T. Fujiwara; Sony Semiconductor Solutions.** *Phase locked loop, electronic device, and method for controlling phase locked loop*. US11936392B2, grant text dated 2024-03-19; US publication text US20220231694A1, 2022-07-21; family member WO2020246092A1, 2020-12-10; priority 2019-06-06. **A-P**. Focus: Fig.6, 8, 11, 12, CNTO, VINT, VFRAC, CRRCT/SIGN. Entry points: [US grant text](https://patents.google.com/patent/US11936392B2); [WO family member](https://patents.google.com/patent/WO2020246092A1/en). Note that “published in 2022” applies only to the listed US publication text; it is not the earliest publication date of the whole family.

**[R08] J. H. Havens; LSI.** *Digital phase locked loop*. US8692598B2. **A-P**. Focus: Fig.2–4, integer / fractional / sub-fractional, the half-rate state, even/odd and the one-count uncertainty. Original text: [patent text](https://patents.google.com/patent/US8692598B2/en).

**[R09] A.-S. Lin, R. B. Staszewski, Y.-H. Cho; MediaTek.** *Frequency synthesizer and associated method*. US8593182B2. **A-P**. Focus: PHV / PHF1 / PHF2, the phase shifter, the phase selector and the single-pulse embodiment. Original text: [patent text](https://patents.google.com/patent/US8593182B2/en).

**[R10]** *Methods and devices for implementing all-digital phase locked loop*. US9306586B2. **A-P**. Focus: RF-counter/TDC skew, the independent estimator E, and the embodiments around Fig.20–25. Original text: [patent text](https://patents.google.com/patent/US9306586B2/en).

**[R11] Z. Zong, P. Chen, R. B. Staszewski.** “A Low-Noise Fractional-N Digital Frequency Synthesizer With Implicit Frequency Tripling for mm-Wave Applications.” *IEEE JSSC*, 54(3), 2019, pp. 755–767. DOI: **10.1109/JSSC.2018.2883397**. **A-J**. Focus: Fig.1, 9–10, the CKV node, the 2+6 counter, CKS sampling, DTC/TDC. Entry points: [DOI](https://doi.org/10.1109/JSSC.2018.2883397); [TU Delft original-text record](https://repository.tudelft.nl/record/uuid:556432e9-11a7-47f2-9019-18e7ccc9f1fd).

**[R12] W. Jiang.** *ADPLL Design for WiMAX*. MSc thesis, Delft University of Technology, 2011. **H**. The previous round located Chapter 2, the TDC / Retimer / Incrementor cooperation, Fig.2-12 to 2-20. Historical entry point: [PDF on the author's supervisor's site](https://bogdanst.com/dissertation/2011-09-18_Wenlong_Jiang_MSc_ADPLL.pdf). In this round, reading this link was unreliable, so it is not used as evidence of having been “reviewed figure by figure in this round”.

**[R13] R. B. Staszewski, P. T. Balsara.** *All-Digital Frequency Synthesizer in Deep-Submicron CMOS*. Wiley, 2006. **H**. The previous round used the user's PDF of the original book, locating Ch.4 §4.5, §4.7.4, Fig.4.14, 4.17, 4.26, 4.27. The pages of the original book were not re-obtained in this round; no accessible full-text download address is fabricated.

**[R14] J. Yin.** *A DC–48 GHz CMOS All-Digital Frequency Synthesizer for Software-Defined Radios*. PhD thesis, HKUST, 2013. **H**. The previous round located Ch.4 §4.3.5 “Counter and PTDC Interface”, Fig.4.6–4.11. No unverified direct-download URL is added in this round.

**[R15] R. B. Staszewski et al.** “Spur-Free Multirate All-Digital PLL for Mobile Phones in 65 nm CMOS.” *IEEE JSSC*, 46(12), 2011, pp. 2904–2919. DOI: **10.1109/JSSC.2011.2162769**. **H**. The previous round focused on the quadrature phase switching and the integer boundary in Fig.20–22. Entry point: [DOI](https://doi.org/10.1109/JSSC.2011.2162769).

**[R16] S. Liu.** “A Fractional-N Counter-Assisted DPLL With Parallel Sampling ILFD.” *IEEE JSSC*, 51(6), 2016. DOI: **10.1109/JSSC.2016.2557810**. **H**. The previous round's hybrid high-speed counter lead is retained; it is not treated as a precedent for this project's complete architecture. Entry point: [DOI](https://doi.org/10.1109/JSSC.2016.2557810).

**[R17] H. Liu et al.** “An Ultra-Low-Jitter Fast-Hopping Fractional-N PLL With LC DTC and Hybrid-Proportional Paths.” *IEEE JSSC*, 60(3), 2025, pp. 785–798. DOI: **10.1109/JSSC.2024.3514870**. **B**. The counter / feedback-clock generator / timing-margin direction is retained; the specific /4 connection has not been upgraded to A. Entry points: [DOI](https://doi.org/10.1109/JSSC.2024.3514870); [IEEE SSCS introduction](https://sscs.ieee.org/an-ultra-low-jitter-fast-hopping-fractional-n-pll-with-lc-dtc-and-hybrid-proportional-paths/).

**[R18]** *Frequency divider with retimed control signal and related frequency dividing method*. US8653862B2. **H / peripheral implementation reference**. Phase-local retiming / glitch-free switching; not a direct precedent for CNT + reference snapshot + fine TDC. Entry point: [patent text](https://patents.google.com/patent/US8653862B2/en).

**[R19]** *Digital phase locked loop with integer channel mitigation*. US8050375B2. **H / supplementary historical lead**. The previous round associated it with phase rotation and integer-part handling; it is not used as a new hard conclusion in this round. Entry point: [patent text](https://patents.google.com/patent/US8050375B2/en).

# Appendix A. Index for Locating Original Figures and Waveforms

This report gives locations that lead back to the original texts; it does not pass off illustrative derivations as original figures. The PDF page numbers below refer to the downloaded versions that include the institutional cover page; the original figure numbers take precedence over PDF page counts.

| Source | Figure/location | Connections or waveforms to be checked |
|---|---|---|
| TI [R01] | Fig.4; US PDF page 9, Sheet 8 | mod-8, RV<2:0>, RV<8:3>, CKVD8, dual candidates and SEL_EDGE |
| Xu [R02] | Fig.6–7 | Shift taps, the boundary before and after sampling, the dependency from the high-bit LSB to the encoder |
| ETRI [R04] | Description of the lower-two-bit and CKVD4 embodiment | Correspondence among 11→00, the active CKVD4 edge and the high-bit carry |
| CN [R05] | Fig.4–6 | Data propagation, the delays of each CKR stage, the final unified output |
| Kuo [R06] | Fig.2; institutional PDF page 3 | Multirate structure, variable phase, CKR candidates and predictive selection |
| Kuo [R06] | Fig.5–6; institutional PDF page 5 | Eight phases after /4, the relationship from the parallel short TDCs to the shared short TDC |
| Havens [R08] | Fig.2–4 | ckh, the cnt high bits, raw state, even/odd and the sub-fractional handling |
| Sony [R07] | Fig.6; US PDF page 8 | The two paths from the same CNTO to integer and fractional |
| Sony [R07] | Fig.11–12; US PDF pages 11–12 | XOR, bit order, the extended VFRAC state, the direction of correction |
| Zong [R11] | Fig.1; institutional PDF page 3 | Fundamental → /4 → /2 → CKV, to avoid misidentifying the clock node |
| Zong [R11] | Fig.9–10; institutional PDF page 9 | Stage-by-stage waveforms of CKS_0/1/2 and c[0]/c[1]/c[2:7] |
| MediaTek [R09] | Phase shifter and single-pulse embodiment | Coordinates of the selected CKV′, PHF2 and the TDC |
| Marvell [R10] | Around Fig.20–25 | RF count / fractional skew and independent boundary estimation |

# Appendix B. Inheritance from Historical Reports and Content Correspondence

**[H01]** `CNT_based_ADPLL_CKV4_P_S_文献调研与架构收敛报告_2026-09-27`: in this round the full 22-page Word body text was read; the Markdown file of the same name is a brief summary. Inherited: the persistent CNT, the selected-edge offset, the distinction between J_plan and J_exec, the relationship between fine SAT and the raw count, and the conclusion downgrading the generic PISO.

**[H02]** `CNT_ADPLL_CKD4_Snapshot_Literature_Research_Report_2026-09-28`, Research Log v0.4; in this round the Markdown was read in full. Inherited: the research leads on Xu /4, Zong delay-matched sampling, Jiang cooperation, and coarse/fine stitching.

The historical reports are a source of this project's progress, not independent evidence of circuit reality. The key hard conclusions of this round go back preferentially to the reviewed original patents/papers among [R01]–[R11]; the remaining leads keep their H/B status.

**Document completeness:** The Word and Markdown body texts come from the same source. The consolidation package additionally includes `verify_invariants.py` and `logical_check_results.json` for recomputing Section 12.1; it does not include third-party paper full texts, font files, transistor netlists or unfinished RTL.
