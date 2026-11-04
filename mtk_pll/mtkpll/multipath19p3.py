"""Behavioural model of ISSCC 2025 paper 19.3 (MediaTek):
"A Fractional-N PLL with 34fs_rms Jitter and -255.5dB FoM Based on a Multipath
Feedback Technique" (C.-C. Hung, C.-H. Shen, C.-L. Lin, M. Tzou, K. Fong, Y.-L. Hsueh),
which is the silicon realisation of MediaTek patent US 11,509,315 B2 (binary slicing,
FIG. 11/13; common inventor Y.-L. Hsueh).

What the slides disclose and how it is modelled
-----------------------------------------------
* 80 MHz XO -> doubler (DBL) -> 160 MHz PFD rate; VCO 7.3-9.5 GHz, measured at VCO/2.
* Multipath feedback (slides 8-11): P = log2(M) PSEL bits, P+1 PFD/CP slices with currents
  Icp/2, Icp/4, ..., Icp/M, Icp/M.  Slide PSEL[k] carries weight 2^-(k+1) (MSB-first index);
  the model's B bit (P-1-k) maps to it.  Each slice receives CK_MMD or CK_MMD + 1*T_VCO
  (two shared VCO-clocked DFFs produce CK_RETIME(0)/(1), a MUX per slice, an output retiming
  DFF per slice).
* Digital macro: taken from US 11,509,315 (fine-resolution MASH -> {D_N, D_f} ->
  accumulator -> PSEL, carry -> N_MMD).  The slide-8 drawing is not self-consistent as drawn;
  a literal "coarse MASH + truncated error integrator" reading would leave an unshaped
  T_VCO/(M*sqrt 12) error (~ -89 dBc/Hz in-band), contradicting slide 29.
* CP (slides 16-20): only an I_DN current source is switched; the opposite charge Q_OFST =
  C_OFST*VDD comes from a capacitor through M2; the UP/DN charges are held on C_UP/C_DN and
  re-distributed onto C1 once per cycle (sample-and-hold).  Modelled: DN-only per-slice charge
  (pulses of the wrong sign are clipped), thermal noise 4kT*gamma*gm of I_DN over the pulse width,
  CP flicker that scales with (on-time)^2, kT/C offset-charge noise, optional C_DN charge
  compression and a soft-start (T_nonlin) charge law.
* VCO: measured free-running phase noise (slide-27 markers, incl. 1/f^3) is fitted and synthesised;
  its frequency dependence is taken from the slide-27 'PN at 1 MHz vs F_VCO/2' plot.

Measured data are read from the slides; digitised curves carry ~ +-0.5..1.5 dB reading error.
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
# Measured data (all PN at the VCO/2 output unless stated)
# ----------------------------------------------------------------------------
VCO_FREE_MARKERS = [  # slide 27, E5052B markers, carrier 4.749946786 GHz
    (10e3, -78.0650), (30e3, -92.4956), (40e3, -96.4078), (100e3, -107.8466),
    (300e3, -120.6436), (402.394e3, -123.7768), (1e6, -132.5933), (3e6, -142.1514),
    (10e6, -150.8349), (40e6, -155.5872)]
PLL_MARKERS = [  # slide 29, closed loop, carrier 4.750118943 GHz, jitter 33.782 fs (10k-100M)
    (10e3, -115.1223), (30e3, -121.1841), (40e3, -121.8444), (100e3, -122.6283),
    (300e3, -123.3384), (402.394e3, -124.2386), (1e6, -128.4607), (3e6, -139.8124),
    (10e6, -147.7038), (40e6, -154.8702)]
PLL_SPUR_MARKERS = [  # slide 30, another channel with a close-in fractional spur, jitter 37.686 fs
    (10e3, -115.5054), (30e3, -120.8800), (40e3, -121.5728), (100e3, -122.1982),
    (300e3, -123.3900), (1e6, -128.2228), (3e6, -139.7116), (10e6, -147.7191), (40e6, -153.8736)]
SPUR_AT_402K_DBC = -70.8805
# slide 29 light trace 'w/o multi-path feedback technique'.  9k-300k: pixel extraction (light-blue
# mask, +0.6 dB calibration from the dark trace vs its exact markers, +-1 dB); 2-10 MHz: read by eye
# (the gray 'Technique' label covers ~4-12 MHz, +-1.5 dB); 20-70 MHz: pixel extraction.
PLL_NO_MP_DIGITISED = [
    (9e3, -110.6), (11e3, -112.0), (12e3, -112.5), (14e3, -113.7), (16e3, -114.7), (18e3, -115.4),
    (25e3, -117.5), (30e3, -118.2), (40e3, -119.7), (50e3, -120.6), (70e3, -120.7), (100e3, -120.9),
    (150e3, -121.3), (200e3, -121.4), (300e3, -121.8), (2e6, -133.5), (3e6, -135.5), (5e6, -137.0),
    (10e6, -138.1), (20e6, -138.4), (30e6, -140.9), (50e6, -146.1), (70e6, -150.7)]
# slide 30 right: fractional spur at VCO/2; x = spur offset (frac value x 160 MHz).  The plotted
# x positions correspond to round offsets 10k..4M (the 400 kHz point equals the slide-30 marker).
FRAC_SPUR_OFFSETS = [(10e3, -74.2), (20e3, -73.9), (40e3, -73.3), (80e3, -71.9), (100e3, -71.1),
                     (200e3, -70.3), (400e3, -71.1), (600e3, -72.5), (800e3, -72.6), (1e6, -73.8),
                     (2e6, -84.6), (4e6, -89.3)]
# slide 29 left: rms jitter (10k-100M) vs VCO frequency [MHz, fs]
JITTER_VS_FVCO = [(7937, 32.6), (8266, 32.7), (8533, 33.3), (8797, 33.6), (9064, 33.9), (9336, 33.7), (9501, 33.8)]
JITTER_SPUR_VS_FVCO = [(7996, 37.4), (8319, 37.1), (8484, 36.7), (8797, 36.4), (9117, 36.5), (9281, 37.2), (9442, 37.7)]
# slide 27 right: VCO PN at 1 MHz (at VCO/2) vs F_VCO/2 [MHz, dBc/Hz]
VCO_PN1M_VS_F = [(3954, -134.3), (4102, -135.0), (4200, -134.4), (4301, -134.1), (4401, -133.7),
                 (4501, -133.6), (4602, -133.3), (4700, -133.0), (4802, -132.5)]
PAPER = dict(jitter_fs=33.782, jitter_spur_fs=37.686, power_mw=24.4, fom=-255.5, fom_spur=-254.6,
             fomn=-276.3, fomn_spur=-275.3, ref_spur_dbc=-101.0, frac_spur_dbc_vco=-64.8,
             inband_100k_norm_9g5=-116.7, vco_pn_1m_9g5=-126.59, vco_power_mw=15.4,
             vco_fom=194.3, vco_fomt=200.23, vco_tr_pct=20.0, f_xo=80e6, f_vco_max=9.5e9,
             area_mm2=0.39, cp_mismatch_3sigma=0.005, folded_inband_claim=-127.0)


# ----------------------------------------------------------------------------
# VCO noise
# ----------------------------------------------------------------------------
def fit_vco(markers=VCO_FREE_MARKERS):
    """a3/f^3 + a2/f^2 + a0 (linear PSD, at VCO/2 = 4.75 GHz) fitted to the slide-27 markers."""
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


_VF = None


def vco_fit_cached():
    global _VF
    if _VF is None:
        _VF = fit_vco()
    return _VF


def vco_L(f, vf, include_floor=True, scale_db=0.0):
    lin = vf["a3"] / f ** 3 + vf["a2"] / f ** 2 + (vf["a0"] if include_floor else 0.0)
    return 10 * np.log10(lin) + scale_db


def vco_freq_adj_db(f_vco):
    """Deviation of the measured VCO PN at f_vco from constant-FoM scaling of the 4.75 GHz data."""
    x = np.array([v[0] for v in VCO_PN1M_VS_F]) * 1e6
    y = np.array([v[1] for v in VCO_PN1M_VS_F])
    L_at = float(np.interp(f_vco / 2, x, y))
    L_ref = float(np.interp(4.75e9, x, y))
    return (L_at - L_ref) - 20 * math.log10((f_vco / 2) / 4.75e9)


def synth_phase(L_func, fs, n, seed, fmin=None):
    """Gaussian sequence x/(2 pi) where x has one-sided PSD 2*10^(L(f)/10) (i.e. phase in cycles)."""
    rng = np.random.default_rng(seed)
    f = np.fft.rfftfreq(n, 1 / fs)
    fmin = fmin or 2 * fs / n
    ff = np.maximum(f, fmin)
    S_ = 2 * 10 ** (L_func(ff) / 10)
    amp = np.sqrt(S_ * fs * n / 4)
    X = amp * (rng.normal(size=f.size) + 1j * rng.normal(size=f.size))
    X[0] = 0
    if n % 2 == 0:
        X[-1] = X[-1].real * math.sqrt(2)
    return np.fft.irfft(X, n) / (2 * math.pi)


# ----------------------------------------------------------------------------
@dataclass
class MP19p3Params:
    # frequency plan
    f_xo: float = 80e6
    dbl: bool = True
    N: int = 59
    K: int = int(round(0.376486791 * 2 ** 24))
    Q: int = 2 ** 24
    dither: bool = True
    M: int = 4                    # multipath level; M = 1 -> single coarse path
    mp_disabled: bool = False     # True: keep the P+1 physical slices but PSEL = 0 and a coarse SDM
    psel_late: bool = False       # PSEL applied one PFD cycle late (latency/race failure)
    # loop (assumptions; fc/pm/p3 fitted to slide-29 markers)
    icp: float = 2e-3
    kvco: float = 150e6
    fc: float = 0.6e6
    pm: float = 65.0
    p3_ratio: float = 10.0
    c3_ratio: float = 0.1
    lf_override: dict | None = None   # frozen loop-filter component values (frequency sweeps)
    # CP linearisation
    t_nonlin: float = 50e-12      # CP soft-start region (slide-12 'T_nonlin'); auto T_off keeps pulses >= it
    t_off: float | None = None    # None -> auto (DSM spread + T_nonlin, no PVT margin)
    offset_mode: str = "sc"       # 'sc' (switched-cap Q_OFST, DN-only CP) | 'bleed' (bidirectional CP + bleed)
    vdd: float = 0.8
    beta: float = 0.0             # UP/DN mismatch, bleed mode only
    nonlin_ramp: bool = False     # current ramps linearly over T_nonlin: q = I*e^2/(2Tn) (e<Tn), I*(e-Tn/2)
    c_dn_va: float = math.inf     # C_DN*V_A of a unit (=Icp) slice [F*V]: q = C(1-exp(-I e / C)), C = w*c_dn_va
    # slice mismatch / timing
    eps: tuple | None = None
    post_skew: tuple | None = None
    dt1: float = 0.0
    retimed: bool = True
    rt_margin: float = 1.0        # [s]; large -> never slips
    rt_sigma: float = 0.0
    rt_shared: bool = False       # slip happens in the shared first DFF (moves all slices by 1 T)
    # noise (absolute)
    vco_on: bool = True
    vco_scale_db: float = 0.0
    out_floor_on: bool = True
    ref_white_fs: float = 100e-15      # XO + DBL white floor per PFD edge (~ -168 dBc/Hz at 80 MHz) - assumption
    pfd_slice_fs: float = 60e-15       # independent jitter of each PFD/retimer slice - assumption
    cp_noise_on: bool = True
    cp_vov: float = 0.25
    cp_gamma: float = 1.0
    cp_noise_scale: float = 1.0        # excess-noise factor on the single I_DN source (fitted)
    cp_flicker_fc: float = 0.0         # 1/f corner of the I_DN current noise [Hz] (fitted)
    xo_flicker_fs2: float = 0.0        # close-in reference timing noise S_t = xo_flicker*(1e4/f)^2 [s^2/Hz]
    sdm_adj_db: float = 0.0            # analytic only: extra dB on the SDM term (profiling the M-gain)
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

    def arith(self):
        """SlicedCPParams that carries the arithmetic (SDM resolution, slicing)."""
        coarse = self.M == 1 or self.mp_disabled
        return S.SlicedCPParams(f_ref=self.f_pfd, N=self.N, K=self.K, Q=self.Q, dither=self.dither,
                                arch="conv" if coarse else "binary", X=1 if coarse else self.M,
                                n_cyc=self.n_cyc, settle=self.settle, seed=self.seed)

    def slice_weights(self):
        Mp = self.M if not self.mp_disabled else 4
        if Mp == 1:
            return np.array([1.0])
        return S.SlicedCPParams(arch="binary", X=Mp).slices()


def frac_params(p: MP19p3Params, f_vco):
    nf = f_vco / p.f_pfd
    N = int(nf)
    return dict(N=N, K=int(round((nf - N) * p.Q)))


def build_sequences(p: MP19p3Params):
    seq = S.build_sequences(p.arith())
    w = p.slice_weights()
    if p.mp_disabled:
        seq = dict(seq)
        seq["d"] = np.zeros((p.n_cyc, len(w)), np.int64)
        seq["w"] = w
    if p.psel_late and p.M > 1 and not p.mp_disabled:
        seq = dict(seq)
        B = np.concatenate(([0], seq["B"][:-1]))
        d = np.zeros_like(seq["d"])
        for i in range(1, d.shape[1]):
            d[:, i] = (B >> (i - 1)) & 1
        seq["d"] = d
    return seq


def loop_filter(p: MP19p3Params):
    if p.lf_override is not None:
        return p.lf_override
    return C.design_cp_filter(p.icp, p.kvco, p.nf, p.fc, p.pm, p.p3_ratio, p.c3_ratio)


def auto_t_off(p: MP19p3Params, seq):
    rel = seq["r1"][:, None] + seq["d"] - seq["r_eff"].mean()
    return float(p.t_nonlin - rel.min() * p.t_vco)


def spreads(seq):
    r1 = seq["r1"] - seq["r_eff"].mean()
    allv = seq["r1"][:, None] + seq["d"]
    return dict(coarse_pp=float(r1.max() - r1.min()),
                eff_pp=float(seq["r_eff"].max() - seq["r_eff"].min()),
                all_slices_pp=float(allv.max() - allv.min()))


# ----------------------------------------------------------------------------
@njit(cache=True)
def _mp_loop(r1, d, w_act, w_nom, post_skew, path_skew, retimed, rt_margin, rt_sigma, rt_shared,
             t_vco, icp, beta, t_nonlin, nonlin_ramp, c_dn_va, ib, q_ofst, sc_mode, Phi, Gam, b2, os_,
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
        shared_slip = 0
        if retimed and rt_shared:
            m = rt_margin
            if rt_sigma > 0:
                m += rt_sigma * np.random.randn()
            if m < 0:
                shared_slip = 1
                slips += 1
        for i in range(M):
            di = d[k, i] + shared_slip
            ex = post_skew[i]
            if sig_slice > 0:
                ex += sig_slice * np.random.randn()
            if retimed:
                if not rt_shared:
                    m = rt_margin - path_skew[i, d[k, i]]
                    if rt_sigma > 0:
                        m += rt_sigma * np.random.randn()
                    if m < 0:
                        di += 1
                        slips += 1
            else:
                ex += path_skew[i, d[k, i]]
            e = (r1[k] + di - th) * t_vco + ex - ref_t[k]
            I = w_act[kw, i] * icp
            if e >= 0:
                ee = e
                if nonlin_ramp:
                    if e < t_nonlin:
                        ee = e * e / (2 * t_nonlin)
                    else:
                        ee = e - 0.5 * t_nonlin
                if c_dn_va < 1e30:
                    cc = w_nom[i] * c_dn_va
                    qi = cc * (1.0 - math.exp(-I * up * ee / cc))
                else:
                    qi = I * up * ee
            else:
                qi = 0.0 if sc_mode else I * dn * e
            if sicp > 0:
                qi += math.sqrt(sicp * w_nom[i] * abs(e) * 0.5) * np.random.randn()
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
    """Thermal noise PSD [A^2/Hz] of the single I_DN source at full Icp: 4kT*gamma*gm, gm = 2I/Vov."""
    kT = 1.380649e-23 * 300
    return 4 * kT * p.cp_gamma * (2 * p.icp / p.cp_vov) * p.cp_noise_scale


def offset_noise_var(p: MP19p3Params, t_off, mode=None):
    """Per-cycle charge-noise variance [C^2] of the CP offset source.  'sc' is a LOWER BOUND
    (2kT*C_OFST only; VDD/bias noise maps as C_OFST*dV, see supply_sensitivity())."""
    mode = mode or p.offset_mode
    q_ofst = p.icp * t_off
    kT = 1.380649e-23 * 300
    if mode == "sc":
        return 2 * kT * (q_ofst / p.vdd)
    ib = q_ofst * p.f_pfd
    s_i = 4 * kT * 1.0 * (2 * ib / 0.25)
    return s_i * (1 / p.f_pfd) * 0.5


def supply_sensitivity(p: MP19p3Params, t_off):
    """d(t_lock)/dV of the SC offset: Q_OFST = C_OFST*VDD  ->  dt = C_OFST*dV/Icp [s/V]."""
    return (p.icp * t_off / p.vdd) / p.icp


def ontime(p: MP19p3Params, t_off):
    """Current-weighted mean pulse width = T_off (sum_i w_i e_i = T_off in lock)."""
    return t_off


def cp_inband_parts(p: MP19p3Params, t_off):
    """Per-PFD-edge white timing variances [s^2] of the in-band sources."""
    w = p.slice_weights()
    out = dict(ref_common=p.ref_white_fs ** 2, pfd_slice=p.pfd_slice_fs ** 2 * float(np.sum(w ** 2)))
    if p.cp_noise_on:
        out["cp"] = cp_noise_psd(p) * ontime(p, t_off) * 0.5 / p.icp ** 2
        out["cp_offset"] = offset_noise_var(p, t_off) / p.icp ** 2
    return out


def simulate(p: MP19p3Params, seq=None, return_seq=False):
    seq = seq if seq is not None else build_sequences(p)
    w = np.asarray(seq["w"], float)
    M = len(w)
    lf = loop_filter(p)
    T = 1 / p.f_pfd
    Phi, Gam, b = C.cp_state_space(lf, p.kvco, T / p.os)
    t_off = p.t_off if p.t_off is not None else auto_t_off(p, seq)
    eps = np.zeros(M) if p.eps is None else np.asarray(p.eps, float)
    w_act = (w * (1 + eps))[None, :]
    post = np.zeros(M) if p.post_skew is None else np.asarray(p.post_skew, float)
    path = np.zeros((M, max(p.M, 1) + 3))
    if M > 1:
        path[1:, 0] = p.dt1
    wsum = float(w_act.sum())
    q_ofst = p.icp * wsum * t_off
    if p.nonlin_ramp:
        q_ofst = p.icp * wsum * (t_off - 0.5 * p.t_nonlin)
    if p.c_dn_va < 1e30:
        q_ofst = sum(wi * p.c_dn_va * (1 - math.exp(-p.icp * t_off / p.c_dn_va)) for wi in w * (1 + eps))
    ib = q_ofst * p.f_pfd
    sicp = cp_noise_psd(p) if p.cp_noise_on else 0.0
    n = p.n_cyc
    rng = np.random.default_rng(p.seed + 3)
    ref_t = p.ref_white_fs * rng.normal(size=n) if p.ref_white_fs > 0 else np.zeros(n)
    if p.xo_flicker_fs2 > 0:
        ref_t = ref_t + 2 * math.pi * synth_phase(
            lambda f: 10 * np.log10(p.xo_flicker_fs2 * (1e4 / f) ** 2 / 2), p.f_pfd, n, p.seed + 5, fmin=1e3)
    if p.cp_noise_on and p.cp_flicker_fc > 0:
        St_th = sicp * ontime(p, t_off) / (p.icp ** 2 * p.f_pfd)      # white timing PSD of thermal CP noise
        kfl = ontime(p, t_off) * p.f_pfd                                # flicker charge ~ i_n * t_on (quasi-static)
        ref_t = ref_t + 2 * math.pi * synth_phase(
            lambda f: 10 * np.log10(St_th * kfl * (p.cp_flicker_fc / f) / 2), p.f_pfd, n, p.seed + 6, fmin=1e3)
    vf = vco_fit_cached()
    if p.vco_on:
        sc_db = 20 * math.log10(p.f_vco / 4.75e9) + p.vco_scale_db
        phi = synth_phase(lambda f: vco_L(f, vf, include_floor=False, scale_db=sc_db),
                          p.f_pfd * p.os, n * p.os, p.seed + 9, fmin=500.0)
    else:
        phi = np.zeros(n * p.os)
    var_ofst = offset_noise_var(p, t_off) if p.cp_noise_on else 0.0
    theta0 = float(seq["r_eff"].mean() - t_off / p.t_vco)
    out, emin, emax, emean, slips = _mp_loop(
        seq["r1"].astype(np.float64), seq["d"], w_act.astype(np.float64), w.astype(np.float64), post, path,
        p.retimed, p.rt_margin, p.rt_sigma, p.rt_shared, p.t_vco, p.icp, p.beta, p.t_nonlin, p.nonlin_ramp,
        float(min(p.c_dn_va, 1e31)), ib, q_ofst, p.offset_mode == "sc", Phi, Gam, b[1], p.os, ref_t,
        p.pfd_slice_fs, sicp, var_ofst, phi, theta0, p.seed + 7)
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
# Linear analytic model
# ----------------------------------------------------------------------------
_TOFF_CACHE = {}


def t_off_of(p: MP19p3Params):
    if p.t_off is not None:
        return p.t_off
    key = (p.N, p.K, p.M, p.mp_disabled, p.psel_late, p.t_nonlin, p.f_xo, p.dbl)
    if key not in _TOFF_CACHE:
        _TOFF_CACHE[key] = auto_t_off(p, build_sequences(replace(p, n_cyc=2 ** 14)))
    return _TOFF_CACHE[key]


def analytic_pn(f, p: MP19p3Params, t_off=None, out_div=2):
    f = np.asarray(f, float)
    lf = loop_filter(p)
    Lg = C.cp_open_loop(f, p.icp, p.kvco, p.nf, lf)
    H2 = np.abs(Lg / (1 + Lg)) ** 2
    E2 = np.abs(1 / (1 + Lg)) ** 2
    vf = vco_fit_cached()
    X = 1 if (p.M == 1 or p.mp_disabled) else p.M
    sc = -20 * math.log10(out_div)
    wv = (2 * np.pi * p.f_vco) ** 2
    out = {}
    S_r = (1 / X ** 2) / 12 * (2 / p.f_pfd) * np.abs(2 * np.sin(np.pi * f / p.f_pfd)) ** 4
    out["sdm"] = 10 * np.log10((2 * np.pi) ** 2 * S_r * H2 / 2) + sc + p.sdm_adj_db
    if p.vco_on:
        out["vco"] = vco_L(f, vf, include_floor=False,
                           scale_db=20 * math.log10(p.f_vco / 4.75e9) + p.vco_scale_db) + 10 * np.log10(E2) + sc
    t_off = t_off if t_off is not None else t_off_of(p)
    for key, var in cp_inband_parts(p, t_off).items():
        if var > 0:
            out[key] = 10 * np.log10(wv * 2 * var / p.f_pfd * H2 / 2) + sc
    if p.cp_noise_on and p.cp_flicker_fc > 0:
        out["cp_flicker"] = out["cp"] + 10 * np.log10(p.cp_flicker_fc / f) + 10 * np.log10(ontime(p, t_off) * p.f_pfd)
    if p.xo_flicker_fs2 > 0:
        out["ref_flicker"] = 10 * np.log10(wv * p.xo_flicker_fs2 * (1e4 / f) ** 2 * H2 / 2) + sc
    if p.out_floor_on:
        out["out_floor"] = 10 * np.log10(np.full_like(f, vf["a0"]))
    out["total"] = 10 * np.log10(sum(10 ** (v / 10) for v in out.values()))
    return out


def jitter_analytic(p: MP19p3Params, f1=1e4, f2=1e8, parts=False):
    fg = np.logspace(math.log10(f1), math.log10(f2), 3000)
    A = analytic_pn(fg, p)
    j = C.rms_jitter_logint(fg, A["total"], p.f_vco / 2, f1, f2)
    if not parts:
        return j
    return j, {k: C.rms_jitter_logint(fg, v, p.f_vco / 2, f1, f2) for k, v in A.items() if k != "total"}


FIT_SCALE = dict(fc=1e6, pm=10.0, ref_white_fs=1e-13, xo_flicker_fs2=1e-32, p3_ratio=1.0,
                 cp_noise_scale=1.0, cp_flicker_fc=1e6, sdm_adj_db=1.0)
FIT_BOUNDS = dict(fc=(0.2e6, 3e6), pm=(30.0, 80.0), ref_white_fs=(0.0, 1e-12), xo_flicker_fs2=(0.0, 1e-30),
                  p3_ratio=(2.0, 60.0), cp_noise_scale=(0.3, 30.0), cp_flicker_fc=(0.0, 5e7), sdm_adj_db=(-12, 12))


def fit_joint(p: MP19p3Params, free, data):
    """Weighted least squares on the analytic model; data: list of (overrides, markers, weight).
    Two starts (given point and box centre); returns (params, per-dataset residuals, cost)."""
    lo = [FIT_BOUNDS[k][0] / FIT_SCALE[k] for k in free]
    hi = [FIT_BOUNDS[k][1] / FIT_SCALE[k] for k in free]
    x0 = [min(max(getattr(p, k) / FIT_SCALE[k], l + 1e-6), h - 1e-6) for k, l, h in zip(free, lo, hi)]
    x1 = [math.sqrt(max(l, 1e-3) * h) if l >= 0 else 0.5 * (l + h) for l, h in zip(lo, hi)]

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

    best = None
    for start in (x0, x1):
        try:
            r = least_squares(resid, x0=start, bounds=(lo, hi), x_scale="jac")
        except Exception:
            continue
        if best is None or r.cost < best.cost:
            best = r
    q = make(best.x)
    per = []
    for over, markers, wgt in data:
        e = markers_err(q, markers, **over)
        per.append(dict(overrides=over, rms_err_db=e["rms"], max_err_db=e["max"], resid=e["resid"]))
    return q, per, float(best.cost)


def markers_err(p: MP19p3Params, markers, **over):
    f = np.array([m[0] for m in markers])
    L = np.array([m[1] for m in markers])
    e = analytic_pn(f, replace(p, **over))["total"] - L
    return dict(rms=float(np.sqrt(np.mean(e ** 2))), max=float(np.max(np.abs(e))), resid=[round(float(v), 2) for v in e])


# ----------------------------------------------------------------------------
# Fractional spur: complex single-bin phasor (linear in the slice-current errors)
# ----------------------------------------------------------------------------
def spur_phasor(p: MP19p3Params, f_spur):
    """Exact-frequency single-bin DFT (Blackman window) of the PFD-rate excess phase at f_spur,
    normalised so |X| = SSB amplitude (A/2) in rad at the VCO."""
    r = simulate(p)
    th = r["theta"][:: p.os]
    k = np.arange(th.size)
    th = th - np.polyval(np.polyfit(k, th, 1), k)
    w = np.blackman(th.size)
    X = np.sum(2 * np.pi * th * w * np.exp(-2j * np.pi * f_spur / p.f_pfd * k))
    return X / w.sum()


# ----------------------------------------------------------------------------
# Reference spur from the periodic charge waveform (ripple)
# ----------------------------------------------------------------------------
def ref_spur_from_waveform(p: MP19p3Params, charges, f_period, n_harm=4):
    lf = loop_filter(p)
    T = 1 / f_period
    out = []
    for h in range(1, n_harm + 1):
        fh = h * f_period
        c = 0j
        for t, qv in charges:
            c += qv / T * np.exp(-2j * np.pi * h * t / T)
        v = abs(C.lf_transimpedance(fh, lf) * c) * 2
        beta = p.kvco * v / fh
        out.append(dict(harmonic=h, f=fh, spur_dbc=float(20 * np.log10(beta / 2 + 1e-300))))
    return out


def pulse_charges(t0, width, I, n=64):
    ts = t0 + (np.arange(n) + 0.5) * width / n
    return [(float(t), I * width / n) for t in ts]
