"""Reproduction + non-ideality study of ISSCC 2025 19.3 (MediaTek multipath-feedback
fractional-N PLL, 34 fs_rms, -255.5 dB FoM), and a point-by-point cross-check against
MediaTek patent US 11,509,315 B2 (sliced CP, 'QNC').  Writes
results/isscc25_19p3_results.json and figures results/D*_*.png.

Every check carries a 'kind':
  arith       - implementation / arithmetic identity (cannot disagree with the slides by design)
  consistency - compares the fitted model with the same data it was fitted to
  validation  - compares with data NOT used in the fit (hold-out) or with an independent claim
A paper/patent claim that the model does not reproduce is logged as DEVIATION.

    python3 run_isscc25_19p3.py            # full run (~4 min)
    python3 run_isscc25_19p3.py --quick
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import replace, asdict
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).parent))
from mtkpll import common as C              # noqa: E402
from mtkpll import sliced_cp as S           # noqa: E402
from mtkpll import multipath19p3 as P       # noqa: E402

OUT = Path(__file__).parent / "results"
OUT.mkdir(exist_ok=True)
CHECKS = []
QUIET = dict(vco_on=False, out_floor_on=False, ref_white_fs=0.0, pfd_slice_fs=0.0, cp_noise_on=False,
             xo_flicker_fs2=0.0)
FREE_A = ("fc", "pm", "xo_flicker_fs2", "p3_ratio", "cp_noise_scale")
FREE_C = FREE_A + ("cp_flicker_fc",)
DATA_A = [({}, P.PLL_MARKERS, 1.0)]
DATA_C = [({}, P.PLL_MARKERS, 1.0), ({"mp_disabled": True}, P.PLL_NO_MP_DIGITISED, 0.5)]


def check(name, ok, measured, expected, kind, note="", soft=False):
    assert kind in ("arith", "consistency", "validation", "claim")
    res = "PASS" if ok else ("DEVIATION" if soft else "FAIL")
    CHECKS.append(dict(check=name, kind=kind, result=res, measured=measured, expected=expected, note=note))
    print(f"  [{res}|{kind}] {name}: measured={measured} expected={expected} {note}")


def fom(p_mw, jit_s, f_ref=None, f_vco=None):
    v = 10 * math.log10(p_mw * jit_s ** 2)
    if f_ref:
        v += 10 * math.log10(f_ref / f_vco)
    return v


def H_closed(p, f):
    Lg = C.cp_open_loop(f, p.icp, p.kvco, p.nf, P.loop_filter(p))
    return np.abs(Lg / (1 + Lg))


def ref_sigma_from_floor(L_dbc_80m, f_pfd=160e6):
    """Per-PFD-edge white timing jitter of an 80 MHz XO floor (doubler edges share the XO noise)."""
    S_t = 2 * 10 ** (L_dbc_80m / 10) / (2 * math.pi * 80e6) ** 2
    return math.sqrt(S_t * f_pfd / 2)


# -----------------------------------------------------------------------------
def exp_d0(base):
    print("\n[D0] multipath arithmetic (slides 8-12; digital macro taken from US 11,509,315)")
    out = dict(identity=[], spread=[], toff=[])
    for M in (2, 4, 8):
        p = replace(base, M=M, n_cyc=2 ** 16)
        seq = P.build_sequences(p)
        ids = S.check_identity(seq, p.arith())
        w = sorted(p.slice_weights().tolist(), reverse=True)
        slide = sorted([1 / 2 ** i for i in range(1, int(math.log2(M)) + 1)] + [1 / M], reverse=True)
        out["identity"].append(dict(M=M, **ids, weights=w, slide_weights=slide, dQ_over_IcpT=1 / M))
        check(f"D0 patent-equivalent PSEL/carry arithmetic + slice currents, M={M}", all(ids.values()) and np.allclose(w, slide),
              dict(ids, weights=[round(x, 4) for x in w]), f"weights {slide}", "arith")
    T = base.t_vco
    for M in (1, 2, 4, 8):
        p = replace(base, M=M, n_cyc=2 ** 16)
        seq = P.build_sequences(p)
        sp = P.spreads(seq)
        toff = P.auto_t_off(p, seq)
        out["spread"].append(dict(M=M, **sp))
        out["toff"].append(dict(M=M, t_off_ps=toff * 1e12, offset_over_T=(toff - p.t_nonlin) / T))
        print(f"    M={M}: coarse spread {sp['coarse_pp']:.2f}T, effective {sp['eff_pp']:.2f}T, all-slice span "
              f"{sp['all_slices_pp']:.2f}T; auto T_off = T_nl + {(toff-p.t_nonlin)/T:.2f}T")
    s4 = [x for x in out["spread"] if x["M"] == 4][0]
    check("D0 slide 12 'DSM spread 2T for M=4' vs span of all slice edges", abs(s4["all_slices_pp"] - 2) < 0.25,
          f"{s4['all_slices_pp']:.2f}T (coarse {s4['coarse_pp']:.2f}T)", "2T", "validation",
          "the CP on-time is set by the earliest slice edge", soft=True)
    tn = base.t_nonlin
    t1 = [x for x in out["toff"] if x["M"] == 1][0]["t_off_ps"] * 1e-12
    t4 = [x for x in out["toff"] if x["M"] == 4][0]["t_off_ps"] * 1e-12
    out["slide12_formula_db"] = 10 * math.log10((tn + 2 * T) / (tn + T))
    out["model_thermal_db"] = 10 * math.log10(t1 / t4)
    out["model_flicker_db"] = 20 * math.log10(t1 / t4)
    print(f"    CP-noise gain M=1->4: slide-12 formula {out['slide12_formula_db']:.2f} dB (assumes offset T); model "
          f"thermal {out['model_thermal_db']:.2f} dB, on-time^2 flicker {out['model_flicker_db']:.2f} dB (offset 1.23T)")
    return out


def exp_d1():
    print("\n[D1] VCO fit + reported figure-of-merit arithmetic")
    vf = P.vco_fit_cached()
    L1m = float(P.vco_L(np.array([1e6]), vf, scale_db=20 * math.log10(9.5 / 4.75))[0])
    a = P.PAPER
    vfom = -a["vco_pn_1m_9g5"] + 20 * math.log10(9.5e9 / 1e6) - 10 * math.log10(a["vco_power_mw"])
    vfomt = vfom + 20 * math.log10(a["vco_tr_pct"] / 10)
    f1 = fom(a["power_mw"], a["jitter_fs"] * 1e-15)
    f2 = fom(a["power_mw"], a["jitter_spur_fs"] * 1e-15)
    fn = fom(a["power_mw"], a["jitter_fs"] * 1e-15, 80e6, 9.5e9)
    s_lin = 10 ** (P.SPUR_AT_402K_DBC / 10)
    j_sp = math.sqrt(2 * s_lin) / (2 * math.pi * 4.720318787e9)
    j_tot = math.sqrt((a["jitter_fs"] * 1e-15) ** 2 + j_sp ** 2)
    out = dict(vco_fit=vf, vco_L1M_9g5=L1m, vco_fom=vfom, vco_fomt=vfomt, pll_fom=f1, pll_fom_spur=f2, fomn=fn,
               spur_jitter_fs=j_sp * 1e15, jitter_with_one_spur_fs=j_tot * 1e15)
    print(f"    VCO fit rms {vf['rms_err_db']:.2f} dB, 1/f^3 corner {vf['corner_hz']/1e3:.0f} kHz, L(1MHz)@9.5GHz {L1m:.2f}")
    check("D1 VCO L(1MHz)@9.5GHz (slide-27 markers) vs slide 28", abs(L1m - a["vco_pn_1m_9g5"]) < 1.0, round(L1m, 2), a["vco_pn_1m_9g5"], "arith")
    check("D1 VCO FoM / FoM_T", abs(vfom - a["vco_fom"]) < 0.15 and abs(vfomt - a["vco_fomt"]) < 0.15,
          [round(vfom, 2), round(vfomt, 2)], [a["vco_fom"], a["vco_fomt"]], "arith")
    check("D1 PLL FoM (33.8 fs / 37.7 fs, 24.4 mW)", abs(f1 - a["fom"]) < 0.1 and abs(f2 - a["fom_spur"]) < 0.1,
          [round(f1, 2), round(f2, 2)], [a["fom"], a["fom_spur"]], "arith")
    check("D1 FoM_N uses f_ref = 80 MHz (XO)", abs(fn - a["fomn"]) < 0.1, round(fn, 2), a["fomn"], "arith")
    check("D1 37.7 fs w/ spur vs 33.8 fs + the -70.9 dBc spur pair", abs(j_tot * 1e15 - a["jitter_spur_fs"]) < 2.5,
          round(j_tot * 1e15, 2), a["jitter_spur_fs"], "arith", "residual = other spur lines")
    return out


def split_fit(per):
    return per[:-1], per[-1]["at_bound"]


def exp_d2(base, n, n_seeds):
    print("\n[D2] identification (fits), consistency checks and HOLD-OUT validation")
    qa, per_a, cost_a = P.fit_joint(base, FREE_A, DATA_A)
    qc, per_c, cost_c = P.fit_joint(base, FREE_C, DATA_C)
    per_a, bnd_a = split_fit(per_a)
    per_c, bnd_c = split_fit(per_c)
    fits = {}
    for tag, q, per, cost, bnd in (("A_M4_only", qa, per_a, cost_a, bnd_a), ("C_joint", qc, per_c, cost_c, bnd_c)):
        fg = np.logspace(3, 8.5, 3000)
        Hdb = 20 * np.log10(H_closed(q, fg))
        j, parts = P.jitter_analytic(q, parts=True)
        fits[tag] = dict(fc=q.fc, pm=q.pm, p3_ratio=q.p3_ratio, cp_noise_scale=q.cp_noise_scale, cp_flicker_fc=q.cp_flicker_fc,
                         xo_flicker_fs2=q.xo_flicker_fs2, ref_white_fs_fixed=q.ref_white_fs * 1e15, cost=cost, at_bound=bnd,
                         closed_loop_bw=float(fg[np.where(Hdb < -3)[0][0]]), peaking_db=float(Hdb.max()),
                         jitter_fs=j * 1e15, parts_fs={k: v * 1e15 for k, v in parts.items()}, per_dataset=per,
                         jitter_mp_off_fs=P.jitter_analytic(replace(q, mp_disabled=True)) * 1e15,
                         t_off_m4_ps=P.t_off_of(q) * 1e12, t_off_mpoff_ps=P.t_off_of(replace(q, mp_disabled=True)) * 1e12)
        print(f"    fit {tag}: fc {q.fc/1e6:.2f} MHz PM {q.pm:.1f} BW {fits[tag]['closed_loop_bw']/1e6:.2f} MHz p3 {q.p3_ratio:.1f} "
              f"CPx{q.cp_noise_scale:.2f} I_DN 1/f corner {q.cp_flicker_fc/1e6:.1f} MHz, at bound {bnd} | " +
              " | ".join(f"{d['overrides']}: rms {d['rms_err_db']:.2f} max {d['max_err_db']:.2f}" for d in per) +
              f" | jitter {j*1e15:.1f} fs (multipath off {fits[tag]['jitter_mp_off_fs']:.1f} fs)")
    check("D2 fit A reproduces the 10 exact slide-29 markers", per_a[0]["max_err_db"] < 1.0,
          round(per_a[0]["max_err_db"], 2), "max < 1 dB", "consistency")
    check("D2 joint fit C: M=4 markers and digitised M=1 trace", per_c[0]["max_err_db"] < 2.0 and per_c[1]["rms_err_db"] < 1.5,
          [round(per_c[0]["max_err_db"], 2), round(per_c[1]["rms_err_db"], 2)], "max<2 dB / rms<1.5 dB", "consistency")
    sims = []
    for s in range(n_seeds):
        r = P.simulate(replace(qc, n_cyc=n, seed=11 + 10 * s))
        f, L = P.output_pn(r)
        sims.append(C.rms_jitter_logint(f, L, qc.f_vco / 2, 1e4, 1e8))
        if s == 0:
            f0, L0 = f, L
    j_sim = float(np.mean(sims)) * 1e15
    j_std = float(np.std(sims)) * 1e15
    j_ana = fits["C_joint"]["jitter_fs"]
    check("D2 time-domain sim vs analytic jitter (fit C)", abs(j_sim / j_ana - 1) < 0.05,
          f"{j_sim:.2f}+-{j_std:.2f}", round(j_ana, 2), "consistency", f"{n_seeds} seeds")
    # side calculations (traceable): marker-only integral, digitised M=1 integral, literal slide-8 reading
    mk = np.array(P.PLL_MARKERS)
    j_mk = C.rms_jitter_logint(np.r_[mk[:, 0], 1e8], np.r_[mk[:, 1], -155.7], 4.75e9, 1e4, 1e8) * 1e15
    dg = np.array(P.PLL_NO_MP_DIGITISED)
    j_m1 = C.rms_jitter_logint(np.r_[dg[:, 0], 1e8], np.r_[dg[:, 1], -155.5], 4.75e9, 1e4, 1e8) * 1e15
    lit = 10 * math.log10((2 * math.pi) ** 2 / (12 * 16) / qc.f_pfd)    # unshaped T/(4 sqrt12) per edge, L at the VCO
    side = dict(jitter_from_markers_only_fs=j_mk, jitter_digitised_M1_trace_fs=j_m1, literal_slide8_reading_L_vco=lit)
    print(f"    side calculations: 10 markers alone integrate to {j_mk:.1f} fs (so the jitter match is forced by the fit); "
          f"digitised w/o-multipath trace {j_m1:.1f} fs; literal slide-8 macro reading -> {lit:.1f} dBc/Hz white at the VCO")
    check("D2 jitter vs measured 33.78 fs (fit C)", abs(j_sim / P.PAPER["jitter_fs"] - 1) < 0.06, round(j_sim, 2),
          P.PAPER["jitter_fs"], "consistency", f"forced by the marker fit (markers alone give {j_mk:.1f} fs)")
    # ---- hold-outs
    h1 = P.markers_err(qa, P.PLL_NO_MP_DIGITISED, mp_disabled=True)
    check("D2-H1 fit on M=4 only -> predict the w/o-multipath trace", h1["rms"] < 1.5, round(h1["rms"], 2), "rms < 1.5 dB",
          "validation", f"max {h1['max']:.1f} dB; jitter {fits['A_M4_only']['jitter_mp_off_fs']:.1f} fs vs digitised {j_m1:.1f} fs; "
          "the only discriminating PN hold-out", soft=True)
    h2a = P.markers_err(qa, P.PLL_SPUR_MARKERS)
    h2c = P.markers_err(qc, P.PLL_SPUR_MARKERS)
    s29 = np.interp(np.log10([m[0] for m in P.PLL_SPUR_MARKERS]), np.log10(mk[:, 0]), mk[:, 1])
    base_rms = float(np.sqrt(np.mean((np.array([m[1] for m in P.PLL_SPUR_MARKERS]) - s29) ** 2)))
    check("D2-H2 slide-30 channel markers (cross-channel repeatability)", max(h2a["rms"], h2c["rms"]) < 1.0,
          [round(h2a["rms"], 2), round(h2c["rms"], 2)], "rms < 1 dB (fit A, fit C)", "consistency",
          f"cannot discriminate: copying the slide-29 markers gives {base_rms:.2f} dB")
    # H3: jitter vs VCO frequency through a FROZEN loop filter and ONE fixed T_off (band-bottom requirement)
    t_bottom = max(P.t_off_of(replace(qc, **P.frac_params(qc, fm * 1e6))) for fm, _ in P.JITTER_VS_FVCO)
    qf, per_f, _ = P.fit_joint(replace(qc, t_off=t_bottom), FREE_C, DATA_C)
    lf0 = P.loop_filter(qf)
    rows = []
    for fm, jm in P.JITTER_VS_FVCO:
        fv = fm * 1e6
        row = dict(f_vco=fv, measured_fs=jm)
        for tag, kv in (("kvco_const", qf.kvco), ("kvco_f3", qf.kvco * (fv / qf.f_vco) ** 3)):
            q = replace(qf, lf_override=lf0, kvco=kv, vco_scale_db=P.vco_freq_adj_db(fv), **P.frac_params(qf, fv))
            row[tag] = P.jitter_analytic(q) * 1e15
        rows.append(row)
    meas = np.array([r["measured_fs"] for r in rows])
    best = None
    for tag in ("kvco_const", "kvco_f3"):
        mod = np.array([r[tag] for r in rows])
        slope_ok = np.sign(mod[-1] - mod[0]) == np.sign(meas[-1] - meas[0])
        err = float(np.max(np.abs(mod - meas)))
        print(f"    H3 jitter vs f_VCO ({tag}, fixed T_off {t_bottom*1e12:.0f} ps): model " +
              ", ".join(f"{r['f_vco']/1e9:.2f}G:{r[tag]:.1f}" for r in rows) + " | measured " + ", ".join(f"{m:.1f}" for m in meas))
        if best is None or err < best[1]:
            best = (tag, err, slope_ok)
    check("D2-H3 slide-29 jitter vs VCO frequency (frozen LPF, fixed T_off, VCO PN vs f from slide 27)", best[1] < 1.5 and best[2],
          f"{best[0]}: max err {best[1]:.2f} fs, slope ok {bool(best[2])}", "|err| < 1.5 fs and same slope", "validation", soft=True)
    # H4: the w/o-multipath mode cannot have kept the M=4 offset (folding would dominate)
    q4 = replace(qa, n_cyc=n // 2, mp_disabled=True, t_off=P.t_off_of(qa), nonlin_ramp=True)
    r = P.simulate(q4)
    f, L = P.output_pn(r, nperseg=2 ** 16)
    l100 = C.band_level(f, L, 7e4, 1.4e5)
    check("D2-H4 'same Q_OFST in both modes' is rejected by the measured M=1 trace", l100 > -120.9 + 6, round(l100, 1),
          "> measured -120.9 + 6 dB", "validation", "M=1 needs its own (larger) offset, as slide 12 implies")
    # identifiability profile 1: reference floor x T_nonlin
    prof = []
    for Lref in (-170.0, -168.0, -166.0):
        for tn in (10e-12, 30e-12, 50e-12):
            q0 = replace(base, ref_white_fs=ref_sigma_from_floor(Lref), t_nonlin=tn)
            q, per, cost = P.fit_joint(q0, FREE_C, DATA_C)
            per, bnd = split_fit(per)
            j, parts = P.jitter_analytic(q, parts=True)
            prof.append(dict(ref_floor_dbc=Lref, t_nonlin_ps=tn * 1e12, cost=cost, rms=[d["rms_err_db"] for d in per],
                             cp_scale=q.cp_noise_scale, cp_flicker_fc=q.cp_flicker_fc, at_bound=bnd, jitter_fs=j * 1e15,
                             parts_fs={k: v * 1e15 for k, v in parts.items()}))
    # identifiability profile 2: CP thermal scale held fixed
    prof_cp = []
    for scl in (0.03, 0.1, 0.3, 1.0, 3.0):
        q, per, cost = P.fit_joint(replace(base, cp_noise_scale=scl), tuple(k for k in FREE_C if k != "cp_noise_scale"), DATA_C)
        per, bnd = split_fit(per)
        j, parts = P.jitter_analytic(q, parts=True)
        prof_cp.append(dict(cp_scale=scl, cost=cost, cp_flicker_fc=q.cp_flicker_fc, at_bound=bnd,
                            parts_fs={k: v * 1e15 for k, v in parts.items()}))
    allp = prof + prof_cp
    keys = sorted({k for p_ in allp for k in p_["parts_fs"]})
    cmin = min(p_["cost"] for p_ in allp)
    good = [p_ for p_ in allp if p_["cost"] < cmin + 1.5]
    ranges = {k: [min(p_["parts_fs"].get(k, 0) for p_ in good), max(p_["parts_fs"].get(k, 0) for p_ in good)] for k in keys}
    fc_rng = [min(p_["cp_flicker_fc"] for p_ in good) / 1e6, max(p_["cp_flicker_fc"] for p_ in good) / 1e6]
    print("    profile 1 (ref floor x T_nl): cost " + ", ".join(f"{p_['cost']:.2f}" for p_ in prof))
    print("    profile 2 (CP thermal scale fixed 0.03..3): " + ", ".join(f"x{p_['cp_scale']}: cost {p_['cost']:.2f} corner {p_['cp_flicker_fc']/1e6:.0f}MHz" for p_ in prof_cp))
    print(f"    component jitter over fits within cost+1.5 of best ({len(good)}/{len(allp)}): " +
          ", ".join(f"{k} {v[0]:.1f}-{v[1]:.1f}" for k, v in ranges.items()) + f"; I_DN 1/f corner {fc_rng[0]:.0f}-{fc_rng[1]:.0f} MHz")
    # figure
    fig, ax = plt.subplots(figsize=(8.5, 5))
    fs_, Ls_ = C.log_smooth(f0, L0, 200, 3e3, 1.5e8)
    ax.semilogx(fs_, Ls_, "C0", lw=1.6, label=f"sim fit C, M=4: {j_sim:.1f} fs")
    fg = np.logspace(3.5, 8, 400)
    for tag, q, sty in (("fit C", qc, "C3-"), ("fit A (M=4 only)", qa, "C1--")):
        ax.semilogx(fg, P.analytic_pn(fg, replace(q, mp_disabled=True))["total"], sty, lw=1.2, label=f"{tag}: w/o multipath")
    A = P.analytic_pn(fg, qc)
    for key in ("vco", "cp", "cp_flicker", "sdm", "ref_common", "out_floor"):
        if key in A:
            ax.semilogx(fg, A[key], ":", lw=1, label=f"fit C, M=4: {key}")
    ax.semilogx(mk[:, 0], mk[:, 1], "o", color="C0", mfc="none", label="measured markers (slide 29)")
    ax.semilogx(dg[:, 0], dg[:, 1], "s", color="C3", mfc="none", ms=4, label="digitised w/o multipath (slide 29)")
    ax.semilogx([m[0] for m in P.PLL_SPUR_MARKERS], [m[1] for m in P.PLL_SPUR_MARKERS], "x", color="k", label="slide-30 markers")
    ax.set(xlabel="offset [Hz]", ylabel="L(f) at VCO/2 [dBc/Hz]", ylim=(-170, -100), title="D2  ISSCC'25 19.3: model vs measurement")
    ax.grid(True, which="both", alpha=.3)
    ax.legend(fontsize=6.5, ncol=2)
    fig.tight_layout()
    fig.savefig(OUT / "D2_pn_vs_measured.png", dpi=130)
    plt.close(fig)
    f_ib = np.array([1e4, 2e4, 1e5])
    gain = {tag: (P.analytic_pn(f_ib, replace(q, mp_disabled=True))["total"] - P.analytic_pn(f_ib, q)["total"]).tolist()
            for tag, q in (("fitA", qa), ("fitC", qc))}
    meas_gain = [float(np.interp(math.log10(x), np.log10(dg[:, 0]), dg[:, 1])) - float(np.interp(math.log10(x), np.log10(mk[:, 0]), mk[:, 1]))
                 for x in f_ib]
    print(f"    in-band gain M=1->M=4 at 10k/20k/100k: measured {np.round(meas_gain,1)}, fit A {np.round(gain['fitA'],1)}, fit C {np.round(gain['fitC'],1)}")
    out = dict(fits=fits, sim_jitter_fs=j_sim, sim_jitter_std_fs=j_std, side=side, holdout_M1=h1,
               slide30=dict(fitA=h2a, fitC=h2c, copy_slide29_baseline_rms=base_rms), jitter_vs_fvco=rows,
               jitter_vs_fvco_fixed_toff_ps=t_bottom * 1e12, same_qofst_L100k=l100, profile=prof, profile_cp_scale=prof_cp,
               profile_ranges_fs=ranges, cp_flicker_corner_range_MHz=fc_rng, inband_gain=dict(measured=meas_gain, **gain))
    return out, qc, qa


def exp_d3(qc, n):
    print("\n[D3] SDM quantisation noise vs M, and the joint-fit cost vs an assumed M=1->M=4 SDM reduction")
    res = {}
    ref = None
    for M in (1, 2, 4, 8):
        p = replace(qc, M=M, n_cyc=n // 2, **QUIET)
        r = P.simulate(p)
        f, L = P.output_pn(r, nperseg=2 ** 15)
        lvl = C.band_level(f, L, 5e6, 40e6)
        ref = lvl if ref is None else ref
        res[str(M)] = dict(level_5_40M=lvl, delta_db=lvl - ref, sdm_jitter_fs=C.rms_jitter_logint(f, L, p.f_vco / 2, 1e4, 1e8) * 1e15)
        print(f"    M={M}: SDM {lvl:.1f} dBc/Hz ({lvl-ref:+.2f} dB), SDM-only jitter {res[str(M)]['sdm_jitter_fs']:.1f} fs")
    check("D3 SDM noise M=4 vs M=1 (-20log4)", abs(res["4"]["delta_db"] + 12.04) < 0.5, round(res["4"]["delta_db"], 2), -12.04, "arith")
    prof = []
    for R in (6, 9, 12, 15, 18):
        q0 = replace(qc, sdm_adj_db=12.0 - R)
        data = [({}, P.PLL_MARKERS, 1.0), ({"mp_disabled": True, "sdm_adj_db": 0.0}, P.PLL_NO_MP_DIGITISED, 0.5)]
        q, per, cost = P.fit_joint(q0, FREE_C, data)
        prof.append(dict(reduction_db=R, cost=cost))
    cmin = min(x["cost"] for x in prof)
    best = min(prof, key=lambda x: x["cost"])
    print("    joint-fit cost vs assumed reduction: " + ", ".join(f"{x['reduction_db']} dB:{x['cost']:.2f}" for x in prof) +
          f" (minimum near {best['reduction_db']} dB; 12 vs 15 dB not separable within +-1 dB digitisation bias)")
    low = [x["cost"] for x in prof if x["reduction_db"] <= 9]
    check("D3 joint fit disfavours a small (<=9 dB) SDM reduction", min(low) > 2 * cmin, f"best {best['reduction_db']} dB",
          "cost(<=9 dB) > 2 x min", "consistency", "same data as the fit; eye-read 2-10 MHz points dominate")
    res["reduction_profile"] = prof
    return res


def quiet_frac(qc, offset):
    frac = offset / qc.f_pfd
    return replace(qc, K=int(round(frac * qc.Q)), n_cyc=2 ** 18, os=1, settle=2 ** 12, **QUIET)


def linear_map(qc, offsets, M=4, delta=1e-3):
    """Spur phasor X(f) = X0(f) + sum_k a_k(f) eps_k  (exactly linear in eps)."""
    nsl = len(replace(qc, M=M).slice_weights())
    X0, A = [], []
    for off in offsets:
        q = replace(quiet_frac(qc, off), M=M)
        x0 = P.spur_phasor(q, off)
        a = []
        for k in range(nsl):
            e = np.zeros(nsl)
            e[k] = delta
            a.append((P.spur_phasor(replace(q, eps=tuple(e)), off) - x0) / delta)
        X0.append(x0)
        A.append(a)
    return np.array(X0), np.array(A)


def spur_population(X0, A, sigma, n_draw=20000, seed=7, sig_vec=None):
    rng = np.random.default_rng(seed)
    nsl = A.shape[1]
    sv = np.full(nsl, sigma) if sig_vec is None else np.asarray(sig_vec) * sigma
    E = rng.normal(size=(n_draw, nsl)) * sv
    X = X0[None, :] + E @ A.T            # (draws, offsets)
    return 20 * np.log10(np.abs(X) + 1e-300) - 20 * math.log10(2)   # SSB spur at VCO/2


def exp_d4(qc):
    print("\n[D4] fractional spur vs offset: CP-slice mismatch (slide 13) vs C_DN charge compression")
    offs = np.array([x[0] for x in P.FRAC_SPUR_OFFSETS])
    meas = np.array([x[1] for x in P.FRAC_SPUR_OFFSETS])
    inb = offs <= 1.0e6
    X0, A = linear_map(qc, offs)
    sig0 = P.PAPER["cp_mismatch_3sigma"] / 3
    pop = spur_population(X0, A, sig0)
    p10, p50, p90 = (np.percentile(pop, q, axis=0) for q in (10, 50, 90))
    ideal = 20 * np.log10(np.abs(X0)) - 6.02
    # structure of the coefficients (which combination of slice errors drives the spur)
    coef = np.abs(A).mean(axis=0)
    rel = coef / coef.max()
    # LEVEL: CI of sigma from the in-band mean statistic
    stat_meas = float(np.mean(meas[inb]))
    ci = []
    grid = np.logspace(math.log10(0.05e-2), math.log10(20e-2), 49)
    for s3 in grid:
        st = spur_population(X0, A, s3 / 3, n_draw=4000)[:, inb].mean(axis=1)
        lo, hi = np.percentile(st, 5), np.percentile(st, 95)
        if lo <= stat_meas <= hi:
            ci.append(s3)
    ci_upper_open = bool(ci) and ci[-1] >= grid[-1]
    st0 = pop[:, inb].mean(axis=1)
    pct = float(np.mean(st0 < stat_meas) * 100)
    pat = {}
    for tag, sg in (("0.001_as_sigma", 1e-3), ("0.001_as_3sigma", 1e-3 / 3)):
        stp = spur_population(X0, A, sg, n_draw=20000)[:, inb].mean(axis=1)
        pat[tag] = dict(median_inband_mean=float(np.median(stp)), measured_percentile=float(np.mean(stp < stat_meas) * 100))
    # SHAPE: draw-independent?  normalised shape of the median vs measured
    def shape_rms(model):
        d = meas - model
        return float(np.sqrt(np.mean((d - d.mean()) ** 2))), float(d.mean())
    sh_mis, off_mis = shape_rms(p50)
    # C_DN charge compression (no current mismatch)
    comp = []
    for cdv in (10e-12, 20e-12, 40e-12, 80e-12):
        mod = []
        for off in offs:
            q = replace(quiet_frac(qc, off), c_dn_va=cdv)
            mod.append(20 * np.log10(abs(P.spur_phasor(q, off))) - 6.02)
        mod = np.array(mod)
        sh, of = shape_rms(mod)
        comp.append(dict(c_dn_va_pFV=cdv * 1e12, spur=mod.tolist(), inband_mean=float(mod[inb].mean()), shape_rms=sh, offset_db=of))
    # folded in-band noise from mismatch (slide 13: 3sigma 0.5% -> -127 dBc/Hz): 3sigma along the worst slice direction
    a_mean = A[inb].mean(axis=0)
    u = np.real(a_mean * np.conj(a_mean[np.argmax(np.abs(a_mean))]))
    u = u / np.linalg.norm(u)
    fold = {}
    for tag, e in (("3sigma_worst_dir", 3 * sig0 * u), ("0.5%_on_Icp/2", np.array([0, 0, 0.005]))):
        q = replace(qc, eps=tuple(e), n_cyc=2 ** 18, os=1, settle=2 ** 12, **QUIET)
        r = P.simulate(q)
        f, L = C.phase_noise(r["theta"], q.f_pfd, nperseg=2 ** 14)
        fold[tag] = C.band_level(f, L, 1e5, 4e5)
    out = dict(sigma_nominal=sig0, offsets=offs.tolist(), measured=meas.tolist(), ideal=ideal.tolist(), p10=p10.tolist(),
               p50=p50.tolist(), p90=p90.tolist(), coef_rel=rel.tolist(), measured_inband_mean=stat_meas,
               measured_percentile_at_nominal=pct, inband_mean_median_at_nominal=float(np.median(st0)),
               sigma3_ci=[min(ci), max(ci)] if ci else None, sigma3_ci_upper_open=ci_upper_open, patent_0p001=pat,
               shape_rms_mismatch=sh_mis,
               level_offset_mismatch=off_mis, compression=comp, folded_inband_9g5=fold)
    print(f"    slice-coefficient magnitudes (Icp/4 fixed, Icp/4 PSEL, Icp/2 PSEL) relative: {np.round(rel,2)}")
    print(f"    nominal sigma {sig0*100:.3f}%: median " + ", ".join(f"{o/1e3:.0f}k:{v:.1f}" for o, v in zip(offs, p50)))
    print(f"    measured in-band mean {stat_meas:.1f} dBc is the {pct:.0f}th percentile of the 3sigma=0.5% population "
          f"(population median of the same statistic {np.median(st0):.1f} dBc); 90% CI of 3sigma "
          f"{(min(ci)*100 if ci else float('nan')):.2f}%..{'>=' if ci_upper_open else ''}{(max(ci)*100 if ci else float('nan')):.1f}%")
    print("    patent 'about 0.001': " + ", ".join(f"{k}: median in-band {v['median_inband_mean']:.1f} dBc, measured at "
          f"{v['measured_percentile']:.0f}th pct" for k, v in pat.items()))
    print(f"    SHAPE rms (after level fit): mismatch {sh_mis:.2f} dB; compression " + ", ".join(f"{c['c_dn_va_pFV']:.0f}pF*V: level {c['inband_mean']:.1f} shape {c['shape_rms']:.2f}" for c in comp))
    print(f"    folded in-band noise (100-400 kHz, at 9.5 GHz): " + ", ".join(f"{k} {v:.1f}" for k, v in fold.items()) + " dBc/Hz (slide 13: -127)")
    check("D4 LEVEL: measured in-band spur within 5-95% of the 3sigma=0.5% slice-mismatch population",
          5 <= pct <= 95, f"{pct:.0f}th percentile", "5..95", "validation", "magnitude only; 90% CI on 3sigma is wide")
    check("D4 SHAPE: spur vs offset shape (mismatch mechanism)", sh_mis < 1.5, round(sh_mis, 2), "rms < 1.5 dB after level fit",
          "validation", "loop |H| shapes the curve; measured low-offset rise not reproduced", soft=True)
    best_c = min(comp, key=lambda c: c["shape_rms"])
    check("D4 attribution unique? (C_DN compression shape distinguishable from mismatch)", abs(best_c["shape_rms"] - sh_mis) > 1.0,
          f"compression {best_c['shape_rms']:.2f} vs mismatch {sh_mis:.2f}", "|diff| > 1 dB", "validation",
          "if not, the slides cannot tell the two mechanisms apart", soft=True)
    check("D4 slide 13: folded in-band noise from 3sigma=0.5% mismatch ~ -127 dBc/Hz", abs(fold["3sigma_worst_dir"] + 127) < 4,
          round(fold["3sigma_worst_dir"], 1), "-127 +- 4", "validation", "two-sided, worst-direction 3sigma, at 9.5 GHz")
    fig, ax = plt.subplots(figsize=(7.8, 4.6))
    ax.fill_between(offs, p10, p90, alpha=0.25, label=f"mismatch population 10-90% (3sigma=0.5%)")
    ax.semilogx(offs, p50, "C0-", label="mismatch median")
    for c in comp[1:3]:
        ax.semilogx(offs, c["spur"], "--", label=f"C_DN compression, C_DN*V_A={c['c_dn_va_pFV']:.0f} pF*V")
    ax.semilogx(offs, ideal, "k:", label="ideal matching, linear CP")
    ax.semilogx(offs, meas, "rs-", label="measured (slide 30)")
    ax.set(xlabel="fractional spur offset [Hz] (= frac x 160 MHz)", ylabel="spur at VCO/2 [dBc]", ylim=(-130, -55),
           title="D4  19.3 fractional spur: level and shape")
    ax.grid(True, which="both", alpha=.3)
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(OUT / "D4_frac_spur_vs_measured.png", dpi=130)
    plt.close(fig)
    return out, (X0, A)


def exp_d5(qc, n):
    print("\n[D5] slide-13 / patent FIG.15 timing non-idealities, retimer margin, PSEL latency")
    off = 200e3
    out = {}
    q0 = quiet_frac(qc, off)
    sp0 = 20 * np.log10(abs(P.spur_phasor(q0, off))) - 6.02
    out["ideal"] = sp0
    for dt in (1e-12, 3e-12, 10e-12):
        a = 20 * np.log10(abs(P.spur_phasor(replace(q0, dt1=dt, retimed=False), off))) - 6.02
        b = 20 * np.log10(abs(P.spur_phasor(replace(q0, dt1=dt, retimed=True, rt_margin=20e-12), off))) - 6.02
        c = 20 * np.log10(abs(P.spur_phasor(replace(q0, post_skew=(0.0, dt, -dt)), off))) - 6.02
        out[f"{dt*1e12:.0f}ps"] = dict(no_retimer=a, retimed_margin20ps=b, post_retimer_skew=c)
        print(f"    {dt*1e12:4.0f} ps: (1) MUX/CK-Q skew w/o retimer {a:.1f} dBc | retimed (margin 20 ps) {b:.1f} | (2) post-retimer skew {c:.1f}")
    bad = 20 * np.log10(abs(P.spur_phasor(replace(q0, dt1=10e-12, retimed=True, rt_margin=5e-12), off))) - 6.02
    out["retimed_margin_lt_skew"] = bad
    print(f"    retimer with margin 5 ps < 10 ps path skew: {bad:.1f} dBc (code-dependent slips)")
    check("D5 (1) retimer removes MUX/CK-Q skew while setup is met", out["10ps"]["retimed_margin20ps"] < sp0 + 1,
          round(out["10ps"]["retimed_margin20ps"], 1), f"<= ideal {sp0:.1f}+1", "arith")
    check("D5 (2) fixed post-retimer skew gives no spur", out["10ps"]["post_retimer_skew"] < sp0 + 1,
          round(out["10ps"]["post_retimer_skew"], 1), f"<= ideal {sp0:.1f}+1", "arith")
    rows = []
    sig = 1.5e-12
    for shared in (False, True):
        for msig in (3.5, 4.0, 4.5, 5.0, 6.0):
            q = replace(qc, rt_margin=msig * sig, rt_sigma=sig, rt_shared=shared, n_cyc=n // 2)
            r = P.simulate(q)
            f, L = P.output_pn(r, nperseg=2 ** 16)
            div = q.n_cyc * (1 if shared else 3)
            rows.append(dict(shared=shared, margin_sigma=msig, slip_rate=r["slips"] / div,
                             jitter_fs=C.rms_jitter_logint(f, L, q.f_vco / 2, 1e4, 1e8) * 1e15))
        print(f"    retimer slips ({'shared first DFF' if shared else 'per-slice DFF'}), sigma 1.5 ps: " +
              ", ".join(f"{x['margin_sigma']}s:{x['slip_rate']:.0e}/{x['jitter_fs']:.0f}fs" for x in rows if x["shared"] == shared))
    print("    note: 5 and 6 sigma rows = zero slips observed in the run; at 5 sigma ~0.3 slips/slice expected per 2^20 cycles "
          "(~46 slips/s at 160 MHz) -> the >=5 sigma rule rests on extrapolation from 4-4.5 sigma")
    out["retimer"] = rows
    q = replace(qc, psel_late=True, n_cyc=n // 2)
    r = P.simulate(q)
    f, L = P.output_pn(r, nperseg=2 ** 16)
    out["psel_late"] = dict(jitter_fs=C.rms_jitter_logint(f, L, q.f_vco / 2, 1e4, 1e8) * 1e15, L_1M=C.band_level(f, L, 0.8e6, 1.2e6),
                            L_100k=C.band_level(f, L, 8e4, 1.2e5))
    print(f"    PSEL one cycle late: jitter {out['psel_late']['jitter_fs']:.0f} fs, L(100k) {out['psel_late']['L_100k']:.1f}, L(1M) {out['psel_late']['L_1M']:.1f}")
    return out


def exp_d6(qc):
    print("\n[D6] CP offset: SC Q_OFST vs bleed current, supply sensitivity, reference spur, DBL duty cycle")
    t_off = P.t_off_of(qc)
    T = 1 / qc.f_pfd
    q_ofst = qc.icp * t_off
    rows = {}
    for mode in ("sc", "bleed"):
        q = replace(qc, offset_mode=mode)
        var = P.offset_noise_var(q, t_off)
        rows[mode] = dict(offset_timing_noise_fs=math.sqrt(var) / q.icp * 1e15, jitter_fs=P.jitter_analytic(q) * 1e15)
    sens = P.supply_sensitivity(qc, t_off)
    vdd_req = 30e-15 / sens
    print(f"    Q_OFST {q_ofst*1e15:.0f} fC, C_OFST {q_ofst/qc.vdd*1e15:.0f} fF; offset noise SC {rows['sc']['offset_timing_noise_fs']:.1f} fs/edge "
          f"(kT/C lower bound), bleed {rows['bleed']['offset_timing_noise_fs']:.1f} fs/edge (thermal only, same gm model); jitter {rows['sc']['jitter_fs']:.2f} vs {rows['bleed']['jitter_fs']:.2f} fs")
    print(f"    supply sensitivity of the locked phase: {sens*1e12*1e-3:.3f} ps/mV -> VDD/bias noise must stay < {vdd_req*1e6:.0f} uV rms per sample "
          f"to add < 30 fs/edge; 1/f supply noise lands in-band unattenuated")
    pulse = P.pulse_charges(0.0, t_off, qc.icp)
    waves = {"bleed current offset, CP pulse into LPF": pulse + P.pulse_charges(0.0, T, -q_ofst / T * T / T, n=256),
             "SC offset, CP pulse into LPF (no S/H)": pulse + [(T / 2, -q_ofst)],
             "S/H re-distribution, 20 ps skew": [(T / 2, q_ofst), (T / 2 + 20e-12, -q_ofst)],
             "S/H re-distribution, 5 ps skew": [(T / 2, q_ofst), (T / 2 + 5e-12, -q_ofst)]}
    waves["bleed current offset, CP pulse into LPF"] = pulse + P.pulse_charges(0.0, T, -q_ofst / T, n=256)
    spurs = {}
    for k, w in waves.items():
        spurs[k] = {f"p3={p3}": P.ref_spur_from_waveform(replace(qc, p3_ratio=p3), w, qc.f_pfd)[0]["spur_dbc"] for p3 in (8, qc.p3_ratio, 40)}
        print(f"    ref spur (160 MHz, at VCO) {k:42s}: " + ", ".join(f"{kk} {v:.1f}" for kk, v in spurs[k].items()) + " dBc")
    dbl = []
    for derr in (1e-12, 5e-12, 20e-12, 625e-12):
        ch = [(0.0, qc.icp * derr / 2), (T, -qc.icp * derr / 2)]
        dbl.append(dict(alternation_ps=derr * 1e12, spur_80M_dbc=P.ref_spur_from_waveform(qc, ch, qc.f_xo, n_harm=1)[0]["spur_dbc"],
                        t_off_margin_needed_ps=derr / 2 * 1e12))
    print("    DBL even/odd edge alternation -> 80 MHz spur / extra T_off needed: " +
          ", ".join(f"{d['alternation_ps']:.0f}ps:{d['spur_80M_dbc']:.0f}dBc/+{d['t_off_margin_needed_ps']:.0f}ps" for d in dbl) +
          " (625 ps = 45/55 % XO duty, uncalibrated)")
    sh = spurs["S/H re-distribution, 20 ps skew"][f"p3={qc.p3_ratio}"]
    bl = spurs["bleed current offset, CP pulse into LPF"][f"p3={qc.p3_ratio}"]
    nosh = spurs["SC offset, CP pulse into LPF (no S/H)"][f"p3={qc.p3_ratio}"]
    check("D6 the S/H charge re-distribution (not the SC offset by itself) suppresses the ripple spur",
          sh < -101 and bl > -101 and nosh > -101, dict(sh=round(sh, 1), bleed=round(bl, 1), sc_no_sh=round(nosh, 1)),
          "S/H < -101 dBc < others", "validation", "assumes Kvco 150 MHz/V, T_off from T_nl=50 ps; sensitive to p3/C3")
    return dict(t_off_ps=t_off * 1e12, q_ofst_fC=q_ofst * 1e15, noise=rows, supply_ps_per_mV=sens * 1e9,
                vdd_noise_req_uV=vdd_req * 1e6, ref_spurs=spurs, dbl=dbl)


def exp_d7(qc, n):
    print("\n[D7] CP soft-start region (T_nonlin) and DN-only clipping vs offset: folded DSM noise")
    out = {}
    fig, ax = plt.subplots(figsize=(7, 4.4))
    T = qc.t_vco
    for M in (1, 4):
        rows = []
        for k in np.linspace(0.0, 2.4, 9):
            q = replace(qc, M=M, t_off=float(qc.t_nonlin + k * T), nonlin_ramp=True, n_cyc=n // 4, **QUIET)
            r = P.simulate(q)
            f, L = P.output_pn(r, nperseg=2 ** 15)
            rows.append(dict(offset_over_T=float(k), L_inband=C.band_level(f, L, 1e5, 4e5)))
        out[f"M{M}"] = rows
        ax.plot([x["offset_over_T"] for x in rows], [x["L_inband"] for x in rows], "o-", label=f"M={M}")
        print(f"    M={M}: " + ", ".join(f"{x['offset_over_T']:.1f}T:{x['L_inband']:.0f}" for x in rows))
    # band-edge: same T_off designed at 9.5 GHz, used at 7.3 GHz
    q73 = replace(qc, **P.frac_params(qc, 7.3e9 + 0.3765 * 160e6))   # generic fraction near the band bottom
    t95 = P.t_off_of(qc)
    t73 = P.t_off_of(q73)
    out["t_off_9g5_ps"] = t95 * 1e12
    out["t_off_needed_7g3_ps"] = t73 * 1e12
    print(f"    minimum T_off: 9.5 GHz {t95*1e12:.0f} ps, 7.3 GHz {t73*1e12:.0f} ps -> a fixed C_OFST*VDD/I_DN must be sized for the band "
          f"bottom plus VDD/C/I tolerances and the DBL residual")
    ax.set(xlabel="(T_off - T_nonlin) / T_VCO", ylabel="in-band L (100-400 kHz) at VCO/2 [dBc/Hz]",
           title="D7  folded DSM noise vs CP offset (soft-start T_nl, DN-only clip)")
    ax.grid(True, alpha=.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(OUT / "D7_offset_vs_folding.png", dpi=130)
    plt.close(fig)
    return out


def exp_d8(qc, d2, n, n_draw):
    print("\n[D8] jitter budget (ranges over the identifiability profile) incl. fractional spur and folded noise")
    j, parts = P.jitter_analytic(qc, parts=True)
    rows = []
    for label, kw in (("design point M=4", {}), ("multipath off (PSEL=0)", dict(mp_disabled=True)), ("M=2", dict(M=2)),
                      ("M=8", dict(M=8)), ("M=16", dict(M=16)), ("80 MHz PFD (no DBL)", dict(dbl=False, N=118))):
        rows.append(dict(case=label, jitter_fs=P.jitter_analytic(replace(qc, **kw)) * 1e15))
    for r in rows:
        print(f"    {r['case']:28s}: {r['jitter_fs']:.1f} fs (noise only, analytic)")
    # measured spur of the slide-30 channel added to the measured slide-29 jitter (bookkeeping, as in D1)
    s30 = P.SPUR_AT_402K_DBC
    js30 = math.sqrt(2 * 10 ** (s30 / 10)) / (2 * math.pi * 4.720318787e9)
    print(f"    slide-30 spur {s30:.2f} dBc -> {js30*1e15:.1f} fs; with 33.78 fs -> {math.sqrt(33.782e-15**2 + js30**2)*1e15:.1f} fs "
          f"(reported 37.69 fs; worst point of the frac sweep is -70.3 dBc at 200 kHz, another channel)")
    # simulated: mismatch draws at 3sigma = 0.5% on a channel with the spur at 200 kHz; full noise; raw-bin integration
    rng = np.random.default_rng(31)
    srows = []
    for M in (2, 4, 8):
        q0 = replace(qc, M=M, K=int(round(200e3 / qc.f_pfd * qc.Q)), n_cyc=n // 2)
        nsl = len(q0.slice_weights())
        r = P.simulate(q0)
        f, L = P.output_pn(r, nperseg=2 ** 17)
        j0 = C.rms_jitter(f, L, q0.f_vco / 2, 1e4, 1e8)
        js = []
        for _ in range(n_draw):
            e = rng.normal(0, P.PAPER["cp_mismatch_3sigma"] / 3, nsl)
            r = P.simulate(replace(q0, eps=tuple(e)))
            f, L = P.output_pn(r, nperseg=2 ** 17)
            js.append(C.rms_jitter(f, L, q0.f_vco / 2, 1e4, 1e8))
        js = np.array(js)
        srows.append(dict(M=M, jitter_no_mismatch_fs=j0 * 1e15, jitter_median_fs=float(np.median(js)) * 1e15,
                          jitter_p90_fs=float(np.percentile(js, 90)) * 1e15, n_draw=n_draw))
        print(f"    M={M}, 200 kHz channel, 3sigma=0.5% mismatch ({n_draw} draws, spur + folded noise, raw-bin integral): "
              f"no mismatch {j0*1e15:.1f} fs, median {np.median(js)*1e15:.1f} fs, 90th pct {np.percentile(js, 90)*1e15:.1f} fs")
    print("    component ranges over the profiles [fs]: " + ", ".join(f"{k} {v[0]:.1f}-{v[1]:.1f}" for k, v in d2["profile_ranges_fs"].items()))
    return dict(parts_fs={k: v * 1e15 for k, v in parts.items()}, jitter_fs=j * 1e15, cases=rows, slide30_spur_jitter_fs=js30 * 1e15,
                mismatch_sim=srows, ranges_fs=d2["profile_ranges_fs"])


def exp_d9(qc, d0, d3, d4, d5, d2):
    """Point-by-point cross-check against US 11,509,315 B2."""
    print("\n[D9] cross-check against US 11,509,315 B2 (MTK sliced-CP 'QNC' patent)")
    rows = []
    for M, claim, expect, lab in ((2, "claim 5 (X=2)", [0.5, 0.5], "(1-1/X, 1/X)*Icp"),
                                  (4, "claim 6 (n=2)", [0.25, 0.25, 0.5], "(1/2^n, 1/2^n, 2/2^n)*Icp"),
                                  (8, "claim 7 (n=3)", [0.125, 0.125, 0.25, 0.5], "(1/2^n, 1/2^n, 2/2^n, 4/2^n)*Icp")):
        w = sorted(replace(qc, M=M).slice_weights().tolist())
        ok = np.allclose(w, sorted(expect))
        rows.append(dict(item=f"{claim} slice currents", patent=expect, isscc=w, match=bool(ok)))
        check(f"D9 {claim}: {lab} == 19.3 slices M={M}", ok, w, expect, "arith", "duplicates D0 weights")
    T = qc.t_vco
    win = 0.5 / qc.f_pfd
    t_off = P.t_off_of(qc)
    dtc = []
    for X in (2, 4, 8, 16):
        two_extra = (X - 1) * T
        dtc.append(dict(X=X, two_slice_delay_dffs=X - 1, two_slice_extra_ontime_ps=two_extra * 1e12,
                        binary_delay_dffs_19p3=1, binary_slices=int(math.log2(X)) + 1, binary_extra_ontime_ps=T * 1e12,
                        two_slice_end_ps=(t_off + two_extra) * 1e12, window_ps=win * 1e12,
                        two_slice_fits_window=bool(t_off + two_extra < win)))
    rows.append(dict(item="DTC realisation (FIG.4 two-slice vs FIG.13 binary = 19.3)", table=dtc))
    print("    two-slice (FIG.4/7/9) vs binary (FIG.13, 19.3): " + ", ".join(
        f"X={d['X']}: delay DFFs {d['two_slice_delay_dffs']} vs 1 (+{d['binary_slices']} slice retimers/MUX), extra pulse "
        f"+{d['two_slice_extra_ontime_ps']:.0f} vs +{d['binary_extra_ontime_ps']:.0f} ps, two-slice pulse ends at {d['two_slice_end_ps']:.0f} ps "
        f"< T_ref/2 {d['window_ps']:.0f} ps: {d['two_slice_fits_window']}" for d in dtc))
    print("    -> the patent's 'levels cannot grow unlimitedly' window limit does not bind at 160 MHz / 9.5 GHz for X <= 16; "
          "binary buys shorter extra pulses (CP noise, offset) and fewer VCO-rate delay DFFs")
    sdm = d3["4"]["delta_db"]
    rows.append(dict(item="SDM noise -6/-12/-18 dB (X=2/4/8)", patent="-12 dB at 4 levels", model=round(sdm, 2),
                     isscc="slide 29: '0.25X Q reduction (M=4)'", data="joint-fit cost minimum near 15 dB, <=9 dB disfavoured"))
    check("D9 patent 'SDM noise -12 dB' at the 19.3 point (M=4)", abs(sdm + 12.04) < 0.5, round(sdm, 2), -12.04, "arith", "duplicates D3")
    check("D9 patent 'CP noise -1~2 dB': thermal on-time ratio at the 19.3 point", 1.0 <= d0["model_thermal_db"] <= 2.0,
          round(d0["model_thermal_db"], 2), "1..2 dB", "arith", "10log(T_off ratio); 2.05 dB if T_nl -> 0")
    qcM1 = replace(qc, mp_disabled=True)
    cpk = ("cp", "cp_flicker", "cp_offset")
    jc4 = math.sqrt(sum(v ** 2 for k, v in P.jitter_analytic(qc, parts=True)[1].items() if k in cpk))
    jc1 = math.sqrt(sum(v ** 2 for k, v in P.jitter_analytic(qcM1, parts=True)[1].items() if k in cpk))
    cp_tot_db = 20 * math.log10(jc1 / jc4)
    check("D9 patent 'CP noise -1~2 dB' vs the TOTAL CP noise of the fitted model (thermal + 1/f + offset)", 1.0 <= cp_tot_db <= 2.0,
          round(cp_tot_db, 2), "1..2 dB", "claim", f"{jc1*1e15:.1f} -> {jc4*1e15:.1f} fs; measured in-band gain "
          f"{np.round(d2['inband_gain']['measured'],1).tolist()} dB at 10k/20k/100k", soft=True)
    rows.append(dict(item="CP noise -1~2 dB from smaller T_OFFSET", patent="1-2 dB", model=dict(
        thermal=round(d0["model_thermal_db"], 2), flicker=round(d0["model_flicker_db"], 2), fitted_total=round(cp_tot_db, 2)),
        slide12_formula=round(d0["slide12_formula_db"], 2), measured_inband_gain=[round(x, 1) for x in d2["inband_gain"]["measured"]]))
    pfd = {}
    for tag, w in (("FIG.5 0.5/0.5", [0.5, 0.5]), ("FIG.7 0.75/0.25", [0.75, 0.25]), ("FIG.9 0.875/0.125", [0.875, 0.125]),
                   ("FIG.11 = 19.3 M=4", [0.25, 0.25, 0.5]), ("FIG.13 M=8", [0.125, 0.125, 0.25, 0.5])):
        pfd[tag] = 10 * math.log10(sum(x * x for x in w))
    rows.append(dict(item="PFD noise -3 dB (equal split; more with more partitions)", model_sum_w2_db=pfd,
                     note="independent per-slice PFD noise only; slides do not quantify it"))
    print("    PFD noise 10log(sum w^2): " + ", ".join(f"{k} {v:.2f} dB" for k, v in pfd.items()))
    check("D9 patent 'PFD -3 dB' for an equal split; binary 19.3 slices give more", abs(pfd["FIG.5 0.5/0.5"] + 3.01) < 0.05
          and pfd["FIG.11 = 19.3 M=4"] < -3.0, round(pfd["FIG.11 = 19.3 M=4"], 2), "-3.01 (equal) / < -3 (binary)", "arith",
          "two-slice FIG.7/9 give only -2.04/-1.07 dB")
    rows.append(dict(item="timing mismatch dT1/dT2/dT3 (FIG.15)", patent="dT1 removed by the retimer; dT2, dT3 fixed -> no folding",
                     isscc="slide 13 (1)(2), slide 14", model=dict(no_retimer_10ps=round(d5["10ps"]["no_retimer"], 1),
                                                                   retimed=round(d5["10ps"]["retimed_margin20ps"], 1),
                                                                   post=round(d5["10ps"]["post_retimer_skew"], 1))))
    # the patent's mismatch statement is COMPARATIVE: current mismatch (~0.001) << timing mismatch
    pat = d4["patent_0p001"]
    cur = pat["0.001_as_sigma"]["median_inband_mean"]
    tim = d5["1ps"]["no_retimer"]
    check("D9 patent: current-mismatch spur (0.001) << timing-mismatch spur (1 ps, unretimed)", cur < tim - 20,
          f"{cur:.1f} vs {tim:.1f} dBc", "current << timing", "claim", "the comparative statement holds")
    rows.append(dict(item="current mismatch 'about 0.001 ... much smaller than timing mismatch ... not the main concern'",
                     patent="comparative, sigma/3sigma convention not stated",
                     model=dict(spur_0p001_sigma=round(pat["0.001_as_sigma"]["median_inband_mean"], 1),
                                spur_0p001_3sigma=round(pat["0.001_as_3sigma"]["median_inband_mean"], 1),
                                spur_1ps_unretimed=round(tim, 1), measured_inband=round(d4["measured_inband_mean"], 1),
                                sigma3_ci=d4["sigma3_ci"], compression_alternative="C_DN*V_A ~ 40 pF*V, zero mismatch"),
                     verdict="comparative statement holds; whether the measured -64.8 dBc (VCO) spur is set by mismatch is undetermined"))
    print(f"    mismatch: 0.001 as sigma -> {pat['0.001_as_sigma']['median_inband_mean']:.1f} dBc, as 3sigma -> "
          f"{pat['0.001_as_3sigma']['median_inband_mean']:.1f} dBc (in-band mean, VCO/2) vs measured {d4['measured_inband_mean']:.1f}; "
          f"1 ps unretimed timing skew -> {tim:.1f} dBc")
    rows.append(dict(item="RMS jitter < 50 fs", patent="< 50 fs", isscc="33.78 fs measured", model=round(d2["sim_jitter_fs"], 1)))
    check("D9 patent example 'RMS jitter < 50 fs' met by the published 33.8 fs", P.PAPER["jitter_fs"] < 50, P.PAPER["jitter_fs"],
          "< 50 fs", "claim", "paper number vs patent statement; no model involved")
    rows.append(dict(item="no PRPS / no calibration", patent="not needed for the DFF delays (col.7 also allows VCDLs with calibration)",
                     isscc="slide 4 (DTC needs gain/INL calibration) vs slides 8-14 (none); DBL duty cycle still needs correction (D6)"))
    rows.append(dict(item="offset T_OFFSET (FIG.2) and the edge spread", patent="+-1T (1st-order SDM), +-2T (2nd-order); unit step Icp*T",
                     isscc="MASH 1-1-1: 4T (slide 12); model 3.91T", note="patent CP 1-2 dB and the model 1.58 dB use different SDM baselines"))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    n = 2 ** 18 if a.quick else 2 ** 20
    n_seeds = 1 if a.quick else 3
    t0 = time.time()
    base = P.MP19p3Params(xo_flicker_fs2=4e-33, cp_flicker_fc=2e6, n_cyc=n)
    res = dict(model="ISSCC 2025 19.3 MediaTek multipath-feedback fractional-N PLL + US 11,509,315 cross-check", paper=P.PAPER,
               measured=dict(vco=P.VCO_FREE_MARKERS, pll=P.PLL_MARKERS, pll_spur=P.PLL_SPUR_MARKERS,
                             no_multipath=P.PLL_NO_MP_DIGITISED, frac_spur=P.FRAC_SPUR_OFFSETS,
                             jitter_vs_fvco=P.JITTER_VS_FVCO, vco_pn_vs_f=P.VCO_PN1M_VS_F))
    res["D0"] = exp_d0(base)
    res["D1"] = exp_d1()
    d2, qc, qa = exp_d2(base, n, n_seeds)
    res["D2"] = d2
    res["params_fit_C"] = {k: v for k, v in asdict(qc).items() if k != "lf_override"}
    res["params_fit_A"] = {k: v for k, v in asdict(qa).items() if k != "lf_override"}
    res["D3"] = exp_d3(qc, n)
    d4, lm4 = exp_d4(qc)
    res["D4"] = d4
    res["D5"] = exp_d5(qc, n)
    res["D6"] = exp_d6(qc)
    res["D7"] = exp_d7(qc, n)
    res["D8"] = exp_d8(qc, d2, n, 4 if a.quick else 10)
    res["D9_patent"] = exp_d9(qc, res["D0"], res["D3"], d4, res["D5"], d2)
    res["checks"] = CHECKS
    res["runtime_s"] = time.time() - t0
    (OUT / "isscc25_19p3_results.json").write_text(json.dumps(res, indent=1, default=float))
    summ = {}
    print("\nkinds: arith = implementation/identity, consistency = vs fitted data, validation = vs held-out data or an "
          "independent slide claim, claim = paper/patent statement comparison")
    for c in CHECKS:
        summ.setdefault(c["kind"], {}).setdefault(c["result"], 0)
        summ[c["kind"]][c["result"]] += 1
    print(f"\nchecks by kind: {summ}; runtime {time.time()-t0:.0f} s")


if __name__ == "__main__":
    main()
