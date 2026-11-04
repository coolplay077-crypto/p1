"""Noise models (one-sided PSDs; timing PSDs in s^2/Hz, L(f) in dBc/Hz)."""
from __future__ import annotations

import numpy as np

from .params import KB, SPLLParams


def shaped_noise(n: int, fs: float, psd_fn, rng) -> np.ndarray:
    """Gaussian sequence with one-sided PSD psd_fn(f) (FFT shaping, circular)."""
    w = rng.standard_normal(n)
    spec = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1.0 / fs)
    h = np.zeros_like(f)
    h[1:] = np.sqrt(psd_fn(f[1:]) * fs / 2.0)
    x = np.fft.irfft(spec * h, n)
    return x - x[0]


def l_to_timing(l_lin, f0):
    return 2.0 * l_lin / (2 * np.pi * f0) ** 2


# --- per-edge noise at the SPD input (CLKREFX2 buffer + DTC thermal + MMDIV) -----------
def edge_white_psd(p: SPLLParams) -> float:
    return 2.0 * p.ref_white ** 2 / p.f_ref


def edge_psd(p: SPLLParams, f):
    return edge_white_psd(p) * (1.0 + p.ref_flicker_fc / f)


def dtc_qn_psd(p: SPLLParams, lsb=None) -> float:
    lsb = lsb or p.dtc_lsb
    return lsb ** 2 / 12.0 * 2.0 / p.f_ref


# --- crystal -------------------------------------------------------------------------
def xo_l(p: SPLLParams, f):
    return 10 ** (p.xo_l_1k / 10) * (1e3 / f) ** 3 + 10 ** (p.xo_l_floor / 10)


def xo_psd(p: SPLLParams, f):
    return l_to_timing(xo_l(p, f), p.f_xo)


# --- VCO -----------------------------------------------------------------------------
def vco_l(p: SPLLParams, f):
    scale = (p.f_vco / 6.333659790e9) ** 2
    return 10 ** (p.vco_l_1m / 10) * scale * (1e6 / f) ** 2 * (1.0 + p.vco_f3 / f)


def vco_psd(p: SPLLParams, f):
    return l_to_timing(vco_l(p, f), p.f_vco)


# --- sampler kT/C (voltages) ---------------------------------------------------------
def ktc_s1(p: SPLLParams) -> float:
    return np.sqrt(KB * p.temp_k / p.c_s1)


def ktc_s2(p: SPLLParams) -> float:
    return np.sqrt(KB * p.temp_k / (p.c_s1 + p.c_s2))


# --- Gm (input-referred voltage noise, enters the integral path only) ---------------
def gm_v_psd(p: SPLLParams, f):
    return p.gm_en ** 2 * (1.0 + p.gm_fc / f)


def outbuf_l(p: SPLLParams, f):
    return 10 ** (p.outbuf_floor / 10) * np.ones_like(np.asarray(f, dtype=float))
