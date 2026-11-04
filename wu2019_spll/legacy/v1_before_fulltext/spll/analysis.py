"""Phase-noise, jitter and spur measurement utilities."""
from __future__ import annotations

import numpy as np
from scipy import signal


def timing_psd(tau: np.ndarray, fs: float, nperseg: int = 1 << 17, window: str = "hann"):
    """One-sided PSD of the timing sequence [s^2/Hz] (Welch, 50 % overlap)."""
    nperseg = min(nperseg, tau.size)
    f, s = signal.welch(tau - np.mean(tau), fs=fs, window=window, nperseg=nperseg,
                        noverlap=nperseg // 2, detrend="linear", scaling="density")
    return f[1:], s[1:]


def l_dbc(s_tau: np.ndarray, f0: float) -> np.ndarray:
    """SSB phase noise L(f) [dBc/Hz] of a carrier f0 from a timing PSD."""
    return 10 * np.log10(0.5 * (2 * np.pi * f0) ** 2 * s_tau + 1e-300)


def integrated_jitter(f, s_tau, f1=10e3, f2=10e6) -> float:
    """rms jitter [s] integrated over [f1, f2] (includes spurs falling inside)."""
    sel = (f >= f1) & (f <= f2)
    return float(np.sqrt(np.trapezoid(s_tau[sel], f[sel])))


def fom_db(jitter_s: float, power_w: float) -> float:
    return 10 * np.log10(jitter_s ** 2 * power_w / 1e-3)


def spur_spectrum(tau: np.ndarray, fs: float, f0: float):
    """Flat-top windowed periodogram -> per-bin tone level in dBc (SSB).
    A pure phase tone A*sin(2*pi*fm*t) shows its exact level 20log10(A/2)."""
    x = tau - np.mean(tau)
    n = x.size
    w = signal.windows.flattop(n, sym=False)
    spec = np.fft.rfft(x * w)
    amp = 2.0 * np.abs(spec) / np.sum(w)             # timing-tone amplitude [s]
    f = np.fft.rfftfreq(n, 1.0 / fs)
    phase_amp = 2 * np.pi * f0 * amp
    return f, 20 * np.log10(phase_amp / 2.0 + 1e-300)


def worst_spur(tau: np.ndarray, fs: float, f0: float, fmin: float = 5e3,
               fmax: float | None = None, exclude: tuple = ()):
    """Largest discrete tone (dBc) in [fmin, fmax], ignoring +-3 bins around `exclude`."""
    f, sp = spur_spectrum(tau, fs, f0)
    fmax = fmax or fs / 2
    sel = (f >= fmin) & (f <= fmax)
    df = f[1] - f[0]
    for fx in exclude:
        sel &= np.abs(f - fx) > 3 * df
    i = np.argmax(np.where(sel, sp, -400.0))
    return float(f[i]), float(sp[i])


def tone_dbc(tau: np.ndarray, fs: float, f0: float, ftone: float, tol_bins: int = 4):
    f, sp = spur_spectrum(tau, fs, f0)
    df = f[1] - f[0]
    sel = np.abs(f - ftone) <= tol_bins * df
    return float(np.max(sp[sel]))


def settle_index(x: np.ndarray, final: float, tol: float, hold: int = 200) -> int:
    """First index after which |x-final| stays within tol for `hold` samples (rolling)."""
    ok = np.abs(x - final) <= tol
    bad = np.flatnonzero(~ok)
    if bad.size == 0:
        return 0
    return int(bad[-1] + 1) if bad[-1] + 1 < x.size else x.size
