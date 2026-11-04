"""Shared utilities: MASH SDM, loop-filter design, phase-noise / spur / jitter metrics.

Conventions
-----------
* time in seconds, frequency in Hz
* oscillator excess phase is carried in *cycles* inside the simulators and
  converted to radians (x 2*pi) only for spectral analysis
* L(f) is the single-sideband phase noise in dBc/Hz, L = S_phi / 2 with
  S_phi the one-sided phase PSD in rad^2/Hz
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit
from scipy import signal
from scipy.linalg import expm


# ----------------------------------------------------------------------------
# MASH 1-1-1 sigma-delta modulator (integer arithmetic, arbitrary modulus Q)
# ----------------------------------------------------------------------------
@njit(cache=True)
def _mash111(K, Q, n, dither, seed):
    np.random.seed(seed)
    a1 = 0
    a2 = 0
    a3 = 0
    c2p = 0
    c3p = 0
    c3pp = 0
    dprev = 0
    y = np.empty(n, np.int64)
    for k in range(n):
        x = K
        if dither:
            d = np.random.randint(0, 2)
            x = K + d - dprev  # first-order shaped LSB dither: zero mean, bounded sum
            dprev = d
        a1 += x
        c1 = a1 // Q
        a1 -= c1 * Q
        a2 += a1
        c2 = a2 // Q
        a2 -= c2 * Q
        a3 += a2
        c3 = a3 // Q
        a3 -= c3 * Q
        y[k] = c1 + (c2 - c2p) + (c3 - 2 * c3p + c3pp)
        c3pp = c3p
        c3p = c3
        c2p = c2
    return y


def mash111(K: int, Q: int, n: int, dither: bool = True, seed: int = 1):
    """MASH 1-1-1 output y[k] (integers, mean K/Q) and cumulative error.

    Returns (y, E) where E[k] = sum_{j<=k} (y[j]*Q - K) is the accumulated
    quantisation error in units of 1/Q output-LSB.  E is bounded (|E| < ~3Q)
    for both the dithered and undithered modulator.
    """
    y = _mash111(int(K), int(Q), int(n), bool(dither), int(seed))
    E = np.cumsum(y * Q - K)
    return y, E


# ----------------------------------------------------------------------------
# Charge-pump PLL loop filter (2nd-order passive: C2 || (R1 + C1))
# ----------------------------------------------------------------------------
def design_cp_filter(icp, kvco_hz, n_div, fc, pm_deg, p3_ratio=6.0, c3_ratio=0.1):
    """Phase-margin design of a 4th-order type-II CP-PLL.

    Filter: C2 || (R1 + C1) at the CP node, followed by R3-C3 (extra pole at
    p3_ratio*fc, C3 = c3_ratio*C2) to attenuate SDM noise far from the carrier.
    kvco_hz in Hz/V.  Loop gain L(s) = icp*kvco_hz*Z(s)/(n_div*s).
    The R1/C1/C2 core is designed for pm_deg + the extra pole's phase lag so the
    real phase margin stays close to pm_deg (checked numerically).
    """
    wc = 2 * math.pi * fc
    lag = math.degrees(math.atan(1 / p3_ratio)) if p3_ratio else 0.0
    phi = math.radians(min(pm_deg + lag, 80.0))
    T1 = (1 / math.cos(phi) - math.tan(phi)) / wc
    T2 = 1 / (wc * wc * T1)
    k = icp * kvco_hz / n_div  # [A*Hz/V] -> L(s) = k * Z(s) / s
    Ctot = k / (wc * wc) * math.sqrt((1 + (wc * T2) ** 2) / (1 + (wc * T1) ** 2))
    C2 = Ctot * T1 / T2
    C1 = Ctot - C2
    R1 = T2 / C1
    lf = dict(R1=R1, C1=C1, C2=C2, T1=T1, T2=T2, Ctot=Ctot, R3=0.0, C3=0.0)
    if p3_ratio:
        C3 = c3_ratio * C2
        R3 = 1 / (2 * math.pi * p3_ratio * fc * C3)
        lf.update(R3=R3, C3=C3)
        # rescale all capacitors (and inverse-scale resistors) so |L(j wc)| = 1
        g = abs(cp_open_loop(fc, icp, kvco_hz, n_div, lf))
        for key in ("C1", "C2", "C3", "Ctot"):
            lf[key] *= g
        for key in ("R1", "R3"):
            lf[key] /= g
    return lf


def lf_transimpedance(f, lf):
    """CP current -> VCO control voltage transimpedance (exact, incl. R3/C3)."""
    s = 2j * np.pi * np.asarray(f, float)
    Y = s * lf["C2"] + 1 / (lf["R1"] + 1 / (s * lf["C1"]))
    if lf.get("C3", 0) > 0:
        Y = Y + s * lf["C3"] / (1 + s * lf["R3"] * lf["C3"])
        return 1 / Y / (1 + s * lf["R3"] * lf["C3"])
    return 1 / Y


def cp_open_loop(f, icp, kvco_hz, n_div, lf):
    s = 2j * np.pi * np.asarray(f, float)
    return icp * kvco_hz * lf_transimpedance(f, lf) / (n_div * s)


def loop_margins(icp, kvco_hz, n_div, lf, fmin=1e3, fmax=1e9):
    """Numerical crossover frequency and phase margin of the CP loop."""
    f = np.logspace(np.log10(fmin), np.log10(fmax), 20000)
    Lg = cp_open_loop(f, icp, kvco_hz, n_div, lf)
    i = int(np.argmin(np.abs(np.abs(Lg) - 1)))
    return float(f[i]), float(180 + np.degrees(np.angle(Lg[i])))


def cp_state_space(lf, kvco_hz, h):
    """Exact discretisation over step h of z=[v_C1, v_C2, v_C3, theta(cycles)].

    Returns (Phi, Gam, b): z(t+h) = Phi z(t) + Gam * I_const ; an impulse
    charge q adds b*q to z.  The VCO is driven by v_C3 (= v_C2 if no R3/C3).
    """
    R1, C1, C2 = lf["R1"], lf["C1"], lf["C2"]
    R3, C3 = lf.get("R3", 0.0), lf.get("C3", 0.0)
    A = np.zeros((4, 4))
    A[0, 0], A[0, 1] = -1 / (R1 * C1), 1 / (R1 * C1)
    A[1, 0], A[1, 1] = 1 / (R1 * C2), -1 / (R1 * C2)
    if C3 > 0:
        A[1, 1] -= 1 / (R3 * C2)
        A[1, 2] = 1 / (R3 * C2)
        A[2, 1], A[2, 2] = 1 / (R3 * C3), -1 / (R3 * C3)
        A[3, 2] = kvco_hz
    else:
        A[2, 2] = -1.0   # unused dummy state
        A[3, 1] = kvco_hz
    b = np.array([0.0, 1 / C2, 0.0, 0.0])
    Aug = np.zeros((5, 5))
    Aug[:4, :4] = A
    Aug[:4, 4] = b
    E = expm(Aug * h)
    return E[:4, :4].copy(), E[:4, 4].copy(), b


# ----------------------------------------------------------------------------
# Spectral metrics
# ----------------------------------------------------------------------------
def phase_noise(theta_cycles, fs, nperseg=2 ** 16, detrend="linear"):
    """Welch estimate of L(f) [dBc/Hz] from excess phase in cycles."""
    phi = 2 * np.pi * np.asarray(theta_cycles, float)
    nperseg = int(min(nperseg, len(phi)))
    f, S = signal.welch(phi, fs=fs, window="hann", nperseg=nperseg,
                        noverlap=nperseg // 2, detrend=detrend, scaling="density")
    with np.errstate(divide="ignore"):
        L = 10 * np.log10(S / 2)
    return f[1:], L[1:]


def log_smooth(f, L_db, n_bins=200, fmin=None, fmax=None):
    """Average PSD (in linear power) on log-spaced bins for plotting/reading."""
    fmin = fmin or f[0]
    fmax = fmax or f[-1]
    edges = np.logspace(np.log10(fmin), np.log10(fmax), n_bins + 1)
    P = 10 ** (L_db / 10)
    fc, Lc = [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (f >= lo) & (f < hi)
        if m.any():
            fc.append(math.sqrt(lo * hi))
            Lc.append(10 * math.log10(P[m].mean()))
    return np.array(fc), np.array(Lc)


def band_level(f, L_db, f1, f2):
    """Mean phase-noise level (power average) in [f1, f2] in dBc/Hz."""
    m = (f >= f1) & (f <= f2)
    return float(10 * np.log10(np.mean(10 ** (L_db[m] / 10))))


def band_level_excl(f, L_db, f1, f2, f_excl, half_width):
    """Like band_level but ignoring |f - f_excl| < half_width (spur notch)."""
    m = (f >= f1) & (f <= f2) & (np.abs(f - f_excl) >= half_width)
    return float(10 * np.log10(np.mean(10 ** (L_db[m] / 10))))


def rms_jitter(f, L_db, f_carrier, f1, f2):
    """RMS jitter [s] integrating L(f) from f1 to f2 (both sidebands)."""
    m = (f >= f1) & (f <= f2)
    var = 2 * np.trapezoid(10 ** (L_db[m] / 10), f[m])
    return float(math.sqrt(var) / (2 * math.pi * f_carrier))


def spur_dbc(theta_cycles, fs, f_spur, search_bins=3):
    """Single-sideband spur level [dBc] of a tone in the excess phase.

    For phi(t) = A cos(2 pi f t) each sideband is (A/2)^2 relative to the
    carrier.  Blackman-Harris window, peak search +-search_bins.
    """
    phi = 2 * np.pi * (np.asarray(theta_cycles, float))
    phi = signal.detrend(phi, type="linear")
    n = len(phi)
    w = signal.windows.blackmanharris(n)
    X = np.fft.rfft(phi * w)
    k0 = int(round(f_spur / fs * n))
    lo, hi = max(k0 - search_bins, 1), min(k0 + search_bins + 1, len(X))
    amp = np.abs(X[lo:hi]).max() / w.sum()  # = A/2
    return float(20 * np.log10(amp + 1e-30))


def wiener_step_sigma(L0_dbc, f0, fs):
    """Per-sample std (cycles) of a random walk giving L(f)=L0*(f0/f)^2."""
    L0 = 10 ** (L0_dbc / 10)
    return math.sqrt(L0 * f0 * f0 / fs)


def white_timing_sigma_from_floor(L_floor_dbc, f_clock, f_ref):
    """Per-edge rms jitter [s] of a white timing source whose phase-noise
    floor is L_floor at clock frequency f_clock, sampled at f_ref."""
    S_t = 2 * 10 ** (L_floor_dbc / 10) / (2 * math.pi * f_clock) ** 2  # s^2/Hz one-sided
    return math.sqrt(S_t * f_ref / 2)
