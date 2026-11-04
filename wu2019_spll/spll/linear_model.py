"""Linearised noise model built from the same sampled-data matrices as the kernel
(spll.loop.period_model): every source is propagated with its exact discrete-time transfer."""
from __future__ import annotations

import numpy as np

from .loop import k_slope_lock, transfer_functions
from .noise import (dtc_qn_psd, edge_psd, gm_v_psd, ktc_s1, ktc_s2, outbuf_l, vco_psd,
                    xo_psd)
from .params import SPLLParams

_QN_CACHE: dict = {}


def mash11_phi_e(alpha_int: int, bits: int, n: int) -> np.ndarray:
    """Accumulated QE Phi_e[k] = c2 - acc1/2^B of a MASH 1-1 with constant input."""
    mod = 1 << bits
    k = np.arange(1, n + 1, dtype=np.int64)
    acc1 = (k * alpha_int) % mod
    s = np.cumsum(acc1)                       # acc2 before wrapping (fits in int64)
    c2 = s // mod - np.concatenate(([0], s[:-1] // mod))
    return c2 - acc1 / mod


def dtc_qn_psd_numeric(p: SPLLParams, f: np.ndarray, kd: float, lsb: float,
                       n: int = 1 << 18) -> np.ndarray:
    """PSD of the DTC rounding error for this channel (MASH 1-1 code sequence, no DCC)."""
    from scipy import signal
    key = (p.alpha_int, round(kd, 6), lsb, n, p.f_ref)
    if key not in _QN_CACHE:
        phi = mash11_phi_e(p.alpha_int, p.acc_bits, n)
        cf = 511.5 + kd * phi
        e = (np.floor(cf + 0.5) - cf) * lsb
        ff, ss = signal.welch(e, fs=p.f_ref, nperseg=1 << 14, window="hann")
        _QN_CACHE[key] = (ff[1:], ss[1:])
    ff, ss = _QN_CACHE[key]
    return np.interp(f, ff, ss)


SOURCES = ("REF + DTC", "MMDIV", "SPD (kT/C)", "Gm", "VCO")


def noise_budget(p: SPLLParams, f: np.ndarray, lsb: float | None = None,
                 qn: str = "numeric") -> dict:
    """One-sided output timing PSDs [s^2/Hz] per source (f < f_ref/2).
    qn='numeric': channel-specific DTC rounding-error spectrum; 'white': (LSB^2/12)*2/f_ref."""
    tf = transfer_functions(p, f)
    hin2 = np.abs(tf["H_in"]) ** 2
    ks = k_slope_lock(p)
    fr = p.f_ref
    lsb = lsb or p.dtc_lsb
    if qn == "numeric":
        kd = p.t_vco / lsb
        s_qn = dtc_qn_psd_numeric(p, f, kd, lsb) if p.alpha_int else 0.0 * f
    else:
        s_qn = dtc_qn_psd(p, lsb)
    out = {
        "REF + DTC": hin2 * ((1 - p.div_share) * edge_psd(p, f) + xo_psd(p, f) + s_qn),
        "MMDIV": hin2 * p.div_share * edge_psd(p, f),
        "SPD (kT/C)": (hin2 * 2 * (ktc_s1(p) / ks) ** 2 / fr +
                       np.abs(tf["H_v2"]) ** 2 * 2 * ktc_s2(p) ** 2 / fr),
        "Gm": np.abs(tf["H_i"]) ** 2 * p.gm ** 2 * gm_v_psd(p, f),
        "VCO": np.abs(tf["H_vco"]) ** 2 * vco_psd(p, f),
    }
    out["Total"] = sum(out.values())
    return out


def l_model(p: SPLLParams, f: np.ndarray, measured_like: bool = True) -> np.ndarray:
    """Total SSB phase noise [dBc/Hz]; measured_like adds the test-buffer floor."""
    s = noise_budget(p, f)["Total"]
    lin = 0.5 * (2 * np.pi * p.f_vco) ** 2 * s
    if measured_like:
        lin = lin + outbuf_l(p, f)
    return 10 * np.log10(lin)


def jitter_model(p: SPLLParams, f1=10e3, f2=10e6, measured_like=True, n=20000) -> float:
    f = np.logspace(np.log10(f1), np.log10(f2), n)
    lin = 10 ** (l_model(p, f, measured_like) / 10)
    return float(np.sqrt(np.trapezoid(2 * lin, f)) / (2 * np.pi * p.f_vco))
