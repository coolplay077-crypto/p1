"""Behavioural model of ISSCC 2025 paper 19.3 (MediaTek):
"A Fractional-N PLL with 34fs_rms Jitter and -255.5dB FoM Based on a Multipath
Feedback Technique" (C.-C. Hung, C.-H. Shen, C.-L. Lin, M. Tzou, K. Fong, Y.-L. Hsueh).

What the slides disclose and how it is modelled
-----------------------------------------------
* 80 MHz XO -> doubler (DBL) -> 160 MHz PFD rate; VCO 7.3-9.5 GHz, measured at VCO/2.
* Multipath feedback (slides 8-11): P = log2(M) PSEL bits, P+1 PFD/CP slices with
  currents Icp/2, Icp/4, ..., Icp/M, Icp/M.  The digital macro (MASH 1-1-1 + integrator
  with carry) produces PSEL and N_MMD; multipath retimers (VCO-clocked DFFs + MUX) give
  each slice CK_MMD or CK_MMD + 1*T_VCO.  This is the binary slicing of US 11,509,315
  (FIG. 13), so the arithmetic is taken from `sliced_cp.build_sequences(arch='binary')`
  -- the equivalence is checked exactly in the run script.
* CP with switched-capacitor offset charge Q_OFST = C_OFST*VDD (slides 16-20): the CP
  pulses are one-signed (locked phase error = T_fix), the offset charge comes from a
  capacitor instead of a bleed current; charge is re-distributed to C1 once per cycle.
  Both offset styles ('sc', 'bleed') are modelled for noise; the ripple/reference-spur
  consequence is evaluated with an exact periodic-steady-state Fourier analysis
  (`ref_spur_from_waveform`).
* Dual-core inverse-class-F VCO: not modelled at circuit level; its *measured*
  free-running phase noise (slide 27 markers, incl. 1/f^3) is fitted and synthesised.
* Reference: lumped input-referred timing noise (XO close-in + white floor of
  XO/DBL/PFD/CP), split into a common part and a per-slice part.

Simulation kernel: per-PFD-cycle, exact state-space LPF/VCO (common.cp_state_space),
os sub-steps, per-slice charge from each slice's own edge time (so slice mismatch,
skews, retimer slips and CP non-linearity act on the real pulses), VCO noise added as
a synthesised free-running phase sequence.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace

import numpy as np
from numba import njit
from scipy.optimize import least_squares

from . import common as C
from . import sliced_cp as S

# ----------------------------------------------------------------------------
# Measured data read from the slides (all at the VCO/2 output, 4.75 GHz)
# ----------------------------------------------------------------------------
VCO_FREE_MARKERS = [  # slide 27, Keysight E5052B, carrier 4.749946786 GHz
    (10e3, -78.0650), (30e3, -92.4956), (40e3, -96.4078), (100e3, -107.8466),
    (300e3, -120.6436), (402.394e3, -123.7768), (1e6, -132.5933), (3e6, -142.1514),
    (10e6, -150.8349), (40e6, -155.5872)]
PLL_MARKERS = [  # slide 29, closed loop, carrier 4.750118943 GHz, jitter 33.782 fs (10k-100M)
    (10e3, -115.1223), (30e3, -121.1841), (40e3, -121.8444), (100e3, -122.6283),
    (300e3, -123.3384), (402.394e3, -124.2386), (1e6, -128.4607), (3e6, -139.8124),
    (10e6, -147.7038), (40e6, -154.8702)]
PLL_SPUR_MARKERS = [  # slide 30, with close-in fractional spur, jitter 37.686 fs
    (10e3, -115.5054), (30e3, -120.8800), (40e3, -121.5728), (100e3, -122.1982),
    (300e3, -123.3900), (1e6, -128.2228), (3e6, -139.7116), (10e6, -147.7191), (40e6, -153.8736)]
SPUR_AT_402K_DBC = -70.8805
# slide 29, light trace "w/o multi-path feedback technique", digitised from the screenshot
# (+-1.5 dB reading accuracy; 1-2 MHz region partly hidden by labels)
PLL_NO_MP_DIGITISED = [(20e3, -117.9), (30e3, -120.2), (50e3, -121.1), (100e3, -121.6),
                       (200e3, -122.5), (2e6, -133.5), (3e6, -135.5), (5e6, -137.0),
                       (10e6, -138.1), (20e6, -139.3), (30e6, -141.5), (50e6, -147.2), (70e6, -151.9)]
# slide 30 right: fractional spur at VCO/2 vs "Frac. Value" (offset = frac * 160 MHz), digitised
FRAC_SPUR_DIGITISED = [(6.1e-5, -74.2), (1.25e-4, -73.9), (2.5e-4, -73.3), (5e-4, -71.9),
                       (6.1e-4, -71.1), (1.22e-3, -70.3), (2.44e-3, -71.1), (3.9e-3, -72.5),
                       (4.9e-3, -72.6), (6.1e-3, -73.8), (1.22e-2, -84.6), (2.44e-2, -89.3)]
PAPER = dict(jitter_fs=33.782, jitter_spur_fs=37.686, power_mw=24.4, fom=-255.5, fom_spur=-254.6,
             fomn=-276.3, fomn_spur=-275.3, ref_spur_dbc=-101.0, frac_spur_dbc_vco=-64.8,
             inband_100k_norm_9g5=-116.7, vco_pn_1m_9g5=-126.59, vco_power_mw=15.4,
             vco_fom=194.3, vco_fomt=200.23, vco_tr_pct=20.0, f_xo=80e6, f_vco_max=9.5e9,
             area_mm2=0.39, cp_mismatch_3sigma=0.005, folded_inband_claim=-127.0)


# ----------------------------------------------------------------------------
# VCO noise: fit a3/f^3 + a2/f^2 + a0 (linear PSD) to the free-running markers
# ----------------------------------------------------------------------------
def fit_vco(markers=VCO_FREE_MARKERS):
    f = np.array([m[0] for m in markers])
    L = np.array([m[1] for m in markers])

    def model(p, f):
        a3, a2, a0 = 10.0 ** p
        return 10 * np.log10(a3 / f ** 3 + a2 / f ** 2 + a0)

    r = least_squares(lambda p: model(p, f) - L, x0=[4.0, -1.3, -15.6])
    a3, a2, a0 = 10.0 ** r.x
    resid = model(r.x, f) - L
    return dict(a3=a3, a2=a2, a0=a0, rms_err_db=float(np.sqrt(np.mean(resid ** 2))),
                max_err_db=float(np.max(np.abs(resid))), corner_hz=a3 / a2)


def vco_L(f, vf, include_floor=True, scale_db=0.0):
    """Free-running VCO L(f) [dBc/Hz]; scale_db=+6.02 converts VCO/2 -> VCO."""
    lin = vf["a3"] / f ** 3 + vf["a2"] / f ** 2 + (vf["a0"] if include_floor else 0.0)
    return 10 * np.log10(lin) + scale_db


def synth_phase(L_func, fs, n, seed, fmin=None):
    """Gaussian phase sequence (cycles) whose one-sided PSD is 2*L(f) rad^2/Hz."""
    rng = np.random.default_rng(seed)
    f = np.fft.rfftfreq(n, 1 / fs)
    fmin = fmin or 2 * fs / n
    ff = np.maximum(f, fmin)
    S = 2 * 10 ** (L_func(ff) / 10)             # rad^2/Hz one-sided
    amp = np.sqrt(S * fs * n / 4)               # |X_k| scaling for rfft
    X = amp * (rng.normal(size=f.size) + 1j * rng.normal(size=f.size))
    X[0] = 0
    if n % 2 == 0:
        X[-1] = X[-1].real * math.sqrt(2)
    x = np.fft.irfft(X, n)
    return x / (2 * math.pi)


# ----------------------------------------------------------------------------
@dataclass
class MP19p3Params:
    # frequency plan (slide 32: 80 MHz x 2, 7.3-9.5 GHz; slide 29 carrier 4.750118943 GHz)
    f_xo: float = 80e6
    dbl: bool = True
    N: int = 59
    K: int = int(round(0.376486791 * 2 ** 24))
    Q: int = 2 ** 24
    dither: bool = True
    M: int = 4                    # multipath level (P = log2 M); M = 1 -> conventional
    # loop (assumptions, fc/pm fitted to slide-29 markers by fit_loop())
    icp: float = 2e-3
    kvco: float = 150e6
    fc: float = 1.7e6
    pm: float = 55.0
    p3_ratio: float = 6.0
    c3_ratio: float = 0.1
    # CP linearisation
    t_nonlin: float = 50e-12      # CP non-linear region (slide 12 'T_nonlin'), also the min pulse
    t_off: float | None = None    # None -> automatic from DSM spread + t_nonlin
    offset_mode: str = "sc"       # 'sc' (switched-cap Q_OFST) or 'bleed' (current source)
    vdd: float = 0.8
    beta: float = 0.0             # UP/DN mismatch (only matters if pulses change sign)
    nonlin_gain: float = 0.0      # charge deficit inside T_nonlin: q = I*(e - g*Tn*(1-e/Tn)^2/2) for e<Tn
    # slice mismatch / timing
    eps: tuple | None = None
    post_skew: tuple | None = None
    dt1: float = 0.0
    retimed: bool = True
    rt_margin: float = 1.0
    rt_sigma: float = 0.0
    # noise (absolute, physical; ref_white_fs and xo_flicker are fitted to slide-29 markers)
    vco_on: bool = True
    out_floor_on: bool = True
    ref_white_fs: float = 250e-15      # common white timing noise per PFD edge (XO floor + DBL + ...)
    pfd_slice_fs: float = 60e-15       # independent jitter of each PFD/retimer slice (assumption)
    cp_noise_on: bool = True           # CP thermal noise, 16kT*gamma*Icp/Vov, on-time model
    cp_vov: float = 0.25
    cp_noise_scale: float = 1.0        # excess-noise multiplier on the thermal CP PSD (fitted)
    cp_flicker_fc: float = 0.0         # CP 1/f corner [Hz]; flicker also scales with on-time (fitted)
    xo_flicker_fs2: float = 0.0        # close-in reference noise: S_t(f) = xo_flicker * (1e4/f)^2 [s^2/Hz]
    # sim
    os: int = 2
    n_cyc: int = 2 ** 20
    settle: int = 2 ** 14
    seed: int = 11

    @property
    def f_pfd(self):
        return self.f_xo * (2 if self.dbl else 1)

    @property
    def nf(self):
        return self.N + self.K / self.Q

    @property
    def f_vco(self):
        return self.nf * self.f_pfd

    @property
    def t_vco(self):
        return 1 / self.f_vco

    def sliced(self):
        """Equivalent SlicedCPParams (arithmetic only)."""
        return S.SlicedCPParams(f_ref=self.f_pfd, N=self.N, K=self.K, Q=self.Q, dither=self.dither,
                                arch="conv" if self.M == 1 else "binary", X=self.M,
                                n_cyc=self.n_cyc, settle=self.settle, seed=self.seed)


def loop_filter(p: MP19p3Params):
    return C.design_cp_filter(p.icp, p.kvco, p.nf, p.fc, p.pm, p.p3_ratio, p.c3_ratio)


def auto_t_off(p: MP19p3Params, seq):
    rel = seq["r1"][:, None] + seq["d"] - seq["r_eff"].mean()
    return float(p.t_nonlin - rel.min() * p.t_vco)


def slide12_spread(seq, p):
    """Peak-to-peak time spread (in T_VCO) of the coarse slice and of the effective edge."""
    r1 = seq["r1"] - seq["r_eff"].mean()
    return dict(coarse_pp=float(r1.max() - r1.min()),
                eff_pp=float(seq["r_eff"].max() - seq["r_eff"].min()),
                all_slices_pp=float((seq["r1"][:, None] + seq["d"]).max() - (seq["r1"][:, None] + seq["d"]).min()))


# ----------------------------------------------------------------------------
@njit(cache=True)
def _mp_loop(r1, d, w_act, w_nom, post_skew, path_skew, retimed, rt_margin, rt_sigma,
             t_vco, icp, beta, t_nonlin, nonlin_gain, ib, q_ofst, sc_mode, Phi, Gam, b2, os_,
             ref_t, sig_slice, sicp, var_ofst, phi_vco, theta0, seed):
    np.random.seed(seed)
    n = r1.shape[0]
    M = d.shape[1]
    nw = w_act.shape[0]
    z = np.zeros(4)
    zn = np.zeros(4)
    z[3] = theta0
    out = np.empty(n * os_)
    emin = np.full(M, 1e9)
    emax = np.full(M, -1e9)
    esum = np.zeros(M)
    slips = 0
    up = 1.0 + 0.5 * beta
    dn = 1.0 - 0.5 * beta
    i_const = -ib if not sc_mode else 0.0
    for k in range(n):
        th = z[3] + phi_vco[k * os_]
        kw = k if nw > 1 else 0
        q = 0.0
        for i in range(M):
            di = d[k, i]
            ex = post_skew[i]
            if sig_slice > 0:
                ex += sig_slice * np.random.randn()
            if retimed:
                m = rt_margin - path_skew[i, di]
                if rt_sigma > 0:
                    m += rt_sigma * np.random.randn()
                if m < 0:
                    di += 1
                    slips += 1
            else:
                ex += path_skew[i, di]
            e = (r1[k] + di - th) * t_vco + ex - ref_t[k]
            I = w_act[kw, i] * icp
            if e >= 0:
                ee = e
                if nonlin_gain > 0 and e < t_nonlin:
                    ee = e - nonlin_gain * t_nonlin * (1 - e / t_nonlin) ** 2 * 0.5
                qi = I * up * ee
            else:
                qi = I * dn * e
            if sicp > 0:
                qi += math.sqrt(sicp * w_nom[i] * (abs(e) + t_nonlin) * 0.5) * np.random.randn()
            q += qi
            if e < emin[i]:
                emin[i] = e
            if e > emax[i]:
                emax[i] = e
            esum[i] += e
        if sc_mode:
            q -= q_ofst
        if var_ofst > 0:
            q += math.sqrt(var_ofst) * np.random.randn()
        z[1] += b2 * q
        for s in range(os_):
            for r in range(4):
                acc = Gam[r] * i_const
                for c in range(4):
                    acc += Phi[r, c] * z[c]
                zn[r] = acc
            for r in range(4):
                z[r] = zn[r]
            out[k * os_ + s] = z[3] + phi_vco[k * os_ + s]
    return out, emin, emax, esum / n, slips


def cp_noise_psd(p: MP19p3Params):
    """Thermal noise PSD [A^2/Hz] of the full CP (UP+DN), 4kT*gamma*gm, gm = 2I/Vov."""
    kT = 1.380649e-23 * 300
    return 2 * 4 * kT * (2 * p.icp / p.cp_vov)


def offset_noise_var(p: MP19p3Params, t_off, mode=None):
    """Per-cycle charge-noise variance [C^2] of the CP offset source."""
    mode = mode or p.offset_mode
    q_ofst = p.icp * t_off
    kT = 1.380649e-23 * 300
    if mode == "sc":
        c_ofst = q_ofst / p.vdd
        return 2 * kT * c_ofst           # reset (kT/C) noise of charge + re-distribution
    ib = q_ofst * p.f_pfd
    s_i = 4 * kT * 1.0 * (2 * ib / 0.25)  # bleed current source thermal noise
    return s_i * (1 / p.f_pfd) * 0.5


def simulate(p: MP19p3Params, seq=None, return_seq=False):
    sp = p.sliced()
    seq = seq if seq is not None else S.build_sequences(sp)
    w = seq["w"]
    M = len(w)
    lf = loop_filter(p)
    T = 1 / p.f_pfd
    Phi, Gam, b = C.cp_state_space(lf, p.kvco, T / p.os)
    t_off = p.t_off if p.t_off is not None else auto_t_off(p, seq)
    eps = np.zeros(M) if p.eps is None else np.asarray(p.eps, float)
    w_act = (w * (1 + eps))[None, :]
    post = np.zeros(M) if p.post_skew is None else np.asarray(p.post_skew, float)
    path = np.zeros((M, p.M + 2))
    if M > 1:
        path[1:, 0] = p.dt1
    wsum = float(w_act.sum())
    q_ofst = p.icp * wsum * t_off
    ib = q_ofst * p.f_pfd
    sicp = cp_noise_psd(p) * p.cp_noise_scale if p.cp_noise_on else 0.0
    n = p.n_cyc
    rng = np.random.default_rng(p.seed + 3)
    ref_t = p.ref_white_fs * rng.normal(size=n) if p.ref_white_fs > 0 else np.zeros(n)
    if p.xo_flicker_fs2 > 0:
        # synth_phase returns x/(2 pi) where x has one-sided PSD 2*10^(L/10): ask for S_t(f)
        ref_t = ref_t + 2 * math.pi * synth_phase(
            lambda f: 10 * np.log10(p.xo_flicker_fs2 * (1e4 / f) ** 2 / 2), p.f_pfd, n, p.seed + 5, fmin=1e3)
    if p.cp_noise_on and p.cp_flicker_fc > 0:
        var_cp_t = sicp * (t_off + p.t_nonlin) * 0.5 / p.icp ** 2
        ref_t = ref_t + 2 * math.pi * synth_phase(
            lambda f: 10 * np.log10(2 * var_cp_t / p.f_pfd * (p.cp_flicker_fc / f) / 2), p.f_pfd, n, p.seed + 6,
            fmin=1e3)
    vf = fit_vco()
    if p.vco_on:
        phi = synth_phase(lambda f: vco_L(f, vf, include_floor=False, scale_db=20 * math.log10(p.f_vco / 4.75e9)),
                          p.f_pfd * p.os, n * p.os, p.seed + 9, fmin=500.0)
    else:
        phi = np.zeros(n * p.os)
    var_ofst = offset_noise_var(p, t_off) if p.cp_noise_on else 0.0
    theta0 = float(seq["r_eff"].mean() - t_off / p.t_vco)
    out, emin, emax, emean, slips = _mp_loop(
        seq["r1"].astype(np.float64), seq["d"], w_act.astype(np.float64), w.astype(np.float64), post, path,
        p.retimed, p.rt_margin, p.rt_sigma, p.t_vco, p.icp, p.beta, p.t_nonlin, p.nonlin_gain, ib, q_ofst,
        p.offset_mode == "sc", Phi, Gam, b[1], p.os, ref_t, p.pfd_slice_fs, sicp, var_ofst, phi, theta0,
        p.seed + 7)
    res = dict(theta=out[p.settle * p.os:], fs=p.f_pfd * p.os, f_vco=p.f_vco, emin=emin, emax=emax,
               emean=emean, slips=int(slips), t_off=t_off, lf=lf, params=p, vf=vf)
    if return_seq:
        res["seq"] = seq
    return res


def output_pn(res, nperseg=2 ** 17, out_div=2):
    """L(f) at the VCO/out_div output, adding the fitted output (buffer/divider) floor."""
    p = res["params"]
    f, L = C.phase_noise(res["theta"], res["fs"], nperseg=nperseg)
    L = L - 20 * math.log10(out_div)
    if p.out_floor_on:
        L = 10 * np.log10(10 ** (L / 10) + res["vf"]["a0"])
    return f, L


# ----------------------------------------------------------------------------
# Linear analytic model (cross-check + fast fitting)
# ----------------------------------------------------------------------------
def analytic_pn(f, p: MP19p3Params, t_off=None, out_div=2):
    f = np.asarray(f, float)
    lf = loop_filter(p)
    Lg = C.cp_open_loop(f, p.icp, p.kvco, p.nf, lf)
    H2 = np.abs(Lg / (1 + Lg)) ** 2
    E2 = np.abs(1 / (1 + Lg)) ** 2
    vf = fit_vco()
    X = p.M
    w = p.sliced().slices()
    sc = -20 * math.log10(out_div)
    wv = (2 * np.pi * p.f_vco) ** 2
    out = {}
    S_r = (1 / X ** 2) / 12 * (2 / p.f_pfd) * np.abs(2 * np.sin(np.pi * f / p.f_pfd)) ** 4
    out["sdm"] = 10 * np.log10((2 * np.pi) ** 2 * S_r * H2 / 2) + sc
    if p.vco_on:
        out["vco"] = vco_L(f, vf, include_floor=False, scale_db=20 * math.log10(p.f_vco / 4.75e9)) + 10 * np.log10(E2) + sc
    seq = S.build_sequences(replace(p.sliced(), n_cyc=2 ** 14))
    t_off = t_off if t_off is not None else auto_t_off(p, seq)
    parts = cp_inband_parts(p, t_off)
    for key, var in parts.items():
        if var > 0:
            out[key] = 10 * np.log10(wv * 2 * var / p.f_pfd * H2 / 2) + sc
    if p.cp_noise_on and p.cp_flicker_fc > 0:
        out["cp_flicker"] = out["cp"] + 10 * np.log10(p.cp_flicker_fc / f)
    if p.xo_flicker_fs2 > 0:
        out["ref_flicker"] = 10 * np.log10(wv * p.xo_flicker_fs2 * (1e4 / f) ** 2 * H2 / 2) + sc
    if p.out_floor_on:
        out["out_floor"] = 10 * np.log10(np.full_like(f, vf["a0"]))
    out["total"] = 10 * np.log10(sum(10 ** (v / 10) for v in out.values()))
    return out


def cp_inband_parts(p: MP19p3Params, t_off):
    """Per-PFD-edge white timing variances [s^2] of the in-band sources.
    CP: sum_i S*w_i*(e_i + T_nl)/2 = S*(T_off + T_nl)/2 because sum w_i e_i = T_off."""
    w = p.sliced().slices()
    out = dict(ref_common=p.ref_white_fs ** 2, pfd_slice=p.pfd_slice_fs ** 2 * float(np.sum(w ** 2)))
    if p.cp_noise_on:
        out["cp"] = cp_noise_psd(p) * p.cp_noise_scale * (t_off + p.t_nonlin) * 0.5 / p.icp ** 2
        out["cp_offset"] = offset_noise_var(p, t_off) / p.icp ** 2
    return out


def fit_loop(p: MP19p3Params, markers=PLL_MARKERS, free=("fc", "pm", "ref_white_fs", "xo_flicker_fs2")):
    """Least-squares fit of loop/in-band parameters to the closed-loop PN markers
    (analytic model, VCO noise fixed by the free-running fit)."""
    f = np.array([m[0] for m in markers])
    L = np.array([m[1] for m in markers])
    scale = dict(fc=1e6, pm=10.0, ref_white_fs=1e-13, xo_flicker_fs2=1e-30)
    x0 = [getattr(p, k) / scale[k] if getattr(p, k) > 0 else 1.0 for k in free]

    def make(x):
        kw = {k: float(abs(v)) * scale[k] for k, v in zip(free, x)}
        kw["pm"] = min(max(kw.get("pm", p.pm), 30.0), 75.0)
        return replace(p, **kw)

    def resid(x):
        q = make(x)
        return analytic_pn(f, q)["total"] - L

    r = least_squares(resid, x0=x0, x_scale="jac")
    q = make(r.x)
    res = resid(r.x)
    return q, dict(rms_err_db=float(np.sqrt(np.mean(res ** 2))), max_err_db=float(np.max(np.abs(res))),
                   resid=[float(x) for x in res])


FIT_SCALE = dict(fc=1e6, pm=10.0, ref_white_fs=1e-13, xo_flicker_fs2=1e-32, p3_ratio=1.0,
                 cp_noise_scale=1.0, cp_flicker_fc=1e5)
FIT_BOUNDS = dict(fc=(0.2e6, 3e6), pm=(30.0, 80.0), ref_white_fs=(0.0, 1e-12), xo_flicker_fs2=(0.0, 1e-30),
                  p3_ratio=(2.0, 40.0), cp_noise_scale=(0.0, 50.0), cp_flicker_fc=(0.0, 5e6))


def fit_joint(p: MP19p3Params, free, data):
    """Weighted least squares over several data sets.
    data: list of (params_overrides, markers, weight).  The same physical parameters
    are shared; e.g. ({}, PLL_MARKERS, 1.0) and ({'M': 1}, PLL_NO_MP_DIGITISED, 0.5)."""
    lo = [FIT_BOUNDS[k][0] / FIT_SCALE[k] for k in free]
    hi = [FIT_BOUNDS[k][1] / FIT_SCALE[k] for k in free]
    x0 = [min(max(getattr(p, k) / FIT_SCALE[k], l + 1e-6), h - 1e-6) for k, l, h in zip(free, lo, hi)]

    def make(x):
        return replace(p, **{k: float(v) * FIT_SCALE[k] for k, v in zip(free, x)})

    def resid(x):
        q = make(x)
        rs = []
        for over, markers, wgt in data:
            f = np.array([m[0] for m in markers])
            L = np.array([m[1] for m in markers])
            rs.append(wgt * (analytic_pn(f, replace(q, **over))["total"] - L))
        return np.concatenate(rs)

    r = least_squares(resid, x0=x0, bounds=(lo, hi), x_scale="jac")
    q = make(r.x)
    per = []
    for over, markers, wgt in data:
        f = np.array([m[0] for m in markers])
        L = np.array([m[1] for m in markers])
        e = analytic_pn(f, replace(q, **over))["total"] - L
        per.append(dict(overrides=over, rms_err_db=float(np.sqrt(np.mean(e ** 2))), max_err_db=float(np.max(np.abs(e))),
                        resid=[round(float(v), 2) for v in e]))
    return q, per


# ----------------------------------------------------------------------------
# Reference spur from the periodic CP/offset current waveform (ripple)
# ----------------------------------------------------------------------------
def ref_spur_from_waveform(p: MP19p3Params, charges, f_period, n_harm=4):
    """charges: list of (time_in_period [s], charge [C]) impulses (+ 'const' current entries
    as (None, I)).  Returns SSB spurs [dBc] at harmonics of f_period, at the VCO."""
    lf = loop_filter(p)
    T = 1 / f_period
    out = []
    for h in range(1, n_harm + 1):
        fh = h * f_period
        c = 0j
        for t, qv in charges:
            if t is None:      # constant current contributes only at DC
                continue
            c += qv / T * np.exp(-2j * np.pi * h * t / T)
        v = abs(C.lf_transimpedance(fh, lf) * c) * 2      # amplitude of the voltage tone
        beta = p.kvco * v / fh                              # FM index
        out.append(dict(harmonic=h, f=fh, spur_dbc=float(20 * np.log10(beta / 2 + 1e-300))))
    return out


def pulse_charges(t0, width, I, n=64):
    """Discretised rectangular current pulse as impulses."""
    ts = t0 + (np.arange(n) + 0.5) * width / n
    return [(float(t), I * width / n) for t in ts]
