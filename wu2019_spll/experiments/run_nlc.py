"""Extension study: adding DTC nonlinearity calibration (NLC) to the JSSC 2019 PLL.

Candidates (all share the single comparator PHE_sign with the K_DTC and DCC loops):
  none   - the paper (gain calibration only)
  poly   - g2, g3 polynomial pre-distortion (Wu, SSC-M 2025 tutorial eq. 12) with the
           observable regressors Phi_e*(phi(1-x)-phi(-x)) derived in spll/core.py
  oracle - poly coefficients from a static least-squares fit of the DTC curve (upper bound
           of what a 3rd-order pre-distortion can do; not implementable in background)
  pwl    - 8-segment piecewise-linear map (same observable regressors)
  lut    - 32-entry code-indexed correction table (same observable regressors)

    python experiments/run_nlc.py            # all (~4-6 min on 4 cores)
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import sys
import time
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from style import C, INK, INK2, MUTED, plt, save  # noqa: E402

from spll import SCENARIOS, DTCModel, SPLLParams, near_integer, simulate, spur_run  # noqa: E402
from spll import analysis as an  # noqa: E402
from spll import measured as ms  # noqa: E402

FIG = ROOT / "figures"
RES = ROOT / "results"
SUM: dict = {}
METHODS_BG = ("none", "poly2", "poly23", "pwl", "lut")
METHODS_FG = ("none", "poly2", "fglut", "hybrid", "oracle")
METHODS = tuple(dict.fromkeys(METHODS_BG + METHODS_FG))
COL = {"none": C[1], "poly2": C[0], "poly23": C[6], "oracle": MUTED, "pwl": C[3],
       "lut": C[4], "fglut": C[5], "hybrid": C[2]}
LABEL = {"none": "paper (gain cal. only)", "poly2": "background g2 NLC",
         "poly23": "background g2+g3 NLC", "oracle": "g2,g3 oracle (static LS fit)",
         "pwl": "background PWL (8 seg.)", "lut": "background LUT (32 bins)",
         "fglut": "foreground INL LUT (0.1 LSB meas.)",
         "hybrid": "hybrid: fg LUT + bg g2 (proposed)"}
NLC_KW = {"poly2": dict(nlc="poly", mu_g3=0.0), "poly23": dict(nlc="poly"),
          "pwl": dict(nlc="pwl"), "lut": dict(nlc="lut"), "none": dict(nlc="none"),
          "fglut": dict(nlc="fglut"), "hybrid": dict(nlc="fglut+poly", mu_g3=0.0)}
SLOW = ("poly2", "poly23", "pwl", "lut", "hybrid")     # need long convergence
HW = {
    "none": dict(adders="1 acc (K)", multipliers="1 (K x Phi_e)", registers=1,
                 tracks_pvt="gain only", note="paper"),
    "poly2": dict(adders="+2 acc (g2, <Phi_e^2> average)",
                  multipliers="+3 (Phi_e^2, g2 x, Phi_e(1-2x))",
                  registers=2, tracks_pvt="gain + bow", note="background, shares comparator"),
    "poly23": dict(adders="+3 acc (g2, g3, <Phi_e^2> average)", multipliers="+6", registers=3,
                   tracks_pvt="gain + 2nd/3rd",
                   note="g3 estimate biased by DNL/memory"),
    "pwl": dict(adders="+8 acc", multipliers="+2 (interp., regressor)", registers=9,
                tracks_pvt="ill-conditioned", note="periodic modes unobservable near integer-N"),
    "lut": dict(adders="+2 acc/cycle + projection", multipliers="+1", registers=32,
                tracks_pvt="ill-conditioned", note="same observability limit"),
    "fglut": dict(adders="0", multipliers="0 (inverse map ROM/RAM 8k x 10 b)", registers=8192,
                  tracks_pvt="no (static)", note="needs one-time INL measurement"),
    "hybrid": dict(adders="+2 acc (g2, <Phi_e^2> average)", multipliers="+3",
                   registers="8k map + 2",
                   tracks_pvt="gain + bow drift", note="static shape incl. DNL + bg bow"),
}
SCN_LABEL = {"paper": "paper DTC\n(C_fix 2 pF, 1.0 LSB)",
             "low_bleed": "low-power DTC\n(I_bleed 10 uA)",
             "small_cfix": "small buffer\n(C_fix 0.5 pF, 3.4 LSB)"}


def oracle_coefficients(p: SPLLParams):
    """Static least-squares K, g2, g3 over the MASH 1-1 Phi_e distribution."""
    d = DTCModel(p)
    ph = np.linspace(-0.999, 0.999, 4001)
    w = np.sqrt(1.0 - np.abs(ph))

    def res(v):
        k, g2, g3, a = v
        c = 511.5 + k * ph + g2 * (ph ** 2 - 1 / 6) + g3 * (ph ** 3 - 0.4 * ph)
        return w * (np.interp(c, d.codes, d.table) - (a + ph * p.t_vco)) * 1e12

    s = least_squares(res, [p.t_vco / d.lsb_fit, 0.0, 0.0, d.table[512]])
    return dict(kd=float(s.x[0]), g2=float(s.x[1]), g3=float(s.x[2]))


def frac_spur(rq, p, off):
    """Worst of the fractional tone and its 2nd/3rd harmonics (INL-generated tones)."""
    t = rq.tau_steady()
    return max(an.tone_dbc(t, rq.fs_out, p.f_vco, abs(off) * m) for m in (1, 2, 3))


def run_method(off, method, scen="paper", seed=None):
    kw = dict(SCENARIOS[scen])
    if seed is not None:
        kw["dtc_seed"] = seed
    if method == "oracle":
        p = near_integer(off, nlc="poly", **kw)
        if True:
            pc = p.with_(nlc="none")
            r = simulate(pc.with_(noise=True), 40000)
            st = r.frozen()
            st.update(oracle_coefficients(p))
            pq = p.with_(noise=False, cal_gain=False, cal_dcc=False)
            rq = simulate(pq, (1 << 17) + (1 << 14), n_discard=1 << 14, state=st)
            return frac_spur(rq, p, off)
    p = near_integer(off, **NLC_KW[method], **kw)
    if method in SLOW:
        rq, _ = spur_run(p, n_conv=300000, avg=100000)
    else:
        rq, _ = spur_run(p, n_conv=40000)
    return frac_spur(rq, p, off)


def _task(args):
    return run_method(*args)


# ------------------------------------------------------------------------ N1
def _eff_inl(p, kd, g2, g3=0.0):
    """Static timing error seen by the loop vs Phi_e (best line removed) [LSB]."""
    d = DTCModel(p)
    ph = np.linspace(-0.995, 0.995, 2001)
    c = 511.5 + kd * ph + g2 * (ph ** 2 - 1 / 6) + g3 * (ph ** 3 - 0.4 * ph)
    t = np.interp(c, d.codes, d.table)          # continuous (rounding noise not shown)
    e = t - ph * p.t_vco
    e = e - np.polyval(np.polyfit(ph, e, 1, w=np.sqrt(1 - np.abs(ph))), ph)
    return ph, e / d.lsb_fit


def exp_conv():
    fig, ax = plt.subplots(1, 3, figsize=(12.6, 3.6))
    out = {}
    for scen, col in (("paper", C[0]), ("small_cfix", C[1])):
        p = near_integer(100e3, nlc="poly", mu_g3=0.0, **SCENARIOS[scen])
        r = simulate(p, 150000)
        t = r.time_us()
        lab = "paper DTC" if scen == "paper" else "C_fix 0.5 pF"
        ax[0].plot(t, r.kd / r.kd_ideal, color=col, lw=0.9, label=lab)
        ax[1].plot(t, r.g2, color=col, lw=0.9, label=lab)
        g2f = float(np.mean(r.g2[-20000:]))
        kdf = float(np.mean(r.kd[-20000:]))
        ph, e0 = _eff_inl(p, kdf, 0.0)
        _, e1 = _eff_inl(p, kdf, g2f)
        ax[2].plot(ph, e0, color=col, lw=0.8, alpha=0.45, label=f"{lab}, gain cal only")
        ax[2].plot(ph, e1, color=col, lw=1.1, label=f"{lab}, + g2 NLC")
        out[scen] = dict(g2_final=g2f, g2_settle_us=float(an.settle_index(
            r.g2, g2f, 0.1 * abs(g2f)) * p.t_ref * 1e6),
            inl_pp_before_lsb=float(np.ptp(e0)), inl_pp_after_lsb=float(np.ptp(e1)))
    for a in ax[:2]:
        a.axvline(50, color=MUTED, lw=0.6)
        a.axvline(200, color=MUTED, lw=0.6)
    ax[0].set(xlabel="time (us)", ylabel="K_DTC / ideal", title="(a) DTC gain loop",
              ylim=(0.97, 1.03))
    ax[1].set(xlabel="time (us)", ylabel="g2 (DTC codes)",
              title="(b) g2 NLC loop (gear-shifts 50/200 us)")
    ax[1].legend(loc="lower right")
    ax[2].set(xlabel="Phi_e (T_vco)", ylabel="static error seen by loop (LSB)",
              title="(c) effective DTC INL before / after NLC")
    ax[2].legend(loc="lower center", fontsize=7)
    save(fig, FIG / "fig8_nlc_convergence.png")
    SUM["convergence"] = out


# ------------------------------------------------------------------------ N2
def exp_offsets():
    offs = list(ms.FIG16A_OFFSETS)
    jobs = [(o, m, "paper", None) for m in METHODS for o in offs]
    with mp.get_context("fork").Pool(4) as pool:
        res = pool.map(_task, jobs)
    grid = {m: np.array(res[i * len(offs):(i + 1) * len(offs)]) for i, m in enumerate(METHODS)}
    fig, ax = plt.subplots(1, 2, figsize=(12.6, 4.2), sharey=True)
    for a, meths, ttl in ((ax[0], METHODS_BG, "(a) background algorithms (sign-LMS)"),
                          (ax[1], METHODS_FG, "(b) foreground / hybrid")):
        for m in meths:
            a.semilogx(offs, grid[m], color=COL[m], marker="o", ms=3.5,
                       lw=1.4 if m in ("hybrid", "poly2") else 1.0,
                       label=f"{LABEL[m]}: worst {grid[m].max():.1f}")
        a.scatter(offs, np.maximum(ms.FIG16A_MINUS, ms.FIG16A_PLUS), marker="s", s=28,
                  facecolor="none", edgecolor=INK, lw=0.9, label="measured (paper)")
        a.set(xlabel="fractional offset df from 60x104 MHz (Hz)", title=ttl, ylim=(-92, -55))
        a.legend(loc="lower left", fontsize=7)
    ax[0].set_ylabel("worst fractional tone m*df, m=1..3 (dBc)")
    save(fig, FIG / "fig9_nlc_spur_vs_offset.png")
    SUM["offsets"] = dict(offsets=offs, **{m: grid[m].tolist() for m in METHODS})


# ------------------------------------------------------------------------ N3
def exp_mc(n_seeds=12, offs=(20e3, 100e3, 400e3)):
    methods = ("none", "poly2", "fglut", "hybrid")
    scens = ("paper", "low_bleed", "small_cfix")
    jobs = [(o, m, s, seed) for s in scens for m in methods for seed in range(1, n_seeds + 1)
            for o in offs]
    with mp.get_context("fork").Pool(4) as pool:
        res = pool.map(_task, jobs)
    arr = np.array(res).reshape(len(scens), len(methods), n_seeds, len(offs))
    fig, ax = plt.subplots(1, 3, figsize=(12.6, 3.7), sharey=True)
    for i, s in enumerate(scens):
        for j, m in enumerate(methods):
            v = arr[i, j]
            ax[i].fill_between(offs, np.percentile(v, 10, 0), np.percentile(v, 90, 0),
                               color=COL[m], alpha=0.12, lw=0)
            ax[i].semilogx(offs, np.median(v, 0), color=COL[m], marker="o", ms=3.5,
                           label=LABEL[m])
        ax[i].axhline(-64, color=MUTED, lw=0.8)
        ax[i].set(xlabel="fractional offset (Hz)", title=SCN_LABEL[s].replace("\n", " "),
                  ylim=(-85, -50))
        ax[i].set_xticks(list(offs), [f"{o/1e3:.0f}k" for o in offs])
        ax[i].xaxis.set_minor_formatter(plt.NullFormatter())
    ax[0].set_ylabel("fractional spur, median and 10-90 % (dBc)")
    h, l = ax[0].get_legend_handles_labels()
    fig.legend(h, l, loc="lower center", ncol=4, fontsize=8, frameon=False)
    fig.subplots_adjust(bottom=0.25)
    ax[0].text(offs[-1], -63.4, "paper: -64 dBc", fontsize=7, color=INK2, ha="right")
    save(fig, FIG / "fig10_nlc_montecarlo.png")
    SUM["mc"] = {s: {m: dict(median_per_offset=np.median(arr[i, j], 0).tolist(),
                             p90_per_offset=np.percentile(arr[i, j], 90, 0).tolist(),
                             median_worst=float(np.median(arr[i, j].max(1))))
                     for j, m in enumerate(methods)} for i, s in enumerate(scens)}
    SUM["mc_offsets"] = list(offs)


# ------------------------------------------------------------------------ N4
def _jit_task(args):
    scen, method, chan = args
    kw = dict(SCENARIOS[scen], **NLC_KW[method])
    p = near_integer(100e3, **kw) if chan == "near_int" else SPLLParams(**kw)
    n, d = 1 << 21, 1 << 16
    r = simulate(p, n + d, n_discard=d)
    f, s = an.timing_psd(r.tau_steady(), r.fs_out)
    lin = 0.5 * (2 * np.pi * p.f_vco) ** 2 * s + 10 ** (p.outbuf_floor / 10)
    sel = (f >= 1e4) & (f <= 1e7)
    return float(np.sqrt(np.trapezoid(2 * lin[sel], f[sel])) / (2 * np.pi * p.f_vco) * 1e15)


def exp_jitter():
    scens = ("paper", "low_bleed", "small_cfix")
    jobs = [(s, m, c) for s in scens for m in ("none", "poly2", "hybrid")
            for c in ("near_int", "frac")]
    with mp.get_context("fork").Pool(4) as pool:
        res = pool.map(_jit_task, jobs)
    out = {}
    k = 0
    for s in scens:
        out[s] = {}
        for m in ("none", "poly2", "hybrid"):
            out[s][m] = dict(near_integer_6240p1=res[k], frac_6333p66=res[k + 1])
            k += 2
    SUM["jitter"] = out
    fig, ax = plt.subplots(figsize=(8.4, 3.9))
    x = np.arange(len(scens))
    meths = ("none", "poly2", "hybrid")
    for j, m in enumerate(meths):
        for chan, alpha, off in (("near_integer_6240p1", 1.0, -0.13), ("frac_6333p66", 0.45, 0.13)):
            vals = [out[s][m][chan] for s in scens]
            ax.bar(x + (j - 1) * 0.28 + off * 0.8, vals, 0.1, color=COL[m], alpha=alpha,
                   label=f"{LABEL[m]}" + (" - 6240.1 MHz (near-integer)" if alpha == 1.0
                                          else " - 6333.7 MHz"))
    ax.axhline(74.2, color=MUTED, lw=0.8)
    ax.text(2.45, 74.6, "paper measured 74.2 fs", fontsize=7, color=INK2, ha="right")
    ax.set_xticks(x, [SCN_LABEL[s] for s in scens])
    ax.set(ylabel="rms jitter 10 kHz-10 MHz (fs)", ylim=(60, 95),
           title="Jitter with all background loops running (noise on)")
    ax.legend(loc="upper left", fontsize=6.5, ncol=2)
    save(fig, FIG / "fig11_nlc_jitter.png")


# ------------------------------------------------------------------------ N5
def _drift_task(args):
    scen, method, drift, off = args
    kw = dict(SCENARIOS[scen])
    kw["dtc_inl_end_lsb"] = kw.get("dtc_inl_end_lsb", 1.4) * (1 + drift)
    p = near_integer(off, fg_drift=drift, **NLC_KW[method], **kw)
    if method in SLOW:
        rq, _ = spur_run(p, n_conv=300000, avg=100000)
    else:
        rq, _ = spur_run(p, n_conv=40000)
    return frac_spur(rq, p, off)


def exp_drift(drifts=(0.0, 0.25, 0.5), offs=(20e3, 100e3, 400e3)):
    scens = ("paper", "small_cfix")
    meths = ("none", "poly2", "fglut", "hybrid")
    jobs = [(s, m, d, o) for s in scens for m in meths for d in drifts for o in offs]
    with mp.get_context("fork").Pool(4) as pool:
        res = pool.map(_drift_task, jobs)
    arr = np.array(res).reshape(len(scens), len(meths), len(drifts), len(offs)).max(axis=3)
    fig, ax = plt.subplots(1, 2, figsize=(10.4, 3.7), sharey=True)
    for i, s in enumerate(scens):
        for j, m in enumerate(meths):
            ax[i].plot(np.array(drifts) * 100, arr[i, j], color=COL[m], marker="o", ms=4,
                       lw=1.4 if m == "hybrid" else 1.0, label=LABEL[m])
        ax[i].axhline(-64, color=MUTED, lw=0.8)
        ax[i].set(xlabel="INL bow change after the foreground measurement (%)",
                  title=SCN_LABEL[s].replace("\n", " "), ylim=(-85, -50))
    ax[0].set_ylabel("worst in-band fractional spur (dBc)")
    ax[0].legend(loc="upper left", fontsize=7)
    save(fig, FIG / "fig12_nlc_drift.png")
    SUM["drift"] = {s: {m: arr[i, j].tolist() for j, m in enumerate(meths)}
                    for i, s in enumerate(scens)}
    SUM["drift_levels"] = list(drifts)


EXPS = dict(conv=exp_conv, offsets=exp_offsets, mc=exp_mc, jitter=exp_jitter,
            drift=exp_drift)


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
    SUM["hardware"] = HW
    path = RES / "nlc_summary.json"
    old = json.loads(path.read_text()) if path.exists() else {}
    old.update(SUM)
    path.write_text(json.dumps(old, indent=2, default=float))


if __name__ == "__main__":
    main()
