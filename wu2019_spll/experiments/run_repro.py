"""Reproduction of the figures / numbers of Wu et al., JSSC 2019.

    python experiments/run_repro.py            # all (~3-4 min on 4 cores)
    python experiments/run_repro.py pn spur    # subset: arch dtc cal dccpn pn budget spur band
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from style import AXIS, C, INK, INK2, MUTED, plt, save  # noqa: E402

from spll import (SCENARIOS, DTCModel, SPLLParams, jitter_model, l_model,  # noqa: E402
                  loop_metrics, near_integer, noise_budget, simulate, spur_run)
from spll import analysis as an  # noqa: E402
from spll import measured as ms  # noqa: E402
from spll.noise import outbuf_l, vco_l  # noqa: E402

FIG = ROOT / "figures"
RES = ROOT / "results"
SUM: dict = {}
N_PN, D_PN = 1 << 21, 1 << 15


def _f(x):
    return float(np.asarray(x))


def pn_sim(p: SPLLParams, n=N_PN, d=D_PN, m_half=1, measured_like=True):
    r = simulate(p, n + d, m_half=m_half, n_discard=d)
    f, s = an.timing_psd(r.tau_steady(), r.fs_out)
    lin = 0.5 * (2 * np.pi * p.f_vco) ** 2 * s
    if measured_like:
        lin = lin + outbuf_l(p, f)
    sel = (f >= 1e4) & (f <= 1e7)
    j = np.sqrt(np.trapezoid(2 * lin[sel], f[sel])) / (2 * np.pi * p.f_vco)
    return f, 10 * np.log10(lin), j, r


def smooth_db(f, l_db, frac=0.05):
    """Log-frequency smoothing of a PSD in dB (display only)."""
    lin = 10 ** (l_db / 10)
    out = np.empty_like(lin)
    lf = np.log10(f)
    c = np.cumsum(np.concatenate(([0.0], lin)))
    lo = np.searchsorted(lf, lf - frac)
    hi = np.searchsorted(lf, lf + frac, side="right")
    out = (c[hi] - c[lo]) / np.maximum(hi - lo, 1)
    return 10 * np.log10(out)


# ------------------------------------------------------------------------ 0
def exp_arch():
    from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
    fig, ax = plt.subplots(figsize=(13.0, 5.6))
    ax.set_xlim(0, 26)
    ax.set_ylim(0, 11)
    ax.axis("off")
    hi = "#eaf2fc"

    def box(x, y, w, h, text, col=INK2, fill="#ffffff", fs=7.6):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.15",
                                    lw=1.0, ec=col, fc=fill))
        ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs, color=INK)

    def arr(p0, p1, col=INK2, cs=None, lw=0.9):
        kw = dict(arrowstyle="-|>", mutation_scale=9, lw=lw, color=col, shrinkA=0, shrinkB=0)
        if cs:
            kw["connectionstyle"] = cs
        ax.add_patch(FancyArrowPatch(p0, p1, **kw))

    def lab(x, y, t, col=INK2, ha="center"):
        ax.text(x, y, t, fontsize=6.8, color=col, ha=ha)

    y1, h = 8.0, 1.3
    box(0.2, y1, 1.7, h, "CLKREF\n52 MHz XO")
    box(2.5, y1, 1.9, h, "X2 doubler\n(duty skew)", C[0], hi)
    box(5.0, y1, 2.4, h, "DTC 10 b\nRC-delay, 642 fs", C[0], hi)
    box(8.0, y1, 2.3, h, "slope gen.\nRC ramp 5 GV/s")
    box(10.9, y1, 2.5, h, "2-stage S/H\n200 fF, lam = 0.5", C[0], hi)
    box(14.0, y1, 1.6, h, "R2-C2")
    box(16.3, 9.15, 2.0, 0.85, "K_VCO,P path", fs=7)
    box(16.3, 7.75, 2.0, 0.85, "Gm -> C_I 30 pF", fs=7)
    box(19.2, y1, 2.6, h, "VCO 5.5-7.3 GHz\nK_VCO,P / K_VCO,I")
    arr((1.9, y1 + h / 2), (2.5, y1 + h / 2))
    arr((4.4, y1 + h / 2), (5.0, y1 + h / 2))
    lab(4.7, y1 - 0.45, "CLKREFX2\n104 MHz")
    arr((7.4, y1 + h / 2), (8.0, y1 + h / 2))
    lab(7.7, y1 + h + 0.12, "CLKDTC")
    arr((10.3, y1 + h / 2), (10.9, y1 + h / 2))
    lab(10.6, y1 + h + 0.12, "ramp")
    arr((13.4, y1 + h / 2), (14.0, y1 + h / 2))
    lab(13.7, y1 + h + 0.12, "V_S2")
    arr((15.6, y1 + h / 2), (16.3, 9.55), cs="angle,angleA=0,angleB=90,rad=0")
    arr((15.6, y1 + h / 2), (16.3, 8.15), cs="angle,angleA=0,angleB=90,rad=0")
    arr((18.3, 9.55), (19.2, 9.0))
    arr((18.3, 8.15), (19.2, 8.4))
    arr((21.8, y1 + h / 2), (25.6, y1 + h / 2))
    lab(24.0, y1 + h / 2 + 0.15, "out")
    # feedback
    y2 = 5.0
    box(19.2, y2, 2.6, h, "MMDIV\n/ N[k]")
    arr((20.5, y1), (20.5, y2 + h))
    ax.plot([19.2, 18.7, 18.7, 12.9], [y2 + h / 2, y2 + h / 2, 7.25, 7.25], color=C[0], lw=0.9)
    arr((12.9, 7.25), (12.9, y1), col=C[0])
    lab(15.8, 7.4, "CLKFB (falling edge samples the ramp)", C[0])
    # DSM + code path
    y3 = 2.0
    box(19.2, y3, 2.6, h, "MASH 1-1\nFCW + dcc_comp")
    arr((20.5, y3 + h), (20.5, y2))
    lab(20.6, 4.05, "NDIV", ha="left")
    box(5.0, y3, 2.4, h, "x K_DTC (+ NLC)\n+ offset -> code", C[0], hi)
    arr((19.2, y3 + h / 2), (7.4, y3 + h / 2))
    lab(13.3, y3 + h / 2 + 0.15, "Phi_e[n]  (accumulated quantisation error)")
    arr((6.2, y3 + h), (6.2, y1))
    lab(6.3, 5.9, "DTC code", ha="left")
    # comparator + calibrations
    box(10.9, 5.0, 2.5, h, "comparator\nsign(V_S2 - Vref_adj)", C[0], hi)
    arr((11.5, y1), (11.5, 5.0 + h))
    box(7.9, 5.15, 2.4, 1.0, "Vref_adj: DSM +\n1-b dV-DAC (2 mV)", C[0], hi, fs=6.9)
    box(13.9, 3.4, 2.6, 1.0, "DTC gain LMS\nK += a1 PHE Phi_e", C[0], hi, fs=6.9)
    box(13.9, 0.3, 2.6, 1.0, "DCC LMS: (1-z^-1)PHE\nx even_cycle", C[0], hi, fs=6.9)
    arr((10.9, 5.65), (10.3, 5.65))
    arr((13.0, 5.0), (13.9, 3.9))
    arr((12.6, 5.0), (14.6, 1.3), cs="angle,angleA=-90,angleB=180,rad=0")
    ax.plot([13.9, 6.8], [3.75, 3.75], color=C[0], lw=0.9)
    arr((6.8, 3.75), (6.8, 3.3), col=C[0])
    lab(10.3, 3.85, "K_DTC", C[0])
    arr((16.5, 0.8), (19.2, 2.3), col=C[0], cs="angle,angleA=0,angleB=-90,rad=0")
    lab(17.9, 1.05, "dcc_comp", C[0])
    ax.text(0.2, 10.5, "Modelled architecture of the JSSC 2019 analog fractional-N sampling PLL "
            "(tinted = the paper's key techniques)", fontsize=10, fontweight="bold", color=INK)
    save(fig, FIG / "fig0_architecture.png")


# ------------------------------------------------------------------------ 1
def exp_dtc():
    p = SPLLParams()
    d = DTCModel(p)
    r = simulate(p, 40000)
    codes = r.code[5000:]
    prev = r.code[4999:-1]
    mid = 511.5
    dyn = d.table[codes] + d.mem_coef * (prev - mid) * (codes / mid)
    line = np.polyfit(d.codes, d.delay, 1)
    inl_dyn = (dyn - d.table[0] - np.polyval(line, codes)) / d.lsb_fit
    fig, ax = plt.subplots(1, 3, figsize=(12.6, 3.6))
    ax[0].scatter(codes[::7], inl_dyn[::7], s=2, color=C[0], alpha=0.35, lw=0,
                  label="with memory effect (MASH 1-1 codes)")
    ax[0].plot(d.codes, d.inl_fit / d.lsb_fit, color=INK, lw=1.0, label="static INL")
    ax[0].set(xlabel="DTC control code", ylabel="INL (LSB)", ylim=(-1.6, 0.8),
              title="(a) Simulated DTC INL (cf. paper Fig. 11)")
    ax[0].legend(loc="lower center")
    for kw, col, name in [(dict(), C[0], "C_fix = 2 pF (paper)"),
                          (SCENARIOS["small_cfix"], C[1], "C_fix = 0.5 pF"),
                          (SCENARIOS["low_bleed"], C[2], "I_bleed 10 uA (scaled)")]:
        dd = DTCModel(SPLLParams(**kw))
        ax[1].plot(dd.codes, dd.inl_fit / dd.lsb_fit, color=col,
                   label=f"{name}: {np.max(np.abs(dd.inl_fit))/dd.lsb_fit:.1f} LSB")
    ax[1].set(xlabel="DTC control code", ylabel="static INL (LSB)",
              title="(b) INL vs. fixed load cap / bleeding")
    ax[1].legend(loc="lower center")
    ax[2].plot(d.codes[:-1], d.dnl, color=C[0], lw=0.7)
    ax[2].set(xlabel="DTC control code", ylabel="DNL (LSB)",
              title=f"(c) DNL, unit-cap mismatch: peak {np.max(np.abs(d.dnl)):.2f} LSB")
    save(fig, FIG / "fig1_dtc.png")
    SUM["dtc"] = {**d.summary(), "small_cfix": DTCModel(SPLLParams(**SCENARIOS["small_cfix"])
                                                        ).summary(),
                  "low_bleed": DTCModel(SPLLParams(**SCENARIOS["low_bleed"])).summary()}


# ------------------------------------------------------------------------ 2
def exp_cal():
    fig, ax = plt.subplots(1, 3, figsize=(12.6, 3.6))
    settle = {}
    for k0, col in zip(ms.FIG9A_KDTC_INIT, C[:5]):
        p = SPLLParams(gm_os=-50e-3)
        kid = p.t_vco / DTCModel(p).lsb_fit
        p = p.with_(kdtc_init=k0 / ms.FIG9A_KDTC_IDEAL * kid)
        r = simulate(p, 7000)
        t = r.time_us()
        ax[0].plot(t, r.kd / r.kd_ideal * ms.FIG9A_KDTC_IDEAL, color=col, label=f"start {k0}")
        ax[1].plot(t, r.dcc * 1e12, color=col)
        ax[2].plot(t, r.vref, color=col, lw=0.8)
        settle[k0] = dict(
            kdtc_us=_f(an.settle_index(r.kd / r.kd_ideal, 1.0, 0.01) * p.t_ref * 1e6),
            dcc_us=_f(an.settle_index(r.dcc, p.duty_err / 2, 2e-12) * p.t_ref * 1e6),
            vref_final=_f(np.mean(r.vref[-1000:])))
    ax[0].axhline(ms.FIG9A_KDTC_IDEAL, color=MUTED, lw=0.8)
    ax[0].axvline(50, color=AXIS, lw=0.8)
    ax[0].text(51, 220, "gear-shift\n50 us", color=INK2, fontsize=7.5)
    ax[0].set(xlabel="time (us)", ylabel="K_DTC (paper scaling, ideal 895)",
              title="(a) DTC gain calibration (Fig. 9a)", xlim=(0, 67))
    ax[0].legend(loc="upper right", fontsize=7)
    ax[1].axhline(p.duty_err / 2 * 1e12, color=MUTED, lw=0.8)
    ax[1].set(xlabel="time (us)", ylabel="dcc_err (ps)", xlim=(0, 67),
              title="(b) duty-cycle calibration (48.5 ps)")
    ax[2].axhline(0.45, color=MUTED, lw=0.8)
    ax[2].set(xlabel="time (us)", ylabel="Vref_adj (V)", xlim=(0, 67),
              title="(c) comparator threshold, 50 mV Gm offset")
    save(fig, FIG / "fig2_calibration.png")
    SUM["calibration"] = settle


# ------------------------------------------------------------------------ 3
def exp_dccpn():
    fig, ax = plt.subplots(figsize=(8.2, 4.4))
    cases = [("1% duty error, no DCC", dict(duty_err=0.01 / 52e6, cal_dcc=False), C[1]),
             ("ideal 50% duty", dict(duty_err=0.0), INK),
             ("6% duty + 50% K_DTC error, DCC + K cal", dict(duty_err=0.06 / 52e6,
                                                             kd_scale=1.5), C[0])]
    out = {}
    for name, kw, col in cases:
        kd_scale = kw.pop("kd_scale", None)
        p = SPLLParams(**kw)
        if kd_scale:
            p = p.with_(kdtc_init=kd_scale * p.t_vco / DTCModel(p).lsb_fit)
        f, l, j, r = pn_sim(p, n=1 << 20, d=1 << 17, m_half=2, measured_like=False)
        out[name] = dict(jitter_fs=_f(j * 1e15),
                         spur_52mhz_dbc=_f(an.tone_dbc(r.tau_steady(), r.fs_out, p.f_vco, 52e6)),
                         dcc_final_ps=_f(np.mean(r.dcc[-5000:]) * 1e12))
        ax.semilogx(f, smooth_db(f, l, 0.01), color=col, lw=0.9,
                    label=f"{name}: {j*1e15:.0f} fs")
    ax.set(xlabel="offset frequency (Hz)", ylabel="L(f) (dBc/Hz)", xlim=(1e4, 2e8),
           ylim=(-170, -80), title="Simulated PN with / without DCC (cf. paper Fig. 9b)")
    ax.legend(loc="lower left", fontsize=8)
    save(fig, FIG / "fig3_dcc_pn.png")
    SUM["dcc_pn"] = out


# ------------------------------------------------------------------------ 4
def exp_pn():
    fig, ax = plt.subplots(figsize=(8.6, 4.8))
    res = {}
    for dbl, col, meas, jm in ((True, C[0], ms.FIG13_DOUBLER, ms.JITTER_DOUBLER_FS),
                               (False, C[1], ms.FIG13_NONDOUBLER, ms.JITTER_NONDOUBLER_FS)):
        p = SPLLParams(doubler=dbl)
        f, l, j, r = pn_sim(p)
        fa = np.logspace(3, np.log10(p.f_ref / 2 * 0.98), 600)
        la = l_model(p, fa)
        ja = jitter_model(p)
        name = "doubler (f_ref 104 MHz)" if dbl else "non-doubler (f_ref 52 MHz)"
        ax.semilogx(f, smooth_db(f, l, 0.01), color=col, lw=0.9,
                    label=f"{name}, sim: {j*1e15:.1f} fs")
        ax.semilogx(fa, la, color=col, lw=0.7, alpha=0.6)
        fm = np.array(list(meas))
        ax.scatter(fm, list(meas.values()), s=34, color=col, edgecolor=INK, lw=0.7, zorder=5,
                   label=f"{name}, measured: {jm:.1f} fs")
        idx = [int(np.argmin(np.abs(f - x))) for x in fm]
        res["doubler" if dbl else "non_doubler"] = dict(
            jitter_sim_fs=_f(j * 1e15), jitter_analytic_fs=_f(ja * 1e15), jitter_meas_fs=jm,
            markers={f"{x:g}": dict(meas=v, sim=_f(np.mean(l[max(i - 4, 0):i + 5])),
                                    model=_f(lm)) for x, v, i, lm in
                     zip(fm, meas.values(), idx, l_model(p, fm))},
            kd_over_ideal=_f(np.mean(r.kd[-5000:]) / r.kd_ideal),
            dcc_ps=_f(np.mean(r.dcc[-5000:]) * 1e12))
    ax.set(xlabel="offset frequency (Hz)", ylabel="L(f) (dBc/Hz)", xlim=(1e3, 3e7),
           ylim=(-150, -80), title="6.3337 GHz fractional-N channel: model vs. measured "
                                   "(paper Fig. 13)")
    ax.legend(loc="lower left", fontsize=7.5)
    ax.text(2.2e5, -86, "thin lines: analytic model\n(fitted; VCO fixed at -125 dBc/Hz @ 1 MHz)",
            fontsize=7.5, color=INK2)
    save(fig, FIG / "fig4_pn_vs_measured.png")
    lm = loop_metrics(SPLLParams())
    res["loop"] = lm
    res["fom_db"] = _f(an.fom_db(res["doubler"]["jitter_sim_fs"] * 1e-15, 18.9e-3))
    SUM["pn"] = res


# ------------------------------------------------------------------------ 5
def exp_budget():
    p = SPLLParams(f_out=6720e6)
    f = np.logspace(3, np.log10(p.f_ref / 2 * 0.98), 1500)
    nb = noise_budget(p, f)
    fig, ax = plt.subplots(figsize=(8.0, 4.6))
    toL = lambda s: 10 * np.log10(0.5 * (2 * np.pi * p.f_vco) ** 2 * s)  # noqa: E731
    # extension above f_ref/2: VCO free-running dominates
    fh = np.logspace(np.log10(f[-1] * 1.01), np.log10(200e6), 200)
    share = {}
    tot_low = {k: np.trapezoid(2 * 0.5 * (2 * np.pi * p.f_vco) ** 2 * v[(f >= 1e4)], f[f >= 1e4])
               for k, v in nb.items()}
    tot_low["VCO"] += np.trapezoid(2 * vco_l(p, fh), fh)
    tot_low["Total"] += np.trapezoid(2 * vco_l(p, fh), fh)
    for k in ("REF + DTC", "MMDIV", "SPD (kT/C)", "Gm", "VCO"):
        share[k] = _f(tot_low[k] / tot_low["Total"])
    jt = np.sqrt(tot_low["Total"]) / (2 * np.pi * p.f_vco)
    cols = dict(zip(("REF + DTC", "VCO", "MMDIV", "SPD (kT/C)", "Gm"), C[:5]))
    for k in ("REF + DTC", "VCO", "MMDIV", "SPD (kT/C)", "Gm"):
        ax.semilogx(f, toL(nb[k]), color=cols[k], lw=1.0,
                    label=f"{k} ({share[k]*100:.0f}%)")
    ax.semilogx(fh, 10 * np.log10(vco_l(p, fh)), color=cols["VCO"], lw=1.0)
    ax.semilogx(np.concatenate((f, fh)),
                10 * np.log10(np.concatenate((0.5 * (2 * np.pi * p.f_vco) ** 2 * nb["Total"],
                                              vco_l(p, fh)))),
                color=INK, lw=1.3, label=f"total {jt*1e15:.1f} fs (10 kHz-200 MHz)")
    ax.set(xlabel="offset frequency (Hz)", ylabel="L(f) (dBc/Hz)", xlim=(1e3, 2e8),
           ylim=(-170, -80), title="Linear-model PN contributors @ 6720 MHz / 104 MHz "
                                   "(cf. paper Fig. 2b)")
    ax.legend(loc="lower left", fontsize=8)
    ax.text(3e5, -88, "paper's pre-silicon model: 87.5 fs;\nREF+DTC 39%, VCO 51%, MMDIV 6%, SPD+Gm 4%",
            fontsize=7.5, color=INK2)
    save(fig, FIG / "fig5_noise_budget.png")
    SUM["budget_6720"] = dict(jitter_10k_200M_fs=_f(jt * 1e15), share=share,
                              paper_share=ms.FIG2B_SHARE, paper_total_fs=ms.FIG2B_TOTAL_FS)


# ------------------------------------------------------------------------ 6
def _spur_task(args):
    """Fractional spur = tone at |df| (as plotted in the paper's Fig. 16a)."""
    off, seed, kw = args
    p = near_integer(off, dtc_seed=seed, **kw)
    rq, _ = spur_run(p, n_conv=40000)
    return an.tone_dbc(rq.tau_steady(), rq.fs_out, p.f_vco, abs(off))


def exp_spur(n_seeds=16):
    offs = np.array(ms.FIG16A_OFFSETS)
    dflt = SPLLParams().dtc_seed
    with mp.get_context("fork").Pool(4) as pool:
        minus = pool.map(_spur_task, [(-o, dflt, {}) for o in offs])
        plus = pool.map(_spur_task, [(o, dflt, {}) for o in offs])
        grid = np.array(pool.map(_spur_task, [(o, s, {}) for s in range(1, n_seeds + 1)
                                              for o in offs])).reshape(n_seeds, offs.size)
    fig, ax = plt.subplots(figsize=(8.0, 4.4))
    ax.fill_between(offs, np.percentile(grid, 10, 0), np.percentile(grid, 90, 0), color=C[0],
                    alpha=0.12, lw=0, label=f"model, {n_seeds} mismatch seeds (10-90 %)")
    ax.semilogx(offs, np.median(grid, 0), color=C[0], lw=0.8, alpha=0.7, label="model median")
    ax.semilogx(offs, minus, color=C[0], marker="^", ms=5, lw=1.0,
                label="model (seed 17): 60x104 MHz - df")
    ax.semilogx(offs, plus, color=C[0], marker="s", ms=4.5, lw=1.0, ls="none",
                label="model (seed 17): 60x104 MHz + df")
    ax.scatter(offs, ms.FIG16A_MINUS, marker="^", s=40, facecolor="none", edgecolor=C[1],
               lw=1.2, label="measured - df (Fig. 16a)")
    ax.scatter(offs, ms.FIG16A_PLUS, marker="s", s=34, facecolor="none", edgecolor=C[1], lw=1.2,
               label="measured + df")
    ax.set(xlabel="fractional offset df (Hz)", ylabel="fractional spur at df (dBc)",
           ylim=(-80, -50), xlim=(8e3, 2.2e6),
           title="Fractional spur near integer-N (paper Fig. 16a), MASH 1-1, no INL cal.")
    ax.legend(loc="lower left", fontsize=7.2, ncol=2)
    save(fig, FIG / "fig6_frac_spur.png")
    SUM["spur"] = dict(offsets=offs.tolist(), minus=[_f(v) for v in minus],
                       plus=[_f(v) for v in plus], mc_median=np.median(grid, 0).tolist(),
                       mc_p10=np.percentile(grid, 10, 0).tolist(),
                       mc_p90=np.percentile(grid, 90, 0).tolist(),
                       worst_model_seed17=_f(max(max(minus), max(plus))),
                       worst_measured=max(max(ms.FIG16A_MINUS), max(ms.FIG16A_PLUS)))


# ------------------------------------------------------------------------ 7
def _band_task(fc):
    p = SPLLParams(f_out=fc)
    return pn_sim(p, n=1 << 20)[2] * 1e15


def exp_band():
    meas_f = np.array([5500, 5600, 6000, 6223, 6403, 6602, 6799, 7000, 7197, 7298]) * 1e6
    m50 = [75.9, 76.1, 78.0, 76.1, 77.5, 79.6, 83.5, 83.5, 82.6, 85.0]
    mm40 = [73.1, 74.4, 77.9, 75.1, 77.3, 78.6, 80.6, 80.3, 79.5, 81.3]
    chans = meas_f + 0.37e6          # stay fractional
    with mp.get_context("fork").Pool(4) as pool:
        js = pool.map(_band_task, list(chans))
    fig, ax = plt.subplots(figsize=(7.2, 3.8))
    ax.plot(chans / 1e9, js, color=C[0], marker="o", ms=4, label="model (room temp.)")
    ax.scatter(meas_f / 1e9, m50, marker="v", s=30, facecolor="none", edgecolor=C[1], lw=1.1,
               label="measured, 50 C (Fig. 16b)")
    ax.scatter(meas_f / 1e9, mm40, marker="^", s=30, facecolor="none", edgecolor=C[2], lw=1.1,
               label="measured, -40 C")
    ax.set(xlabel="f_VCO (GHz)", ylabel="rms jitter 10 kHz-10 MHz (fs)", ylim=(60, 100),
           title="Jitter across the tuning range (paper Fig. 16b)")
    ax.legend(loc="upper left", fontsize=8)
    save(fig, FIG / "fig7_jitter_band.png")
    SUM["band"] = dict(f_ghz=(chans / 1e9).tolist(), jitter_fs=[_f(v) for v in js],
                       measured_50C=m50, measured_m40C=mm40)


EXPS = dict(arch=exp_arch, dtc=exp_dtc, cal=exp_cal, dccpn=exp_dccpn, pn=exp_pn,
            budget=exp_budget, spur=exp_spur, band=exp_band)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("which", nargs="*", default=list(EXPS))
    a = ap.parse_args()
    FIG.mkdir(exist_ok=True)
    RES.mkdir(exist_ok=True)
    for k in a.which:
        t0 = time.time()
        EXPS[k]()
        print(f"[{k}] {time.time() - t0:.1f} s", flush=True)
    path = RES / "repro_summary.json"
    old = json.loads(path.read_text()) if path.exists() else {}
    old.update(SUM)
    path.write_text(json.dumps(old, indent=2, default=float))


if __name__ == "__main__":
    main()
