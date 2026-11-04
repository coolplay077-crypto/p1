"""Behavioural model of the MediaTek ISSCC 2008 (paper 10.1) fractional-N ADPLL
"A Fractional Spur-Free ADPLL with Loop-Gain Calibration and Phase-Noise
Cancellation for GSM/GPRS/EDGE" (H.-H. Chang, P.-Y. Wang, J.-H. C. Zhan, B.-Y. Hsieh).

Reproduced blocks (Fig. 10.1.1 / 10.1.4 / 10.1.5):
  * PFD + cyclic TDC (CTDC): 32-stage ring, 5-bit cycle counter, ~30 ps LSB,
    sign from the PFD 'Lag' output; the bang-bang sign is merged into the
    phase word so there is no dead zone (mid-riser quantiser).
  * TDC calibration controller: offset (A=B=REF) and normalisation
    (A=REF, B=REFB -> Delta N counts per half reference period),
    TDCgain = 1 / (2 * Delta N * Fref).
  * Digital phase-noise compensator:
        e_CTDC[k] = sum_{n<k} e_DS[n] * 2*Delta N / (M+F)
    subtracted from the TDC word (MASH 1-1-1 accumulated error).
  * DLF: feed-forward path = programmable IIR low-pass x a (proportional);
    bang-bang integration path = sign(phase) -> UP/DN counter x b.
  * Loop-gain calibration: a = TDCgain/DCOgain * 2*pi*BW*M*Fref, with
    DCOgain = Delta F * Fref / Delta I measured by a preset divider step.
  * DCO tracking bank with fractional bits (1st-order DS dithering is far
    below other noise, see report) and optional unit-element DNL.

Modelling level: reference-rate phase-domain loop with `os` sub-steps for the
output spectrum; the TDC is a real time-to-count quantiser (with stage
mismatch, offset, drift), so quantisation, INL and normalisation errors act
on the true timing of each edge.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace

import numpy as np
from numba import njit

from . import common as C


@dataclass
class ADPLLParams:
    f_ref: float = 26e6
    M: int = 138
    Fn: int = 2
    Fd: int = 130            # F = Fn/Fd  (138 + 2/130 -> 400 kHz fractional offset)
    dither: bool = False     # paper shows the undithered worst case
    # CTDC
    tau: float = 30e-12      # mean inverter delay at calibration
    n_stage: int = 32
    tdc_sigma: float = 0.0   # stage-delay mismatch (relative sigma)
    t_os: float = 60e-12     # PFD/TDC static offset (removed by offset cal)
    duty: float = 0.5        # REF duty cycle seen by the normalisation step
    tau_drift: float = 0.0   # relative tau change after calibration (temperature)
    miscount_p: float = 0.0  # P(cycle counter off by one ring) when the stop edge
    miscount_win: float = 15e-12  #   lands within this window of a ring wrap
    tdc_jit: float = 0.0     # rms thermal jitter of PFD+CTDC measurement [s]
    offset_track: bool = False  # True: TDC offset re-measured at run-time tau (after drift)
    phase_bias: float = 0.0  # lock point offset [TDC LSB]; > DS swing keeps dt one-signed
    dN_error: int = 0        # forced error of Delta N (e.g. +-n_stage from a cycle miscount)
    # DCO
    kdco: float = 12e3       # actual tracking LSB [Hz/LSB]
    frac_bits: int = 11      # fractional tracking bits (12 kHz/2^11 ~ 5.9 Hz)
    dco_dnl: float = 0.0     # unit-element sigma (relative) of tracking bank
    dco_L1M: float | None = -126.0   # DCO L(1 MHz) at 3.6 GHz [dBc/Hz]
    ref_floor: float | None = -150.0 # 26 MHz TCXO floor [dBc/Hz]
    # loop
    bw: float = 50e3
    lp_order: int = 2
    lp_fc: float = 150e3
    extra_latency: int = 0   # cycles beyond the inherent z^-1
    bb_step_hz: float = 1.0  # integral path: b*DCOgain per reference cycle
    cancel: bool = True
    comp_frac_bits: int = 8  # canceller output truncation (fraction of TDC LSB)
    # calibration knowledge used to compute 'a'
    calibrated: bool = True  # False -> a from nominal tau=30 ps, kdco=12 kHz
    kdco_est: float | None = None   # None -> use actual kdco (set by calibrate())
    # sim
    os: int = 4
    n_cyc: int = 2 ** 19
    settle: int = 2 ** 14
    seed: int = 3

    @property
    def F(self):
        return self.Fn / self.Fd

    @property
    def f_dco(self):
        return (self.M + self.F) * self.f_ref

    @property
    def t_dco(self):
        return 1 / self.f_dco


# ----------------------------------------------------------------------------
# CTDC model
# ----------------------------------------------------------------------------
def tdc_positions(p: ADPLLParams, drift=0.0):
    rng = np.random.default_rng(p.seed + 11)
    d = 1 + rng.normal(0, p.tdc_sigma, p.n_stage) if p.tdc_sigma > 0 else np.ones(p.n_stage)
    d *= p.tau * (1 + drift)
    return np.concatenate(([0.0], np.cumsum(d)))


@njit(cache=True)
def _tdc_count(t, P):
    n = P.shape[0] - 1
    ring = P[n]
    c = math.floor(t / ring)
    rem = t - c * ring
    lo = 0
    hi = n
    while hi - lo > 1:          # last index with P[idx] <= rem
        mid = (lo + hi) // 2
        if P[mid] <= rem:
            lo = mid
        else:
            hi = mid
    return c * n + lo


def tdc_count(t, P):
    return int(_tdc_count(float(t), P))


def tdc_calibration(p: ADPLLParams):
    """Offset + half-period normalisation with the calibration-time TDC."""
    P = tdc_positions(p, 0.0)
    offset = tdc_count(p.t_os, P)
    dN = tdc_count(p.duty / p.f_ref + p.t_os, P) - offset + p.dN_error
    tdc_gain = 1 / (2 * dN * p.f_ref)    # [s/LSB]
    return dict(offset=offset, dN=dN, tdc_gain=tdc_gain, P_cal=P)


def loop_gain_a(tdc_gain, dco_gain, p: ADPLLParams):
    return tdc_gain / dco_gain * 2 * math.pi * p.bw * p.M * p.f_ref


def dsm_sequence(p: ADPLLParams, n):
    y, E = C.mash111(p.Fn, p.Fd, n, p.dither, p.seed)
    # r[k]: accumulated DS error (DCO cycles) seen by the k-th feedback edge
    r = np.concatenate(([0.0], E[:-1] / p.Fd))
    return r


# ----------------------------------------------------------------------------
# Loop kernel
# ----------------------------------------------------------------------------
@njit(cache=True)
def _adpll_loop(r_true, r_comp, ref_mod, P, t_os, offset, cancel, comp_gain, comp_q,
                a, b, alpha, lp_order, lat, frac_scale, kdco, dnl_cum, dnl_c0,
                t_dco, t_ref, os_, sig_dco, sig_ref, seed, record, mc_p, mc_win, tdc_jit, bias):
    np.random.seed(seed)
    n = r_true.shape[0]
    out = np.empty(n * os_)
    trk = np.empty(n if record else 1)
    pe_rec = np.empty(n if record else 1)
    th = -bias * (P[P.shape[0] - 1] / (P.shape[0] - 1)) / t_dco
    lp = np.zeros(4)
    cnt = 0.0
    nd = dnl_cum.shape[0]
    fq = np.zeros(lat + 1)       # pipeline of DCO frequency words (latency)
    for k in range(n):
        dt = (r_true[k] - th) * t_dco - ref_mod[k]
        if sig_ref > 0:
            dt -= sig_ref * np.random.randn()
        if tdc_jit > 0:
            dt += tdc_jit * np.random.randn()
        sgn = 1.0 if dt >= 0 else -1.0
        tt = abs(dt) + t_os
        cntv = _tdc_count(tt, P) - offset
        if mc_p > 0:
            ring = P[P.shape[0] - 1]
            rem = tt - math.floor(tt / ring) * ring
            if (rem < mc_win or ring - rem < mc_win) and np.random.rand() < mc_p:
                cntv += (P.shape[0] - 1) if np.random.rand() < 0.5 else -(P.shape[0] - 1)
        pe = sgn * (cntv + 0.5)              # BB merged -> no dead zone
        if cancel:
            c = r_comp[k] * comp_gain
            pe -= math.floor(c / comp_q + 0.5) * comp_q
        pe -= bias
        x = pe
        for j in range(lp_order):
            lp[j] += alpha * (x - lp[j])
            x = lp[j]
        cnt += 1.0 if pe >= 0 else -1.0
        T = a * x + b * cnt
        Tq = math.floor(T * frac_scale) / frac_scale
        if nd > 1:
            u = Tq + dnl_c0
            i = int(math.floor(u))
            if i < 0:
                i = 0
            if i > nd - 2:
                i = nd - 2
            f_dev = kdco * (dnl_cum[i] + (u - i) * (dnl_cum[i + 1] - dnl_cum[i]) - dnl_cum[int(dnl_c0)])
        else:
            f_dev = kdco * Tq
        for j in range(lat, 0, -1):
            fq[j] = fq[j - 1]
        fq[0] = f_dev
        fa = fq[lat]
        for s in range(os_):
            th += fa * t_ref / os_
            if sig_dco > 0:
                th += sig_dco * np.random.randn()
            out[k * os_ + s] = th
        if record:
            trk[k] = T
            pe_rec[k] = pe
    return out, trk, pe_rec


def simulate(p: ADPLLParams, a=None, cal=None, r_extra=None, ref_mod=None, record=False):
    cal = cal or tdc_calibration(p)
    n = p.n_cyc
    r = dsm_sequence(p, n)
    r_true = r if r_extra is None else r + r_extra
    if ref_mod is None:
        ref_mod = np.zeros(n)
    if a is None:
        a = design_a(p, cal)
    P_run = tdc_positions(p, p.tau_drift)
    offset = tdc_count(p.t_os, P_run) if p.offset_track else cal["offset"]
    b = p.bb_step_hz / (p.kdco_est or p.kdco)
    alpha = 1 - math.exp(-2 * math.pi * p.lp_fc / p.f_ref)
    comp_gain = 2 * cal["dN"] / (p.M + p.F)
    if p.dco_dnl > 0:
        rng = np.random.default_rng(p.seed + 23)
        units = 1 + rng.normal(0, p.dco_dnl, 512)
        dnl_cum = np.concatenate(([0.0], np.cumsum(units)))
        dnl_c0 = 256.0
    else:
        dnl_cum = np.zeros(1)
        dnl_c0 = 0.0
    sig_dco = C.wiener_step_sigma(p.dco_L1M, 1e6, p.f_ref * p.os) if p.dco_L1M is not None else 0.0
    sig_ref = C.white_timing_sigma_from_floor(p.ref_floor, p.f_ref, p.f_ref) if p.ref_floor is not None else 0.0
    out, trk, pe = _adpll_loop(r_true, r, ref_mod.astype(np.float64), P_run, p.t_os, offset,
                               p.cancel, comp_gain, 2.0 ** -p.comp_frac_bits, a, b, alpha, p.lp_order,
                               p.extra_latency, 2.0 ** p.frac_bits, p.kdco, dnl_cum, dnl_c0,
                               p.t_dco, 1 / p.f_ref, p.os, sig_dco, sig_ref, p.seed + 5, record,
                               p.miscount_p, p.miscount_win, p.tdc_jit, p.phase_bias)
    return dict(theta=out[p.settle * p.os:], fs=p.f_ref * p.os, f_dco=p.f_dco, a=a, cal=cal,
                trk=trk, pe=pe, params=p)


def design_a(p: ADPLLParams, cal):
    if p.calibrated:
        return loop_gain_a(cal["tdc_gain"], p.kdco_est or p.kdco, p)
    nominal = ADPLLParams()
    return loop_gain_a(nominal.tau, nominal.kdco, p)


def estimate_dco_gain(p: ADPLLParams, a0, cal, dF=1 / 64, n=2 ** 15):
    """Paper Fig. 10.1.4: apply a preset divider change Delta F and read the
    change Delta I of the tracking word -> DCOgain = Delta F * Fref / Delta I."""
    q = replace(p, n_cyc=n, settle=0, dco_L1M=None, ref_floor=None, os=1)
    k0 = n // 2
    ramp = np.zeros(n)
    ramp[k0:] = dF * np.arange(n - k0)
    res = simulate(q, a=a0, cal=cal, r_extra=ramp, record=True)
    w = n // 8
    T0 = res["trk"][k0 - w: k0].mean()
    T1 = res["trk"][n - w:].mean()
    return dF * p.f_ref / (T1 - T0)


def full_calibration(p: ADPLLParams):
    """TDC offset/normalisation, DCO-gain measurement, then 'a'."""
    cal = tdc_calibration(p)
    nominal = ADPLLParams()
    a0 = loop_gain_a(nominal.tau, nominal.kdco, p)        # pre-calibration guess
    kd = estimate_dco_gain(p, a0, cal)
    a = loop_gain_a(cal["tdc_gain"], kd, p)
    return dict(cal=cal, kdco_est=kd, a=a, a0=a0)


# ----------------------------------------------------------------------------
# Linear models
# ----------------------------------------------------------------------------
def actual_loop_gain(p: ADPLLParams, a):
    """Per-sample open-loop gain G (true tau incl. drift, true kdco)."""
    tau_act = p.tau * (1 + p.tau_drift)
    return a * p.kdco * (1 / p.f_ref) * p.t_dco / tau_act


def closed_loop_H(f, p: ADPLLParams, a):
    z = np.exp(2j * np.pi * np.asarray(f, float) / p.f_ref)
    G = actual_loop_gain(p, a)
    alpha = 1 - math.exp(-2 * math.pi * p.lp_fc / p.f_ref)
    D = (alpha / (1 - (1 - alpha) / z)) ** p.lp_order
    L = G * D * z ** (-1 - p.extra_latency) / (1 - 1 / z)
    return L / (1 + L), L


def analytic_pn(f, p: ADPLLParams, a):
    H, L = closed_loop_H(f, p, a)
    H2 = np.abs(H) ** 2
    E2 = np.abs(1 / (1 + L)) ** 2
    wv = (2 * np.pi * p.f_dco) ** 2
    tau_act = p.tau * (1 + p.tau_drift)
    out = dict(tdc=10 * np.log10(wv * 2 * (tau_act ** 2 / 12) / p.f_ref * H2 / 2))
    if p.dco_L1M is not None:
        out["dco"] = p.dco_L1M + 20 * np.log10(1e6 / f) + 10 * np.log10(E2)
    if p.ref_floor is not None:
        s = C.white_timing_sigma_from_floor(p.ref_floor, p.f_ref, p.f_ref)
        out["ref"] = 10 * np.log10(wv * 2 * s ** 2 / p.f_ref * H2 / 2)
    out["total"] = 10 * np.log10(sum(10 ** (v / 10) for v in out.values()))
    return out


def measure_transfer(p: ADPLLParams, a, cal, freqs, amp=300e-12, n=2 ** 16):
    """Inject a sinusoidal reference phase modulation, lock-in the DCO timing."""
    q = replace(p, n_cyc=n, settle=0, dco_L1M=None, ref_floor=None, os=1)
    k = np.arange(n)
    Hs = []
    for fm in freqs:
        mod = amp * np.sin(2 * np.pi * fm * k / p.f_ref)
        res = simulate(q, a=a, cal=cal, ref_mod=mod)
        y = -res["theta"] * p.t_dco
        k0 = n // 4
        per = p.f_ref / fm
        m = int((n - k0) // per * per)
        kk = k[k0:k0 + m]
        yy = y[k0:k0 + m] - y[k0:k0 + m].mean()
        s = np.sin(2 * np.pi * fm * kk / p.f_ref)
        c = np.cos(2 * np.pi * fm * kk / p.f_ref)
        A = np.vstack([s, c, np.ones_like(s), kk - kk.mean()]).T
        coef = np.linalg.lstsq(A, yy, rcond=None)[0]
        Hs.append(complex(coef[0], coef[1]) / amp)
    return np.array(Hs)


def bw_from_transfer(freqs, Hs):
    """-3 dB frequency by log-interpolation of |H|."""
    mag = 20 * np.log10(np.abs(Hs))
    for i in range(1, len(freqs)):
        if mag[i] < -3 <= mag[i - 1]:
            x0, x1 = math.log10(freqs[i - 1]), math.log10(freqs[i])
            t = (-3 - mag[i - 1]) / (mag[i] - mag[i - 1])
            return 10 ** (x0 + t * (x1 - x0))
    return float("nan")


def bw_3db_analytic(p: ADPLLParams, a):
    f = np.logspace(3, 7, 4000)
    H, _ = closed_loop_H(f, p, a)
    mag = 20 * np.log10(np.abs(H))
    i = np.where(mag < -3)[0]
    return float(f[i[0]]) if len(i) else float("nan")


def unity_gain_bw(p: ADPLLParams, a):
    """First-order loop bandwidth G*Fref/(2 pi) -- the paper's 'BW'."""
    return actual_loop_gain(p, a) * p.f_ref / (2 * math.pi)
