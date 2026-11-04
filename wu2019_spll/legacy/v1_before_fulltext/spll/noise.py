"""Noise PSD models and FFT-shaped noise generation (all timing PSDs are one-sided,
in s^2/Hz; phase-noise L(f) is SSB in dBc/Hz)."""
from __future__ import annotations

import numpy as np

from .params import SPLLParams, KB


def shaped_noise(n: int, fs: float, psd_fn, rng) -> np.ndarray:
    """Real Gaussian sequence whose one-sided PSD is psd_fn(f) (f > 0)."""
    w = rng.standard_normal(n)
    spec = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1.0 / fs)
    h = np.zeros_like(f)
    h[1:] = np.sqrt(psd_fn(f[1:]) * fs / 2.0)
    x = np.fft.irfft(spec * h, n)
    return x - x[0]


def l_to_timing_psd(l_lin, f0):
    """SSB phase noise (linear, 1/Hz) of a carrier f0 -> one-sided timing PSD."""
    return 2.0 * l_lin / (2 * np.pi * f0) ** 2


def xo_l(p: SPLLParams, f):
    return 10 ** (p.xo_l_10k / 10) * (1e4 / f) ** 3 + 10 ** (p.xo_l_floor / 10)


def xo_timing_psd(p: SPLLParams, f):
    return l_to_timing_psd(xo_l(p, f), p.f_xo)


def vco_l(p: SPLLParams, f):
    scale = (p.f_out_q / 6.0e9) ** 2
    l1 = 10 ** (p.vco_l_1m / 10) * scale
    return l1 * (1e6 / f) ** 2 * (1 + p.vco_f3 / f) + 10 ** (p.vco_l_floor / 10) * scale


def vco_timing_psd(p: SPLLParams, f):
    return l_to_timing_psd(vco_l(p, f), p.f_out_q)


def ktc_voltage(p: SPLLParams) -> float:
    return np.sqrt(KB * p.temp_k / p.c_sh)


def gm_current_psd(p: SPLLParams) -> float:
    return 4 * KB * p.temp_k * p.gm_nf * p.gm


def resistor_psd(p: SPLLParams, r: float) -> float:
    return 4 * KB * p.temp_k * r
