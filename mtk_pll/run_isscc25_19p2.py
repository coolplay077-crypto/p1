"""Reproduction + non-ideality study of ISSCC 2025 paper 19.2 (U. Tokyo):
cascaded PLL with two MMDs driven by one shared DSM (MMD-based QEC).
Writes figures results/C*_*.png and results/isscc25_19p2_results.json.

    python3 run_isscc25_19p2.py            # full run (~2-3 min)
    python3 run_isscc25_19p2.py --quick    # shorter records for a smoke test
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
from scipy.optimize import least_squares

sys.path.insert(0, str(Path(__file__).parent))
from mtkpll import common as C                 # noqa: E402
from mtkpll import cascaded_mmdqec as M        # noqa: E402

OUT = Path(__file__).parent / "results"
OUT.mkdir(exist_ok=True)
CHECKS = []
D4 = 20 * math.log10(4)          # paper PN plots are measured after the on-chip /4

# ----------------------------------------------------------------------------
# Paper data (ISSCC 2025 19.2).  PN values of Figs. 19.2.3/19.2.5 are at the
# /4 output (~1.3 GHz); D4 converts them to the 5.2 GHz VCO.
# ----------------------------------------------------------------------------
PAPER = dict(
    f_ref=81.93e6, f_out_int=5.205706e9, f_out_frac=5.205692e9,
    spur_off_2m11=181.55e3, spur_off_2m16=5.67e3,
    jit_frac=95.1, jit_frac_spur=95.9, jit_int=91.8, jit_woqec=173.8, q_jit_woqec=146.0,
    shares=dict(aux=33.0, cp=38.0, vco=28.0, q=1.0), q_share_woqec=238.0,
    spur_worst=-70.6, power_mW=21.2, lock_main_us=0.31, lock_aux_us=0.11,
    # Fig. 19.2.3 markers (1.3 GHz scale): offset -> dBc/Hz
    markers_int={1e3: -108.87, 1e4: -120.33, 1e5: -127.31, 1e6: -131.47, 1e7: -149.16, 1e8: -158.28},
    markers_frac={1e3: -108.60, 1e4: -119.15, 1e5: -128.37, 1e6: -131.27, 1e7: -148.73, 1e8: -155.71},
    # Fig. 19.2.4 bottom-left: worst fractional spur vs fractional FCW 2^-m
    spur_vs_fcw={16: -71.1, 15: -71.3, 14: -71.0, 13: -70.7, 12: -70.8, 11: -70.6, 10: -71.0,
                 9: -72.5, 8: -76.0, 7: -84.5, 6: -89.0, 5: -93.5},
    # Fig. 19.2.4 top: spur markers at 2^-11 (dB rel. carrier at 1.3 GHz)
    spur_markers_2m11={1: (-84.72, -85.89), 2: (-82.55, -83.39)},
    # Fig. 19.2.2 table (N = 11)
    table_N11={1: (0.1, 0.08), 2: (0.22, 0.15), 3: (0.38, 0.21)},
)
# Fig. 19.2.5 calculated curves, digitised by colour from the figure (1.3 GHz scale,
# +-~0.5 dB digitising error): offset [Hz], L [dBc/Hz]
FIG5 = {
    "total": [(1e+03, -107.7), (1.26e+03, -108.6), (1.58e+03, -110.0), (2e+03, -111.4), (2.51e+03, -112.4), (3.16e+03, -113.5), (3.98e+03, -114.4), (5.01e+03, -115.3), (6.31e+03, -116.6), (7.94e+03, -117.7), (1e+04, -118.6), (1.26e+04, -119.4), (1.58e+04, -120.5), (2e+04, -121.5), (2.51e+04, -122.4), (3.16e+04, -123.5), (3.98e+04, -124.1), (5.01e+04, -125.2), (6.31e+04, -126.0), (7.94e+04, -126.8), (1e+05, -127.4), (1.26e+05, -128.0), (1.58e+05, -128.5), (2e+05, -128.9), (2.51e+05, -129.1), (3.16e+05, -129.3), (3.98e+05, -129.6), (5.01e+05, -129.9), (6.31e+05, -130.2), (7.94e+05, -130.7), (1e+06, -131.3), (1.26e+06, -132.2), (1.58e+06, -133.3), (2e+06, -134.5), (2.51e+06, -136.0), (3.16e+06, -137.8), (3.98e+06, -139.8), (5.01e+06, -142.0), (6.31e+06, -144.5), (7.94e+06, -146.7), (1e+07, -149.1), (1.26e+07, -151.4), (1.58e+07, -153.1), (2e+07, -154.8), (2.51e+07, -156.2), (3.16e+07, -156.8), (3.98e+07, -157.5), (5.01e+07, -157.8), (6.31e+07, -157.9), (7.94e+07, -158.1), (1e+08, -158.6)],
    "aux": [(1e+03, -110.2), (1.26e+03, -112.3), (1.58e+03, -113.8), (2e+03, -115.6), (2.51e+03, -116.8), (3.16e+03, -118.2), (3.98e+03, -118.5), (5.01e+03, -119.5), (6.31e+03, -121.4), (7.94e+03, -122.2), (1e+04, -122.8), (1.26e+04, -123.6), (1.58e+04, -125.0), (2e+04, -126.0), (2.51e+04, -126.9), (3.16e+04, -127.9), (3.98e+04, -128.5), (5.01e+04, -129.4), (6.31e+04, -130.3), (7.94e+04, -131.2), (1e+05, -131.7), (1.26e+05, -132.1), (1.58e+05, -132.5), (2e+05, -132.7), (2.51e+05, -133.1), (3.16e+05, -133.7), (3.98e+05, -134.2), (5.01e+05, -134.5), (1.26e+06, -137.0), (1.58e+06, -138.2), (2e+06, -139.6), (2.51e+06, -141.2), (3.16e+06, -143.0), (3.98e+06, -145.2), (5.01e+06, -147.6), (6.31e+06, -150.3), (7.94e+06, -153.3), (1e+07, -156.4)],
    "cp": [(1e+03, -110.8), (1.26e+03, -111.5), (1.58e+03, -112.4), (2e+03, -113.5), (2.51e+03, -114.4), (3.16e+03, -115.5), (3.98e+03, -116.5), (5.01e+03, -117.4), (6.31e+03, -118.5), (7.94e+03, -119.5), (1e+04, -120.5), (1.26e+04, -121.5), (1.58e+04, -122.5), (2e+04, -123.3), (2.51e+04, -124.3), (3.16e+04, -125.2), (3.98e+04, -126.3), (5.01e+04, -127.2), (6.31e+04, -128.1), (7.94e+04, -129.0), (1e+05, -129.8), (1.26e+05, -130.5), (1.58e+05, -131.3), (2e+05, -131.9), (2.51e+05, -132.5), (3.16e+05, -133.1), (3.98e+05, -133.6), (5.01e+05, -134.2), (6.31e+05, -134.7), (7.94e+05, -135.9), (1e+06, -136.5), (1.26e+06, -137.5), (1.58e+06, -138.6), (2e+06, -140.2), (2.51e+06, -141.9), (3.16e+06, -143.9), (3.98e+06, -146.1), (5.01e+06, -148.7), (6.31e+06, -151.4), (7.94e+06, -154.4), (1e+07, -157.6)],
    "vco": [(2.51e+04, -151.2), (3.16e+04, -150.6), (3.98e+04, -148.9), (5.01e+04, -147.3), (6.31e+04, -146.1), (7.94e+04, -144.4), (1e+05, -142.9), (1.26e+05, -141.5), (1.58e+05, -139.9), (2e+05, -139.0), (2.51e+05, -137.7), (3.16e+05, -136.6), (3.98e+05, -135.9), (5.01e+05, -135.5), (6.31e+05, -135.4), (7.94e+05, -135.4), (1e+06, -135.6), (1.26e+06, -136.2), (1.58e+06, -137.2), (2e+06, -138.3), (2.51e+06, -139.7), (3.16e+06, -141.4), (3.98e+06, -143.1), (5.01e+06, -144.7), (6.31e+06, -146.9), (7.94e+06, -148.9), (1e+07, -151.0), (1.26e+07, -152.8), (1.58e+07, -154.2), (2e+07, -155.8), (2.51e+07, -157.2), (3.16e+07, -158.2), (3.98e+07, -159.1), (5.01e+07, -159.3), (6.31e+07, -159.5), (7.94e+07, -159.5), (1e+08, -160.0)],
    "q": [(3.98e+06, -169.0), (5.01e+06, -167.5), (6.31e+06, -166.1), (7.94e+06, -165.0), (1e+07, -164.2), (1.26e+07, -163.7), (1.58e+07, -163.2), (2e+07, -162.9), (2.51e+07, -162.8), (3.16e+07, -162.8), (3.98e+07, -162.8), (5.01e+07, -162.9), (6.31e+07, -163.4), (7.94e+07, -163.8), (1e+08, -164.2)],
    "q_woqec": [(1e+06, -162.2), (1.26e+06, -159.0), (1.58e+06, -155.8), (2e+06, -153.6), (2.51e+06, -151.3), (3.16e+06, -149.0), (3.98e+06, -146.9), (5.01e+06, -145.1), (6.31e+06, -143.9), (7.94e+06, -142.9), (1e+07, -142.0), (1.26e+07, -141.3), (1.58e+07, -141.0), (2e+07, -140.7), (2.51e+07, -140.7), (3.98e+07, -140.7), (5.01e+07, -140.8), (6.31e+07, -141.0), (7.94e+07, -141.3), (1e+08, -142.1)],
}
# Fig. 19.2.6 comparison table: name -> (P mW, jitter fs, f_ref MHz, FoM, FoMref, spur dBc)
TABLE = {
    "This work": (21.2, 95.9, 82, -247.1, -238.0, -70.6),
    "[5] Yang ISSCC19": (13.4, 131, 60, -246.4, -238.6, -70),
    "[1] Xu ISSCC24": (8.89, 143.7, 100, -247.4, -237.4, -62.1),
    "[9] Jang ISSCC24": (15.7, 88, 100, -249.1, -239.1, -68),
    "[4] Dartizio ISSCC22": (20, 68.6, 250, -250.3, -236.3, -58.2),
    "[3] Kim ISSCC21": (7.3, 104, 150, -251.0, -239.2, -61),
    "[2] Dartizio ISSCC23": (17.2, 76.7, 250, -249.9, -235.9, -71.9),
    "Helal JSSC21": (23.15, 151, 80, -242.8, -233.8, -49),
}
POWER = {"Aux SPD": 2.3, "Aux int-divider": 1.1, "Aux VCO w/ buf": 1.7, "Div-by-2": 1.5,
         "Main PFDCP": 1.1, "Main/Aux MMDs": 1.9, "DSM": 0.7, "Main VCO buf": 1.7, "Main VCO": 9.2}


def check(name, ok, measured, expected, note="", soft=False):
    """soft=True: a paper claim the model does not reproduce is logged as
    DEVIATION (explained in the summary) instead of FAIL."""
    res = "PASS" if ok else ("DEVIATION" if soft else "FAIL")
    CHECKS.append(dict(check=name, result=res, measured=measured, expected=expected, note=note))
    print(f"  [{res}] {name}: measured={measured} expected={expected} {note}")


def r2(x, n=2):
    return float(round(float(x), n))


def fig5(key, scale=D4):
    a = np.array(FIG5[key])
    return a[:, 0], a[:, 1] + scale


def frac_K(m, Q=2 ** 24):
    return Q >> m


def nan2none(x):
    return None if (isinstance(x, float) and math.isnan(x)) else x


def level_near(f, L, f0, rel=0.15):
    """Power-averaged level around f0 (nearest bin if the window is empty)."""
    m = (f >= f0 * (1 - rel)) & (f <= f0 * (1 + rel))
    if not m.any():
        return float(L[int(np.argmin(np.abs(f - f0)))])
    return float(10 * np.log10(np.mean(10 ** (L[m] / 10))))


def sim_vs_analytic(r, p, f2=1e8):
    """Simulated and analytic jitter over the SAME band [f1, f2]; f1 = 1 kHz
    unless the record is too short to resolve it (quick mode)."""
    f, L = M.pn_stitched(r)
    f1 = max(1e3, float(f[0]))
    js = C.rms_jitter(f, L, p.f_out, f1, f2)
    Ja, _ = M.analytic_jitters(M.analytic_grid(4000, f1, f2), p, f1, f2)
    return js, Ja, f1, f, L


# ----------------------------------------------------------------------------
# Noise-budget fit (analytic model vs the paper's calculated component curves)
# ----------------------------------------------------------------------------
FIT_NAMES = ["fc", "pm", "aux_inband", "aux_flicker", "cp_tn", "cp_flicker", "vco_L1M", "vco_f3", "out_floor",
             "aux_vco_L1M"]


def _fit_params(base, x):
    return replace(base, fc=x[0] * 1e6, pm=x[1], aux_inband=x[2], aux_flicker=10 ** x[3],
                   cp_tn=10 ** x[4], cp_flicker=10 ** x[5], vco_L1M=x[6], vco_f3=10 ** x[7],
                   out_floor=x[8], aux_vco_L1M=x[9])


def fit_budget(base, fix=None):
    """Least-squares fit of 9 loop/noise parameters so that the analytic aux /
    CP / VCO contributions and the total reproduce the paper's Fig. 19.2.5
    calculated curves (Q-noise is NOT fitted: it is a model prediction)."""
    tg = {k: fig5(k) for k in ("aux", "cp", "vco", "total")}

    def grp(p, f):
        g = M.group_components(M.analytic_pn(f, p))
        return {k: 10 * np.log10(v + 1e-300) for k, v in g.items()}, g

    def resid(x):
        p = _fit_params(base, x)
        R = []
        for key in ("aux", "cp", "vco"):
            f, L = tg[key]
            R.append(grp(p, f)[0][key] - L)
        f, L = tg["total"]
        _, g = grp(p, f)
        R.append(10 * np.log10(g["aux"] + g["cp"] + g["vco"] + g["q"]) - L)
        return np.concatenate(R)

    x0 = [1.6, 60, -125, 4.5, math.log10(3e-17), 4.5, -121, 4.5, -148, -108]
    lb = [0.5, 35, -160, 2, -18, 2, -130, 3, -160, -120]
    ub = [4, 80, -105, 7, -15.5, 7, -110, 6, -140, -95]
    for k, v in (fix or {}).items():         # pin a parameter (sensitivity runs)
        i = FIT_NAMES.index(k)
        x0[i], lb[i], ub[i] = v, v - 1e-6, v + 1e-6
    sol = least_squares(resid, x0, bounds=(lb, ub))
    p = _fit_params(base, sol.x)
    vals = dict(zip(FIT_NAMES, [float(v) for v in sol.x]))
    for k in ("aux_flicker", "cp_tn", "cp_flicker", "vco_f3"):
        vals[k] = 10 ** vals[k]
    vals["fc"] *= 1e6
    return p, dict(values=vals, rms_resid_dB=float(np.sqrt(np.mean(sol.fun ** 2))),
                   max_resid_dB=float(np.max(np.abs(sol.fun))), n_points=int(len(sol.fun)))


# ----------------------------------------------------------------------------
def qonly(p):
    return replace(p, **M.NOISE_OFF)


def exp_C0(base):
    print("\n[C0] arithmetic: e_eqv = e_mfb*(Nm-Na)/(Na+alpha); frequency plan")
    out = dict(identity=[], float_edges=[], closed_loop=None, freq={})
    for (Na, Nm, m, dith) in [(13, 14, 11, True), (13, 14, 11, False), (12, 13, 9, True),
                               (15, 14, 5, True), (11, 14, 7, True)]:
        p = replace(base, Na=Na, Nm=Nm, K=frac_K(m), dither=dith)
        seq = M.build_sequences(p, n=2 ** 18)
        ok = bool(np.array_equal(seq["D"], -(Nm - Na) * seq["E"]))
        out["identity"].append(dict(Na=Na, Nm=Nm, alpha=f"2^-{m}", dither=dith, exact=ok))
        check(f"C0 exact integer identity D=-(Nm-Na)E  Na={Na} Nm={Nm} a=2^-{m} dith={dith}", ok, ok, True,
              "edge-time difference in units T_mout/(Na*Q+K)")
        # independent long-double edge-time computation (sum of MMD periods)
        y = seq["y"].astype(np.longdouble)
        T_a = np.longdouble(2) / (np.longdouble(p.f_ref) * p.n_int)
        T_m = T_a * np.longdouble(Na * p.Q + p.K) / np.longdouble(Nm * p.Q + p.K)
        t_ref = np.cumsum((Na + y) * T_a)
        t_fb = np.cumsum((Nm + y) * T_m)
        e_eqv = (t_fb - t_ref) / T_m                         # cycles of f_out
        e_mfb = seq["E"].astype(np.longdouble) / p.Q         # w/o QEC (cycles)
        ratio_pred = -(Nm - Na) / (Na + p.alpha)
        err = float(np.max(np.abs(e_eqv - ratio_pred * e_mfb)))
        rms_ratio = float(np.std(e_eqv.astype(float)) / np.std(e_mfb.astype(float)))
        out["float_edges"].append(dict(Na=Na, Nm=Nm, alpha=p.alpha, max_err_cycles=err,
                                       rms_ratio=rms_ratio, predicted=abs(ratio_pred)))
        check(f"C0 long-double edges: e_eqv/e_mfb = {abs(ratio_pred):.5f} (Na={Na},Nm={Nm})",
              err < 1e-6 and abs(rms_ratio / abs(ratio_pred) - 1) < 1e-6,
              f"max err {err:.1e} cyc, rms ratio {rms_ratio:.5f}", f"{abs(ratio_pred):.5f}")
    # closed loop: PFD error with vs without QEC (noise off, linear CP)
    p = replace(qonly(base), n_cyc=2 ** 19, os=1)
    r_on = M.simulate(p, keep_e=True)
    r_off = M.simulate(replace(p, qec=False), keep_e=True)
    ratio = r_on["e_rms"] / r_off["e_rms"]
    out["closed_loop"] = dict(e_rms_qec_ps=r_on["e_rms"] * 1e12, e_rms_noqec_ps=r_off["e_rms"] * 1e12,
                              ratio=ratio, expected=1 / (13 + base.alpha),
                              e_pp_qec_ps=(r_on["e_max"] - r_on["e_min"]) * 1e12,
                              e_pp_noqec_ps=(r_off["e_max"] - r_off["e_min"]) * 1e12)
    check("C0 closed-loop PFD error rms ratio QEC/conv = 1/(13+a)", abs(ratio * (13 + base.alpha) - 1) < 0.02,
          r2(ratio, 5), r2(1 / (13 + base.alpha), 5),
          f"e_rms {r_on['e_rms']*1e12:.2f} ps vs {r_off['e_rms']*1e12:.1f} ps")
    # frequency plan (paper Figs. 19.2.3 / 19.2.4 / 19.2.5)
    fr = PAPER["f_ref"]
    f_int = M.f_out_formula(fr, 118, 13, 14, 0.0)
    f_frac = M.f_out_formula(fr, 118, 13, 14, 2 ** -11)
    sp11 = M.f_dsm_formula(fr, 118, 13, 2 ** -11) * 2 ** -11
    sp16 = M.f_dsm_formula(fr, 118, 13, 2 ** -16) * 2 ** -16
    fo1 = M.f_out_formula(fr, 118, 13, 14, 2 ** -11)
    fo2 = M.f_out_formula(fr, 127, 12, 13, 2 ** -9)
    out["freq"] = dict(f_out_int=f_int, f_out_frac=f_frac, spur_2m11=sp11, spur_2m16=sp16,
                       f_dsm_2m11=M.f_dsm_formula(fr, 118, 13, 2 ** -11),
                       aux_vco_118=fr * 118, aux_vco_127=fr * 127, transient_f1=fo1, transient_f2=fo2,
                       model_f_out=base.f_out, model_f_pfd=base.f_pfd)
    check("C0 f_out int-N = 81.93M*118/2*14/13", abs(f_int - PAPER["f_out_int"]) < 1e3, r2(f_int / 1e9, 6), 5.205706, "GHz")
    check("C0 f_out frac-N (13+2^-11):(14+2^-11)", abs(f_frac - PAPER["f_out_frac"]) < 1e3, r2(f_frac / 1e9, 6), 5.205692, "GHz")
    check("C0 spur offset f_DSM*alpha @2^-11", abs(sp11 - PAPER["spur_off_2m11"]) < 10, r2(sp11 / 1e3, 2), 181.55, "kHz")
    check("C0 spur offset f_DSM*alpha @2^-16", abs(sp16 - PAPER["spur_off_2m16"]) < 5, r2(sp16 / 1e3, 3), 5.67, "kHz")
    check("C0 transient end points 5.21 -> 5.64 GHz, aux VCO 9.67 -> 10.41 GHz",
          abs(fo1 - 5.21e9) < 5e6 and abs(fo2 - 5.64e9) < 5e6 and abs(fr * 118 - 9.67e9) < 5e6 and abs(fr * 127 - 10.41e9) < 5e6,
          [r2(fo1 / 1e9, 3), r2(fo2 / 1e9, 3), r2(fr * 118 / 1e9, 3), r2(fr * 127 / 1e9, 3)], [5.21, 5.64, 9.67, 10.41], "GHz")

    # figure: e_mfb vs e_eqv (paper Fig. 19.2.2 bottom)
    seq = M.build_sequences(base, n=400)
    k = np.arange(120)
    e_mfb = seq["E"][:120] / base.Q * base.t_vco * 1e12
    e_eqv = seq["r_dsm"][:120] * base.t_vco * 1e12
    dE = np.diff(np.concatenate(([0], seq["E"][:120]))) / base.Q * base.t_vco * 1e12
    fig, axs = plt.subplots(1, 2, figsize=(12, 3.8))
    axs[0].step(k, dE, "r", where="mid", label=r"$\Delta e_{mfb}[k]=(\alpha[k]-\alpha)T_{mout}$")
    axs[0].step(k, dE * base.f_out / base.f_aux, "b--", where="mid",
                label=r"$\Delta e_{mref}[k]=(\alpha[k]-\alpha)T_{aout}$")
    axs[0].step(k, np.diff(np.concatenate(([0], seq["r_dsm"][:120]))) * base.t_vco * 1e12, "0.4", where="mid",
                lw=2, label=r"$\Delta e_{eqv}=\Delta e_{mfb}-\Delta e_{mref}$")
    axs[0].set(xlabel="cycle k", ylabel="per-cycle error [ps]", title="C0a per-cycle Q-error (alpha=2^-11, Na=13, Nm=14)")
    axs[1].step(k, e_mfb, "r", where="mid", label="e_mfb (w/o QEC)")
    axs[1].step(k, e_eqv, "0.3", where="mid", lw=2, label="e_eqv = -e_mfb/(13+a)")
    axs[1].set(xlabel="cycle k", ylabel="accumulated error [ps]", title="C0b accumulated error seen by the PFD")
    for a in axs:
        a.grid(alpha=.3)
        a.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "C0_qec_arithmetic.png", dpi=130)
    plt.close(fig)
    return out


def exp_C1(base, n):
    print("\n[C1] Q-noise reduction with / without QEC (Q-noise only)")
    out = {}
    fig, ax = plt.subplots(figsize=(7.5, 4.6))
    res = {}
    for qec in (True, False):
        p = replace(qonly(base), qec=qec, n_cyc=n)
        r = M.simulate(p)
        f, L = M.pn_stitched(r)
        A = M.analytic_pn(f, p)
        lvl = C.band_level(f, L, 3e6, 3e7)
        lvl_a = C.band_level(f, A["q"], 3e6, 3e7)
        j = C.rms_jitter(f, L, p.f_out, 1e3, 1e8)
        j_a = C.rms_jitter(f, A["q"], p.f_out, 1e3, 1e8)
        res[qec] = dict(level_3_30MHz=lvl, level_analytic=lvl_a, jitter_fs=j * 1e15, jitter_analytic_fs=j_a * 1e15,
                        f_pfd=p.f_pfd)
        tag = "QEC" if qec else "conv"
        check(f"C1 Q-noise sim vs analytic ({tag}) 3-30 MHz", abs(lvl - lvl_a) < 0.7, r2(lvl), r2(lvl_a), "dBc/Hz @5.2 GHz")
        check(f"C1 Q-noise jitter sim vs analytic ({tag})", abs(j / j_a - 1) < 0.06, r2(j * 1e15, 1), r2(j_a * 1e15, 1), "fs 1k-100M")
        fs_, Ls_ = C.log_smooth(f, L, 150, 1e4, 1.8e8)
        ax.semilogx(fs_, Ls_ - D4, "C0" if qec else "C3", label=f"sim {tag}: {j*1e15:.1f} fs")
        ax.semilogx(f, A["q"] - D4, "k--" if qec else "k:", lw=1, label=f"analytic {tag}")
    fq, Lq = fig5("q", 0)
    fo, Lo = fig5("q_woqec", 0)
    ax.semilogx(fq, Lq, "m-", lw=3, alpha=.4, label="paper Fig.5 Q w/ QEC")
    ax.semilogx(fo, Lo, "-", color="0.3", lw=3, alpha=.4, label="paper Fig.5 Q w/o QEC")
    ax.set(xlabel="offset [Hz]", ylabel="L(f) [dBc/Hz] at /4 output (1.3 GHz)", ylim=(-200, -130),
           title="C1  Q-noise only, alpha=2^-11, Na:Nm=13:14")
    ax.grid(True, which="both", alpha=.3)
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(OUT / "C1_qnoise_reduction.png", dpi=130)
    plt.close(fig)
    red = res[False]["level_3_30MHz"] - res[True]["level_3_30MHz"]
    red_a = res[False]["level_analytic"] - res[True]["level_analytic"]
    exp = 20 * math.log10(13 + base.alpha)
    out = dict(qec=res[True], conv=res[False], reduction_dB=red, reduction_analytic_dB=red_a, expected_dB=exp)
    check("C1 Q-noise reduction = 20log10(13+alpha) (paper: 22.3 dB)", abs(red - exp) < 0.5, r2(red), r2(exp), "dB, 3-30 MHz")
    # paper-curve gap (paper's own two curves) for reference
    gap = float(np.mean(np.interp(np.log10(fq[fq >= 1e7]), np.log10(fo), Lo) - Lq[fq >= 1e7]))
    out["paper_curve_gap_dB"] = gap
    check("C1 paper Fig.5 gap between Q w/o and w/ QEC (digitised)", abs(gap - exp) < 1.0, r2(gap), r2(exp), "dB")
    return out


def exp_C2(base, n):
    print("\n[C2] division-ratio table: residual factor for (N+-k):N")
    rows = []
    for N in (11, 14):
        for kk in (1, 2, 3):
            for sgn in (+1, -1):
                Na = N + sgn * kk
                p = replace(qonly(base), Na=Na, Nm=N, n_cyc=n, os=1)
                lv = {}
                for qec in (True, False):
                    q = replace(p, qec=qec)
                    r = M.simulate(q)
                    f, L = M.pn_stitched(r)
                    lv[qec] = (C.band_level(f, L, 3e6, 3e7), C.band_level(f, M.analytic_pn(f, q)["q"], 3e6, 3e7))
                fac_sim = 10 ** ((lv[True][0] - lv[False][0]) / 20)
                fac_ana = 10 ** ((lv[True][1] - lv[False][1]) / 20)
                fac_exp = kk / (Na + p.alpha)
                rows.append(dict(N=N, Na=Na, Nm=N, k=kk, factor_sim=fac_sim, factor_analytic=fac_ana,
                                 factor_expected=fac_exp, f_pfd=p.f_pfd))
                print(f"    N={N} aux {Na}:main {N}  factor sim {fac_sim:.4f}  analytic {fac_ana:.4f}  k/(Na+a) {fac_exp:.4f}")
    worst = max(abs(r["factor_sim"] / r["factor_expected"] - 1) for r in rows)
    check("C2 sim residual factor = |Nm-Na|/(Na+alpha) (12 settings)", worst < 0.05, r2(worst, 3), "<0.05 rel. err")
    # paper table (N = 11): entries are (1/(N-1),1/(N+1)), (2/(N-2),2/(N+2)), (3/(N-3),3/(N+3)) rounded
    tab = {}
    for kk, (a, b) in PAPER["table_N11"].items():
        lo = [r for r in rows if r["N"] == 11 and r["k"] == kk and r["Na"] == 11 - kk][0]["factor_sim"]
        hi = [r for r in rows if r["N"] == 11 and r["k"] == kk and r["Na"] == 11 + kk][0]["factor_sim"]
        tab[kk] = dict(paper=(a, b), sim=(lo, hi))
        ok = abs(lo - a) < 0.006 and abs(hi - b) < 0.006
        check(f"C2 paper table N=11, (N+-{kk}):N", ok, [r2(lo, 3), r2(hi, 3)], [a, b], "factor (2-digit table)")
    # optimal setting: smallest factor for given N is k=1 with Na=N+1
    best = min(rows, key=lambda r: r["factor_sim"])
    check("C2 (N+-1):N is the optimal fractional-N setting", best["k"] == 1, f"best Na:Nm={best['Na']}:{best['Nm']}", "k=1")
    fig, ax = plt.subplots(figsize=(7, 4))
    for i, N in enumerate((11, 14)):
        for sgn, mk in ((+1, "o"), (-1, "s")):
            rr = [r for r in rows if r["N"] == N and np.sign(r["Na"] - N) == sgn]
            ax.plot([r["k"] for r in rr], [r["factor_sim"] for r in rr], mk, color=f"C{i}", ms=8,
                    label=f"sim N={N}, aux=N{'+' if sgn > 0 else '-'}k")
            ax.plot([r["k"] for r in rr], [r["factor_expected"] for r in rr], "-", color=f"C{i}", lw=1)
    for kk, (a, b) in PAPER["table_N11"].items():
        ax.plot([kk, kk], [a, b], "kx", ms=10, mew=2, label="paper table N=11" if kk == 1 else None)
    ax.set(xlabel="|Nm - Na| = k", ylabel="Q-noise amplitude factor", title="C2  residual factor k/(Na+alpha)")
    ax.grid(alpha=.3)
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(OUT / "C2_division_ratio_table.png", dpi=130)
    plt.close(fig)
    return dict(rows=rows, paper_table=tab)


def exp_C3(base, fitinfo, n):
    print("\n[C3] noise budget (fitted to Fig. 19.2.5 component curves; Q-noise predicted)")
    vals = fitinfo["values"]
    print("    fitted: " + ", ".join(f"{k}={v:.4g}" for k, v in vals.items()))
    print(f"    fit residual rms {fitinfo['rms_resid_dB']:.2f} dB (max {fitinfo['max_resid_dB']:.2f}) over {fitinfo['n_points']} points")
    check("C3 fit of analytic components to paper curves", fitinfo["rms_resid_dB"] < 1.5,
          r2(fitinfo["rms_resid_dB"]), "<1.5 dB rms", f"{len(FIT_NAMES)} fitted params")
    fA = M.analytic_grid()
    J, A = M.analytic_jitters(fA, base)
    Jo, Ao = M.analytic_jitters(fA, replace(base, qec=False))
    tot = J["total"]
    shares = {k: 100 * J[k] ** 2 / tot ** 2 for k in ("aux", "cp", "vco", "q")}
    q_off_share = 100 * Jo["q"] ** 2 / tot ** 2
    j_int = math.sqrt(tot ** 2 - J["q"] ** 2)
    out = dict(fit=fitinfo, bw3db=M.bw_3db(base), analytic_fs={k: v * 1e15 for k, v in J.items()},
               analytic_woqec_fs={k: v * 1e15 for k, v in Jo.items()}, shares_pct=shares,
               q_share_woqec_pct=q_off_share, jitter_intN_fs=j_int * 1e15)
    print(f"    analytic: total {tot*1e15:.1f} fs, shares " + ", ".join(f"{k} {v:.1f}%" for k, v in shares.items())
          + f"; w/o QEC: total {Jo['total']*1e15:.1f} fs, Q {Jo['q']*1e15:.1f} fs ({q_off_share:.0f}%)")
    check("C3 total jitter (fitted model) vs paper 95.1 fs", abs(tot * 1e15 / PAPER["jit_frac"] - 1) < 0.05,
          r2(tot * 1e15, 1), PAPER["jit_frac"], "fs 1k-100M (consistency of fit)")
    check("C3 int-N jitter (Q-noise removed) vs paper 91.8 fs", abs(j_int * 1e15 / PAPER["jit_int"] - 1) < 0.05,
          r2(j_int * 1e15, 1), PAPER["jit_int"], "fs", soft=True)
    for k in ("aux", "cp", "vco"):
        check(f"C3 jitter^2 share {k} (not a fit target)", abs(shares[k] - PAPER["shares"][k]) < 4,
              r2(shares[k], 1), PAPER["shares"][k], "%", soft=True)
    check("C3 Q-noise share with QEC (prediction)", 0.5 <= shares["q"] <= 2.0, r2(shares["q"], 2), "1 (0.5-2)", "%", soft=True)
    check("C3 Q-noise share w/o QEC (prediction) vs paper 238%", abs(q_off_share / PAPER["q_share_woqec"] - 1) < 0.25,
          r2(q_off_share, 0), PAPER["q_share_woqec"], "%", soft=True)
    check("C3 jitter w/o QEC (prediction) vs paper 173.8 fs", abs(Jo["total"] * 1e15 / PAPER["jit_woqec"] - 1) < 0.10,
          r2(Jo["total"] * 1e15, 1), PAPER["jit_woqec"], "fs", soft=True)
    # Q-noise level vs the paper's plotted curves (10-50 MHz plateau)
    fb = np.logspace(7, math.log10(5e7), 30)
    lq = float(np.mean(M.analytic_pn(fb, base)["q"])) - D4
    lqo = float(np.mean(M.analytic_pn(fb, replace(base, qec=False))["q"])) - D4
    fq, Lq = fig5("q", 0)
    fo, Lo = fig5("q_woqec", 0)
    pq = float(np.mean(np.interp(np.log10(fb), np.log10(fq), Lq)))
    po = float(np.mean(np.interp(np.log10(fb), np.log10(fo), Lo)))
    out["q_plateau"] = dict(model_qec=lq, model_woqec=lqo, paper_qec=pq, paper_woqec=po)
    check("C3 Q-noise plateau 10-50 MHz vs paper curve (w/o QEC)", abs(lqo - po) < 1.5, r2(lqo, 1), r2(po, 1),
          "dBc/Hz @1.3 GHz", soft=True)
    # what Q-noise level would reproduce the paper's 173.8 fs?
    need = (PAPER["jit_woqec"] ** 2 - (tot * 1e15) ** 2 + (J["q"] * 1e15) ** 2) / (Jo["q"] * 1e15) ** 2
    out["q_scale_needed_dB"] = 10 * math.log10(need)
    print(f"    Q-noise w/o QEC would need {out['q_scale_needed_dB']:+.1f} dB to give 173.8 fs")
    # sensitivity of the (unfitted) Q-noise prediction to the fit: pin some parameters
    sens = []
    for fix in ({"aux_vco_L1M": -108.0}, {"aux_vco_L1M": -100.0}, {"pm": 60.0}, {"fc": 1.6}, {"pm": 55.0, "fc": 1.2}):
        ps, fi = fit_budget(replace(base, qec=True), fix)
        Js, _ = M.analytic_jitters(fA, ps)
        Jso, _ = M.analytic_jitters(fA, replace(ps, qec=False))
        sens.append(dict(fixed=fix, rms_resid_dB=fi["rms_resid_dB"], total_fs=Js["total"] * 1e15,
                         q_share_pct=100 * Js["q"] ** 2 / Js["total"] ** 2, woqec_fs=Jso["total"] * 1e15,
                         q_woqec_share_pct=100 * Jso["q"] ** 2 / Js["total"] ** 2, bw3db=M.bw_3db(ps)))
        print(f"    sensitivity, fixed {fix}: fit rms {fi['rms_resid_dB']:.2f} dB, total {Js['total']*1e15:.1f} fs, Q {sens[-1]['q_share_pct']:.1f}%,"
              f" w/o QEC {Jso['total']*1e15:.1f} fs (Q {sens[-1]['q_woqec_share_pct']:.0f}%)")
    out["fit_sensitivity"] = sens
    good = [x["woqec_fs"] for x in sens if x["rms_resid_dB"] < 0.6] + [Jo["total"] * 1e15]
    out["woqec_range_comparable_fits_fs"] = [min(good), max(good)]
    check("C3 w/o-QEC jitter range over comparable fits (rms<0.6 dB) contains 173.8 fs",
          min(good) <= PAPER["jit_woqec"] <= max(good), [r2(min(good), 1), r2(max(good), 1)], PAPER["jit_woqec"], "fs",
          soft=True)

    # ---- time-domain simulation (full noise) and per-source sims
    sims = {}
    curves = {}
    for tag, kw in [("qec", {}), ("conv", dict(qec=False))]:
        p = replace(base, n_cyc=n, **kw)
        r = M.simulate(p)
        js, Aj, f1, f, L = sim_vs_analytic(r, p)
        sims[tag] = dict(jitter_fs=js * 1e15, analytic_fs=Aj["total"] * 1e15, band_lo_Hz=f1,
                         L={str(int(k)): level_near(f, L, k) for k in (1e3, 1e4, 1e5, 1e6, 1e7) if k > f[0]})
        curves[tag] = (f, L)
        check(f"C3 full-noise sim vs analytic jitter ({tag})", abs(js / Aj["total"] - 1) < 0.05,
              r2(js * 1e15, 1), r2(Aj["total"] * 1e15, 1), f"fs {f1/1e3:.1f}k-100M")
    nsrc = max(n // 2, 2 ** 18)
    src_kw = {
        "aux": dict(cp_tn=None, vco_L1M=None, out_floor=None),
        "cp": dict(aux_vco_L1M=None, aux_inband=None, ref_floor=None, vco_L1M=None, out_floor=None),
        "vco": dict(aux_vco_L1M=None, aux_inband=None, ref_floor=None, cp_tn=None),
    }
    for k, kw in src_kw.items():
        p = replace(base, n_cyc=nsrc, **kw)
        r = M.simulate(p)
        Ls, Aj, f1, f, L = sim_vs_analytic(r, p)
        # subtract the (small) Q-noise that is always present
        js = math.sqrt(max(Ls ** 2 - Aj["q"] ** 2, 0))
        sims[f"only_{k}"] = dict(jitter_fs=js * 1e15, analytic_fs=Aj[k] * 1e15, band_lo_Hz=f1)
        check(f"C3 per-source sim vs analytic ({k} only)", abs(js / Aj[k] - 1) < 0.07, r2(js * 1e15, 1),
              r2(Aj[k] * 1e15, 1), f"fs {f1/1e3:.1f}k-100M")
    out["sims"] = sims
    # marker comparison with Fig. 19.2.3 (frac-N)
    f, L = curves["qec"]
    mk = {}
    for fo_, Lp in PAPER["markers_frac"].items():
        if fo_ >= 1e8 or 0.85 * fo_ < f[0]:
            continue
        mk[str(int(fo_))] = dict(sim=level_near(f, L, fo_) - D4, paper=Lp)
    out["markers_vs_fig3"] = mk
    worst = max(abs(v["sim"] - v["paper"]) for v in mk.values())
    check("C3 sim PN at Fig.3 markers (1k..10M, frac-N)", worst < 2.5, r2(worst), "<2.5 dB", "max |sim-paper|", soft=True)

    # figure
    fig, axs = plt.subplots(1, 2, figsize=(14, 5), sharey=True)
    ax = axs[0]
    fs_, Ls_ = C.log_smooth(*curves["qec"], 200, 1e3, 1e8)
    ax.semilogx(fs_, Ls_ - D4, "k", lw=2, label=f"sim total w/ QEC ({sims['qec']['jitter_fs']:.1f} fs)")
    cols = dict(aux="C1", cp="C2", vco="C4", q="m")
    g = M.group_components(A)
    for k, c in cols.items():
        ax.semilogx(fA, 10 * np.log10(g[k] + 1e-300) - D4, c, label=f"model {k} ({shares[k]:.1f}%)")
        key = {"aux": "aux", "cp": "cp", "vco": "vco", "q": "q"}[k]
        fp, Lp = fig5(key, 0)
        ax.semilogx(fp, Lp, c, lw=4, alpha=.3)
    fp, Lp = fig5("total", 0)
    ax.semilogx(fp, Lp, "c", lw=4, alpha=.4, label="paper Fig.5 curves (thick, faint)")
    ax.semilogx(fA, Ao["q"] - D4, "k:", label=f"model Q w/o QEC ({q_off_share:.0f}%)")
    fp, Lp = fig5("q_woqec", 0)
    ax.semilogx(fp, Lp, "k", lw=4, alpha=.25)
    ax.plot(list(PAPER["markers_frac"].keys()), list(PAPER["markers_frac"].values()), "bD", label="Fig.3 markers frac-N")
    ax.set(xlabel="offset [Hz]", ylabel="L(f) [dBc/Hz] at /4 output", ylim=(-175, -100),
           title="C3a noise budget (model fitted to paper Fig. 19.2.5)")
    ax.grid(True, which="both", alpha=.3)
    ax.legend(fontsize=7)
    ax = axs[1]
    for tag, c in (("qec", "C0"), ("conv", "C3")):
        fs_, Ls_ = C.log_smooth(*curves[tag], 200, 1e3, 1e8)
        ax.semilogx(fs_, Ls_ - D4, c, label=f"sim {tag}: {sims[tag]['jitter_fs']:.1f} fs (analytic {sims[tag]['analytic_fs']:.1f})")
    ax.semilogx(fA, A["total"] - D4, "k--", lw=1, label="analytic w/ QEC")
    ax.semilogx(fA, Ao["total"] - D4, "k:", lw=1, label="analytic w/o QEC")
    ax.set(xlabel="offset [Hz]", title="C3b total PN: proposed vs conventional cascaded (same noise)")
    ax.grid(True, which="both", alpha=.3)
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "C3_noise_budget.png", dpi=130)
    plt.close(fig)
    return out


def spur_sim(p, n, harmonics=(1, 2, 3)):
    q = replace(qonly(p), n_cyc=n, os=1, settle=2 ** 14)
    r = M.simulate(q)
    return M.spur_levels(r, harmonics), r


def exp_C4(base, n_sp, n):
    print("\n[C4] fractional spur vs CP UP/DN mismatch beta and vs FCW")
    out = {}
    betas = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2]
    sw = []
    for b in betas:
        s_on, _ = spur_sim(replace(base, beta=b), n_sp)
        s_off, _ = spur_sim(replace(base, beta=b, qec=False), n_sp)
        sw.append(dict(beta=b, qec=s_on, conv=s_off))
        print(f"    beta={b:.3f}: QEC {s_on[1]:6.1f}/{s_on[2]:6.1f} dBc (1st/2nd) | conv {s_off[1]:6.1f}/{s_off[2]:6.1f}")
    out["beta_sweep"] = sw
    s0, _ = spur_sim(replace(base, beta=0.0), n_sp)
    out["beta0_spur"] = s0
    lb = np.log10(betas)
    s1 = np.array([x["qec"][1] for x in sw])
    slope, icpt = np.polyfit(lb, s1, 1)
    beta_fit = 10 ** ((PAPER["spur_worst"] - icpt) / slope)
    out["slope_dB_per_dec"] = slope
    out["beta_fit"] = beta_fit
    check("C4 spur grows 20 dB/dec with beta (piece-wise linear CP)", abs(slope - 20) < 1.0, r2(slope), 20, "dB/dec")
    sup = float(np.mean([x["conv"][1] - x["qec"][1] for x in sw]))
    out["qec_spur_suppression_dB"] = sup
    check("C4 QEC suppresses CP-nonlinearity spur by 20log10(13+a)", abs(sup - 20 * math.log10(13 + base.alpha)) < 1.0,
          r2(sup), r2(20 * math.log10(13 + base.alpha)), "dB (peak error /13 -> folded tone /13)")
    check("C4 linear CP (beta=0): no fractional spur", s0[1] < -120, r2(s0[1], 1), "<-120 dBc")
    print(f"    beta reproducing -70.6 dBc (fundamental, 2^-11): {beta_fit*100:.2f}%")
    # FCW sweep at beta_fit (QEC) and conv
    fcw = []
    pb = replace(base, beta=beta_fit)
    for m in range(16, 4, -1):
        s_on, _ = spur_sim(replace(pb, K=frac_K(m)), n_sp, (1, 2))
        s_off, _ = spur_sim(replace(pb, K=frac_K(m), qec=False), n_sp, (1, 2))
        H = abs(M.H_main(pb, np.array([2 ** -m * pb.f_pfd]))[0][0])
        worst = max(s_on.values())
        fcw.append(dict(m=m, f_spur=2 ** -m * pb.f_pfd, qec=s_on, conv=s_off, worst_qec=worst,
                        worst_conv=max(s_off.values()), paper=PAPER["spur_vs_fcw"][m], H_dB=20 * math.log10(H)))
        print(f"    2^-{m:2d} ({2**-m*pb.f_pfd/1e3:8.1f} kHz): QEC worst {worst:6.1f} | conv {max(s_off.values()):6.1f} | paper {PAPER['spur_vs_fcw'][m]:6.1f} | |H| {20*math.log10(H):5.1f} dB")
    out["fcw_sweep"] = fcw
    flat = [x["worst_qec"] for x in fcw if x["m"] >= 10]
    check("C4 flat in-band spur 2^-16..2^-10 (paper: -70.6..-71.3)", max(flat) - min(flat) < 3 and abs(np.mean(flat) - (-70.9)) < 2,
          [r2(min(flat), 1), r2(max(flat), 1)], "-71.3..-70.6", "dBc", soft=True)
    ro = {x["m"]: x["worst_qec"] - np.mean(flat) for x in fcw if x["m"] <= 9}
    ro_p = {m: PAPER["spur_vs_fcw"][m] - (-70.9) for m in ro}
    dev = max(abs(ro[m] - ro_p[m]) for m in ro)
    out["rolloff_model"] = ro
    out["rolloff_paper"] = ro_p
    check("C4 roll-off above BW2 (2^-9..2^-5) vs Fig.4", dev < 3.0, {m: r2(v, 1) for m, v in ro.items()},
          {m: r2(v, 1) for m, v in ro_p.items()}, f"dB rel. flat level, max dev {dev:.1f} dB", soft=True)
    conv_flat = [x["worst_conv"] for x in fcw if x["m"] >= 10]
    out["conv_flat_mean"] = float(np.mean(conv_flat))
    # harmonic structure (paper: 2nd harmonic is the worst, Fig. 19.2.4 top)
    h = [x for x in fcw if x["m"] == 11][0]["qec"]
    pm1 = max(PAPER["spur_markers_2m11"][1]) + D4
    pm2 = max(PAPER["spur_markers_2m11"][2]) + D4
    out["harmonics_2m11"] = dict(model=h, paper={1: pm1, 2: pm2})
    check("C4 harmonic structure @2^-11: paper 2nd >= 1st", h[2] >= h[1] - 1, [r2(h[1], 1), r2(h[2], 1)],
          [r2(pm1, 1), r2(pm2, 1)], "dBc (1st, 2nd)", soft=True)
    # a candidate even-order mechanism: modulus-dependent delay quadratic in the code (main MMD only)
    quad = tuple(0.05e-12 * (np.arange(M.ALPHA_MIN, M.ALPHA_MAX + 1)) ** 2)
    sq, _ = spur_sim(replace(base, mmd_table_m=quad), n_sp, (1, 2, 3, 4))
    out["quad_delay_0p05ps"] = sq
    print(f"    even-order hypothesis: 0.05 ps*code^2 MMD delay mismatch -> spurs {', '.join(f'{k}:{v:.1f}' for k, v in sq.items())} dBc")
    # jitter with spurs and folded noise (full noise, beta_fit)
    jit = {}
    for tag, kw in [("qec_beta0", dict(beta=0.0)), ("qec_betafit", dict(beta=beta_fit)),
                    ("conv_beta0", dict(beta=0.0, qec=False)), ("conv_betafit", dict(beta=beta_fit, qec=False))]:
        p = replace(base, n_cyc=n, **kw)
        r = M.simulate(p)
        f, L = M.pn_stitched(r)
        j_all = C.rms_jitter(f, L, p.f_out, 1e3, 1e8)
        fsp = p.alpha * p.f_pfd
        msk = np.ones_like(f, bool)
        for hh in range(1, 40):
            msk &= np.abs(f - hh * fsp) > max(3e3, 0.02 * fsp)
        j_ns = C.rms_jitter(f[msk], L[msk], p.f_out, 1e3, 1e8)
        jit[tag] = dict(with_spur_fs=j_all * 1e15, without_spur_fs=j_ns * 1e15)
        print(f"    {tag}: jitter w/ spur {j_all*1e15:.1f} fs, w/o spur {j_ns*1e15:.1f} fs")
    out["jitter"] = jit
    d_paper = PAPER["jit_frac_spur"] - PAPER["jit_frac"]
    d_model = jit["qec_betafit"]["with_spur_fs"] - jit["qec_betafit"]["without_spur_fs"]
    check("C4 jitter increase from spurs (paper 95.1 -> 95.9 fs)", abs(d_model - d_paper) < 0.5, r2(d_model, 2), r2(d_paper, 2),
          "fs", soft=True)
    check("C4 conv. cascaded with same beta: folded noise + spurs degrade jitter",
          jit["conv_betafit"]["with_spur_fs"] > 1.3 * jit["qec_betafit"]["with_spur_fs"],
          r2(jit["conv_betafit"]["with_spur_fs"], 1), f"> 1.3 x {jit['qec_betafit']['with_spur_fs']:.1f}", "fs")
    # figure
    fig, axs = plt.subplots(1, 3, figsize=(16, 4.5))
    axs[0].semilogx(betas, [x["qec"][1] for x in sw], "o-", label="QEC (13:14)")
    axs[0].semilogx(betas, [x["conv"][1] for x in sw], "s-", label="conventional cascaded")
    axs[0].axhline(PAPER["spur_worst"], color="k", ls=":", label="paper -70.6 dBc")
    axs[0].axvline(beta_fit, color="0.5", ls="--")
    axs[0].set(xlabel="CP UP/DN mismatch beta", ylabel="spur @ alpha*f_DSM [dBc]", title="C4a spur vs beta (alpha=2^-11)")
    ms = [x["m"] for x in fcw]
    axs[1].plot(ms, [x["worst_qec"] for x in fcw], "o-", label=f"model QEC, beta={beta_fit*100:.1f}%")
    axs[1].plot(ms, [x["worst_conv"] for x in fcw], "s-", label="model conv., same beta")
    axs[1].plot(ms, [x["paper"] for x in fcw], "kD--", label="paper Fig. 19.2.4")
    axs[1].plot(ms, [np.mean(flat) + x["H_dB"] for x in fcw], "0.5", ls=":", label="flat + 20log|H(f_spur)|")
    axs[1].invert_xaxis()
    axs[1].set_xticks(ms)
    axs[1].set_xticklabels([f"2^-{m}" for m in ms], rotation=45)
    axs[1].set(xlabel="fractional FCW", ylabel="worst frac. spur [dBc]", title="C4b spur vs FCW")
    p = replace(qonly(base), beta=beta_fit, n_cyc=n_sp, os=1)
    r = M.simulate(p)
    th = r["theta"]
    fsp, Lsp = C.phase_noise(th, p.f_pfd, nperseg=2 ** 18)
    axs[2].semilogx(fsp, Lsp, lw=.8, label="QEC, beta_fit (noise off)")
    r2_ = M.simulate(replace(p, qec=False))
    fsp2, Lsp2 = C.phase_noise(r2_["theta"], p.f_pfd, nperseg=2 ** 18)
    axs[2].semilogx(fsp2, Lsp2, lw=.8, alpha=.7, label="conventional")
    axs[2].set(xlim=(1e4, 1e8), xlabel="offset [Hz]", ylabel="PSD [dBc/Hz]", title="C4c spectrum (alpha=2^-11, deterministic)")
    for a in axs:
        a.grid(True, which="both", alpha=.3)
        a.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(OUT / "C4_fractional_spur.png", dpi=130)
    plt.close(fig)
    return out


def exp_C5(base, n, n_sp, quick):
    out = {}
    fA = M.analytic_grid()
    J0, _ = M.analytic_jitters(fA, base)
    j0 = J0["total"]
    # ---------------------------------------------------------------- (a) latency
    print("\n[C5a] DSM-to-MMD latency mismatch")
    la = []
    fig, axs = plt.subplots(2, 3, figsize=(17, 9))
    ax = axs[0, 0]
    for (da, dm) in [(0, 0), (1, 0), (0, 1), (2, 0), (1, 1)]:
        p = replace(qonly(base), lat_a=da, lat_m=dm, n_cyc=n // 2)
        r = M.simulate(p)
        f, L = M.pn_stitched(r)
        A = M.analytic_pn(f, p)
        lv = C.band_level(f, L, 3e5, 3e6)
        lva = C.band_level(f, A["q"], 3e5, 3e6)
        jq = C.rms_jitter(f, L, p.f_out, 1e3, 1e8)
        Jf, _ = M.analytic_jitters(fA, replace(base, lat_a=da, lat_m=dm))
        la.append(dict(lat_a=da, lat_m=dm, q_level_0p3_3MHz=lv, analytic=lva, q_jitter_fs=jq * 1e15,
                       total_jitter_analytic_fs=Jf["total"] * 1e15))
        print(f"    lat_a={da} lat_m={dm}: Q-only {jq*1e15:6.1f} fs, in-band(0.3-3M) {lv:.1f} (analytic {lva:.1f}) -> total {Jf['total']*1e15:.1f} fs")
        fs_, Ls_ = C.log_smooth(f, L, 150, 1e4, 1.8e8)
        ax.semilogx(fs_, Ls_, label=f"lat a/m={da}/{dm}: {jq*1e15:.0f} fs")
    pc = replace(qonly(base), qec=False)
    ax.semilogx(fA, M.analytic_pn(fA, pc)["q"], "k:", label="conv. (analytic)")
    ax.set(xlabel="offset [Hz]", ylabel="Q-noise L(f) @5.2 GHz", ylim=(-190, -110), title="C5a DSM->MMD latency mismatch")
    ok = all(abs(x["q_level_0p3_3MHz"] - x["analytic"]) < 1.0 for x in la)
    check("C5a latency: sim vs analytic G(z)=[(Na+a)z^-dm-(Nm+a)z^-da]/(Na+a)", ok,
          [r2(x["q_level_0p3_3MHz"], 1) for x in la], [r2(x["analytic"], 1) for x in la], "dBc/Hz 0.3-3 MHz")
    l1 = [x for x in la if x["lat_a"] == 1 and x["lat_m"] == 0][0]
    l11 = [x for x in la if x["lat_a"] == 1 and x["lat_m"] == 1][0]
    check("C5a equal latency in both MMDs keeps the cancellation", abs(l11["q_jitter_fs"] / la[0]["q_jitter_fs"] - 1) < 0.1,
          r2(l11["q_jitter_fs"], 1), r2(la[0]["q_jitter_fs"], 1), "fs Q-only")
    out["latency"] = la
    print(f"    1-cycle mismatch: Q-only jitter {la[0]['q_jitter_fs']:.1f} -> {l1['q_jitter_fs']:.1f} fs")
    # ---------------------------------------------------------------- (b) MMD delay mismatch
    print("\n[C5b] modulus-dependent MMD delay mismatch")
    mb = dict(linear=[], table=[])
    for kap in (1e-12, 5e-12):
        p = replace(qonly(base), mmd_kappa_m=kap, n_cyc=n // 2)
        r = M.simulate(p)
        f, L = M.pn_stitched(r)
        A = M.analytic_pn(f, p)
        lv = C.band_level(f, L, 3e7, 1e8)
        lva = 10 * np.log10(np.mean(10 ** (A["total"][(f >= 3e7) & (f <= 1e8)] / 10)))
        Jf, _ = M.analytic_jitters(fA, replace(base, mmd_kappa_m=kap))
        mb["linear"].append(dict(kappa_ps=kap * 1e12, level_30_100MHz=lv, analytic=lva, total_jitter_fs=Jf["total"] * 1e15))
        print(f"    linear {kap*1e12:.0f} ps/step: 30-100 MHz {lv:.1f} (analytic {lva:.1f}); total jitter {Jf['total']*1e15:.1f} fs")
    check("C5b linear delay mismatch: sim vs analytic ((1-z^-1)^3, coherent with Q-noise)",
          all(abs(x["level_30_100MHz"] - x["analytic"]) < 1.0 for x in mb["linear"]),
          [r2(x["level_30_100MHz"], 1) for x in mb["linear"]], [r2(x["analytic"], 1) for x in mb["linear"]], "dBc/Hz")
    rng = np.random.default_rng(11)
    unit = rng.standard_normal(M.ALPHA_MAX - M.ALPHA_MIN + 1)
    unit -= unit.mean()
    unit /= unit.std()
    for sig in (0.03e-12, 0.1e-12, 0.3e-12, 1e-12):
        tab = tuple(sig * unit)
        s_on, _ = spur_sim(replace(base, mmd_table_m=tab), n_sp)
        s_conv, _ = spur_sim(replace(base, mmd_table_m=tab, qec=False), n_sp)
        tab_scaled = tuple(np.array(tab) * base.f_out / base.f_aux)   # same delay in input periods
        s_match, _ = spur_sim(replace(base, mmd_table_m=tab, mmd_table_a=tab), n_sp)
        s_per, _ = spur_sim(replace(base, mmd_table_m=tab, mmd_table_a=tab_scaled), n_sp)
        mb["table"].append(dict(sigma_ps=sig * 1e12, qec_unmatched=s_on, conv=s_conv, qec_matched=s_match,
                                qec_matched_in_input_periods=s_per))
        print(f"    random per-code delay sigma {sig*1e12:.2f} ps (main MMD only): QEC {max(s_on.values()):6.1f} | conv {max(s_conv.values()):6.1f}"
              f" | matched aux {max(s_match.values()):6.1f} | matched in input periods {max(s_per.values()):6.1f} dBc")
    t1 = [x for x in mb["table"] if abs(x["sigma_ps"] - 0.1) < 1e-9][0]
    check("C5b code-dependent delay mismatch is NOT divided by (N+-1)",
          abs(max(t1["qec_unmatched"].values()) - max(t1["conv"].values())) < 2.0,
          r2(max(t1["qec_unmatched"].values()), 1), r2(max(t1["conv"].values()), 1), "dBc QEC vs conv (sigma 0.1 ps)")
    check("C5b delay that scales with the input period is divided by (Na+a)",
          abs((max(t1["qec_unmatched"].values()) - max(t1["qec_matched_in_input_periods"].values())) - 20 * math.log10(13 + base.alpha)) < 1.5,
          r2(max(t1["qec_unmatched"].values()) - max(t1["qec_matched_in_input_periods"].values()), 1), r2(20 * math.log10(13 + base.alpha), 1), "dB")
    sigs = np.array([x["sigma_ps"] for x in mb["table"]])
    sps = np.array([max(x["qec_unmatched"].values()) for x in mb["table"]])
    sl, ic = np.polyfit(np.log10(sigs), sps, 1)
    mb["sigma_for_m70p6_ps"] = float(10 ** ((PAPER["spur_worst"] - ic) / sl))
    print(f"    per-code delay mismatch giving -70.6 dBc alone: {mb['sigma_for_m70p6_ps']*1e3:.0f} fs")
    out["mmd_delay"] = mb
    ax = axs[0, 1]
    ax.loglog(sigs, 10 ** (sps / 20), "o-", label="QEC, mismatch main-only")
    ax.loglog(sigs, [10 ** (max(x["conv"].values()) / 20) for x in mb["table"]], "s--", label="conventional")
    ax.loglog(sigs, [10 ** (max(x["qec_matched_in_input_periods"].values()) / 20) for x in mb["table"]], "^-",
              label="QEC, delay = same # input periods")
    ax.axhline(10 ** (PAPER["spur_worst"] / 20), color="k", ls=":", label="-70.6 dBc")
    ax.set(xlabel="per-code MMD delay mismatch sigma [ps]", ylabel="worst spur (amplitude)", title="C5b code-dependent MMD delay")
    # ---------------------------------------------------------------- (c) aux noise transfer
    print("\n[C5c] aux-PLL noise transfer and aux BW choice")
    bws = [1e6, 2e6, 5e6, 10e6, 20e6, 40e6]
    rows = []
    for bw in bws:
        Jb, Ab = M.analytic_jitters(fA, replace(base, aux_bw=bw))
        jv = C.rms_jitter(fA, Ab["aux_vco"], base.f_out, 1e3, 1e8) if "aux_vco" in Ab else 0
        jin = math.sqrt(max(Jb["aux"] ** 2 - jv ** 2, 0))
        Jw, Aw = M.analytic_jitters(fA, replace(base, aux_bw=bw, aux_vco_L1M=base.aux_vco_L1M + 10))
        rows.append(dict(aux_bw=bw, total_fs=Jb["total"] * 1e15, aux_vco_fs=jv * 1e15, aux_inband_fs=jin * 1e15,
                         total_auxvco_plus10dB_fs=Jw["total"] * 1e15))
        print(f"    aux BW {bw/1e6:4.0f} MHz: total {Jb['total']*1e15:6.1f} fs (aux VCO {jv*1e15:5.1f}, aux in-band {jin*1e15:5.1f}); aux VCO +10 dB -> {Jw['total']*1e15:.1f} fs")
    out["aux_bw"] = rows
    r10 = [x for x in rows if x["aux_bw"] == 10e6][0]
    check("C5c aux VCO contribution at 10 MHz aux BW is negligible (<3% of jitter^2)",
          (r10["aux_vco_fs"] / r10["total_fs"]) ** 2 < 0.03, r2(100 * (r10["aux_vco_fs"] / r10["total_fs"]) ** 2, 2), "<3",
          f"% (aux VCO {base.aux_vco_L1M:.1f} dBc/Hz@1MHz at f_aux, from the Fig.5 fit)", soft=True)
    p = replace(base, cp_tn=None, vco_L1M=None, out_floor=None, aux_inband=None, ref_floor=None,
                aux_vco_L1M=base.aux_vco_L1M + 20, n_cyc=n // 2)
    r = M.simulate(p)
    f, L = M.pn_stitched(r)
    A = M.analytic_pn(f, p)
    lv, lva = C.band_level(f, L, 2e6, 2e7), C.band_level(f, A["total"], 2e6, 2e7)
    out["aux_vco_sim"] = dict(level_2_20MHz=lv, analytic=lva)
    check("C5c aux-VCO-only sim (HP by aux loop, LP by main loop) vs analytic", abs(lv - lva) < 1.0, r2(lv), r2(lva), "dBc/Hz 2-20 MHz")
    ax = axs[0, 2]
    fx = np.logspace(3, 8, 400)
    Lfr = base.aux_vco_L1M + 20 * np.log10(1e6 / fx)
    comps = M.aux_L_components(base, fx)
    ax.semilogx(fx, Lfr, "0.5", label="aux VCO free-running (f_aux)")
    ax.semilogx(fx, 10 * np.log10(comps["aux_vco"]), "r", label="@ aux output (x|1-Ha|^2)")
    ax.semilogx(fx, M.analytic_pn(fx, base)["aux_vco"], "b",
                label="@ main output (x|Hm|^2, incl. f_DSM sampling aliases)")
    ax.semilogx(fx, 10 * np.log10(comps["aux_spd"] + comps["aux_ref"]), "C1--", label="aux in-band (SPD+ref) @ aux out")
    ax.semilogx(f, L - 20, "b", alpha=.3, lw=.6, label="sim (aux VCO +20 dB, others off) -20 dB")
    ax.set(ylim=(-190, -60), xlabel="offset [Hz]", ylabel="L [dBc/Hz]", title="C5c aux VCO PN filtering (Fig. 19.2.2 top-middle)")
    # ---------------------------------------------------------------- (d) aux MMD jitter
    print("\n[C5d] aux-MMD output jitter (not retimed)")
    md = []
    for sj in (0.1e-12, 0.3e-12, 1e-12):
        p = replace(base, aux_mmd_jit=sj, n_cyc=n)
        r = M.simulate(p)
        js, Jd, f1, f, L = sim_vs_analytic(r, p)
        md.append(dict(sigma_ps=sj * 1e12, sim_fs=js * 1e15, analytic_fs=Jd["total"] * 1e15))
        print(f"    aux MMD jitter {sj*1e12:.1f} ps rms: total {js*1e15:.1f} fs (analytic {Jd['total']*1e15:.1f}, ideal {j0*1e15:.1f})")
    check("C5d aux-MMD jitter: sim vs analytic", all(abs(x["sim_fs"] / x["analytic_fs"] - 1) < 0.05 for x in md),
          [r2(x["sim_fs"], 1) for x in md], [r2(x["analytic_fs"], 1) for x in md], "fs")
    # max sigma for 5 % jitter degradation (analytic, white -> flat in-band floor)
    lo, hi = 1e-15, 5e-12
    for _ in range(50):
        mid = math.sqrt(lo * hi)
        Jm, _ = M.analytic_jitters(fA, replace(base, aux_mmd_jit=mid))
        if Jm["total"] > 1.05 * j0:
            hi = mid
        else:
            lo = mid
    out["aux_mmd"] = dict(rows=md, sigma_5pct_fs=lo * 1e15)
    print(f"    max aux-MMD jitter for +5 % total jitter: {lo*1e15:.0f} fs rms")
    ax = axs[1, 0]
    ax.plot([x["sigma_ps"] for x in md], [x["sim_fs"] for x in md], "o", label="sim")
    ss = np.logspace(-1, 0.1, 30)
    ax.plot(ss, [M.analytic_jitters(fA, replace(base, aux_mmd_jit=s * 1e-12))[0]["total"] * 1e15 for s in ss], "-", label="analytic")
    ax.set_xscale("log")
    ax.set(xlabel="aux MMD output jitter [ps rms]", ylabel="total jitter [fs]", title="C5d aux-MMD jitter (no retiming)")
    # ---------------------------------------------------------------- (e) frequency plan
    print("\n[C5e] frequency plan: coverage, resolution, FCW->frequency non-linearity")
    fr = base.f_ref
    Q = base.Q
    segs = []
    for nint in range(111, 128):           # aux VCO 9.1-10.4 GHz (Fig. 19.2.2)
        fa = fr * nint / 2
        for Na in range(11, 16):
            for Nm in (Na - 1, Na + 1):
                if not 12 <= Nm <= 14:
                    continue
                a = np.linspace(0, 1, 201)
                fo = fa * (Nm + a) / (Na + a)
                segs.append(dict(n_int=nint, Na=Na, Nm=Nm, f_lo=float(fo.min()), f_hi=float(fo.max()),
                                 res_lo=float(fa / (Na + 1) ** 2 / Q), res_hi=float(fa / Na ** 2 / Q)))
    grid = np.linspace(4.7e9, 5.7e9, 2001)
    cov = np.zeros_like(grid, bool)
    for s in segs:
        cov |= (grid >= s["f_lo"]) & (grid <= s["f_hi"])
    holes = grid[~cov]
    hole_iv = []
    if len(holes):
        idx = np.where(~cov)[0]
        brk = np.where(np.diff(idx) > 1)[0]
        starts = np.concatenate(([idx[0]], idx[brk + 1]))
        ends = np.concatenate((idx[brk], [idx[-1]]))
        hole_iv = [[float(grid[a_] / 1e6), float(grid[b_] / 1e6)] for a_, b_ in zip(starts, ends)]
    res_all = [s["res_lo"] for s in segs] + [s["res_hi"] for s in segs]
    # chirp non-linearity for (Na, Nm) = (13, 14) at n_int = 118
    fa = fr * 118 / 2
    a = np.linspace(0, 1, 1001)
    fo = fa * (14 + a) / (13 + a)
    lin = fo[0] + (fo[-1] - fo[0]) * a
    nl = float(np.max(np.abs(fo - lin)))
    slope_ratio = (13 + 1) ** 2 / 13 ** 2
    # inverse mapping: alpha for a target frequency, quantised to Q
    tgt = 5.2e9
    a_t = (14 * fa - 13 * tgt) / (tgt - fa)
    K_t = round(a_t * Q)
    f_t = fa * (14 + K_t / Q) / (13 + K_t / Q)
    out["freq_plan"] = dict(n_segments=len(segs), coverage_frac=float(cov.mean()),
                            holes_MHz=hole_iv, f_max_GHz=max(s_["f_hi"] for s_ in segs) / 1e9,
                            f_min_GHz=min(s_["f_lo"] for s_ in segs) / 1e9,
                            res_Hz_min=float(min(res_all)), res_Hz_max=float(max(res_all)),
                            span_per_setting_MHz=float((fo[0] - fo[-1]) / 1e6), chirp_nonlin_MHz=nl / 1e6,
                            chirp_nonlin_pct_of_span=100 * nl / abs(fo[-1] - fo[0]), slope_ratio=slope_ratio,
                            target_5p2GHz=dict(alpha=a_t, K=K_t, f=f_t, err_Hz=f_t - tgt))
    print(f"    coverage of 4.7-5.7 GHz with N_int 111..127, Na 11..15, Nm=Na+-1 (12..14): {100*cov.mean():.1f}%"
          + (f", holes [MHz] {[[round(x_) for x_ in h_] for h_ in hole_iv]}" if hole_iv else ""))
    print(f"    LSB resolution {min(res_all):.2f}..{max(res_all):.2f} Hz (Q=2^24); one (Na,Nm) setting spans {abs(fo[0]-fo[-1])/1e6:.1f} MHz;"
          f" FCW->f non-linearity {nl/1e6:.2f} MHz ({100*nl/abs(fo[-1]-fo[0]):.1f}% of span), slope ratio {slope_ratio:.3f}")
    check("C5e exact channel synthesis: alpha solved for 5.2 GHz, error < 1 LSB step",
          abs(f_t - tgt) < fa / 13 ** 2 / Q, r2(f_t - tgt, 4), f"< {fa/13**2/Q:.4f} Hz")
    ax = axs[1, 1]
    ax.plot(a, (fo - lin) / 1e6, label="f_out - linear chord")
    ax2 = ax.twinx()
    ax2.plot(a, -fa / (13 + a) ** 2 / 1e6, "C1", label="df/dalpha [MHz/unit]")
    ax.set(xlabel="alpha (FCW fraction)", ylabel="non-linearity [MHz]", title="C5e FCW->f mapping (Na:Nm=13:14, N_int=118)")
    ax2.set_ylabel("df/dalpha [MHz]")
    ax.legend(loc="upper left", fontsize=7)
    ax2.legend(loc="lower right", fontsize=7)
    # ---------------------------------------------------------------- (f) locking transient
    print("\n[C5f] locking transient 5.21 -> 5.64 GHz (Fig. 19.2.5 bottom)")
    ax = axs[1, 2]
    tr_out = {}
    for be, c in ((-100e6, "C3"), (0.0, "C0")):
        tr = M.lock_transient(base, band_err=be, t_post=(1.0e-6 if quick else 2.0e-6))
        t, fm, fa_ = tr["t"], tr["f_main"], tr["f_aux"]
        k = 10
        ker = np.ones(k) / k
        fms = np.convolve(fm, ker, "same")[k:-k]
        fas = np.convolve(fa_, ker, "same")[k:-k]
        tt = t[k:-k]
        ts = {f"main_{int(tol/1e6)}MHz_us": nan2none(M.settle_time(tt, fms, tr["f_out2"], tol) * 1e6) for tol in (10e6, 3e6, 1e6)}
        ts.update({f"aux_{int(tol/1e6)}MHz_us": nan2none(M.settle_time(tt, fas, tr["f_aux2"], tol * tr["f_aux2"] / tr["f_out2"]) * 1e6)
                   for tol in (10e6, 3e6)})
        tr_out[f"band_err_{int(be/1e6)}MHz"] = ts
        print(f"    band preset error {be/1e6:.0f} MHz: " + ", ".join(f"{k_}={v}" for k_, v in ts.items()))
        ax.plot(tt * 1e6, fms / 1e9, c, label=f"main (band err {be/1e6:.0f} MHz)")
        if be == 0.0:
            ax.plot(tt * 1e6, fas / 1e9, "C2", label="aux (/2 output)")
    ax.set(xlabel="time after trigger [us]", ylabel="frequency [GHz]", title="C5f locking transient (10 ns average)")
    out["transient"] = tr_out
    t_best = tr_out["band_err_0MHz"]["main_3MHz_us"]
    check("C5f main lock time (3 MHz, ideal band preset) vs paper 0.31 us", abs(t_best - PAPER["lock_main_us"]) < 0.1,
          r2(t_best, 2), PAPER["lock_main_us"], "us (aux = type-II H_a model, assumption)", soft=True)
    t_slip = tr_out["band_err_-100MHz"]["main_3MHz_us"]
    check("C5f main lock time (3 MHz, -100 MHz band preset error as in Fig.5) vs paper",
          t_slip is not None and abs(t_slip - PAPER["lock_main_us"]) < 0.1,
          None if t_slip is None else r2(t_slip, 2), PAPER["lock_main_us"],
          "us (cycle slipping of tri-state PFD; None = not settled in the window)", soft=True)
    t_aux = tr_out["band_err_0MHz"]["aux_10MHz_us"]
    check("C5f aux settling (10 MHz rel.) vs paper 0.11 us", abs(t_aux - PAPER["lock_aux_us"]) < 0.06, r2(t_aux, 2),
          PAPER["lock_aux_us"], "us (generic type-II, zeta=0.707, 10 MHz BW)", soft=True)
    for a_ in axs.flat:
        a_.grid(True, which="both", alpha=.3)
        a_.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(OUT / "C5_nonidealities.png", dpi=130)
    plt.close(fig)
    return out


def exp_C6():
    print("\n[C6] FoM arithmetic (Fig. 19.2.6) and power breakdown")
    rows = {}
    worst = 0.0
    for k, (P, J, fr, fom, fomr, sp) in TABLE.items():
        f1 = 10 * math.log10(P * (J * 1e-15) ** 2)
        f2 = f1 + 10 * math.log10(fr / 10)
        rows[k] = dict(FoM=f1, FoMref=f2, FoM_table=fom, FoMref_table=fomr)
        worst = max(worst, abs(f1 - fom), abs(f2 - fomr))
    check("C6 FoM/FoMref of all 8 columns recomputed", worst <= 0.11, r2(worst, 3), "<=0.1 dB (rounding)")
    tw = rows["This work"]
    check("C6 this work FoM = -247.1, FoMref = -238.0", abs(tw["FoM"] + 247.1) < 0.06 and abs(tw["FoMref"] + 238.0) < 0.06,
          [r2(tw["FoM"], 2), r2(tw["FoMref"], 2)], [-247.1, -238.0], "dB")
    elig = {k: v for k, v in TABLE.items() if v[1] < 100 and v[5] < -70}
    best = min(elig, key=lambda k: rows[k]["FoMref"])
    check("C6 best FoMref among <100 fs & <-70 dBc designs in the table", best == "This work", best, "This work",
          f"eligible: {list(elig)}")
    ptot = sum(POWER.values())
    grp = dict(aux=POWER["Aux SPD"] + POWER["Aux int-divider"] + POWER["Aux VCO w/ buf"], div2=POWER["Div-by-2"],
               main_digital=POWER["Main PFDCP"] + POWER["Main/Aux MMDs"] + POWER["DSM"],
               main_vco=POWER["Main VCO buf"] + POWER["Main VCO"])
    pct = {k: 100 * v / ptot for k, v in grp.items()}
    check("C6 power breakdown sums to 21.2 mW; 24/7/18/51 %", abs(ptot - 21.2) < 0.05 and
          all(abs(round(pct[k]) - e) <= 1 for k, e in zip(("aux", "div2", "main_digital", "main_vco"), (24, 7, 18, 51))),
          [r2(ptot, 2)] + [r2(v, 1) for v in pct.values()], [21.2, 24, 7, 18, 51], "mW, %")
    check("C6 aux VCO 1.7 mW = 8% of total", abs(100 * 1.7 / ptot - 8) < 0.5, r2(100 * 1.7 / ptot, 1), 8, "%")
    # jitter / share arithmetic of the text
    j_wo = math.sqrt(PAPER["jit_frac"] ** 2 * (1 - 0.01) + PAPER["q_jit_woqec"] ** 2)
    check("C6 text: 95.1 fs (1% Q) + 146 fs Q-noise -> 174 fs", abs(j_wo - 174) < 1.0, r2(j_wo, 1), 174, "fs")
    check("C6 text: 146 fs / 95.1 fs = 238%", abs(100 * (146 / 95.1) ** 2 - 238) < 3, r2(100 * (146 / 95.1) ** 2, 1), 238, "%")
    q_w = 238 / 13 ** 2
    check("C6 238% / 13^2 = Q share with QEC (rounds to 1%)", round(q_w) == 1, r2(q_w, 2), 1, "%")
    sp = [m for m in PAPER["spur_markers_2m11"].values()]
    pw = sum(10 ** ((v + D4) / 10) for pair in sp for v in pair)
    j_sp = math.sqrt(PAPER["jit_frac"] ** 2 + (math.sqrt(pw) / (2 * math.pi * PAPER["f_out_frac"]) * 1e15) ** 2)
    check("C6 Fig.4 spur markers (+-181k, +-363k) explain 95.1 -> 95.9 fs", abs(j_sp - PAPER["jit_frac_spur"]) < 0.6,
          r2(j_sp, 2), PAPER["jit_frac_spur"], "fs")
    return dict(table=rows, power_pct=pct, power_total=ptot, text_jitter_woqec=j_wo, spur_jitter=j_sp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    n = 2 ** 20 if a.quick else 2 ** 22          # full-noise sims (1 kHz resolution needs >= 2^21)
    n2 = 2 ** 18 if a.quick else 2 ** 20         # Q-only sims
    n_sp = 2 ** 19 if a.quick else 2 ** 20       # spur sims (os=1, noise off)
    t0 = time.time()
    base0 = M.CascParams(n_cyc=n)
    base, fitinfo = fit_budget(base0)
    lf = M.loop_filter(base)
    fc, pm = C.loop_margins(base.icp, base.kvco, base.n_eff, lf)
    results = dict(model="ISSCC 2025 19.2 cascaded PLL with two MMDs + shared DSM (MMD-QEC)",
                   params=asdict(base), loop=dict(fc=fc, pm=pm, bw3db=M.bw_3db(base), **lf),
                   f_out=base.f_out, f_pfd=base.f_pfd, f_aux=base.f_aux)
    print(f"base: f_out {base.f_out/1e9:.6f} GHz, f_DSM {base.f_pfd/1e6:.2f} MHz, fc {fc/1e6:.2f} MHz, PM {pm:.1f} deg, -3dB BW {M.bw_3db(base)/1e6:.2f} MHz")
    results["C0_arithmetic"] = exp_C0(base)
    results["C1_qnoise"] = exp_C1(base, n2)
    results["C2_ratio_table"] = exp_C2(base, n2 // 2)
    results["C3_budget"] = exp_C3(base, fitinfo, n)
    results["C4_spur"] = exp_C4(base, n_sp, n // 2)
    results["C5_nonideal"] = exp_C5(base, n2 * 2, n_sp, a.quick)
    results["C6_fom"] = exp_C6()
    results["checks"] = CHECKS
    results["runtime_s"] = time.time() - t0
    (OUT / "isscc25_19p2_results.json").write_text(json.dumps(results, indent=1, default=float))
    cnt = {k: sum(c["result"] == k for c in CHECKS) for k in ("PASS", "DEVIATION", "FAIL")}
    print(f"\n{cnt['PASS']}/{len(CHECKS)} checks PASS, {cnt['DEVIATION']} DEVIATION, {cnt['FAIL']} FAIL, runtime {time.time()-t0:.0f} s")


if __name__ == "__main__":
    main()
