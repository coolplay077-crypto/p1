"""Reproduction + non-ideality study of ISSCC 2025 19.3 (MediaTek multipath-feedback
fractional-N PLL, 34 fs_rms, -255.5 dB FoM).  Writes results/isscc25_19p3_results.json
and figures results/D*_*.png.

    python3 run_isscc25_19p3.py            # full run (~3 min)
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
FREE_C = ("fc", "pm", "ref_white_fs", "xo_flicker_fs2", "p3_ratio", "cp_noise_scale", "cp_flicker_fc")
FREE_A = ("fc", "pm", "ref_white_fs", "xo_flicker_fs2", "p3_ratio")


def check(name, ok, measured, expected, note="", soft=False):
    res = "PASS" if ok else ("DEVIATION" if soft else "FAIL")
    CHECKS.append(dict(check=name, result=res, measured=measured, expected=expected, note=note))
    print(f"  [{res}] {name}: measured={measured} expected={expected} {note}")


def H_closed(p, f):
    lf = P.loop_filter(p)
    Lg = C.cp_open_loop(f, p.icp, p.kvco, p.nf, lf)
    return np.abs(Lg / (1 + Lg))


def fom(p_mw, jit_s, f_ref=None, f_vco=None):
    v = 10 * math.log10(p_mw * jit_s ** 2)
    if f_ref:
        v += 10 * math.log10(f_ref / f_vco)
    return v


# -----------------------------------------------------------------------------
def exp_d0(base):
    print("\n[D0] multipath arithmetic (slides 8-12)")
    out = dict(identity=[], spread=[], toff=[])
    for M in (2, 4, 8):
        p = replace(base, M=M, n_cyc=2 ** 16)
        sp = p.sliced()
        seq = S.build_sequences(sp)
        ids = S.check_identity(seq, sp)
        w = sorted(sp.slices().tolist(), reverse=True)
        slide = sorted([1 / 2 ** i for i in range(1, int(math.log2(M)) + 1)] + [1 / M], reverse=True)
        out["identity"].append(dict(M=M, **ids, weights=w, slide_weights=slide, dQ_over_IcpT=1 / M))
        check(f"D0 PSEL/carry arithmetic + weights M={M}", all(ids.values()) and np.allclose(w, slide),
              dict(ids, weights=[round(x, 4) for x in w]), f"weights {slide}", "slide 8/10/11")
    T = base.t_vco
    for M in (1, 2, 4, 8):
        p = replace(base, M=M, n_cyc=2 ** 16)
        seq = S.build_sequences(p.sliced())
        sprd = P.slide12_spread(seq, p)
        toff = P.auto_t_off(p, seq)
        out["spread"].append(dict(M=M, **sprd))
        out["toff"].append(dict(M=M, t_off_ps=toff * 1e12, t_off_over_T=(toff - p.t_nonlin) / T))
        print(f"    M={M}: coarse-edge spread {sprd['coarse_pp']:.2f} T, effective-edge spread {sprd['eff_pp']:.2f} T, "
              f"all-slice span {sprd['all_slices_pp']:.2f} T; auto T_off = T_nl + {(toff-p.t_nonlin)/T:.2f} T")
    s1 = [x for x in out["spread"] if x["M"] == 1][0]
    s4 = [x for x in out["spread"] if x["M"] == 4][0]
    check("D0 slide 12: DSM spread 4T (conv) -> ~2T (M=4)", abs(s1["coarse_pp"] - 4) < 0.3 and 1.5 < s4["coarse_pp"] < 2.3,
          f"{s1['coarse_pp']:.2f}T -> {s4['coarse_pp']:.2f}T", "4T -> 2T", "coarse (MMD) edge peak-to-peak")
    tn = base.t_nonlin
    t1 = [x for x in out["toff"] if x["M"] == 1][0]["t_off_ps"] * 1e-12
    t4 = [x for x in out["toff"] if x["M"] == 4][0]["t_off_ps"] * 1e-12
    slide_db = 10 * math.log10((tn + 2 * T) / (tn + T))
    exact_db = 10 * math.log10((t1 + tn) / (t4 + tn))
    out["slide12_formula_db"] = slide_db
    out["exact_ontime_db"] = exact_db
    print(f"    CP on-time noise gain: slide formula 10log((Tnl+2T)/(Tnl+T)) = {slide_db:.2f} dB; exact model {exact_db:.2f} dB")
    return out


def exp_d1():
    print("\n[D1] VCO fit + reported figure-of-merit arithmetic")
    vf = P.fit_vco()
    L1m_9g5 = float(P.vco_L(np.array([1e6]), vf, scale_db=20 * math.log10(9.5 / 4.75))[0])
    a = P.PAPER
    vfom = -a["vco_pn_1m_9g5"] + 20 * math.log10(9.5e9 / 1e6) - 10 * math.log10(a["vco_power_mw"])
    vfomt = vfom + 20 * math.log10(a["vco_tr_pct"] / 10)
    f1 = fom(a["power_mw"], a["jitter_fs"] * 1e-15)
    f2 = fom(a["power_mw"], a["jitter_spur_fs"] * 1e-15)
    fn = fom(a["power_mw"], a["jitter_fs"] * 1e-15, 80e6, 9.5e9)
    fn2 = fom(a["power_mw"], a["jitter_spur_fs"] * 1e-15, 80e6, 9.5e9)
    # jitter with spur: one SSB spur pair at -70.88 dBc (VCO/2) adds sqrt(2*S)/(2 pi f) rms
    s_lin = 10 ** (P.SPUR_AT_402K_DBC / 10)
    j_sp = math.sqrt(2 * s_lin) / (2 * math.pi * 4.720318787e9)
    j_tot = math.sqrt((a["jitter_fs"] * 1e-15) ** 2 + j_sp ** 2)
    out = dict(vco_fit=vf, vco_L1M_9g5=L1m_9g5, vco_fom=vfom, vco_fomt=vfomt, pll_fom=f1, pll_fom_spur=f2,
               fomn=fn, fomn_spur=fn2, spur_jitter_fs=j_sp * 1e15, jitter_with_one_spur_fs=j_tot * 1e15)
    print(f"    VCO fit a3/f^3+a2/f^2+a0: rms {vf['rms_err_db']:.2f} dB, 1/f^3 corner {vf['corner_hz']/1e3:.0f} kHz, "
          f"L(1MHz)@9.5GHz = {L1m_9g5:.2f} dBc/Hz")
    check("D1 VCO L(1MHz)@9.5GHz from slide-27 markers vs slide 28", abs(L1m_9g5 - a["vco_pn_1m_9g5"]) < 1.0,
          round(L1m_9g5, 2), a["vco_pn_1m_9g5"], "dBc/Hz")
    check("D1 VCO FoM", abs(vfom - a["vco_fom"]) < 0.15, round(vfom, 2), a["vco_fom"], "dB")
    check("D1 VCO FoM_T", abs(vfomt - a["vco_fomt"]) < 0.15, round(vfomt, 2), a["vco_fomt"], "dB (20% TR)")
    check("D1 PLL FoM (33.8 fs, 24.4 mW)", abs(f1 - a["fom"]) < 0.1, round(f1, 2), a["fom"], "dB")
    check("D1 PLL FoM w/ spur (37.7 fs)", abs(f2 - a["fom_spur"]) < 0.1, round(f2, 2), a["fom_spur"], "dB")
    check("D1 FoM_N uses f_ref = 80 MHz (XO, not 160 MHz)", abs(fn - a["fomn"]) < 0.1, round(fn, 2), a["fomn"], "dB")
    check("D1 jitter w/ spur consistent with the -70.9 dBc spur", abs(j_tot * 1e15 - a["jitter_spur_fs"]) < 2.5,
          round(j_tot * 1e15, 2), a["jitter_spur_fs"], "fs (one spur pair only; residual = other spurs)")
    return out


def exp_d2(base, n):
    print("\n[D2] loop / noise identification against the measured PN (slides 27, 29)")
    qa, per_a = P.fit_joint(base, FREE_A, [({}, P.PLL_MARKERS, 1.0)])
    qc, per_c = P.fit_joint(base, FREE_C, [({}, P.PLL_MARKERS, 1.0), ({"M": 1}, P.PLL_NO_MP_DIGITISED, 0.5)])
    fits = {}
    for tag, q, per in [("A_M4_only", qa, per_a), ("C_joint", qc, per_c)]:
        lf = P.loop_filter(q)
        fcm, pmm = C.loop_margins(q.icp, q.kvco, q.nf, lf)
        fg = np.logspace(3, 8.5, 3000)
        Hdb = 20 * np.log10(H_closed(q, fg))
        fits[tag] = dict(fc=q.fc, pm=q.pm, p3_ratio=q.p3_ratio, ref_white_fs=q.ref_white_fs * 1e15,
                         xo_flicker_fs2=q.xo_flicker_fs2, cp_noise_scale=q.cp_noise_scale, cp_flicker_fc=q.cp_flicker_fc,
                         closed_loop_bw=float(fg[np.where(Hdb < -3)[0][0]]), peaking_db=float(Hdb.max()),
                         margins=dict(fc=fcm, pm=pmm), per_dataset=per)
        print(f"    fit {tag}: fc {q.fc/1e6:.2f} MHz, PM {q.pm:.1f}, BW(-3dB) {fits[tag]['closed_loop_bw']/1e6:.2f} MHz, "
              f"p3 {q.p3_ratio:.1f}xfc, ref {q.ref_white_fs*1e15:.0f} fs, CPx{q.cp_noise_scale:.2f}, CP 1/f corner "
              f"{q.cp_flicker_fc/1e3:.0f} kHz | " + " | ".join(f"{d['overrides']}: rms {d['rms_err_db']:.2f} dB" for d in per))
    # time-domain verification of the joint fit, M=4 and M=1
    sims = {}
    fig, ax = plt.subplots(figsize=(8.5, 5))
    for M, col in [(4, "C0"), (1, "C3")]:
        q = replace(qc, M=M, n_cyc=n)
        r = P.simulate(q)
        f, L = P.output_pn(r)
        A = P.analytic_pn(f, q)
        jit = C.rms_jitter(f, L, q.f_vco / 2, 1e4, 1e8)
        jit_a = C.rms_jitter(f, A["total"], q.f_vco / 2, 1e4, 1e8)
        comp = {k: C.rms_jitter(f, v, q.f_vco / 2, 1e4, 1e8) * 1e15 for k, v in A.items()}
        mk = P.PLL_MARKERS if M == 4 else P.PLL_NO_MP_DIGITISED
        err = [C.band_level(f, L, m[0] * 0.93, m[0] * 1.07) - m[1] for m in mk if m[0] <= 9e7]
        sims[f"M{M}"] = dict(jitter_fs=jit * 1e15, jitter_analytic_fs=jit_a * 1e15, component_jitter_fs=comp,
                             marker_err_db=[round(e, 2) for e in err], marker_rms_err_db=float(np.sqrt(np.mean(np.square(err)))),
                             t_off_ps=r["t_off"] * 1e12)
        fs_, Ls_ = C.log_smooth(f, L, 200, 3e3, 1.5e8)
        ax.semilogx(fs_, Ls_, col, lw=1.6, label=f"sim M={M}: {jit*1e15:.1f} fs")
        ax.semilogx([m[0] for m in mk], [m[1] for m in mk], "o" if M == 4 else "s", color=col, mfc="none",
                    label="measured markers (slide 29)" if M == 4 else "digitised w/o multipath (slide 29)")
        print(f"    sim M={M}: jitter {jit*1e15:.2f} fs (analytic {jit_a*1e15:.2f}), marker rms err "
              f"{sims[f'M{M}']['marker_rms_err_db']:.2f} dB; components " + ", ".join(f"{k} {v:.1f}" for k, v in comp.items()))
        if M == 4:
            for key, sty in [("vco", ":"), ("cp", ":"), ("cp_flicker", ":"), ("sdm", "--"), ("ref_flicker", ":"), ("out_floor", ":")]:
                if key in A:
                    m_ = f < 1e8
                    ax.semilogx(f[m_], A[key][m_], sty, lw=1, label=f"analytic {key} (M=4)")
    vf = P.fit_vco()
    fg = np.logspace(3.5, 8, 300)
    ax.semilogx(fg, P.vco_L(fg, vf), color="gray", lw=1, label="VCO free-running fit (slide 27)")
    ax.set(xlabel="offset [Hz]", ylabel="L(f) at VCO/2 = 4.75 GHz [dBc/Hz]", ylim=(-170, -95),
           title="D2  ISSCC'25 19.3: model vs measured (joint fit C)")
    ax.grid(True, which="both", alpha=.3)
    ax.legend(fontsize=7, ncol=2)
    fig.tight_layout()
    fig.savefig(OUT / "D2_pn_vs_measured.png", dpi=130)
    plt.close(fig)
    m4 = sims["M4"]
    check("D2 sim jitter (10k-100M) vs measured 33.78 fs", abs(m4["jitter_fs"] / P.PAPER["jitter_fs"] - 1) < 0.06,
          round(m4["jitter_fs"], 2), P.PAPER["jitter_fs"], "fs, joint-fit parameters")
    check("D2 sim PN vs 10 measured markers", m4["marker_rms_err_db"] < 1.0, round(m4["marker_rms_err_db"], 2), "<1 dB rms")
    check("D2 M=1 prediction vs digitised w/o-multipath trace", sims["M1"]["marker_rms_err_db"] < 1.5,
          round(sims["M1"]["marker_rms_err_db"], 2), "<1.5 dB rms", "digitisation +-1.5 dB")
    check("D2 sim vs analytic jitter", abs(m4["jitter_fs"] / m4["jitter_analytic_fs"] - 1) < 0.05,
          round(m4["jitter_fs"], 2), round(m4["jitter_analytic_fs"], 2), "fs")
    # in-band improvement M=1 -> M=4 (measured ~1 dB @100k, ~1.8 dB @20k)
    f_ib = np.array([2e4, 1e5])
    d_c = P.analytic_pn(f_ib, replace(qc, M=1))["total"] - P.analytic_pn(f_ib, qc)["total"]
    d_a = P.analytic_pn(f_ib, replace(qa, M=1))["total"] - P.analytic_pn(f_ib, qa)["total"]
    out = dict(fits=fits, sims=sims, inband_gain_db=dict(fitC_20k=float(d_c[0]), fitC_100k=float(d_c[1]),
                                                         fitA_20k=float(d_a[0]), fitA_100k=float(d_a[1]),
                                                         measured_20k=-117.9 + 119.7, measured_100k=-121.6 + 122.63))
    print(f"    in-band gain M=1->M=4: fit C {d_c[1]:.2f} dB @100k ({d_c[0]:.2f} @20k); fit A {d_a[1]:.2f} dB; "
          f"measured ~1.0 dB @100k (~1.8 @20k, digitised)")
    return out, qc, qa


def exp_d3(base, n):
    print("\n[D3] SDM quantisation noise vs M (slide 29 '0.25X Q reduction')")
    res = {}
    ref = None
    for M in (1, 2, 4, 8):
        p = replace(base, M=M, n_cyc=n // 2, **QUIET)
        r = P.simulate(p)
        f, L = P.output_pn(r, nperseg=2 ** 15)
        lvl = C.band_level(f, L, 5e6, 40e6)
        ref = lvl if ref is None else ref
        res[M] = dict(level_5_40M=lvl, delta_db=lvl - ref, expected=-20 * math.log10(M),
                      sdm_jitter_fs=C.rms_jitter(f, L, p.f_vco / 2, 1e4, 1e8) * 1e15)
        print(f"    M={M}: SDM level {lvl:.1f} dBc/Hz (delta {lvl-ref:+.2f}, expected {-20*math.log10(M):+.2f}), "
              f"SDM-only jitter {res[M]['sdm_jitter_fs']:.1f} fs")
    check("D3 Q-noise reduction M=4 (slide 29: 0.25X)", abs(res[4]["delta_db"] + 12.04) < 0.5, round(res[4]["delta_db"], 2), -12.04, "dB")
    return {str(k): v for k, v in res.items()}


def spur_sim(p, frac, n):
    q = replace(p, K=int(round(frac * p.Q)), n_cyc=n, os=1, settle=2 ** 12, **QUIET)
    r = P.simulate(q)
    per = int(round(1 / frac))
    th = r["theta"]
    th = th[: (len(th) // per) * per] if per < len(th) // 4 else th
    return C.spur_dbc(th, q.f_pfd, frac * q.f_pfd) - 20 * math.log10(2), r   # at VCO/2


def exp_d4(qc, n_mc, n):
    print("\n[D4] fractional spur vs fractional value: CP-slice mismatch (slide 13: 3sigma = 0.5%)")
    sig = P.PAPER["cp_mismatch_3sigma"] / 3
    fracs = [2.0 ** -k for k in range(14, 4, -1)]
    rng = np.random.default_rng(2025)
    draws = rng.normal(0, sig, size=(n_mc, 3))
    table = np.zeros((n_mc, len(fracs)))
    for i in range(n_mc):
        for j, fr in enumerate(fracs):
            table[i, j], _ = spur_sim(replace(qc, eps=tuple(draws[i])), fr, n)
    ideal = [spur_sim(qc, fr, n)[0] for fr in fracs]
    p10, p50, p90 = (np.percentile(table, q, axis=0) for q in (10, 50, 90))
    meas_x = np.array([x[0] for x in P.FRAC_SPUR_DIGITISED])
    meas_y = np.array([x[1] for x in P.FRAC_SPUR_DIGITISED])
    in_band = meas_x <= 6.2e-3
    lo = np.interp(np.log(meas_x), np.log(fracs), p10)
    hi = np.interp(np.log(meas_x), np.log(fracs), p90)
    med = np.interp(np.log(meas_x), np.log(fracs), p50)
    inside = int(np.sum((meas_y >= lo - 1.0) & (meas_y <= hi + 1.0)))
    # folded in-band noise from mismatch (slide 13 claims -127 dBc/Hz): noise-only sims, generic channel
    fold = []
    for i in range(min(n_mc, 8)):
        r0 = P.simulate(replace(qc, eps=tuple(draws[i]), n_cyc=n, os=1, settle=2 ** 12, **QUIET))
        f, L = C.phase_noise(r0["theta"], qc.f_pfd, nperseg=2 ** 14)
        fold.append(C.band_level(f, L, 1e5, 4e5))
    r00 = P.simulate(replace(qc, n_cyc=n, os=1, settle=2 ** 12, **QUIET))
    f, L = C.phase_noise(r00["theta"], qc.f_pfd, nperseg=2 ** 14)
    fold_ideal = C.band_level(f, L, 1e5, 4e5)
    out = dict(sigma=sig, fracs=fracs, p10=p10.tolist(), p50=p50.tolist(), p90=p90.tolist(), ideal=ideal,
               measured=P.FRAC_SPUR_DIGITISED, measured_inside_10_90_band=inside, n_measured=len(meas_x),
               folded_inband_9g5_mean=float(np.mean(fold)), folded_inband_9g5_max=float(np.max(fold)),
               folded_inband_ideal=fold_ideal)
    print(f"    sigma_slice={sig*100:.3f}%: median spur (VCO/2) " + ", ".join(f"2^{int(round(math.log2(fr)))}:{v:.1f}" for fr, v in zip(fracs, p50)))
    print(f"    measured points inside MC 10-90% band (+-1 dB): {inside}/{len(meas_x)}; ideal-match spur max {max(ideal):.1f} dBc")
    print(f"    folded in-band noise from mismatch (100-400 kHz, at 9.5 GHz): mean {np.mean(fold):.1f}, max {np.max(fold):.1f} "
          f"dBc/Hz (ideal {fold_ideal:.1f}); slide 13 claims -127")
    check("D4 measured frac-spur curve explained by 0.5%(3sigma) slice mismatch",
          inside >= int(0.75 * len(meas_x)), f"{inside}/{len(meas_x)} inside", ">=75% of points",
          "MC 10-90% band +-1 dB; spur at VCO/2")
    # in-band mean level: is the measured mean inside the MC distribution of the same statistic?
    mc_means = np.array([np.mean(np.interp(np.log(meas_x[in_band]), np.log(fracs), table[i])) for i in range(n_mc)])
    m_meas = float(np.mean(meas_y[in_band]))
    lo_m, hi_m = np.percentile(mc_means, 5), np.percentile(mc_means, 95)
    sigma_fit = sig * 10 ** ((m_meas - float(np.median(mc_means))) / 20)   # spur amplitude is linear in mismatch
    out.update(mc_inband_mean_5_95=[float(lo_m), float(hi_m)], measured_inband_mean=m_meas, sigma_inferred=sigma_fit)
    print(f"    in-band mean: measured {m_meas:.1f} dBc, MC 5-95% [{lo_m:.1f}, {hi_m:.1f}] -> inferred effective "
          f"sigma ~ {sigma_fit*100:.3f}% (3sigma {3*sigma_fit*100:.2f}%)")
    check("D4 in-band spur level within MC 5-95% for 3sigma=0.5%", lo_m - 1 <= m_meas <= hi_m + 1,
          round(m_meas, 1), f"[{lo_m:.1f}, {hi_m:.1f}]", "dBc @VCO/2, mean of in-band points")
    check("D4 slide 13: folded in-band noise from mismatch ~ -127 dBc/Hz", np.max(fold) < -124.0,
          round(float(np.max(fold)), 1), "<= -127 (+3 dB)", "dBc/Hz at 9.5 GHz, worst of 8 draws")
    fig, ax = plt.subplots(figsize=(7.5, 4.6))
    ax.fill_between(fracs, p10, p90, alpha=0.25, label=f"model MC 10-90% (sigma={sig*100:.2f}%/slice)")
    ax.semilogx(fracs, p50, "C0-", label="model MC median")
    ax.semilogx(fracs, ideal, "k:", label="model, ideal matching")
    ax.semilogx(meas_x, meas_y, "rs-", label="measured (slide 30, digitised)")
    ax.set(xlabel="fractional value (offset = frac x 160 MHz)", ylabel="fractional spur at VCO/2 [dBc]",
           title="D4  19.3 fractional spur: CP-slice mismatch mechanism", ylim=(-130, -55))
    ax.grid(True, which="both", alpha=.3)
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "D4_frac_spur_vs_measured.png", dpi=130)
    plt.close(fig)
    return out


def exp_d5(qc, n):
    print("\n[D5] slide-13 timing non-idealities + retimer margin at 9.5 GHz (T_VCO = 105 ps)")
    frac = 2.0 ** -10
    out = {}
    sp0, _ = spur_sim(qc, frac, n)
    out["ideal"] = sp0
    for dt in (1e-12, 3e-12, 10e-12):
        a, _ = spur_sim(replace(qc, dt1=dt, retimed=False), frac, n)
        b, _ = spur_sim(replace(qc, dt1=dt, retimed=True), frac, n)
        c, _ = spur_sim(replace(qc, post_skew=(0.0, dt, -dt)), frac, n)
        out[f"{dt*1e12:.0f}ps"] = dict(mux_ckq_no_retimer=a, mux_ckq_retimed=b, post_retimer_prop_mismatch=c)
        print(f"    {dt*1e12:4.0f} ps: (1) MUX/CK-Q w/o retimer {a:.1f} dBc | with retimer {b:.1f} | (2) post-retimer prop. mismatch {c:.1f}")
    check("D5 (1) retimers remove MUX/CK-Q mismatch", out["10ps"]["mux_ckq_retimed"] < sp0 + 1, round(out["10ps"]["mux_ckq_retimed"], 1),
          f"<= ideal {sp0:.1f}+1", "dBc @VCO/2")
    check("D5 (2) fixed propagation mismatch gives no spur", out["10ps"]["post_retimer_prop_mismatch"] < sp0 + 1,
          round(out["10ps"]["post_retimer_prop_mismatch"], 1), f"<= ideal {sp0:.1f}+1", "dBc @VCO/2")
    rows = []
    sig = 1.5e-12
    for msig in (3.0, 4.0, 4.5, 5.0, 6.0):
        q = replace(qc, rt_margin=msig * sig, rt_sigma=sig, n_cyc=n)
        r = P.simulate(q)
        f, L = P.output_pn(r, nperseg=2 ** 15)
        rows.append(dict(margin_sigma=msig, slip_rate=r["slips"] / (q.n_cyc * 3),
                         jitter_fs=C.rms_jitter(f, L, q.f_vco / 2, 1e4, 1e8) * 1e15))
        print(f"    retimer margin {msig:.1f} sigma (sigma {sig*1e12:.1f} ps): slip rate {rows[-1]['slip_rate']:.1e}, jitter {rows[-1]['jitter_fs']:.1f} fs")
    out["retimer"] = rows
    return out


def exp_d6(qc):
    print("\n[D6] CP offset: switched-cap Q_OFST vs bleed current (noise and reference spur)")
    seq = S.build_sequences(replace(qc.sliced(), n_cyc=2 ** 14))
    t_off = P.auto_t_off(qc, seq)
    T = 1 / qc.f_pfd
    q_ofst = qc.icp * t_off
    fg = np.logspace(4, 8, 3000)
    rows = {}
    for mode in ("sc", "bleed"):
        q = replace(qc, offset_mode=mode)
        A = P.analytic_pn(fg, q)
        var = P.offset_noise_var(q, t_off)
        rows[mode] = dict(offset_charge_noise_C=math.sqrt(var), offset_timing_noise_fs=math.sqrt(var) / q.icp * 1e15,
                          L_offset_100k=float(np.interp(1e5, fg, A["cp_offset"])),
                          jitter_fs=C.rms_jitter(fg, A["total"], q.f_vco / 2, 1e4, 1e8) * 1e15)
    print(f"    Q_OFST = Icp*T_off = {q_ofst*1e15:.0f} fC (C_OFST = {q_ofst/qc.vdd*1e15:.0f} fF @VDD {qc.vdd} V)")
    for k, v in rows.items():
        print(f"    {k:5s}: offset noise {v['offset_timing_noise_fs']:.1f} fs/edge, L_offset(100k) {v['L_offset_100k']:.1f} dBc/Hz, total jitter {v['jitter_fs']:.2f} fs")
    # ripple / reference spur: periodic steady-state charge waveform
    pulse = P.pulse_charges(0.0, t_off, qc.icp)                     # one-signed CP pulse of the locked loop
    bleed = pulse + P.pulse_charges(0.0, T, -qc.icp * t_off / T, n=256)
    sc = [(T / 2, q_ofst), (T / 2, -q_ofst)]                         # both re-distributed at the sampling instant
    sc_skew = [(T / 2, q_ofst), (T / 2 + 20e-12, -q_ofst)]           # 20 ps re-distribution skew
    sc_mis = [(T / 2, q_ofst * 1.0), (T / 2 + 20e-12, -q_ofst)]
    no_s_h = pulse + [(T / 2, -q_ofst)]                              # SC offset but CP pulse straight into the LPF
    spurs = {k: P.ref_spur_from_waveform(qc, w, qc.f_pfd)[0]["spur_dbc"] for k, w in
             [("bleed_current_offset", bleed), ("sc_ideal", sc + [(0.0, 1e-30)]), ("sc_20ps_redistribution_skew", sc_skew),
              ("sc_offset_cp_pulse_unsampled", no_s_h)]}
    # doubler duty-cycle error: CP charge alternates every other PFD cycle -> tone at f_xo = 80 MHz
    dbl = []
    for derr in (0.1e-12, 1e-12, 5e-12):
        ch = [(0.0, qc.icp * derr / 2), (T, -qc.icp * derr / 2)]        # alternating +- charge, period 2T
        dbl.append(dict(duty_err_ps=derr * 1e12,
                        spur_80M_dbc=P.ref_spur_from_waveform(qc, ch, qc.f_xo, n_harm=1)[0]["spur_dbc"]))
    for k, v in spurs.items():
        print(f"    reference spur (160 MHz, at VCO): {k:30s} {v:7.1f} dBc")
    for d in dbl:
        print(f"    DBL duty-cycle error {d['duty_err_ps']:.1f} ps -> 80 MHz spur {d['spur_80M_dbc']:.1f} dBc")
    check("D6 SC offset is quieter than a bleed-current offset", rows["sc"]["offset_timing_noise_fs"] < rows["bleed"]["offset_timing_noise_fs"],
          round(rows["sc"]["offset_timing_noise_fs"], 1), f"< {rows['bleed']['offset_timing_noise_fs']:.1f}", "fs per edge")
    check("D6 measured -101 dBc ref spur needs the sampled SC offset (bleed ripple far larger)",
          spurs["bleed_current_offset"] > -101 and spurs["sc_20ps_redistribution_skew"] < -101,
          dict(bleed=round(spurs["bleed_current_offset"], 1), sc_skew20ps=round(spurs["sc_20ps_redistribution_skew"], 1)),
          "bleed > -101 > SC", "dBc; Kvco/Icp are assumptions")
    return dict(t_off_ps=t_off * 1e12, q_ofst_fC=q_ofst * 1e15, noise=rows, ref_spurs=spurs, dbl=dbl)


def exp_d7(qc, n):
    print("\n[D7] CP non-linear region T_nonlin vs offset: folded SDM noise (M=1 vs M=4)")
    out = {}
    fig, ax = plt.subplots(figsize=(7, 4.4))
    T = qc.t_vco
    for M in (1, 4):
        rows = []
        for k in np.linspace(0, 2.4, 9):
            toff = qc.t_nonlin + k * T
            q = replace(qc, M=M, t_off=float(toff), nonlin_gain=1.0, beta=0.1, n_cyc=n // 2, **QUIET)
            r = P.simulate(q)
            f, L = P.output_pn(r, nperseg=2 ** 15)
            rows.append(dict(t_off_over_T=float(k), L_inband=C.band_level(f, L, 1e5, 4e5)))
        out[f"M{M}"] = rows
        ax.plot([x["t_off_over_T"] for x in rows], [x["L_inband"] for x in rows], "o-", label=f"M={M}")
        print(f"    M={M}: " + ", ".join(f"{x['t_off_over_T']:.1f}T:{x['L_inband']:.0f}" for x in rows))
    ax.set(xlabel="(T_off - T_nonlin) / T_VCO", ylabel="in-band L (100-400 kHz) at VCO/2 [dBc/Hz]",
           title="D7  folded DSM noise vs CP offset (beta=10%, T_nonlin region)")
    ax.grid(True, alpha=.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(OUT / "D7_offset_vs_folding.png", dpi=130)
    plt.close(fig)
    return out


def exp_d8(qc):
    print("\n[D8] jitter budget and what-if (analytic, joint-fit parameters)")
    fg = np.logspace(4, 8, 4000)
    rows = []
    for label, kw in [("measured design point (M=4)", {}), ("M=1 (no multipath)", dict(M=1)), ("M=2", dict(M=2)),
                      ("M=8", dict(M=8)), ("M=16", dict(M=16)), ("M=4, CP noise -3 dB", dict(cp_noise_scale=qc.cp_noise_scale / 2)),
                      ("M=4, VCO -3 dB", dict(vco_on=True)), ("M=4, ref doubler off (80 MHz PFD)", dict(dbl=False, N=118))]:
        q = replace(qc, **kw)
        A = P.analytic_pn(fg, q)
        if label.startswith("M=4, VCO -3 dB"):
            A["vco"] = A["vco"] - 3
            A["total"] = 10 * np.log10(sum(10 ** (v / 10) for k, v in A.items() if k != "total"))
        j = C.rms_jitter(fg, A["total"], q.f_vco / 2, 1e4, 1e8)
        comp = {k: round(C.rms_jitter(fg, v, q.f_vco / 2, 1e4, 1e8) * 1e15, 1) for k, v in A.items() if k != "total"}
        rows.append(dict(case=label, jitter_fs=j * 1e15, fom=fom(P.PAPER["power_mw"], j), components_fs=comp))
        print(f"    {label:36s}: {j*1e15:5.1f} fs  (FoM {fom(P.PAPER['power_mw'], j):.1f} dB)  " + ", ".join(f"{k} {v}" for k, v in comp.items()))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    n = 2 ** 18 if a.quick else 2 ** 20
    n_spur = 2 ** 17 if a.quick else 2 ** 18
    n_mc = 8 if a.quick else 30
    t0 = time.time()
    base = P.MP19p3Params(fc=0.6e6, pm=68.6, ref_white_fs=97e-15, xo_flicker_fs2=6.4e-33, n_cyc=n)
    res = dict(model="ISSCC 2025 19.3 MediaTek multipath-feedback fractional-N PLL", paper=P.PAPER,
               measured=dict(vco=P.VCO_FREE_MARKERS, pll=P.PLL_MARKERS, pll_spur=P.PLL_SPUR_MARKERS,
                             no_multipath_digitised=P.PLL_NO_MP_DIGITISED, frac_spur_digitised=P.FRAC_SPUR_DIGITISED))
    res["D0_arithmetic"] = exp_d0(base)
    res["D1_vco_fom"] = exp_d1()
    d2, qc, qa = exp_d2(base, n)
    res["D2_identification"] = d2
    res["params_joint_fit"] = asdict(qc)
    res["D3_sdm"] = exp_d3(qc, n)
    res["D4_frac_spur"] = exp_d4(qc, n_mc, n_spur)
    res["D5_timing"] = exp_d5(qc, n_spur)
    res["D6_offset_cp"] = exp_d6(qc)
    res["D7_nonlin"] = exp_d7(qc, n)
    res["D8_budget"] = exp_d8(qc)
    res["checks"] = CHECKS
    res["runtime_s"] = time.time() - t0
    (OUT / "isscc25_19p3_results.json").write_text(json.dumps(res, indent=1, default=float))
    npass = sum(c["result"] == "PASS" for c in CHECKS)
    print(f"\n{npass}/{len(CHECKS)} checks PASS, runtime {time.time()-t0:.0f} s")


if __name__ == "__main__":
    main()
