"""Reproduction + non-ideality study of the MediaTek ISSCC 2008 (10.1) ADPLL.
Writes figures and results/adpll2008_results.json.

    python3 run_adpll2008.py            # full run
    python3 run_adpll2008.py --quick    # shorter records
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
from mtkpll import adpll2008 as A       # noqa: E402

OUT = Path(__file__).parent / "results"
OUT.mkdir(exist_ok=True)
CHECKS = []
NOISELESS = dict(dco_L1M=None, ref_floor=None)
IDEAL_TDC = dict(tau=0.1e-12, t_os=0.2e-12)
PAPER = dict(pn_400k=-117.0, bw=50e3, ref_spur=-84.0, f_dco=3.6e9)


def check(name, ok, measured, expected, note="", soft=False):
    """soft=True: a paper claim the model does not reproduce is logged as
    DEVIATION (explained in the report) instead of FAIL."""
    res = "PASS" if ok else ("DEVIATION" if soft else "FAIL")
    CHECKS.append(dict(check=name, result=res, measured=measured, expected=expected, note=note))
    print(f"  [{res}] {name}: measured={measured} expected={expected} {note}")


def f_offset(p):
    return min(p.F, 1 - p.F) * p.f_ref


def calibrated(p):
    """Run the paper's calibration sequence and return params+cal+a."""
    fc = A.full_calibration(p)
    return replace(p, kdco_est=fc["kdco_est"]), fc


def spur_and_pn(p, a, cal, seeds=(3, 4, 5)):
    sp, pn400, jit, curves = [], [], [], None
    for s in seeds:
        q = replace(p, seed=s)
        r = A.simulate(q, a=a, cal=cal)
        th = r["theta"][:: q.os]
        sp.append(C.spur_dbc(th, q.f_ref, f_offset(q)))
        f, L = C.phase_noise(r["theta"], r["fs"], 2 ** 17)
        pn400.append(C.band_level_excl(f, L, 350e3, 450e3, f_offset(q), 6e3))
        jit.append(C.rms_jitter(f, L, q.f_dco, 1e3, q.f_ref / 2))
        if curves is None:
            curves = (f, L)
    # spur visibility: noise power in one FFT bin (Blackman-Harris ENBW = 2 bins)
    nb = (p.n_cyc - p.settle)
    bin_floor = float(np.mean(pn400) + 10 * math.log10(2.0 * p.f_ref / nb))
    return dict(spur_dBc=float(np.mean(sp)), spur_dBc_max=float(np.max(sp)), pn_400k=float(np.mean(pn400)),
                jitter_fs=float(np.mean(jit) * 1e15), fft_bin_noise_dBc=bin_floor,
                spur_in_1kHz_RBW_visible=bool(np.mean(sp) > np.mean(pn400) + 30)), curves


# -----------------------------------------------------------------------------
def exp_b0(p):
    print("\n[B0] TDC calibration and canceller arithmetic")
    cal = A.tdc_calibration(p)
    tau_est = cal["tdc_gain"]
    out = dict(dN=cal["dN"], offset=cal["offset"], tau_est_ps=tau_est * 1e12,
               comp_gain=2 * cal["dN"] / (p.M + p.F), comp_gain_ideal=p.t_dco / p.tau)
    err = out["comp_gain"] / out["comp_gain_ideal"] - 1
    out["comp_gain_rel_err"] = err
    check("B0 half-period normalisation -> TDC LSB", abs(tau_est / p.tau - 1) < 2 / cal["dN"],
          round(tau_est * 1e12, 3), p.tau * 1e12, f"ps, dN={cal['dN']}")
    check("B0 e_CTDC gain 2*dN/(M+F) == T_DCO/TDCgain", abs(err) < 2 / cal["dN"], f"{err:.2e}", "<2/dN")
    # exact cancellation with ideal TDC, linear loop (BB path off)
    rows = {}
    for Fn in (2, 128):
        for cancel in (False, True):
            q = replace(p, Fn=Fn, cancel=cancel, bb_step_hz=0.0, n_cyc=2 ** 17, **NOISELESS, **IDEAL_TDC)
            c = A.tdc_calibration(q)
            a = A.loop_gain_a(c["tdc_gain"], q.kdco, q)
            r = A.simulate(q, a=a, cal=c)
            rows[f"F{Fn}_cancel{cancel}"] = C.spur_dbc(r["theta"][:: q.os], q.f_ref, f_offset(q))
    out["ideal_tdc_linear_loop_spur"] = rows
    print("    ideal TDC, linear loop: " + ", ".join(f"{k}: {v:.1f} dBc" for k, v in rows.items()))
    check("B0 canceller removes DS spur (ideal TDC, linear loop)",
          rows["F2_cancelTrue"] < rows["F2_cancelFalse"] - 60, round(rows["F2_cancelTrue"], 1),
          f"<< {rows['F2_cancelFalse']:.1f}", "dBc @400 kHz")
    return out


def exp_b1(p):
    print("\n[B1] loop-gain calibration across TDC/DCO corners")
    freqs = np.array([10e3, 20e3, 30e3, 40e3, 50e3, 60e3, 70e3, 80e3, 90e3, 100e3, 130e3, 200e3])
    rows = []
    fig, axs = plt.subplots(1, 2, figsize=(12, 4.4), sharey=True)
    for tau in (20e-12, 30e-12, 45e-12):
        for kd in (8.4e3, 12e3, 15.6e3):
            q = replace(p, tau=tau, t_os=2 * tau, kdco=kd)
            qc, fc = calibrated(q)
            a_cal = fc["a"]
            qu = replace(q, calibrated=False)
            a_unc = A.design_a(qu, A.tdc_calibration(qu))
            Hs = A.measure_transfer(qc, a_cal, fc["cal"], freqs)
            bw_meas = A.bw_from_transfer(freqs, Hs)
            row = dict(tau_ps=tau * 1e12, kdco_khz=kd / 1e3, dN=fc["cal"]["dN"], kdco_est_khz=fc["kdco_est"] / 1e3,
                       a=a_cal, bw_ug_cal_khz=A.unity_gain_bw(q, a_cal) / 1e3,
                       bw_ug_uncal_khz=A.unity_gain_bw(q, a_unc) / 1e3,
                       bw3db_meas_khz=bw_meas / 1e3, bw3db_analytic_khz=A.bw_3db_analytic(q, a_cal) / 1e3,
                       bw3db_uncal_khz=A.bw_3db_analytic(q, a_unc) / 1e3)
            rows.append(row)
            print(f"    tau={tau*1e12:.0f}ps kdco={kd/1e3:.1f}k: dN={row['dN']} kdco_est={row['kdco_est_khz']:.3f}k "
                  f"BW_ug cal {row['bw_ug_cal_khz']:.2f}k / uncal {row['bw_ug_uncal_khz']:.1f}k | "
                  f"-3dB meas {row['bw3db_meas_khz']:.1f}k (ana {row['bw3db_analytic_khz']:.1f}k, uncal {row['bw3db_uncal_khz']:.1f}k)")
            ff = np.logspace(3.5, 6, 300)
            axs[0].semilogx(ff, 20 * np.log10(np.abs(A.closed_loop_H(ff, q, a_unc)[0])), lw=1)
            axs[1].semilogx(ff, 20 * np.log10(np.abs(A.closed_loop_H(ff, q, a_cal)[0])), lw=1)
            axs[1].semilogx(freqs, 20 * np.log10(np.abs(Hs)), "k.", ms=4)
    axs[0].set(title="B1  uncalibrated a (nominal 30 ps / 12 kHz), 9 corners", xlabel="f [Hz]", ylabel="|H| [dB]", ylim=(-25, 6))
    axs[1].set(title="B1  calibrated a (dots: sim lock-in measurement)", xlabel="f [Hz]")
    for ax in axs:
        ax.axhline(-3, color="gray", ls=":")
        ax.grid(True, which="both", alpha=.3)
    fig.tight_layout()
    fig.savefig(OUT / "B1_loop_gain_calibration.png", dpi=130)
    plt.close(fig)
    ug = np.array([r["bw_ug_cal_khz"] for r in rows])
    unc = np.array([r["bw_ug_uncal_khz"] for r in rows])
    meas = np.array([r["bw3db_meas_khz"] for r in rows])
    ana = np.array([r["bw3db_analytic_khz"] for r in rows])
    check("B1 calibrated unity-gain BW = 50 kHz over corners", np.max(np.abs(ug / 50 - 1)) < 0.02,
          f"{ug.min():.2f}..{ug.max():.2f}", "50 kHz +-2%", f"uncalibrated {unc.min():.1f}..{unc.max():.1f} kHz")
    check("B1 sim-measured -3dB BW == analytic", np.max(np.abs(meas / ana - 1)) < 0.03,
          f"{meas.min():.1f}..{meas.max():.1f}", f"{ana.min():.1f}..{ana.max():.1f}", "kHz")
    return rows


def exp_b2(p):
    print("\n[B2] phase noise & 400 kHz fractional spur, cancellation on/off (paper Fig. 10.1.6)")
    out = {}
    pc, fc = calibrated(p)
    a, cal = fc["a"], fc["cal"]
    fig, axs = plt.subplots(1, 2, figsize=(12, 4.6), sharey=True)
    for i, Fn in enumerate((2, 128)):
        for cancel in (False, True):
            q = replace(pc, Fn=Fn, cancel=cancel)
            m, (f, L) = spur_and_pn(q, a, cal)
            out[f"F{Fn}_cancel{cancel}"] = m
            print(f"    F=138+{Fn}/130 cancel={cancel}: PN@400k {m['pn_400k']:.1f} dBc/Hz, spur {m['spur_dBc']:.1f} dBc "
                  f"(max {m['spur_dBc_max']:.1f}), jitter {m['jitter_fs']:.0f} fs, FFT-bin noise {m['fft_bin_noise_dBc']:.1f}")
            fs_, Ls_ = C.log_smooth(f, L, 220, 1e3, 5e7)
            axs[i].semilogx(fs_, Ls_, label=f"sim, cancel={cancel}")
        an = A.analytic_pn(f, replace(pc, Fn=Fn), a)
        m_ = f < 5e6
        for key, sty in [("tdc", "C2:"), ("dco", "C3:"), ("ref", "C4:"), ("total", "k--")]:
            axs[i].semilogx(f[m_], an[key][m_], sty,
                            label=f"analytic {key}" + (" (white q-noise tau^2/12)" if key == "tdc" else ""))
        axs[i].plot([400e3], [PAPER["pn_400k"]], "r*", ms=12, label="paper: -117 dBc/Hz @400k")
        axs[i].set(title=f"B2  divider 138+{Fn}/130 (f_dco={q.f_dco/1e9:.4f} GHz)", xlabel="offset [Hz]", ylim=(-150, -80))
        axs[i].grid(True, which="both", alpha=.3)
        axs[i].legend(fontsize=7)
    axs[0].set_ylabel("L(f) [dBc/Hz]")
    fig.tight_layout()
    fig.savefig(OUT / "B2_phase_noise_cancellation.png", dpi=130)
    plt.close(fig)
    for Fn in (2, 128):
        on = out[f"F{Fn}_cancelTrue"]
        check(f"B2 PN@400k F={Fn}/130 vs paper -117", abs(on["pn_400k"] - PAPER["pn_400k"]) < 1.5,
              round(on["pn_400k"], 1), PAPER["pn_400k"], "dBc/Hz (DCO noise is an assumption fitted to this)")
        check(f"B2 400k spur hidden below PN in 1 kHz RBW F={Fn}/130 (paper: not observable)",
              not on["spur_in_1kHz_RBW_visible"], round(on["spur_dBc"], 1), f"< {on['pn_400k']+30:.1f}", "dBc",
              soft=True)

    print("  spur mechanism decomposition (F=138+2/130, noise on, 3 seeds)")
    deco = {}
    cases = [("ideal_TDC_no_cancel", dict(cancel=False, **IDEAL_TDC)),
             ("ideal_TDC_cancel", dict(cancel=True, **IDEAL_TDC)),
             ("tdc30_cancel_comp2b", dict(cancel=True, comp_frac_bits=2)),
             ("tdc30_cancel_comp8b", dict(cancel=True, comp_frac_bits=8)),
             ("tdc30_no_cancel", dict(cancel=False)),
             ("tdc30_cancel_tdcjit3ps", dict(cancel=True, comp_frac_bits=8, tdc_jit=3e-12)),
             ("tdc30_cancel_DSdither", dict(cancel=True, comp_frac_bits=8, dither=True)),
             ("tdc30_cancel_DLF3rd", dict(cancel=True, comp_frac_bits=8, lp_order=3))]
    for label, kw in cases:
        q = replace(pc, Fn=2, **kw)
        c = A.tdc_calibration(q)
        aq = A.loop_gain_a(c["tdc_gain"], pc.kdco_est, q)
        m, _ = spur_and_pn(q, aq, c)
        deco[label] = m
        print(f"    {label:24s}: spur {m['spur_dBc']:6.1f} dBc, PN@400k {m['pn_400k']:.1f}, jitter {m['jitter_fs']:.0f} fs")

    print("  loop-BW sweep: DS-pattern spur without/with cancellation (ideal TDC, noiseless, linear loop)")
    bw_rows = []
    for bw in (50e3, 100e3, 200e3, 400e3):
        row = dict(bw=bw)
        for cancel in (False, True):
            q = replace(pc, Fn=2, bw=bw, lp_fc=3 * bw, cancel=cancel, bb_step_hz=0.0, n_cyc=2 ** 17,
                        **NOISELESS, **IDEAL_TDC)
            c = A.tdc_calibration(q)
            aq = A.loop_gain_a(c["tdc_gain"], q.kdco, q)
            r = A.simulate(q, a=aq, cal=c)
            row[f"spur_cancel{cancel}"] = C.spur_dbc(r["theta"][:: q.os], q.f_ref, f_offset(q))
        bw_rows.append(row)
        print(f"    BW {bw/1e3:4.0f} kHz: no cancel {row['spur_cancelFalse']:.1f} dBc | cancel {row['spur_cancelTrue']:.1f} dBc")
    out["decomposition"] = deco
    out["bw_sweep_ideal_tdc"] = bw_rows
    return dict(results=out, a=a, dN=cal["dN"], kdco_est=pc.kdco_est)


def exp_b3(p):
    print("\n[B3] REF duty-cycle error -> TDC-gain error (half-period normalisation)")
    pc, fc = calibrated(p)
    rows = []
    for d in (0.40, 0.45, 0.48, 0.50, 0.52, 0.55):
        q = replace(pc, duty=d)
        cal = A.tdc_calibration(q)
        a = A.loop_gain_a(cal["tdc_gain"], pc.kdco_est, q)
        # residual DS noise leak: dithered DS, 0.01 ps TDC, only DS active
        qd = replace(q, dither=True, tau=1e-14, t_os=2e-14, bb_step_hz=0.0, n_cyc=2 ** 18, **NOISELESS)
        cd = A.tdc_calibration(qd)
        ad = A.loop_gain_a(cd["tdc_gain"], qd.kdco, qd)
        rd = A.simulate(qd, a=ad, cal=cd)
        f, L = C.phase_noise(rd["theta"], rd["fs"], 2 ** 15)
        m, _ = spur_and_pn(q, a, cal, seeds=(3,))
        rows.append(dict(duty=d, gain_err=2 * d - 1, bw_ug_khz=A.unity_gain_bw(q, a) / 1e3,
                         bw3db_khz=A.bw_3db_analytic(q, a) / 1e3, ds_leak_L400k=C.band_level(f, L, 3e5, 5e5),
                         spur_dBc=m["spur_dBc"], pn_400k=m["pn_400k"]))
        print(f"    duty {d:.2f}: canceller gain err {2*d-1:+.2f}, BW_ug {rows[-1]['bw_ug_khz']:.1f}k, -3dB {rows[-1]['bw3db_khz']:.1f}k, "
              f"DS leak @400k {rows[-1]['ds_leak_L400k']:.1f} dBc/Hz | 30ps-TDC spur {m['spur_dBc']:.1f}, PN {m['pn_400k']:.1f}")
    # uncancelled DS reference level
    qd = replace(pc, dither=True, tau=1e-14, t_os=2e-14, bb_step_hz=0.0, n_cyc=2 ** 18, cancel=False, **NOISELESS)
    cd = A.tdc_calibration(qd)
    rd = A.simulate(qd, a=A.loop_gain_a(cd["tdc_gain"], qd.kdco, qd), cal=cd)
    f, L = C.phase_noise(rd["theta"], rd["fs"], 2 ** 15)
    ds_ref = C.band_level(f, L, 3e5, 5e5)
    for r in rows:
        r["ds_leak_pred"] = ds_ref + 20 * math.log10(abs(r["gain_err"])) if r["gain_err"] else None
    print(f"    uncancelled DS @400k: {ds_ref:.1f} dBc/Hz -> leak predicted ds_ref + 20log|2d-1|")
    r45 = [r for r in rows if r["duty"] == 0.45][0]
    check("B3 DS leak scales as 20log|2d-1| (d=0.45)", abs(r45["ds_leak_L400k"] - r45["ds_leak_pred"]) < 1.5,
          round(r45["ds_leak_L400k"], 1), round(r45["ds_leak_pred"], 1), "dBc/Hz")
    check("B3 BW error = 1/(2d) (d=0.45)", abs(r45["bw_ug_khz"] / 50 - 1 / 0.9) < 0.01,
          round(r45["bw_ug_khz"], 2), round(50 / 0.9, 2), "kHz")
    return dict(rows=rows, ds_uncancelled_L400k=ds_ref)


def exp_b4(p):
    print("\n[B4] CTDC non-idealities: zero-crossing DNL, stage mismatch, cycle miscount, tau drift")
    pc, fc = calibrated(p)
    tau = p.tau
    bias = 30.0          # lock 30 LSB (900 ps) away from zero > DS swing (+-2 T_DCO = +-556 ps)
    out = dict(zero_dnl=[], inl=[], miscount=[], drift=[])
    # (a) sign-magnitude PFD+CTDC: residual fractional offset t_os/tau creates a DNL at dt=0
    for fr in (0.0, 0.1, 0.25, 0.5, 0.75, 0.9):
        row = dict(frac=fr)
        for b in (0.0, bias):
            q = replace(pc, t_os=(2 + fr) * tau, phase_bias=b)
            cal = A.tdc_calibration(q)
            m, _ = spur_and_pn(q, fc["a"], cal, seeds=(3, 4))
            row[f"bias{int(b)}"] = m
        out["zero_dnl"].append(row)
        print(f"    frac(t_os/tau)={fr:.2f}: no bias spur {row['bias0']['spur_dBc']:.1f} / PN {row['bias0']['pn_400k']:.1f} | "
              f"bias {bias:.0f} LSB spur {row['bias30']['spur_dBc']:.1f} / PN {row['bias30']['pn_400k']:.1f}")
    # (b) stage mismatch (ring INL)
    for sg in (0.0, 0.02, 0.05, 0.10):
        row = dict(sigma=sg)
        for b in (0.0, bias):
            q = replace(pc, tdc_sigma=sg, phase_bias=b)
            cal = A.tdc_calibration(q)
            m, _ = spur_and_pn(q, fc["a"], cal)
            row[f"bias{int(b)}"] = m
        out["inl"].append(row)
        print(f"    stage sigma {sg*100:4.1f}%: no bias spur {row['bias0']['spur_dBc']:.1f} / PN {row['bias0']['pn_400k']:.1f} | "
              f"bias spur {row['bias30']['spur_dBc']:.1f} / PN {row['bias30']['pn_400k']:.1f}")
    # (c) cycle-counter miscount: matters once the stop edge crosses ring wraps (biased lock point)
    for pm in (0.0, 1e-3, 1e-2):
        q = replace(pc, miscount_p=pm, phase_bias=bias)
        m, _ = spur_and_pn(q, fc["a"], fc["cal"], seeds=(3,))
        out["miscount"].append(dict(p=pm, **m))
        print(f"    miscount p={pm:.0e} (bias {bias:.0f} LSB, wraps occur): PN@400k {m['pn_400k']:.1f}, jitter {m['jitter_fs']:.0f} fs, spur {m['spur_dBc']:.1f}")
    for e in (-p.n_stage, p.n_stage):
        q = replace(pc, dN_error=e)
        cal = A.tdc_calibration(q)
        a = A.loop_gain_a(cal["tdc_gain"], pc.kdco_est, q)
        out["miscount"].append(dict(dN_error=e, dN=cal["dN"], bw_ug_khz=A.unity_gain_bw(q, a) / 1e3,
                                    canceller_gain_err=cal["dN"] / (cal["dN"] - e) - 1))
        print(f"    miscount during normalisation dN{e:+d}: BW_ug {out['miscount'][-1]['bw_ug_khz']:.1f} kHz, "
              f"canceller gain err {out['miscount'][-1]['canceller_gain_err']*100:+.1f}%")
    # (d) tau drift after calibration, offset tracked and integer (pure gain error)
    for dr in (-0.2, -0.1, 0.0, 0.1, 0.2):
        q = replace(pc, tau_drift=dr, t_os=0.0, offset_track=True, phase_bias=bias)
        cal = A.tdc_calibration(q)
        a = A.loop_gain_a(cal["tdc_gain"], pc.kdco_est, q)
        m, _ = spur_and_pn(q, a, cal, seeds=(3,))
        out["drift"].append(dict(drift=dr, bw_ug_khz=A.unity_gain_bw(q, a) / 1e3, **m))
        print(f"    tau drift {dr*100:+4.0f}% (gain only): BW_ug {out['drift'][-1]['bw_ug_khz']:.1f}k, spur {m['spur_dBc']:.1f}, PN@400k {m['pn_400k']:.1f}")
    z = out["zero_dnl"]
    worst0 = max(r["bias0"]["spur_dBc"] for r in z)
    worstb = max(r["bias30"]["spur_dBc"] for r in z)
    check("B4 phase bias removes zero-crossing DNL sensitivity", worstb < worst0 - 10,
          round(worstb, 1), f"<< {worst0:.1f}", "dBc worst over frac(t_os/tau)")
    return out


def exp_b5(p):
    print("\n[B5] integer / near-integer channel, coarse TDC: bang-bang limit cycle vs DS dither")
    pc, fc = calibrated(p)
    out = {}
    for label, kw in [("frac_2_130", dict(Fn=2)), ("integer_F0", dict(Fn=0)),
                      ("integer_F0_dither", dict(Fn=0, dither=True)), ("frac_2_130_dither", dict(Fn=2, dither=True))]:
        q = replace(pc, **kw)
        r = A.simulate(q, a=fc["a"], cal=fc["cal"])
        f, L = C.phase_noise(r["theta"], r["fs"], 2 ** 17)
        out[label] = dict(jitter_fs=C.rms_jitter(f, L, q.f_dco, 1e3, q.f_ref / 2) * 1e15,
                          L_10k=C.band_level(f, L, 8e3, 12e3), L_100k=C.band_level(f, L, 8e4, 1.2e5),
                          pn_400k=C.band_level_excl(f, L, 3.5e5, 4.5e5, f_offset(q), 6e3))
        print(f"    {label:18s}: jitter {out[label]['jitter_fs']:.0f} fs, L10k {out[label]['L_10k']:.1f}, L100k {out[label]['L_100k']:.1f}, L400k {out[label]['pn_400k']:.1f}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    n = 2 ** 18 if args.quick else 2 ** 20
    p = A.ADPLLParams(n_cyc=n)
    t0 = time.time()
    res = dict(model="ISSCC 2008 10.1 MediaTek fractional-N ADPLL", params=asdict(p), paper=PAPER,
               f_dco=p.f_dco)
    res["B0_calibration_math"] = exp_b0(p)
    res["B1_loop_gain_cal"] = exp_b1(p)
    res["B2_pn_cancellation"] = exp_b2(p)
    res["B3_duty_cycle"] = exp_b3(p)
    res["B4_tdc_nonideal"] = exp_b4(p)
    res["B5_integer_channel"] = exp_b5(p)
    res["checks"] = CHECKS
    res["runtime_s"] = time.time() - t0
    (OUT / "adpll2008_results.json").write_text(json.dumps(res, indent=1, default=float))
    npass = sum(c["result"] == "PASS" for c in CHECKS)
    print(f"\n{npass}/{len(CHECKS)} checks PASS, runtime {time.time()-t0:.0f} s")


if __name__ == "__main__":
    main()
