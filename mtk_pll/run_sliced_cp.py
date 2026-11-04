"""Reproduction + non-ideality study of the MTK sliced-CP fractional-N PLL
(US 11,509,315 B2).  Writes figures and results/sliced_cp_results.json.

    python3 run_sliced_cp.py            # full run (~1-2 min)
    python3 run_sliced_cp.py --quick    # shorter records for a smoke test
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
from mtkpll import common as C          # noqa: E402
from mtkpll import sliced_cp as S       # noqa: E402

OUT = Path(__file__).parent / "results"
OUT.mkdir(exist_ok=True)
NOISE_OFF = dict(vco_L1M=None, ref_floor=None, pfd_jit=0.0, cp_noise=False)
CHECKS = []


def check(name, ok, measured, expected, note=""):
    CHECKS.append(dict(check=name, result="PASS" if ok else "FAIL",
                       measured=measured, expected=expected, note=note))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: measured={measured} expected={expected} {note}")


def frac_K(frac, Q=2 ** 24):
    return int(round(frac * Q))


def H_closed(p, f):
    lf = S.loop_filter(p)
    Lg = C.cp_open_loop(f, p.icp, p.kvco, p.nf, lf)
    return np.abs(Lg / (1 + Lg))


# -----------------------------------------------------------------------------
def exp_identity(base):
    print("\n[A0] patent arithmetic: SDM->{D_N,D_f}->accumulator->SEL/S, DTC=B*T_VCO")
    rows = []
    for arch, X in [("conv", 1), ("two", 2), ("two", 4), ("two", 8), ("binary", 4), ("binary", 8)]:
        p = replace(base, arch=arch, X=X, n_cyc=2 ** 16)
        seq = S.build_sequences(p)
        ids = S.check_identity(seq, p)
        w = p.slices()
        rows.append(dict(arch=arch, X=X, slices=[round(x, 4) for x in w], **ids,
                         dQ_over_IcpT=1 / p.x_eff,
                         B_range=[int(seq["B"].min()), int(seq["B"].max())],
                         divisor_range=[int(seq["divisor"].min()), int(seq["divisor"].max())]))
        check(f"A0 identity {arch} X={X}", all(ids.values()), ids, "all True",
              "D_N+S+dB/X == y_fine/X ; sum w_i*(r1+d_i) == r_eff")
    return rows


def exp_sdm(base, n):
    print("\n[A1] SDM quantisation-noise reduction vs X (only SDM active)")
    res = {}
    fig, ax = plt.subplots(figsize=(7.5, 4.6))
    ref = None
    for arch, X in [("conv", 1), ("two", 2), ("two", 4), ("two", 8), ("two", 16), ("binary", 8)]:
        p = replace(base, arch=arch, X=X, n_cyc=n, **NOISE_OFF)
        r = S.simulate(p)
        f, L = S.pn(r, 2 ** 16)
        lvl = C.band_level(f, L, 2e6, 20e6)
        jit = C.rms_jitter(f, L, p.f_vco, 1e4, p.f_ref / 2)
        if ref is None:
            ref = lvl
        A = S.analytic_pn(f, p, r["t_off"])
        lvl_a = C.band_level(f, A["sdm"], 2e6, 20e6)
        res[f"{arch}_X{X}"] = dict(level_2_20MHz=lvl, delta_dB=lvl - ref,
                                   expected_delta=-20 * math.log10(X), analytic_level=lvl_a,
                                   sdm_jitter_fs=jit * 1e15)
        fs_, Ls_ = C.log_smooth(f, L, 150, 1e4, 2e8)
        ax.semilogx(fs_, Ls_, label=f"{arch} X={X}: {jit*1e15:.0f} fs")
        if arch != "conv":
            check(f"A1 SDM noise {arch} X={X}", abs((lvl - ref) + 20 * math.log10(X)) < 0.6,
                  round(lvl - ref, 2), round(-20 * math.log10(X), 2), "dB, band 2-20 MHz")
        check(f"A1 sim-vs-analytic {arch} X={X}", abs(lvl - lvl_a) < 1.0, round(lvl, 2), round(lvl_a, 2), "dBc/Hz")
    ax.set(xlabel="offset frequency [Hz]", ylabel="L(f) [dBc/Hz]",
           title="A1  SDM-only phase noise vs slicing level X (sim)", ylim=(-190, -90))
    ax.grid(True, which="both", alpha=.3)
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "A1_sdm_noise_vs_X.png", dpi=130)
    plt.close(fig)
    return res


def exp_budget(base, n):
    print("\n[A2] full noise budget, sim vs analytic components")
    out = {}
    fig, axs = plt.subplots(1, 2, figsize=(12, 4.6), sharey=True)
    cases = [("conv", 1), ("two", 2), ("two", 8), ("binary", 8)]
    for arch, X in cases:
        p = replace(base, arch=arch, X=X, n_cyc=n)
        r = S.simulate(p)
        f, L = S.pn(r, 2 ** 17)
        A = S.analytic_pn(f, p, r["t_off"], r["emean"])
        jit = C.rms_jitter(f, L, p.f_vco, 1e4, p.f_ref / 2)
        jit_a = C.rms_jitter(f, A["total"], p.f_vco, 1e4, p.f_ref / 2)
        comp_jit = {k: C.rms_jitter(f, v, p.f_vco, 1e4, p.f_ref / 2) * 1e15 for k, v in A.items()}
        out[f"{arch}_X{X}"] = dict(t_off_ps=r["t_off"] * 1e12, jitter_fs=jit * 1e15, jitter_analytic_fs=jit_a * 1e15,
                                  component_jitter_fs=comp_jit,
                                  L_100k=C.band_level(f, L, 90e3, 110e3), L_1M=C.band_level(f, L, 0.9e6, 1.1e6),
                                  L_10M=C.band_level(f, L, 9e6, 11e6),
                                  max_pulse_ps=[float(x) * 1e12 for x in r["emax"]],
                                  min_pulse_ps=[float(x) * 1e12 for x in r["emin"]])
        check(f"A2 jitter sim-vs-analytic {arch} X={X}", abs(jit / jit_a - 1) < 0.08,
              round(jit * 1e15, 1), round(jit_a * 1e15, 1), "fs (10k..fref/2)")
        if (arch, X) in [("conv", 1), ("two", 8)]:
            ax = axs[0 if X == 1 else 1]
            fs_, Ls_ = C.log_smooth(f, L, 150, 1e4, 2e8)
            ax.semilogx(fs_, Ls_, "k", lw=2, label=f"sim total ({jit*1e15:.0f} fs)")
            m = f <= p.f_ref / 3
            for key, sty in [("total", "r--"), ("sdm", "C0:"), ("vco", "C1:"), ("cp", "C2:"), ("ref", "C3:"), ("pfd", "C4:")]:
                ax.semilogx(f[m], A[key][m], sty, label=f"analytic {key}")
            ax.set(title=f"A2  {arch} X={X}: T_off={r['t_off']*1e12:.0f} ps", xlabel="offset [Hz]", ylim=(-170, -95))
            ax.grid(True, which="both", alpha=.3)
            ax.legend(fontsize=7)
    axs[0].set_ylabel("L(f) [dBc/Hz]")
    fig.tight_layout()
    fig.savefig(OUT / "A2_noise_budget.png", dpi=130)
    plt.close(fig)
    j1, j8 = out["conv_X1"]["jitter_fs"], out["two_X8"]["jitter_fs"]
    print(f"  jitter conv={j1:.1f} fs, two X=8={j8:.1f} fs, binary X=8={out['binary_X8']['jitter_fs']:.1f} fs")

    # --- CP-noise-only and PFD-noise-only in-band comparisons (claims 1-2 dB, 3 dB)
    print("  CP-only / PFD-only in-band levels (100-300 kHz)")
    cp, pf = {}, {}
    for arch, X in cases:
        p = replace(base, arch=arch, X=X, n_cyc=n, vco_L1M=None, ref_floor=None, pfd_jit=0.0, cp_noise=True)
        r = S.simulate(p)
        f, L = S.pn(r, 2 ** 16)
        cp[f"{arch}_X{X}"] = dict(level=C.band_level(f, L, 1e5, 3e5), t_off_ps=r["t_off"] * 1e12)
        p = replace(base, arch=arch, X=X, n_cyc=n, vco_L1M=None, ref_floor=None, pfd_jit=200e-15, cp_noise=False)
        r = S.simulate(p)
        f, L = S.pn(r, 2 ** 16)
        pf[f"{arch}_X{X}"] = dict(level=C.band_level(f, L, 1e5, 3e5), sum_w2=float(np.sum(p.slices() ** 2)))
    for k in cp:
        cp[k]["delta_dB"] = cp[k]["level"] - cp["conv_X1"]["level"]
        pf[k]["delta_dB"] = pf[k]["level"] - pf["conv_X1"]["level"]
        pf[k]["expected_dB"] = 10 * math.log10(pf[k]["sum_w2"])
        print(f"    {k}: CP {cp[k]['delta_dB']:+.2f} dB (T_off {cp[k]['t_off_ps']:.0f} ps) | PFD {pf[k]['delta_dB']:+.2f} dB (exp {pf[k]['expected_dB']:+.2f})")
    check("A2 CP-noise reduction two X=8 (patent: 1-2 dB)", -2.5 < cp["two_X8"]["delta_dB"] < -0.8,
          round(cp["two_X8"]["delta_dB"], 2), "-1..-2", "dB in-band; from smaller T_OFFSET")
    check("A2 PFD-noise reduction two X=2 (patent: 3 dB)", abs(pf["two_X2"]["delta_dB"] + 3.01) < 0.5,
          round(pf["two_X2"]["delta_dB"], 2), -3.01, "dB, independent per-slice PFD jitter")
    check("A2 PFD-noise binary X=8 = 10log(sum w^2)", abs(pf["binary_X8"]["delta_dB"] - pf["binary_X8"]["expected_dB"]) < 0.5,
          round(pf["binary_X8"]["delta_dB"], 2), round(pf["binary_X8"]["expected_dB"], 2), "dB")
    return dict(budget=out, cp_only=cp, pfd_only=pf)


def spur_case(base, arch, X, frac, n=2 ** 18, **kw):
    p = replace(base, arch=arch, X=X, K=frac_K(frac), n_cyc=n, os=1, settle=2 ** 12, **NOISE_OFF)
    p = replace(p, **kw)
    r = S.simulate(p)
    th = r["theta"]
    th = th[: (len(th) // int(round(1 / frac))) * int(round(1 / frac))]
    return C.spur_dbc(th, p.f_ref, frac * p.f_ref), r, p


def sawtooth_rho(r, frac, X):
    """|fundamental of B| / (X/pi): how much the SDM's own fine-LSB noise
    smears the wrap of the B sawtooth.  Also returns the closed-form estimate
    exp(-2 pi^2 var(E/Q) / X^2)."""
    seq = r["seq"]
    p = r["params"]
    B = seq["B"][p.settle:].astype(float)
    per = int(round(1 / frac))
    B = B[: len(B) // per * per]
    k = np.arange(len(B))
    aB = abs(np.sum(B * np.exp(-2j * np.pi * frac * k))) * 2 / len(B)
    var_n = float(np.var(seq["E"] / p.Q))
    return aB * math.pi / X, math.exp(-2 * math.pi ** 2 * var_n / X ** 2), var_n


def mismatch_pred(eps, X, rho, H):
    """SSB spur [dBc] of a two-slice CP whose fine slice is off by eps:
    timing error = eps*(1-1/X)*B*T_VCO/X, B ~ sawtooth with fundamental rho*X/pi."""
    return 20 * math.log10(eps * (1 - 1 / X) * rho * H)


def exp_mismatch(base, n):
    print("\n[A3] CP slice current-ratio mismatch -> fractional spur (sawtooth B)")
    out = dict(eps_sweep=[], fs_sweep=[], dem=None, binary_mc=None)
    frac = 1 / 256
    fs = frac * base.f_ref
    eps_list = [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2]
    sp0, r0, p = spur_case(base, "two", 8, frac)
    rho, rho_cf, var_n = sawtooth_rho(r0, frac, 8)
    out["rho"] = dict(measured=rho, closed_form=rho_cf, var_E_over_Q=var_n)
    print(f"    sawtooth fundamental factor rho={rho:.3f} (closed form {rho_cf:.3f}, var(E/Q)={var_n:.3f})")
    for eps in eps_list:
        sp, r, p = spur_case(base, "two", 8, frac, eps=(0.0, eps))
        pred = mismatch_pred(eps, 8, rho, H_closed(p, fs))
        out["eps_sweep"].append(dict(eps=eps, spur_dBc=sp, predicted_dBc=float(pred),
                                     rule_of_thumb_dBc=20 * math.log10(eps)))
        print(f"    eps={eps:.0e}: spur {sp:6.1f} dBc  predicted {pred:6.1f}  (20log eps = {20*math.log10(eps):.0f})")
    out["no_mismatch_spur_dBc"] = sp0
    worst = max(abs(e["spur_dBc"] - e["predicted_dBc"]) for e in out["eps_sweep"])
    check("A3 spur = 20log10(eps(1-1/X)rho|H|) (two X=8, f_s=203 kHz)", worst < 0.5, round(worst, 2), "<0.5 dB error",
          f"ideal (eps=0) spur {sp0:.0f} dBc")
    # fractional-offset sweep at eps = 1e-3
    for fr in [1 / 1024, 1 / 256, 1 / 64, 1 / 16]:
        sp, r, p = spur_case(base, "two", 8, fr, eps=(0.0, 1e-3))
        rho_i = sawtooth_rho(r, fr, 8)[0]
        pred = mismatch_pred(1e-3, 8, rho_i, H_closed(p, fr * p.f_ref))
        out["fs_sweep"].append(dict(f_spur=fr * p.f_ref, spur_dBc=sp, predicted_dBc=float(pred), rho=rho_i))
        print(f"    f_s={fr*p.f_ref/1e3:7.1f} kHz: spur {sp:6.1f} dBc predicted {pred:6.1f}")
    # X dependence at fixed eps (the SDM's own noise dithers B -> small X is helped)
    out["x_sweep"] = []
    for X in [2, 4, 8, 16]:
        sp, r, p = spur_case(base, "two", X, frac, eps=(0.0, 1e-3))
        rho_i, rho_c, _ = sawtooth_rho(r, frac, X)
        out["x_sweep"].append(dict(X=X, spur_dBc=sp, rho=rho_i, rho_closed_form=rho_c,
                                   predicted_dBc=mismatch_pred(1e-3, X, rho_i, H_closed(p, fs))))
        print(f"    X={X:2d}: spur {sp:6.1f} dBc (rho={rho_i:.3f}, closed form {rho_c:.3f})")
    # binary slicing with independent per-slice mismatch (DNL)
    rng = np.random.default_rng(5)
    mc = []
    for t in range(20):
        e = tuple(rng.normal(0, 1e-3, 4))
        sp, r, p = spur_case(base, "binary", 8, frac, n=2 ** 17, eps=e)
        mc.append(sp)
    out["binary_mc"] = dict(sigma=1e-3, spur_dBc_mean=float(np.mean(mc)), spur_dBc_max=float(np.max(mc)))
    print(f"    binary X=8, sigma_slice=0.1%: spur mean {np.mean(mc):.1f} / max {np.max(mc):.1f} dBc (20 MC)")
    # unit-cell DEM: static vs random rotation (full noise to see noise floor)
    dem = {}
    for mode in ["static", "random"]:
        p = replace(base, arch="two", X=8, K=frac_K(frac), n_cyc=n, unit_sigma=3e-3, dem=mode)
        r = S.simulate(p)
        f, L = S.pn(r, 2 ** 17)
        th = r["theta"][:: p.os]
        th = th[: (len(th) // 256) * 256]
        dem[mode] = dict(spur_dBc=C.spur_dbc(th, p.f_ref, fs), L_inband=C.band_level(f, L, 3e4, 1.5e5),
                         jitter_fs=C.rms_jitter(f, L, p.f_vco, 1e4, p.f_ref / 2) * 1e15)
        if mode == "static":
            f_s, L_s = f, L
        else:
            f_r, L_r = f, L
    p = replace(base, arch="two", X=8, K=frac_K(frac), n_cyc=n)
    r = S.simulate(p)
    f0, L0 = S.pn(r, 2 ** 17)
    dem["ideal"] = dict(L_inband=C.band_level(f0, L0, 3e4, 1.5e5), jitter_fs=C.rms_jitter(f0, L0, p.f_vco, 1e4, p.f_ref / 2) * 1e15)
    out["dem"] = dem
    print(f"    unit-cell sigma=0.3%: static spur {dem['static']['spur_dBc']:.1f} dBc | random-DEM spur {dem['random']['spur_dBc']:.1f} dBc, "
          f"in-band {dem['ideal']['L_inband']:.1f} -> {dem['random']['L_inband']:.1f} dBc/Hz")

    fig, axs = plt.subplots(1, 3, figsize=(15, 4.4))
    e = np.array([x["eps"] for x in out["eps_sweep"]])
    axs[0].semilogx(e, [x["spur_dBc"] for x in out["eps_sweep"]], "o", label="sim")
    axs[0].semilogx(e, [x["predicted_dBc"] for x in out["eps_sweep"]], "-", label="20log10(eps(1-1/X) rho |H(f_s)|)")
    axs[0].set(xlabel="slice current-ratio error eps", ylabel="spur [dBc]", title="A3a  spur @ f_s=203 kHz (two, X=8)")
    fsw = np.array([x["f_spur"] for x in out["fs_sweep"]])
    fgrid = np.logspace(4, 7.5, 200)
    axs[1].semilogx(fgrid, 20 * np.log10(1e-3 * (7 / 8) * out["rho"]["measured"] * H_closed(p, fgrid)), "-",
                    label="prediction eps=1e-3")
    axs[1].semilogx(fsw, [x["spur_dBc"] for x in out["fs_sweep"]], "o", label="sim")
    axs[1].set(xlabel="fractional spur offset frac*f_ref [Hz]", ylabel="spur [dBc]", title="A3b  spur vs channel (eps=0.1%)")
    fs1, Ls1 = C.log_smooth(f_s, L_s, 200, 1e4, 3e7)
    fr1, Lr1 = C.log_smooth(f_r, L_r, 200, 1e4, 3e7)
    f01, L01 = C.log_smooth(f0, L0, 200, 1e4, 3e7)
    axs[2].semilogx(f01, L01, "k", label="ideal match")
    axs[2].semilogx(fs1, Ls1, "C3", label="unit sigma 0.3%, static")
    axs[2].semilogx(fr1, Lr1, "C0", label="unit sigma 0.3%, random DEM")
    axs[2].set(xlabel="offset [Hz]", ylabel="L(f) [dBc/Hz] (log-bin avg, spur smeared)", title="A3c  DEM: spur -> noise")
    for a in axs:
        a.grid(True, which="both", alpha=.3)
        a.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "A3_current_mismatch.png", dpi=130)
    plt.close(fig)
    return out


def exp_skew(base, n):
    print("\n[A4] timing skews: dT1 (pre-retimer, B-dependent) vs dT2/dT3 (post-retimer, constant)")
    frac = 1 / 256
    fs = frac * base.f_ref
    out = {}
    sp_ideal, r, p = spur_case(base, "two", 8, frac)
    out["ideal"] = sp_ideal
    for dt in [2e-12, 5e-12, 20e-12]:
        sp_post, r_post, _ = spur_case(base, "two", 8, frac, post_skew=(0.0, dt))
        sp_pre_nr, _, _ = spur_case(base, "two", 8, frac, dt1=dt, retimed=False)
        sp_pre_rt, _, _ = spur_case(base, "two", 8, frac, dt1=dt, retimed=True)
        # predicted spur for dT1 without retimer: w2*dT1*1[B==0] pulse train
        X = 8
        amp_t = (1 / X) * dt * 2 * math.sin(math.pi / X) / math.pi
        pred = 20 * math.log10(2 * math.pi * p.f_vco * amp_t / 2) + 20 * math.log10(H_closed(p, fs))
        out[f"{dt*1e12:.0f}ps"] = dict(post_skew_spur=sp_post, dT1_no_retimer_spur=sp_pre_nr,
                                        dT1_no_retimer_pred=float(pred), dT1_retimed_spur=sp_pre_rt,
                                        static_phase_shift_fs=float(dt / X * 1e15))
        print(f"    skew {dt*1e12:4.0f} ps: post(dT2/dT3) spur {sp_post:6.1f} | dT1 no-retimer {sp_pre_nr:6.1f} (pred {pred:6.1f}) | dT1 retimed {sp_pre_rt:6.1f} dBc")
    check("A4 constant dT2/dT3 does not create spur", out["20ps"]["post_skew_spur"] < sp_ideal + 1.0,
          round(out["20ps"]["post_skew_spur"], 1), f"<= ideal {sp_ideal:.1f}+1", "dBc, 20 ps skew")
    check("A4 retimer removes dT1", out["20ps"]["dT1_retimed_spur"] < sp_ideal + 1.0,
          round(out["20ps"]["dT1_retimed_spur"], 1), f"<= ideal {sp_ideal:.1f}+1", "dBc")
    check("A4 dT1 without retimer matches pulse-train prediction",
          abs(out["5ps"]["dT1_no_retimer_spur"] - out["5ps"]["dT1_no_retimer_pred"]) < 1.5,
          round(out["5ps"]["dT1_no_retimer_spur"], 1), round(out["5ps"]["dT1_no_retimer_pred"], 1), "dBc")
    # noise check: constant skew must not change noise (full-noise run)
    pa = replace(base, arch="two", X=8, n_cyc=n)
    ra = S.simulate(pa)
    rb = S.simulate(replace(pa, post_skew=(0.0, 20e-12)))
    fa, La = S.pn(ra, 2 ** 16)
    fb, Lb = S.pn(rb, 2 ** 16)
    ja = C.rms_jitter(fa, La, pa.f_vco, 1e4, pa.f_ref / 2)
    jb = C.rms_jitter(fb, Lb, pa.f_vco, 1e4, pa.f_ref / 2)
    out["noise_jitter_fs"] = dict(no_skew=ja * 1e15, post_skew_20ps=jb * 1e15)
    check("A4 constant skew: no noise folding", abs(jb / ja - 1) < 0.03, round(jb * 1e15, 1), round(ja * 1e15, 1), "fs")
    # MMD jitter without retimer
    rc = S.simulate(replace(pa, retimed=False, mmd_jit=300e-15))
    fc_, Lc = S.pn(rc, 2 ** 16)
    out["noise_jitter_fs"]["no_retimer_mmd300fs"] = C.rms_jitter(fc_, Lc, pa.f_vco, 1e4, pa.f_ref / 2) * 1e15
    print(f"    jitter: ideal {ja*1e15:.1f} fs | +20ps post skew {jb*1e15:.1f} fs | no retimer, MMD 300 fs rms: {out['noise_jitter_fs']['no_retimer_mmd300fs']:.1f} fs")
    return out


def exp_retimer(base, n):
    print("\n[A5] retimer setup margin -> cycle slips")
    out = []
    sig = 2e-12
    pa = replace(base, arch="two", X=8, n_cyc=n // 2, rt_sigma=sig)
    for msig in [2.0, 3.0, 4.0, 5.0, 6.0]:
        r = S.simulate(replace(pa, rt_margin=msig * sig))
        f, L = S.pn(r, 2 ** 15)
        rate = r["slips"] / (pa.n_cyc * 2)
        out.append(dict(margin_over_sigma=msig, slip_rate=rate, jitter_fs=C.rms_jitter(f, L, pa.f_vco, 1e4, pa.f_ref / 2) * 1e15,
                        L_inband=C.band_level(f, L, 1e5, 3e5)))
        print(f"    margin {msig:.0f} sigma: slip rate {rate:.2e}, in-band {out[-1]['L_inband']:.1f} dBc/Hz, jitter {out[-1]['jitter_fs']:.1f} fs")
    # code-dependent margin: B=0 bypass path faster by dT1 -> its margin shrinks
    frac = 1 / 256
    sp, r, p = spur_case(base, "two", 8, frac, rt_margin=10e-12, dt1=8e-12, rt_sigma=sig)
    out_cd = dict(spur_dBc=sp, slips=r["slips"])
    print(f"    code-dependent margin (B=0 path 2 ps left, sigma 2 ps): spur {sp:.1f} dBc, slips {r['slips']}")
    return dict(sweep=out, code_dependent=out_cd)


def exp_cp_nonlin(base, n):
    print("\n[A6] CP UP/DN mismatch (beta=10%) vs offset T_off: noise folding")
    out = {}
    fig, ax = plt.subplots(figsize=(7, 4.4))
    for arch, X in [("conv", 1), ("two", 8), ("binary", 8)]:
        p0 = replace(base, arch=arch, X=X, n_cyc=n // 2, beta=0.10, **NOISE_OFF)
        t_auto = S.auto_t_off(p0, S.build_sequences(replace(p0, n_cyc=2 ** 14)))
        rows = []
        for toff in np.linspace(0, 450e-12, 10):
            r = S.simulate(replace(p0, t_off=float(toff)))
            f, L = S.pn(r, 2 ** 15)
            rows.append(dict(t_off_ps=toff * 1e12, L_inband=C.band_level(f, L, 1e5, 3e5)))
        out[f"{arch}_X{X}"] = dict(t_off_auto_ps=t_auto * 1e12, rows=rows)
        ax.plot([x["t_off_ps"] for x in rows], [x["L_inband"] for x in rows], "o-", label=f"{arch} X={X} (auto T_off={t_auto*1e12:.0f} ps)")
        print(f"    {arch} X={X}: " + ", ".join(f"{x['t_off_ps']:.0f}ps:{x['L_inband']:.0f}" for x in rows))
    ax.set(xlabel="CP offset T_off [ps]", ylabel="in-band L(100-300 kHz) [dBc/Hz]",
           title="A6  folded SDM noise, CP UP/DN mismatch 10% (other noise off)")
    ax.grid(True, alpha=.3)
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "A6_cp_nonlinearity.png", dpi=130)
    plt.close(fig)
    lin8 = [x for x in out["two_X8"]["rows"] if x["t_off_ps"] >= out["two_X8"]["t_off_auto_ps"]]
    lin1 = [x for x in out["conv_X1"]["rows"] if x["t_off_ps"] < out["conv_X1"]["t_off_auto_ps"] - 60]
    check("A6 X=8 linear at T_off >= auto, while conv still folds at that T_off",
          lin8[0]["L_inband"] < -150 and any(x["L_inband"] > -140 for x in lin1),
          round(lin8[0]["L_inband"], 1), "<-150 (no folding)", "dBc/Hz")
    return out


def exp_xlimit(base):
    print("\n[A7] X limit: CP pulse must end before next PFD event (window ~ T_ref/2)")
    rows = []
    for fref in [26e6, 52e6, 104e6, 208e6]:
        Nf = 6.0e9 / fref
        tv = 1 / 6.0e9
        for arch in ["two", "binary"]:
            xmax = 1
            for X in [2, 4, 8, 16, 32, 64]:
                toff = (1 + 1 / X) * tv + base.t_guard
                extra = (X - 1) * (1 - 1 / X) * tv if arch == "two" else (1 - 1 / X) * tv
                t_on = toff + 2 * tv / X + extra + base.t_rst
                if t_on < 0.5 / fref:
                    xmax = X
            rows.append(dict(f_ref=fref, arch=arch, X_max=xmax))
        print(f"    f_ref={fref/1e6:5.0f} MHz: X_max two={rows[-2]['X_max']}, binary={rows[-1]['X_max']}")
    return rows


def exp_lowjitter(base, n):
    print("\n[A8] what the patent's '<50 fs rms' needs: low-jitter design point (sim + analytic budget)")
    lj = dict(f_ref=104e6, N=57, icp=4e-3, vco_L1M=-124.0, ref_floor=-168.0, fc=1.2e6)
    out = {}
    for arch, X in [("conv", 1), ("binary", 16)]:
        p = replace(base, arch=arch, X=X, n_cyc=n, **lj)
        r = S.simulate(p)
        f, L = S.pn(r, 2 ** 17)
        A = S.analytic_pn(f, p, r["t_off"], r["emean"])
        comp = {k: C.rms_jitter(f, v, p.f_vco, 1e4, p.f_ref / 2) * 1e15 for k, v in A.items()}
        out[f"{arch}_X{X}"] = dict(jitter_fs=C.rms_jitter(f, L, p.f_vco, 1e4, p.f_ref / 2) * 1e15,
                                   component_jitter_fs=comp, f_vco=p.f_vco, t_off_ps=r["t_off"] * 1e12)
        print(f"    {arch} X={X}: sim {out[f'{arch}_X{X}']['jitter_fs']:.1f} fs | analytic " +
              ", ".join(f"{k} {v:.1f}" for k, v in comp.items()))
    out["conditions"] = lj
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    n = 2 ** 17 if a.quick else 2 ** 19
    base = S.SlicedCPParams(n_cyc=n)
    lf = S.loop_filter(base)
    fc, pm = C.loop_margins(base.icp, base.kvco, base.nf, lf)
    t0 = time.time()
    results = dict(model="US11509315 sliced-CP fractional-N PLL", params=asdict(base),
                   loop=dict(fc=fc, pm=pm, **lf), f_vco=base.f_vco)
    results["A0_identity"] = exp_identity(base)
    results["A1_sdm"] = exp_sdm(base, n)
    results["A2_budget"] = exp_budget(base, n)
    results["A3_mismatch"] = exp_mismatch(base, n)
    results["A4_skew"] = exp_skew(base, n)
    results["A5_retimer"] = exp_retimer(base, n)
    results["A6_cp_nonlin"] = exp_cp_nonlin(base, n)
    results["A7_xlimit"] = exp_xlimit(base)
    results["A8_lowjitter"] = exp_lowjitter(base, n)
    results["checks"] = CHECKS
    results["runtime_s"] = time.time() - t0
    (OUT / "sliced_cp_results.json").write_text(json.dumps(results, indent=1, default=float))
    npass = sum(c["result"] == "PASS" for c in CHECKS)
    print(f"\n{npass}/{len(CHECKS)} checks PASS, runtime {time.time()-t0:.0f} s")


if __name__ == "__main__":
    main()
