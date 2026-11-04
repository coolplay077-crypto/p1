---
title: "CNT-based ADPLL: Integer-Phase Preservation, Coherent Snapshots and Short-Range TDC"
subtitle: "A Multi-Round Research Synthesis Report on CKV/4, CKV/8, Shared State and Physical Edge Selection"
author: "Technical Research Report"
date: "Consolidated Review Edition V1.0 · 2026-10-03"
lang: en
---

**Positioning of this report:** an organization of the literature evidence, a definition of the core problem, a unified phase model and a verification framework. It is not a circuit freeze that has completed transistor-level verification, nor is it a patent-novelty conclusion.

**Materials covered:** the two existing research reports of 2026-09-27 and 2026-09-28, the TI / ETRI / Sony and other leads newly added in the current conversation, and the public original texts that could be obtained in this round. The historical reports have been read; verbatim transcripts of all historical conversations were not obtained, so this document does not serve as an archive of the original questions and answers.

**Reading route:** Chapters 1–3 explain the problem and the coordinates; Chapters 4–5 present the literature evidence and its boundaries; Chapters 6–10 develop timing, physical edge selection and interfaces; Chapters 11–13 record revisions, verification and open items; Chapter 14 and the appendices provide citation entry points and the locations of the original figures.

# 1. Core Problem and Summary of Conclusions

## 1.1 Formal Statement of the Core Problem

> In a CNT / VPA / phase-domain ADPLL, can the high bits of a wide integer phase counter be lowered to operate at CKV/4 or CKV/8 while the raw CKV cycle index is fully preserved; and can the low-bit state, the reference-related snapshot and the selected true physical edge then be associated with one another, so that a finite-range TDC measures only the local time residual, and so that a complete phase observation that is coordinate-consistent and whose validity can be judged is still obtained under counter carries, asynchronous sampling, edge-selection switching and TDC saturation?

There are two interrelated tasks here that must not be conflated. The first is the **measurement chain**: continuously recording the cycles the oscillator has actually traversed, and forming a joint coarse/fine timestamp near the reference event. The second is the **execution chain**: how low-speed parallel state or predicted commands generate a designated physical edge on the high-speed side. P/S, one-hot, shift-state machines and multiphase selectors are only candidate implementations of the execution chain; they do not imply that the whole measurement problem has been solved.

This project is further concerned with whether the low-bit count state can, directly or through a deterministic mapping, double as the control information for the physical-edge identity / selector. The goal is not to find yet another ordinary fractional divider, but to preserve the continuous integer phase observation of the CNT-based ADPLL.

## 1.2 What the Existing Evidence Is Sufficient to Support

**A wide counter can be split and rate-reduced.** TI's /8 embodiment, Xu/Lindfors's /4 phase accumulator and ETRI's /4 counter all provide direct structural grounds. What is rate-reduced is the high-bit arithmetic and part of the post-sampling processing; the low-bit state of the raw cycles does not have to be discarded. [R01–R04]

**Integer and fractional measurements require an explicit consistency mechanism.** Dual-candidate retiming, delay-matched readout, redundant phase state and integer-cycle correction all have public grounds. Havens and Sony in particular show that fractional/multiphase state is used not only for the fine phase but can also be used, in the reverse direction, to check the coarse epoch. [R01][R05][R07][R08][R10][R11]

**Physical edge selection and a short-range TDC can be used in a phase-domain ADPLL.** Kuo 2018, MediaTek's phase-selection patent and Zong 2019's DTC/TDC chain each provide a different implementation. But "shortening the true time interval at the TDC input" and "digitally subtracting whole cycles" are not the same thing. [R06][R09][R11]

## 1.3 Three Points That Must Be Corrected in This Round

First, one cannot generically write $8C+q+e/8+\epsilon$. Here $q$ may already contain the whole-cycle position expressed by $e$; and the unit of $e/8$ may also be the **divided-clock period** rather than the raw CKV cycle. The clock node, the phase origin and the dimensions (units) must be unified first.

Second, not all epoch mismatches can be reduced to ±1 raw cycle. For $N=MC+q$, when torn sampling of the high and low bits occurs at a group boundary, the two typical errors are $-M$ and $+M$, respectively, relative to the corresponding legal state. A /8 high-bit error of one group and a raw-CKV error of one cycle are different faults.

Third, Sony is not the starting point of the evidence for "no shared-state method existed before". The Havens patent already contains integer counting, fractional detection, a sub-fractional TDC, and processing that uses the fractional state to eliminate the one-count uncertainty. Sony's contribution should be positioned as another explicit, compact implementation of shared state and correction, not as the earliest precedent that this search has proven. [R07][R08]

## 1.4 Boundaries of the Current Conclusions

No public implementation that is strictly isomorphic (structurally identical) to the following complete combination has been verified so far: **/8 high-bit counting of raw CKV + a 3-bit raw-cycle residue + that state directly controlling physical edge selection + short TDC + a complete epoch/validity interface**. Stronger engineering extensions further include MASH future-edge planning, a true execution-side receipt, and coarse takeover after fine saturation.

"Not verified" describes only the current evidence set and cannot be extrapolated to "there is no prior art". Likewise, being able to assemble local mechanisms from different publications into a plausible architecture does not mean that the timing, causality and analog errors of the combination have been verified.

# 2. Research Scope and Requirements Freeze

## 2.1 Goals That Must Be Maintained

| ID | Requirement | Acceptance semantics |
|---|---|---|
| G1 | Continuous integer phase observation | The CNT records the actual CKV cycles, rather than recording the command state only when a target is hit |
| G2 | High-bit rate reduction | The wide high bits are allowed to operate in the /4 or /8 domain; a small number of low-bit states may keep running at high speed |
| G3 | Raw cycle index not lost | The phase model is traceable to the selected raw CKV node, rather than retaining only slow-clock edges |
| G4 | Coarse/fine observations consistent | Coarse and fine correspond to the same physical anchor, or carry an explicit, verifiable coordinate transformation |
| G5 | True fine range under control | The target is about one raw CKV cycle or less; it must be checked against the true input interval |
| G6 | Boundaries and faults identifiable | Wrap, sampling mismatch, invalid codes, saturation, missing edges and duplicate edges must not silently become valid phase |
| G7 | P/S does not replace the CNT | P/S or the slot executor is responsible for physical edge execution and does not remove the reference-related coarse measurement |

The above requirements inherit the goals of the two previous reports; this round only clarifies their semantics and does not change the goal into a study of ordinary dividers. [H01][H02]

## 2.2 Boundaries of the Literature Screening

Priority is given to ADPLLs/DPLLs in which the oscillator-cycle count / variable phase genuinely participates in the main phase measurement. High-speed counters, retimers and selected-edge TDCs can each constitute local evidence, but the interfaces they do not cover must be noted.

Generic serializers, ordinary fractional dividers and phase-switching dividers can serve as circuit references for gating, retiming or glitch-free phase selection, but they cannot be deemed isomorphic to the target merely because they involve "/4", "multiphase" or "P/S". [R18]

## 2.3 Evidence Levels and Review Status

| Mark | Meaning | Usage rule in this report |
|---|---|---|
| A-P | The original patent text and the relevant structure/description were checked in this round | Proves that a certain method was disclosed; does not imply silicon measurement |
| A-J | The original paper text and its key figures were checked in this round | Structures explicitly given in the paper may serve as direct evidence; not extrapolated to this project's PVT |
| B | Official metadata/abstract can be checked; the internal circuitry has not been sufficiently verified | Kept only as a related lead; invisible connections are not filled in |
| H | A previous-round report preserved the conclusion; the complete original evidence was not re-obtained in this round | The historical contribution is retained, explicitly without being conflated with direct review in this round |
| D | A derivation, example or candidate engineering specification of this report | Not a formula from an original text, and not a completed circuit verification |

The evidence level evaluates the **strength of support and the scope of what was read**, not a quality ranking of the papers or patents themselves. H also does not mean that the content is necessarily wrong; it only means that the reviewable chain in this round is incomplete.

# 3. Unified Clock Nodes and Phase Coordinates

## 3.1 CKV, DCO and Prescaler Outputs Cannot Be Substituted for One Another Across Publications by Name Alone

Different sources name CKV differently. The CKV in the Bogdan baseline, the multiphase CKV in the Kuo paper and the pre-divided CKV in the Zong paper should not automatically be regarded as oscillator nodes at the same level. Zong's system diagram explicitly contains a CKV obtained by passing the roughly 20 GHz fundamental through /4 and /2 before it enters the phase detector; the regrouping inside its counter is a separate issue. [R11]

This report uniformly calls **the clock node whose cycle index is to be fully preserved** $CK_0$, with period $T_0$ and frequency $f_0$. It may be the LC DCO itself, or a prescaled node that has been explicitly chosen by the engineering design. Whenever $CK_0$ is changed, all CNT weights, the FCW, the fine normalization and the edge IDs must be converted together.

| Symbol | Definition | Unit/range |
|---|---|---|
| $CK_0,T_0,f_0$ | The target raw counting clock and its period and frequency | s, Hz |
| $M$ | Grouping ratio between the high and low counts | This report mainly uses 4 or 8 |
| $C$ | High-bit group count, value after origin/delay alignment | One count represents $M$ cycles of $CK_0$ |
| $q$ | In-group raw-cycle residue | $0,\ldots,M-1$; not a TDC fractional code |
| $N$ | Integer raw-cycle index | $N=MC+q$ |
| $J$ | Absolute index of a specific actual raw rising edge | Raw cycles |
| $\alpha$ | Intra-cycle offset of the selected edge relative to that rising edge | Raw cycles; added only when this degree of freedom exists independently |
| $\mu$ | Signed phase interval from the reference to the selected edge | Raw cycles |
| $T_d$ | Period of the grouped slow clock | $T_d=MT_0$, ideal fixed ratio |
| $a$ | Region label within one multiphase period | The clock node and the mapping table must be given separately |

## 3.2 The Integer Decomposition Is a Definition, Not a Proof of CDC Correctness

For aligned, logically consistent states, define:

$$
N=MC+q,\qquad C=\operatorname{floor}(N/M),\quad q=N\bmod M. \tag{1}
$$

A legal continuous count must satisfy:

$$
(C,M-1)\longrightarrow(C+1,0). \tag{2}
$$

Eq. (1) of course holds for correct states, but it cannot be used to prove that "independently sampling C and q at an arbitrary moment and concatenating them is always correct". The latter is a question of the circuit's synchronization, delay matching, encoding and boundary correction.

In addition, for ordinary binary, the rising edge of $q[2]$ corresponds to the low three bits going 3→4, while its falling edge corresponds to 7→0. Therefore, after "using the MSB of q as the /8 clock", one must still check the trigger polarity of the high bits, the reset origin and the pipeline delay. One cannot assume, merely from the signal name CKVD8, that one of its active edges is equal to the carry of Eq. (2).

## 3.3 General Expression of the Complete Phase

Taking the continuously unwrapped raw-clock phase $\Phi_0(t)$ as the definition, the coordinate of the physical edge actually selected is written as:

$$
A_k=J_k+\alpha_k. \tag{3}
$$

The exact phase interval from the reference event $t_{R,k}$ to that edge $t_{E,k}$ is:

$$
\mu_k=\int_{t_{R,k}}^{t_{E,k}} f_0(t)\,dt. \tag{4}
$$

Hence:

$$
\Phi_0(t_{R,k})=A_k-\mu_k. \tag{5}
$$

Here the sign of $\mu$ is determined by the limits of integration; the same formula applies whether the preceding edge or the following edge is selected, and an undefined "±TDC" is no longer used to mask the convention.

Only if the frequency is approximately constant within a local interval do we have:

$$
\widehat{\mu}_k\approx\frac{\widehat{\Delta t}_k}{\widehat T_0[k]}. \tag{6}
$$

Under fast frequency modulation, strong transients, or intervals spanning multiple cycles, the error of Eq. (6) relative to Eq. (4) should be evaluated. If the frequency-estimate error within the interval is bounded by $\delta f_{max}$, there is a simple upper bound $|\delta\mu|\leq\delta f_{max}|\Delta t|$. This is also why an overly long selected-edge interval should not rely solely on fixed-period normalization.

## 3.4 Why q and Octal Cannot Simply Be Added Together

Consider an example with an **ideal /4, eight phases uniformly distributed, and phase origins aligned**. If $a=0\ldots7$ is the eight-phase region within one divided-clock period, then:

$$
\Phi_d=C_d+\frac{a}{8}+\epsilon_d.
$$

Converted to raw cycles:

$$
\Phi_0=4\Phi_d=4C_d+\frac{a}{2}+4\epsilon_d. \tag{7}
$$

Further letting $q=\operatorname{floor}(a/2)$ and $p=a\bmod2$, we obtain:

$$
\Phi_0=4C_d+q+\frac{p}{2}+\epsilon_0,\qquad\epsilon_0=4\epsilon_d. \tag{8}
$$

At this point a already contains the information of q; adding $q+a/8$ on top of it mixes units and may count the same information twice. Eqs. (7)–(8) are a dimensional derivation, not a code-by-code replica of the decoder truth table of any original paper. A real circuit must also handle phase ordering, edge polarity, DCC and origin offsets.

# 4. Literature Evidence: Explaining the Value and Boundaries of Each Item

## 4.1 TI: /8 High/Low Decomposition and SEL_EDGE Candidate Selection

**Source:** US20050195917A1, *Method and apparatus for crystal drift compensation*, Staszewski / Leipold; same family as WO2005086759A2. The core lies in Fig.4; the title alone is not enough. [R01]

The original text gives the CKV-driven mod-8 low bits `RV<2:0>`, the CKVD8-driven high bits `RV<8:3>`, and two sets of retiming / low-bit sampling candidates obtained by sampling FREF on the CKV rising edge and on the CKV falling edge, respectively; `SEL_EDGE` participates in the candidate selection. CKVD8 also takes on part of the delay processing.

**Evidence value:** It directly proves that a small amount of high-speed low-bit state and rate-reduced high bits can together form a VPA, and that the fine-side edge decision can participate in selecting the coarse path.

**Boundary:** It cannot be interpreted as "first making the fine TDC input uniformly 8T0, and then letting the snapshot automatically compress it into T0", nor does it directly disclose this project's P/S absolute-edge executor. The high-bit polarity and the pipeline origin should be checked path by path against Fig.4, and must not be mechanically concatenated.

## 4.2 Xu / Lindfors: /4 Fast State, Sampled First and Then Encoded

**Source:** the ISCAS 2008 paper and WO2009053531A1, *Phase accumulator for digital phase locked loop*. [R02][R03]

The patent's example uses a low-speed modulo incrementer for the upper six bits and a high-speed shift state. The low-bit information is recovered by a 4-to-2 encoder after sampling by CKR; some embodiments also use the least significant bit of the high counter in the decoding. The related structures/truth tables are in Fig.6–7.

**Evidence value:** "The raw-cycle residue must be preserved" does not imply "a high-speed binary low-bit adder must be used". The high-speed side can hold a state that is easy to implement, and the low-speed side can decode it afterwards.

**Boundary:** State encoding does not exempt the design from epoch consistency. This source alone cannot prove that the same low-bit state already controls the physical edge selection of a short TDC, nor can all encoder inputs be assumed to form an ordinary, independently synchronized bus.

## 4.3 ETRI: A Direct Example of a /4 Carry and Continuous Counting

**Source:** US20130156147A1, *High speed counter apparatus*. [R04]

This embodiment uses the low two-bit state to form a carry-related CKVD4, which drives the high bits; it describes the relationship between the low bits' 11→00 transition and the high-bit carry, and the combination yields a continuous 8-bit count.

**Evidence value:** It can be used to check the count lineage required by Eqs. (1)–(2): the slow count must not be driven by just any /4 clock of the same frequency; it must be logically tied to the low-bit wrap.

**Boundary:** That continuous counting holds does not mean that the reference-related snapshot is already safe; this source is also not a proof of a shared short TDC, a selected edge, or complete phase reconstruction.

## 4.4 CN105071798: Matching the Sampling Delay to the Count Propagation

**Source:** CN105071798A, *Low-power phase accumulator applied to an all-digital PLL* (original title: 应用于全数字PLL的低功耗相位累加器), focusing on Fig.4–6. [R05]

This scheme reduces counting power by using asynchronous low bits and synchronous high bits, spreads out the CKR sampling instants according to the propagation delay of each stage, and then resamples everything into a unified output. Its method addresses the fact that "the bits do not settle simultaneously"; it does not require all bits to be physically latched at the same instant.

**Evidence value:** The essence of a coherent snapshot is the same logical epoch, not that all registers use a zero-skew clock.

**Boundary:** The final unified output does not automatically prove that setup/hold is met at every intermediate stage. The min/max delays of both the data paths and the sampling paths, the same-source errors and the PVT differences must all be verified together; the delay chain cannot be treated as an ideal constant.

## 4.5 Kuo 2018: Eight-Phase Selection and a Short TDC, but the Units Must Be Converted Correctly

**Source:** F.-W. Kuo et al., TCAS-I 2018; Fig.2 and Fig.5–6 are the key figures. [R06]

This ADPLL forms an eight-phase CKV from the /4 output of the DCO, combined with predictive phase selection, a short TDC and multi-candidate reference retiming. The Octal information works together with the fine TDC, while the variable phase has a separate integer sampling path. The experimental section of the paper gives a DCO tuning range of 5.7–8.4 GHz; after /4 this corresponds to 1.425–2.1 GHz.

**Must be corrected:** The "about 2 GHz" node in the paper must not be miswritten as "the raw DCO is about 2 GHz and is then divided by 4". The $T_V/8$ of the eight-phase regions is referenced to the paper's CKV period; if converted to the period $T_0$ before the preceding /4, the ideal spacing is $T_0/2$, not $T_0/8$.

**Boundary:** This implementation is an intra-cycle multiphase selection and cannot, without a mapping, be equated with a raw-CKV 3-bit /8 integer residue or with a whole-cycle slot executor.

## 4.6 Havens: Shared State and Sub-fractional Detection Earlier Than Sony

**Source:** US8692598B2, *Digital phase locked loop*, J. H. Havens; focusing on Fig.2–4. [R08]

Its feedback counter contains integer, fractional and sub-fractional TDC parts at the same time. The integer value is composed of the high bits `cnt[7:1]` and the divider state `ckh[0]`; the multiphase half-rate state is sampled for the fractional detector, and the even/odd information is retained in order to handle the one-count uncertainty introduced by the synchronizer.

**Evidence value:** Shared state, integer-boundary checking and finer TDC measurement did not first appear with Sony. It also shows that the coverage of the redundant state must match the possible epoch errors.

**Boundary:** The half-rate / parity structure here cannot directly replace a /8 block-epoch check. Its sub-fractional implementation is also not, without modification, equivalent to Kuo's single short TDC after predictive phase selection.

## 4.7 Sony: Explicit Reuse of Integer/Divider State and Two XOR Corrections

**Source:** US11936392B2, *Phase locked loop, electronic device, and method for controlling phase locked loop*, Kurihara / Fujiwara; Fig.6, Fig.11–12. [R07]

`CNTO[0]` together with the high bits of the slow accumulator forms the integer code; `CNTO[3:0]` is in addition sampled directly by REFCLK as VFRAC. VINT, by contrast, is sampled after reference retiming. Based on the state difference between the two paths, the original text generates:

$$
CRRCT=VINT[0]\oplus VFRAC[0],\qquad SIGN=VFRAC[0]\oplus VFRAC[3]. \tag{9}
$$

| CRRCT | SIGN | Correction sent to the phase comparator in the original embodiment |
|---|---|---|
| 0 | Any | 0 |
| 1 | 0 | −1 |
| 1 | 1 | +1 |

**Boundary:** This embodiment uses multiphase latch/correction in place of the conventional TDC of the comparative example; one cannot say it has already been connected to this project's short TDC. VFRAC is a state code carrying cycle-level redundancy; the values in Fig.12 extend up to 1.75, so it is not an ordinary pure-fraction binary code. The "1" of the correction amount must be interpreted in its original phase unit. [R07]

One cannot infer from Eq. (9) that unique recovery is guaranteed for arbitrary asynchronous errors. Some individual statements about retiming nodes/bit order in the original patent text also need to be cross-checked against Fig.6, 8, 11 and 12; this document does not directly transcribe the global phase formula found on the web page into RTL.

## 4.8 MediaTek and Marvell: Coordinate Offset and Independent Boundary Checking

**US8593182B2:** a raw-CKV VPA coexists with a TDC path on the shifted CKV′, and an additional PHF2 is used to compensate the phase-selection coordinate; the original text gives $PHE=PHR+PHF1+PHF2-PHV$, and there is a related single-pulse embodiment. It supports "preserving the original CNT while explicitly compensating the selected edge offset". However, the whole-cycle absolute-edge executor is a further synthesis made by this project, not a function that this formula accomplishes automatically. [R09]

**US9306586B2:** uses RF counter/TDC skew correction together with independent boundary-estimation information to judge whether the fractional code should be close to 0 or close to 1, thereby correcting whole-cycle mismatch. It suggests that the fine code should not be made to bear all of the range, boundary and self-trustworthiness judgments at once; the ambiguous region of the estimator itself must also be constrained. [R10]

## 4.9 Zong 2019: Split Counter, Matched Readout and DTC/TDC in the Same Real Chip

**Source:** Z. Zong, P. Chen, R. B. Staszewski, JSSC 2019; Fig.1, Fig.9–10. [R11]

The 8-bit PHV_I uses two asynchronous low bits and six synchronous high bits. In Fig.9, CKS_0/1/2 match the count propagation along the sampling chain; the text states that, under the matching condition, sampling takes place about half a CKV cycle after the count bits have settled. The system also adopts a DTC-assisted TDC, which detects overflow/underflow and uses a clamped output during transients.

**Evidence value:** This is direct paper evidence that a split counter, explicit sampling timing and a finite-range TDC coexist within the same ADPLL.

**Boundary:** The CKV in Fig.1 is already a node obtained by passing the roughly 20 GHz fundamental through /8, so the low two bits in Fig.9 cannot be equated with "the low two bits of every cycle of the 20 GHz fundamental". Its saturation-clamping strategy also cannot be equated with "the fine value remains exact under saturation", nor with a coarse-only fallback already verified for this project.

## 4.10 Historical Leads Must Be Retained, but Their Review Level Is Not Raised

| Source | Previous-round contribution | Status in this round |
|---|---|---|
| Bogdan / Balsara 2006 original book | raw CKV TDC, PHF_I, SEL_EDGE, CKVD8 time-deferred PHV | H; the old report was read in this round, but the corresponding pages of the original book were not re-obtained [R13] |
| Jiang 2011 MSc | mod-8, cooperation between retimer and incrementor, integer correction | H; recorded in the existing reports, but the original PDF link could not be read reliably in this round [R12] |
| Yin 2013 PhD | Counter/PTDC interface, boundary alternative-edge consistency | H; the pointer to Ch.4 §4.3.5 is retained, but it was not re-checked figure by figure [R14] |
| Staszewski JSSC 2011 | Phase selection across whole-cycle boundaries and integer-count handling | H; the phase-selection transition 270°→0° is not directly equated with a raw /4 count-group carry [R15] |
| S. Liu JSSC 2016 | Implementations related to hybrid high-speed counters | H; not a precedent for the complete executor considered here [R16] |
| H. Liu JSSC 2025 | Directions related to the counter, feedback clock generation and timing margin | B; the official source can be located, but the specific /4 wiring is not taken as a verified conclusion [R17] |
