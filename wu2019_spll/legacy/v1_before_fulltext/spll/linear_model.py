"""Analytic (linearised) noise model, built from the *same* ZOH-discretised loop
as the time-domain kernel, so the two can be overlaid as a cross-check."""
from __future__ import annotations

import numpy as np

from .dtc import DTCModel
from .loopfilter import (design_loop_filter, discretize, kpd, spd_slope_eff,
                         state_space)
from .noise import (gm_current_psd, ktc_voltage, resistor_psd, vco_timing_psd,
                    xo_timing_psd)
from .params import SPLLParams


def transfer_functions(p: SPLLParams, f: np.ndarray, lf=None) -> dict:
    lf = lf or design_loop_filter(p)
    a, b_i, b_r1, b_r3 = state_space(p, lf)
    t = p.t_pd
    phi, (gam, gr1, gr3) = discretize(a, [b_i, b_r1, b_r3], t)
    z = np.exp(1j * 2 * np.pi * f * t)
    mat = z[:, None, None] * np.eye(4)[None] - phi[None]
    rhs = np.stack([gam, gr1, gr3], axis=1).astype(complex)       # (4, 3)
    sol = np.linalg.solve(mat, np.broadcast_to(rhs, (f.size, 4, 3)))
    gi, gr1_, gr3_ = sol[:, 3, 0], sol[:, 3, 1], sol[:, 3, 2]
    g = kpd(p) * gi                                                # open loop
    return dict(G=g, H_in=g / (1 + g), H_vco=1 / (1 + g), H_gm=gi / (1 + g),
                H_r1=gr1_ / (1 + g), H_r3=gr3_ / (1 + g), lf=lf)


def loop_metrics(p: SPLLParams, lf=None) -> dict:
    f = np.logspace(3, np.log10(p.f_pd / 2 * 0.999), 6000)
    tf = transfer_functions(p, f, lf)
    g = tf["G"]
    i = np.argmin(np.abs(np.abs(g) - 1))
    pm = 180 + np.degrees(np.angle(g[i]))
    h = np.abs(tf["H_in"])
    j = np.flatnonzero(h < 1 / np.sqrt(2))
    f3db = f[j[0]] if j.size else np.nan
    peak = 20 * np.log10(h.max())
    return dict(f_unity=f[i], phase_margin_deg=pm, f_3db=f3db, peaking_db=peak,
                kpd=kpd(p), slope_eff=spd_slope_eff(p), lf=tf["lf"])


def noise_budget(p: SPLLParams, f: np.ndarray, lf=None, dtc: DTCModel | None = None,
                 kd: float | None = None) -> dict:
    """One-sided output *timing* PSD contributions [s^2/Hz] at frequencies f (< f_pd/2)."""
    tf = transfer_functions(p, f, lf)
    lf = tf["lf"]
    fpd = p.f_pd
    dtc = dtc or DTCModel(p)
    # mean DTC jitter^2 over the codes actually visited
    kd = kd or dtc.kd_ideal(p.t_out)
    q = (np.arange(4096) + 0.5) / 4096 * p.q_span + 0.25
    mid = 0.5 * (dtc.table.size - 1)
    codes = np.clip(np.round(kd * (q - 0.5 * (p.q_span + 0.5)) + mid), 0,
                    dtc.table.size - 1).astype(int)
    sig2_dtc = np.mean(dtc.sigma[codes] ** 2)
    s_q = dtc.lsb_fit ** 2 / 12 * 2 / fpd
    if p.dtc_sdm:
        s_q = s_q * np.abs(2 * np.sin(np.pi * f / fpd)) ** 2
    s_ref = xo_timing_psd(p, f) + 2 * p.ref_buf_jitter ** 2 / fpd
    s_dtc = 2 * sig2_dtc / fpd + s_q
    s_spd = 2 * (p.div_jitter ** 2 + p.spd_slope_jitter ** 2 +
                 (ktc_voltage(p) / spd_slope_eff(p)) ** 2) / fpd
    hin2 = np.abs(tf["H_in"]) ** 2
    out = {
        "Reference (XO+doubler/buffer)": hin2 * s_ref,
        "DTC (jitter+quantisation)": hin2 * s_dtc,
        "SPD (kT/C, slope gen., MMD)": hin2 * s_spd,
        "Gm + loop filter": (np.abs(tf["H_gm"]) ** 2 * gm_current_psd(p) +
                             np.abs(tf["H_r1"]) ** 2 * resistor_psd(p, lf.r1) +
                             np.abs(tf["H_r3"]) ** 2 * resistor_psd(p, lf.r3)),
        "VCO": np.abs(tf["H_vco"]) ** 2 * vco_timing_psd(p, f),
    }
    out["Total (analytic)"] = sum(out.values())
    return out
