"""Run every reproduction experiment, write figures/ and results/summary.{json,md}.

    python experiments/run_all.py            # everything (~2-3 min on 4 cores)
    python experiments/run_all.py pn spur    # selected experiments
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from style import C, INK, INK2, MUTED, plt, save  # noqa: E402

from spll import (DTCModel, SPLLParams, converge_then_freeze, loop_metrics,  # noqa: E402
                  noise_budget, simulate)
from spll import analysis as an  # noqa: E402
from spll.loopfilter import spd_lock_time  # noqa: E402

FIG = ROOT / "figures"
RES = ROOT / "results"
PAPER = dict(jitter_fs=75.0, jitter_band="10 kHz - 10 MHz", fom_db=-249.7,
             frac_spur_dbc=-64.0, power_mw=18.9, f_ref_mhz=52.0, band_ghz=(5.5, 7.3),
             dtc_bits=10, area_mm2=0.45)
SUMMARY: dict = {"paper": PAPER}
N_PN = 1 << 21          # cycles for phase-noise runs (20 ms of simulated time)
D_PN = 1 << 15          # discarded start-up cycles (lock + calibration)


def _f(x):
    return float(np.asarray(x))


def _jit(r, f1=10e3, f2=10e6):
    f, s = an.timing_psd(r.tau_steady(), r.fs_out)
    return f, s, an.integrated_jitter(f, s, f1, f2)


def _spur_point(p: SPLLParams, n_meas: int = 1 << 17):
    """Converge the background loops with noise, freeze them, then measure the worst
    discrete tone of a noiseless run (deterministic fractional spurs)."""
    kd, dcc = converge_then_freeze(p, 30000, 6000)
    pq = p.with_(noise=False, cal_gain=False, cal_dcc=False)
    r = simulate(pq, n_meas + (1 << 14), n_discard=1 << 14, kd_override=kd, dcc_override=dcc)
    return an.worst_spur(r.tau_steady(), r.fs_out, p.f_out_q, fmin=3e3)



# --------------------------------------------------------------------------- 0
def exp_arch():
    """Block diagram of the modelled architecture."""
    from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
    fig, ax = plt.subplots(figsize=(12.5, 5.0))
    ax.set_xlim(0, 25)
    ax.set_ylim(0, 10)
    ax.axis("off")

    def box(x, y, w, h, text, col=INK2, fill="#ffffff"):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.15",
                                    lw=1.0, ec=col, fc=fill))
        ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=8, color=INK)
        return (x, y, w, h)

    def arrow(p0, p1, text=None, col=INK2, dx=0.0, dy=0.18, ha="center"):
        ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle="-|>", mutation_scale=9, lw=0.9,
                                     color=col, shrinkA=0, shrinkB=0))
        if text:
            ax.text((p0[0] + p1[0]) / 2 + dx, (p0[1] + p1[1]) / 2 + dy, text, fontsize=7,
                    color=INK2, ha=ha)

    hi = "#eaf2fc"   # light tint of slot 1 for the paper's key techniques
    y1, h = 7.0, 1.3
    box(0.3, y1, 2.0, h, "XO\n52 MHz")
    box(3.0, y1, 2.4, h, "Doubler\n(duty skew)", C[0], hi)
    box(6.1, y1, 2.4, h, "Ref. buffer\n(inverters)")
    box(9.2, y1, 2.4, h, "Slope gen.\n2.5 mV/ps ramp")
    box(12.3, y1, 2.2, h, "S/H\n200 fF", C[0], hi)
    box(15.2, y1, 1.8, h, "Gm")
    box(17.7, y1, 2.5, h, "Loop filter\nR1C1 || C2, R3C3")
    box(20.9, y1, 2.6, h, "VCO\n5.5-7.3 GHz")
    arrow((2.3, y1 + h / 2), (3.0, y1 + h / 2))
    arrow((5.4, y1 + h / 2), (6.1, y1 + h / 2))
    ax.text(5.75, y1 - 0.55, "CLKREFX2\n104 MHz", fontsize=7, color=INK2, ha="center")
    arrow((8.5, y1 + h / 2), (9.2, y1 + h / 2))
    arrow((11.6, y1 + h / 2), (12.3, y1 + h / 2), "ramp")
    arrow((14.5, y1 + h / 2), (15.2, y1 + h / 2), "Vs")
    arrow((17.0, y1 + h / 2), (17.7, y1 + h / 2), "I")
    arrow((20.2, y1 + h / 2), (20.9, y1 + h / 2), "Vtune")
    arrow((23.5, y1 + h / 2), (24.8, y1 + h / 2), "out")
    # feedback path
    y2 = 3.9
    box(20.9, y2, 2.6, h, "MMD\n/ N[k]")
    box(15.2, y2, 4.2, h, "DTC, 10 bit, 0.45 ps LSB\n(highly linear)", C[0], hi)
    arrow((22.2, y1), (22.2, y2 + h))
    arrow((20.9, y2 + h / 2), (19.4, y2 + h / 2), "CLKDIV", dy=0.2)
    ax.add_patch(FancyArrowPatch((15.2, y2 + h / 2), (14.0, y1), arrowstyle="-|>",
                                 mutation_scale=9, lw=0.9, color=C[0],
                                 connectionstyle="angle,angleA=180,angleB=90,rad=0"))
    ax.text(14.15, 5.95, "CLKFB = delayed\nsampling clock", fontsize=7, color=C[0])
    # digital
    y3 = 0.6
    box(20.9, y3, 2.6, h, "MASH 1-1\nDSM (FCW)")
    box(15.2, y3, 4.2, h, "x Kd  ->  DTC code\n(+ DCC fractional shift)")
    arrow((22.2, y3 + h), (22.2, y2), "N[k] (+ DCC integer shift)", dx=0.15, ha="left")
    arrow((20.9, y3 + h / 2), (19.4, y3 + h / 2), "residue r[k]", dy=0.2)
    arrow((17.3, y3 + h), (17.3, y2))
    # comparator + calibrations
    box(9.2, 3.9, 2.6, h, "Comparator\nsign(Vs - VREFc)", C[0], hi)
    ax.add_patch(FancyArrowPatch((12.7, y1), (11.8, 3.9 + h / 2), arrowstyle="-|>",
                                 mutation_scale=9, lw=0.9, color=INK2,
                                 connectionstyle="angle,angleA=-90,angleB=0,rad=0"))
    ax.text(12.8, 6.3, "Vs", fontsize=7, color=INK2)
    box(3.0, 4.75, 4.6, 0.95, "VREF generator (offset cancel)", C[0], hi)
    box(3.0, 3.25, 4.6, 0.95, "DTC gain cal.: sign-sign LMS", C[0], hi)
    box(3.0, 1.75, 4.6, 0.95, "DCC: LMS on odd/even pattern", C[0], hi)
    for yy in (5.22, 3.72, 2.22):
        arrow((9.2, 4.55), (7.6, yy))
    # outputs of the two LMS loops -> bus -> Kd / DCC shift
    for yy in (3.72, 2.22):
        ax.plot([3.0, 2.4], [yy, yy], color=C[0], lw=0.8)
    ax.plot([2.4, 2.4], [3.72, 1.05], color=C[0], lw=0.8)
    ax.add_patch(FancyArrowPatch((2.4, 1.05), (15.2, 1.05), arrowstyle="-|>", mutation_scale=9,
                                 lw=0.8, color=C[0], shrinkA=0, shrinkB=0))
    ax.text(8.0, 1.2, "Kd estimate, DCC estimate (odd/even skew)", fontsize=7, color=C[0])
    ax.text(0.3, 9.4, "Modelled architecture (tinted blocks = the paper's key techniques)",
            fontsize=10, fontweight="bold", color=INK)
    save(fig, FIG / "fig0_architecture.png")


# --------------------------------------------------------------------------- 1
def exp_dtc():
    p = SPLLParams()
    cs = DTCModel(p.with_(dtc_type="constant_slope"))
    vs = DTCModel(p.with_(dtc_type="inverter_vs"))
    k = cs.codes
    fig, ax = plt.subplots(1, 3, figsize=(11.5, 3.4))
    ax[0].plot(k, vs.delay * 1e12, color=C[1], label="Conventional VS-DTC (inverter)")
    ax[0].plot(k, cs.delay * 1e12, color=C[0], label="Highly linear DTC (constant slope)")
    ax[0].set(xlabel="DTC code", ylabel="Programmed delay (ps)",
              title="(a) 10-bit DTC transfer curves")
    ax[0].legend(loc="upper left")
    for a, d, col, name in [(ax[1], vs, C[1], "Conventional VS-DTC"),
                            (ax[2], cs, C[0], "Highly linear DTC")]:
        a.plot(k, d.inl_fit * 1e12, color=col)
        pk = np.max(np.abs(d.inl_fit))
        a.set(xlabel="DTC code", ylabel="INL (ps, best-fit line)",
              title=f"({'b' if a is ax[1] else 'c'}) {name}\n    peak INL {pk*1e12:.2f} ps "
                    f"= {pk/d.lsb_fit:.2f} LSB")
    save(fig, FIG / "fig1_dtc_inl.png")
    SUMMARY["dtc"] = {d.p.dtc_type: {k_: _f(v) if not isinstance(v, str) else v
                                     for k_, v in d.summary().items()} for d in (cs, vs)}


# --------------------------------------------------------------------------- 2
def exp_spd():
    p = SPLLParams()
    tl = spd_lock_time(p)
    t_clip = -(p.spd_va / p.spd_slope) * np.log(1 - (p.spd_vhigh - p.spd_vlow) / p.spd_va) - tl
    x = np.linspace(-450e-12, 450e-12, 3001)
    xx = np.clip(x + tl, 0, None)
    v = np.minimum(p.spd_va * (1 - np.exp(-p.spd_slope * xx / p.spd_va)),
                   p.spd_vhigh - p.spd_vlow) + p.spd_vlow
    n, d = 1 << 18, 1 << 14
    r_no = simulate(p.with_(use_dtc=False), n + d, n_discard=d)
    r_yes = simulate(p, n + d, n_discard=d)
    fig, ax = plt.subplots(1, 3, figsize=(11.5, 3.4))
    ax[0].axvspan(-tl * 1e12, t_clip * 1e12, color=C[0], alpha=0.08, lw=0)
    ax[0].plot(x * 1e12, v, color=C[0])
    ax[0].axhline(p.spd_vref, color=MUTED, lw=0.8)
    ax[0].text(-440, p.spd_vref + 0.01, "lock point VREF", color=INK2, fontsize=8)
    ax[0].set(xlabel="CLKFB - CLKREFX2 timing error (ps)", ylabel="Sampled voltage Vs (V)",
              title=f"(a) SPD transfer (ramp {p.spd_slope/1e9:.1f} mV/ps)\n"
                    f"    linear window {(t_clip + tl)*1e12:.0f} ps")
    for a, r, col, ttl in [(ax[1], r_no, C[1], "(b) SPD input without DTC"),
                           (ax[2], r_yes, C[0], "(c) SPD input with calibrated DTC")]:
        dt = r.dt[d:] * 1e12
        a.hist(dt, bins=160, color=col, alpha=0.85, lw=0)
        a.set(xlabel="Timing error at SPD (ps)", ylabel="Count",
              title=ttl + f"\n    timing error rms {np.std(dt):.2f} ps")
        if r is r_no:
            for b in (-tl * 1e12, t_clip * 1e12):
                a.axvline(b, color=INK2, lw=0.8)
            a.text(t_clip * 1e12, a.get_ylim()[1] * 0.92, " ramp\n clips", color=INK2, fontsize=8)
    save(fig, FIG / "fig2_spd_dtc.png")
    SUMMARY["spd"] = dict(slope_mV_per_ps=p.spd_slope / 1e9, window_ps=_f((t_clip + tl) * 1e12),
                          dt_rms_no_dtc_ps=_f(np.std(r_no.dt[d:]) * 1e12),
                          dt_rms_with_dtc_ps=_f(np.std(r_yes.dt[d:]) * 1e12),
                          ktc_noise_fs=_f(np.sqrt(1.380649e-23 * 300 / p.c_sh) / 2.44e9 * 1e15))


# --------------------------------------------------------------------------- 3
def exp_gain_cal():
    fig, ax = plt.subplots(1, 2, figsize=(11.5, 3.8), gridspec_kw=dict(width_ratios=[1, 1.35]))
    conv = {}
    for err, col in [(-0.15, C[0]), (0.15, C[1])]:
        p = SPLLParams(dtc_gain_err=err)
        r = simulate(p, 8000)
        g = r.kd / r.kd_ideal
        ax[0].plot(r.time_us(), g, color=col, label=f"DTC gain error {err:+.0%}")
        i = an.settle_index(g, 1.0, 0.005)
        conv[f"{err:+.2f}"] = _f(i * p.t_pd * 1e6)
    ax[0].axhline(1.0, color=MUTED, lw=0.8)
    ax[0].set(xlabel="Time (us)", ylabel="Digital DTC gain / ideal",
              title="(a) Background DTC gain calibration (sign-sign LMS)", xlim=(0, 60))
    ax[0].legend(loc="lower right")
    cases = [("Without DTC (raw MASH 1-1 error)", dict(use_dtc=False), C[1]),
             ("DTC, +5% gain error, calibration off", dict(dtc_gain_err=0.05, cal_gain=False), C[3]),
             ("DTC, +5% gain error, background cal. on", dict(dtc_gain_err=0.05), C[0])]
    pn = {}
    for name, kw, col in cases:
        p = SPLLParams(**kw)
        r = simulate(p, N_PN + D_PN, n_discard=D_PN)
        f, s, j = _jit(r)
        pn[name] = _f(j * 1e15)
        ax[1].semilogx(f, an.l_dbc(s, p.f_out_q), color=col, lw=1.0,
                       label=f"{name}: {j*1e15:.0f} fs")
    ax[1].set(xlabel="Offset frequency (Hz)", ylabel="L(f) (dBc/Hz)", xlim=(1e4, 52e6),
              ylim=(-160, -80), title="(b) Output phase noise at 6.0 GHz (jitter 10k-10M)")
    ax[1].legend(loc="lower left")
    save(fig, FIG / "fig3_dtc_gain_cal.png")
    SUMMARY["gain_cal"] = dict(settle_us_to_0p5pct=conv, jitter_fs=pn)


# --------------------------------------------------------------------------- 4
def exp_dcc():
    p = SPLLParams(duty_err_s=1e-9, dtc_gain_err=-0.10)
    r = simulate(p, 8000)
    t = r.time_us()
    fig, ax = plt.subplots(1, 3, figsize=(11.5, 3.4))
    ax[0].plot(t, r.dcc * 1e12, color=C[0], label="DCC estimate")
    ax[0].axhline(1000, color=MUTED, lw=0.8)
    ax[0].text(20, 930, "true odd/even skew: 1 ns", color=INK2, fontsize=8)
    ax[0].set(xlabel="Time (us)", ylabel="CLKFB odd-edge shift (ps)", xlim=(0, 60),
              title="(a) Reference duty-cycle correction")
    ax[1].plot(t, (r.vcref - p.spd_vref) * 1e3, color=C[2])
    ax[1].axhline(p.cmp_offset * 1e3, color=MUTED, lw=0.8)
    ax[1].text(18, p.cmp_offset * 1e3 - 0.75, "comparator offset (3 mV)", color=INK2, fontsize=8)
    ax[1].set(xlabel="Time (us)", ylabel="VREF_cmp - VREF (mV)", xlim=(0, 60),
              title="(b) Comparator VREF generator")
    dcc_settle = an.settle_index(r.dcc, 1e-9, 2e-12) * p.t_pd * 1e6
    kd_settle = an.settle_index(r.kd / r.kd_ideal, 1.0, 0.005) * p.t_pd * 1e6
    # spectrum with a 20 ps odd/even skew, oversampled output (shows 52 MHz)
    n, d, m = 1 << 19, 1 << 14, 4
    sp = {}
    for cal, col, name in [(False, C[1], "DCC off"), (True, C[0], "DCC on")]:
        pp = SPLLParams(duty_err_s=20e-12, cal_dcc=cal)
        rr = simulate(pp, n + d, m_sub=m, n_discard=d)
        f, s = an.timing_psd(rr.tau_steady(), rr.fs_out, nperseg=1 << 16)
        tone = an.tone_dbc(rr.tau_steady(), rr.fs_out, pp.f_out_q, pp.f_xo)
        sp[name] = _f(tone)
        ax[2].semilogx(f, an.l_dbc(s, pp.f_out_q), color=col, lw=1.0,
                       label=f"{name}: spur @52 MHz {tone:.1f} dBc")
    ax[2].set(xlabel="Offset frequency (Hz)", ylabel="L(f) (dBc/Hz)", xlim=(1e5, 2e8),
              ylim=(-170, -100), title="(c) 20 ps duty skew: spur at f_XO")
    ax[2].legend(loc="lower left")
    save(fig, FIG / "fig4_dcc.png")
    # 1 ns error without DCC: loop cannot lock properly
    rb = simulate(SPLLParams(duty_err_s=1e-9, cal_dcc=False), (1 << 19) + d, n_discard=d)
    _, _, jb = _jit(rb)
    SUMMARY["dcc"] = dict(settle_us_from_1ns=_f(dcc_settle), gain_settle_us=_f(kd_settle),
                          spur_52MHz_dbc_20ps=sp, jitter_fs_1ns_dcc_off=_f(jb * 1e15),
                          vref_cmp_final_mV=_f((r.vcref[-1] - p.spd_vref) * 1e3))


# --------------------------------------------------------------------------- 5
def exp_phase_noise():
    p = SPLLParams()
    r = simulate(p, N_PN + D_PN, n_discard=D_PN)
    f, s, j = _jit(r)
    nb = noise_budget(p, f, dtc=r.dtc, kd=float(np.mean(r.kd[-5000:])))
    ja = an.integrated_jitter(f, nb["Total (analytic)"])
    lm = loop_metrics(p)
    fig, ax = plt.subplots(figsize=(8.6, 4.8))
    ax.semilogx(f, an.l_dbc(s, p.f_out_q), color=C[0], lw=1.0,
                label=f"Time-domain simulation: {j*1e15:.1f} fs rms")
    cols = [C[1], C[2], C[3], C[4], C[5]]
    contrib = {}
    for (name, v), col in zip([(k, v) for k, v in nb.items() if k != "Total (analytic)"], cols):
        jj = an.integrated_jitter(f, v)
        contrib[name] = _f(jj * 1e15)
        ax.semilogx(f, an.l_dbc(v, p.f_out_q), color=col, lw=0.9, label=f"{name}: {jj*1e15:.1f} fs")
    ax.semilogx(f, an.l_dbc(nb["Total (analytic)"], p.f_out_q), color=INK, lw=1.0,
                label=f"Analytic total: {ja*1e15:.1f} fs")
    fom = an.fom_db(j, p.power_w)
    ax.set(xlabel="Offset frequency (Hz)", ylabel="L(f) (dBc/Hz)", xlim=(1e4, 52e6),
           ylim=(-175, -100),
           title=f"Fractional-N output {p.f_out_q/1e9:.4f} GHz, f_PD = {p.f_pd/1e6:.0f} MHz"
                 f" (52 MHz XO x2)\n"
                 f"Jitter 10 kHz-10 MHz: {j*1e15:.1f} fs (paper: 75 fs)   "
                 f"FoM: {fom:.1f} dB (paper: -249.7 dB)")
    ax.axvspan(1e4, 1e7, color=C[0], alpha=0.04, lw=0)
    ax.legend(loc="lower left", fontsize=7.5)
    save(fig, FIG / "fig5_phase_noise.png")
    idx = lambda fo: int(np.argmin(np.abs(f - fo)))  # noqa: E731
    SUMMARY["phase_noise"] = dict(
        f_out_ghz=p.f_out_q / 1e9, jitter_sim_fs=_f(j * 1e15), jitter_analytic_fs=_f(ja * 1e15),
        fom_db=_f(fom), contributions_fs=contrib,
        L_dbc_hz={f"{fo:g}": _f(an.l_dbc(np.mean(s[idx(fo) - 3: idx(fo) + 4]), p.f_out_q))
                  for fo in (1e4, 1e5, 1e6, 1e7, 3e7)},
        loop=dict(f_unity_mhz=_f(lm["f_unity"] / 1e6), phase_margin_deg=_f(lm["phase_margin_deg"]),
                  f_3db_mhz=_f(lm["f_3db"] / 1e6), peaking_db=_f(lm["peaking_db"]),
                  kpd_uA_per_ps=_f(lm["kpd"] * 1e-12 * 1e6)),
        loop_filter=dict(R1_ohm=lm["lf"].r1, C1_pF=lm["lf"].c1 * 1e12, C2_pF=lm["lf"].c2 * 1e12,
                         R3_ohm=lm["lf"].r3, C3_pF=lm["lf"].c3 * 1e12),
        kd_over_ideal=_f(np.mean(r.kd[-5000:]) / r.kd_ideal))


# --------------------------------------------------------------------------- 6
def exp_spur():
    n0 = 58
    base = n0 * 104e6
    offs = np.logspace(4, np.log10(50e6), 19)
    fig, ax = plt.subplots(1, 3, figsize=(12.5, 3.8))
    res = {}
    for dtype, col, name in [("inverter_vs", C[1], "Conventional VS-DTC"),
                             ("constant_slope", C[0], "Highly linear DTC"),
                             ("ideal", C[2], "Ideal DTC")]:
        lv = [_spur_point(SPLLParams(f_out=base + fo, dtc_type=dtype))[1] for fo in offs]
        res[dtype] = [_f(x) for x in lv]
        ax[0].semilogx(offs, lv, color=col, marker="o", ms=3.5, label=name)
    ax[0].set(xlabel="Fractional offset from 58 x 104 MHz (Hz)", ylabel="Worst spur (dBc)",
              title="(a) Fractional spur vs. offset", ylim=(-115, -30))
    ax[0].axhline(PAPER["frac_spur_dbc"], color=MUTED, lw=0.9, label="Paper: < -64 dBc")
    ax[0].legend(loc="lower left", bbox_to_anchor=(0.0, 0.16))
    # (b) spur vs. INL magnitude at an in-band offset
    inl_res = {}
    for dtype, col, name in [("inverter_vs", C[1], "VS-DTC INL shape"),
                             ("constant_slope", C[0], "Constant-slope INL shape")]:
        x, y = [], []
        base_pk = np.max(np.abs(DTCModel(SPLLParams(dtc_type=dtype)).inl_fit))
        for target in np.logspace(np.log10(0.03e-12), np.log10(10e-12), 9):
            sc = target / base_pk
            pp = SPLLParams(f_out=base + 400e3, dtc_type=dtype, dtc_inl_scale=sc)
            x.append(target * 1e12)
            y.append(_spur_point(pp)[1])
        inl_res[dtype] = dict(inl_ps=[_f(v) for v in x], spur_dbc=[_f(v) for v in y])
        ax[1].semilogx(x, y, color=col, marker="o", ms=3.5, label=name)
    for dtype, col, lab in [("inverter_vs", C[1], "VS-DTC\nmodel"),
                            ("constant_slope", C[0], "CS-DTC\nmodel")]:
        pk = np.max(np.abs(DTCModel(SPLLParams(dtc_type=dtype)).inl_fit)) * 1e12
        ax[1].axvline(pk, color=col, lw=0.8, alpha=0.6)
        ax[1].text(pk * 1.08, -96, f"{lab}\n{pk:.2f} ps", color=INK2, fontsize=7.5)
    ax[1].set(xlabel="DTC INL, peak vs. best-fit line (ps)", ylabel="Worst spur (dBc)",
              title="(b) In-band spur (400 kHz) vs. DTC INL", ylim=(-100, -20))
    ax[1].axhline(PAPER["frac_spur_dbc"], color=MUTED, lw=0.9, label="Paper: < -64 dBc")
    ax[1].legend(loc="upper left")
    # (c) across the band
    chans = np.arange(5.5e9, 7.3e9 + 1, 25e6)
    band = {}
    for dtype, col, name in [("inverter_vs", C[1], "Conventional VS-DTC"),
                             ("constant_slope", C[0], "Highly linear DTC")]:
        lv = np.array([_spur_point(SPLLParams(f_out=fc, dtc_type=dtype), 1 << 16)[1]
                       for fc in chans])
        band[dtype] = dict(worst_dbc=_f(lv.max()), median_dbc=_f(np.median(lv)))
        ax[2].plot(chans / 1e9, lv, color=col, marker="o", ms=3, lw=0.8,
                   label=f"{name}: worst {lv.max():.1f} dBc")
    ax[2].set(xlabel="Output frequency (GHz)", ylabel="Worst spur (dBc)",
              title="(c) Worst spur, 5.5-7.3 GHz band", ylim=(-125, -30))
    ax[2].axhline(PAPER["frac_spur_dbc"], color=MUTED, lw=0.9, label="Paper: < -64 dBc")
    ax[2].legend(loc="lower left")
    save(fig, FIG / "fig6_frac_spur.png")
    SUMMARY["spur"] = dict(offsets_hz=[_f(o) for o in offs], vs_offset_dbc=res,
                           vs_inl=inl_res, band=band)


# --------------------------------------------------------------------------- 7
def exp_band():
    chans = np.linspace(5.52e9, 7.28e9, 9) + 13.7e6
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    out = {}
    for dtype, col, name in [("inverter_vs", C[1], "Conventional VS-DTC"),
                             ("constant_slope", C[0], "Highly linear DTC")]:
        js = []
        for fc in chans:
            r = simulate(SPLLParams(f_out=fc, dtc_type=dtype), (1 << 20) + D_PN, n_discard=D_PN)
            js.append(_jit(r)[2] * 1e15)
        out[dtype] = [_f(v) for v in js]
        ax.plot(chans / 1e9, js, color=col, marker="o", ms=3.5, label=name)
    ax.axhline(PAPER["jitter_fs"], color=MUTED, lw=0.9, label="Paper: 75 fs")
    ax.set(xlabel="Output frequency (GHz)", ylabel="rms jitter 10 kHz-10 MHz (fs)",
           title="Integrated jitter across the band", ylim=(0, None))
    ax.legend(loc="upper right")
    save(fig, FIG / "fig7_jitter_band.png")
    SUMMARY["band_jitter"] = dict(f_out_ghz=[_f(c / 1e9) for c in chans], jitter_fs=out)


EXPS = dict(arch=exp_arch, dtc=exp_dtc, spd=exp_spd, gain=exp_gain_cal, dcc=exp_dcc, pn=exp_phase_noise,
            spur=exp_spur, band=exp_band)


def write_summary():
    RES.mkdir(exist_ok=True)
    path = RES / "summary.json"
    old = json.loads(path.read_text()) if path.exists() else {}
    old.update(SUMMARY)
    path.write_text(json.dumps(old, indent=2, default=float))
    return old


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("which", nargs="*", default=list(EXPS))
    args = ap.parse_args()
    FIG.mkdir(exist_ok=True)
    for name in args.which:
        t0 = time.time()
        EXPS[name]()
        print(f"[{name}] done in {time.time() - t0:.1f} s", flush=True)
    s = write_summary()
    print(json.dumps({k: s[k] for k in s if k in ("phase_noise", "dcc", "gain_cal")}, indent=1,
                     default=float)[:3000])


if __name__ == "__main__":
    main()
