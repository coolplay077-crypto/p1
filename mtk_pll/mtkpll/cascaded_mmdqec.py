"""Behavioural model of ISSCC 2025 paper 19.2 (University of Tokyo):
"A 96fs-rms-Jitter, -70.6dBc-Fractional-Spur Cascaded PLL Employing Two MMDs
with Shared DSM for Quantization Noise Cancellation".

Architecture (paper Fig. 19.2.2)
--------------------------------
    f_ref (81.93 MHz) -> aux integer-N SPLL (BW1 = 10 MHz, VCO 9.1-10.4 GHz, /N_int)
                      -> /2 -> f_aux (4.6-5.2 GHz)
    f_aux -> aux MMD  /(Na + alpha[k])  -> main-PLL reference  (mref)
    f_out -> main MMD /(Nm + alpha[k])  -> main-PLL feedback   (mfb)
    one MASH 1-1-1 (alpha[k] in -3..4, mean alpha) drives BOTH MMDs
    main PLL: PFD + CP + 2nd-order passive LF (Fig. 19.2.2 shows R-C || C), BW2 ~ 1.6 MHz
    f_out = f_ref * N_int/2 * (Nm + alpha)/(Na + alpha),  f_DSM = f_aux/(Na + alpha)

Quantisation-error cancellation: with the loop locked, the k-th reference and
feedback edges carry (alpha[k]-alpha)*T_aout and (alpha[k]-alpha)*T_mout of
timing error; the PFD sees the difference, i.e. the accumulated error is
multiplied by (Nm-Na)/(Na+alpha) (= 1/(N+-1) for the paper's (N+-1):N setting).

Model type
----------
* One step per main-PFD cycle (uniform grid T_pfd = 1/f_DSM), exact state-space
  (impulse-invariant) discretisation of CP/LF/VCO with `os` sub-steps for the
  output spectrum (same scheme as sliced_cp.py).  The PFD/CP charge of cycle k is
  computed from the actual edge-time difference e[k] = t_fb[k] - t_ref[k]
  (impulse charge; UP/DN mismatch beta -> piece-wise linear CP).
* Deterministic edge times are computed with EXACT integer arithmetic from the
  MASH output (common.mash111): in units of T_mout/(Na*Q+K)
      D[k] = c*K*(Nm-Na) + Y_m[k]*(Na*Q+K) - Y_a[k]*(Nm*Q+K)      (c = k+1)
  with Y_m, Y_a the cumulative MMD-control sums (allowing DSM-to-MMD latency
  mismatch).  Without latency mismatch D[k] = -(Nm-Na)*E[k]  exactly.
* Random noise:
    - aux-PLL output phase noise (ref floor + SPD in-band floor with 1/f corner,
      low-passed by the aux loop H_a; aux VCO 1/f^2 high-passed by 1-H_a) is
      synthesised by FFT as a Gaussian sequence sampled at the reference edges
      (aliases of the PSD from 4 Nyquist zones are folded in).  The aux loop is
      represented by a generic type-II 2nd-order H_a (zeta, -3 dB BW = aux_bw);
      it is not simulated cycle by cycle (choice documented in the report).
    - aux / main MMD output jitter (white, per edge, not retimed)
    - main CP noise as an input-referred timing noise (white + 1/f), synthesised
    - main VCO: 1/f^2 Wiener phase per sub-step + 1/f^3 increments per cycle
      (synthesised), plus an optional white output floor that is NOT fed back
      (models the output buffer / on-chip /4 floor seen in the paper's VCO curve)
* Non-uniform reference spacing (the reference period varies by +-3 aux
  cycles) is only used for the PFD timing error; the loop is advanced on the
  uniform grid (error ~ excess-frequency x 0.6 ns, negligible).
* Not modelled: CP pulse-shape ripple inside a cycle, supply/substrate coupling
  between the two VCOs, aux-SPLL sampling non-linearity, MMD retiming.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from numba import njit
from scipy import signal

# Default noise / loop values are the ones fitted in run_isscc25_19p2.py (C3) to
# the paper's Fig. 19.2.5 calculated curves; they are assumptions, not data.

from . import common as C

ALPHA_MIN, ALPHA_MAX = -3, 4  # MASH 1-1-1 output range


@dataclass
class CascParams:
    # ---------------------------------------------------------------- frequency plan
    f_ref: float = 81.93e6
    n_int: int = 118                 # aux SPLL integer division (aux VCO = f_ref*n_int)
    Na: int = 13                     # aux MMD integer part
    Nm: int = 14                     # main MMD integer part
    Q: int = 2 ** 24                 # DSM modulus
    K: int = 2 ** 13                 # fractional word: alpha = K/Q  (2^-11)
    dither: bool = True              # LSB dither of the MASH (common.mash111)
    qec: bool = True                 # False: conventional cascaded PLL (aux MMD fixed Na)
    lat_a: int = 0                   # DSM->aux-MMD latency [cycles]
    lat_m: int = 0                   # DSM->main-MMD latency [cycles]
    mmd_kappa_a: float = 0.0         # aux-MMD delay per modulus step [s]
    mmd_kappa_m: float = 0.0         # main-MMD delay per modulus step [s]
    mmd_table_a: tuple | None = None  # optional delay per code alpha[k]=-3..4 [s] (8 values)
    mmd_table_m: tuple | None = None
    # ---------------------------------------------------------------- main loop
    icp: float = 1.0e-3
    kvco: float = 200e6              # Hz/V (assumed)
    fc: float = 1.53e6               # open-loop unity-gain frequency (C3 fit; paper BW2 = 1.6 MHz)
    pm: float = 72.4                 # phase margin [deg] (C3 fit)
    p3_ratio: float = 0.0            # 0 -> 2nd-order passive LF as drawn in Fig. 19.2.2
    c3_ratio: float = 0.1
    n_design: float = 14.0           # division ratio used for the LF design (fixed LF)
    beta: float = 0.0                # CP UP/DN mismatch: I_up=(1+b/2)I, I_dn=(1-b/2)I
    # ---------------------------------------------------------------- aux PLL
    aux_bw: float = 10e6             # aux SPLL closed-loop -3 dB BW
    aux_zeta: float = 0.707
    aux_vco_L1M: float | None = -115.2   # aux VCO (after /2, at f_aux) L(1 MHz), 1/f^2 (C3 fit)
    aux_inband: float | None = -131.4    # SPD/divider in-band white floor at f_aux [dBc/Hz] (C3 fit)
    aux_flicker: float = 1.05e6          # 1/f corner of the in-band floor (C3 fit)
    ref_floor: float | None = -165.0     # reference floor at f_ref [dBc/Hz]
    aux_mmd_jit: float = 0.0             # aux MMD output jitter rms [s] (white)
    main_mmd_jit: float = 0.0            # main MMD output jitter rms [s] (white)
    # ---------------------------------------------------------------- main CP / VCO noise
    cp_tn: float | None = 1.98e-17       # CP input-referred timing noise [s/sqrt(Hz)], white (C3 fit)
    cp_flicker: float = 6.75e5           # 1/f corner of the CP noise (C3 fit)
    vco_L1M: float | None = -120.1       # main VCO L(1 MHz) at f_out, 1/f^2 (C3 fit)
    vco_f3: float = 2.43e4               # 1/f^3 corner (C3 fit)
    out_floor: float | None = -148.2     # white floor at the output [dBc/Hz] (not fed back; C3 fit)
    # ---------------------------------------------------------------- simulation
    os: int = 2
    n_cyc: int = 2 ** 21
    settle: int = 2 ** 14
    seed: int = 1

    # ------------------------------------------------------------------ derived
    @property
    def alpha(self):
        return self.K / self.Q

    @property
    def f_aux(self):
        return self.f_ref * self.n_int / 2

    @property
    def div_a(self):
        """Mean aux-MMD division (reference path)."""
        return self.Na + self.alpha if self.qec else float(self.Na)

    @property
    def f_pfd(self):
        return self.f_aux / self.div_a

    @property
    def n_eff(self):
        return self.Nm + self.alpha

    @property
    def f_out(self):
        return self.f_pfd * self.n_eff

    @property
    def t_vco(self):
        return 1.0 / self.f_out

    @property
    def t_pfd(self):
        return 1.0 / self.f_pfd

    @property
    def rho(self):
        """Ideal residual factor of the accumulated Q-error (signed)."""
        return -(self.Nm - self.Na) / (self.Na + self.alpha) if self.qec else 1.0


NOISE_OFF = dict(aux_vco_L1M=None, aux_inband=None, ref_floor=None, cp_tn=None,
                 vco_L1M=None, out_floor=None, aux_mmd_jit=0.0, main_mmd_jit=0.0)


# ----------------------------------------------------------------------------
# frequency plan helpers
# ----------------------------------------------------------------------------
def f_out_formula(f_ref, n_int, Na, Nm, alpha):
    """Paper Fig. 19.2.2: f_out = f_ref * N_int/2 * (Nm+alpha)/(Na+alpha)."""
    return f_ref * n_int / 2 * (Nm + alpha) / (Na + alpha)


def f_dsm_formula(f_ref, n_int, Na, alpha):
    return f_ref * n_int / 2 / (Na + alpha)


# ----------------------------------------------------------------------------
# loop filter (fixed design, cached)
# ----------------------------------------------------------------------------
@lru_cache(maxsize=64)
def _lf_cached(icp, kvco, n, fc, pm, p3, c3):
    return C.design_cp_filter(icp, kvco, n, fc, pm, p3, c3)


def loop_filter(p: CascParams):
    return dict(_lf_cached(p.icp, p.kvco, p.n_design, p.fc, p.pm, p.p3_ratio, p.c3_ratio))


def H_main(p: CascParams, f):
    """Closed-loop transfer (input timing -> output phase, normalised) and Lg."""
    lf = loop_filter(p)
    Lg = C.cp_open_loop(np.asarray(f, float), p.icp, p.kvco, p.n_eff, lf)
    return Lg / (1 + Lg), Lg


def bw_3db(p: CascParams):
    f = np.logspace(4, 8, 4000)
    H = np.abs(H_main(p, f)[0])
    i = np.where(H < 1 / math.sqrt(2))[0][0]
    return float(f[i])


def H_aux(p: CascParams, f, bw=None, zeta=None):
    """Generic type-II 2nd-order aux-loop transfer with -3 dB BW = aux_bw."""
    bw = p.aux_bw if bw is None else bw
    z = p.aux_zeta if zeta is None else zeta
    # -3 dB frequency of (2 z wn s + wn^2)/(s^2 + 2 z wn s + wn^2)
    a = 1 + 2 * z * z
    k3 = math.sqrt(a + math.sqrt(a * a + 1))
    wn = 2 * math.pi * bw / k3
    s = 2j * math.pi * np.asarray(f, float)
    return (2 * z * wn * s + wn * wn) / (s * s + 2 * z * wn * s + wn * wn)


# ----------------------------------------------------------------------------
# DSM sequences and exact edge arithmetic
# ----------------------------------------------------------------------------
def _delayed(y, d):
    if d <= 0:
        return y.copy()
    return np.concatenate((np.full(d, y[0], y.dtype), y[:-d]))


def _mmd_delay(y, kappa, table):
    """Modulus-dependent MMD delay [s] for each cycle (mean removed later)."""
    out = kappa * y.astype(np.float64)
    if table is not None:
        tab = np.asarray(table, float)
        out = out + tab[np.clip(y - ALPHA_MIN, 0, len(tab) - 1)]
    return out


def build_sequences(p: CascParams, n=None):
    """MASH output, exact accumulated errors and per-cycle deterministic
    timing error r[k] (feedback minus reference edge, in main-VCO cycles)."""
    n = p.n_cyc if n is None else n
    y, E = C.mash111(p.K, p.Q, n, p.dither, p.seed)
    ym = _delayed(y, p.lat_m)
    ya = _delayed(y, p.lat_a)
    Q, K, Na, Nm = p.Q, p.K, p.Na, p.Nm
    c = np.arange(1, n + 1, dtype=np.int64)
    Ym = np.cumsum(ym)
    Ya = np.cumsum(ya)
    if p.qec:
        den = Na * Q + K                          # units: T_mout/(Na*Q+K)
        D = c * K * (Nm - Na) + Ym * den - Ya * (Nm * Q + K)
    else:
        den = Na * Q                              # units: T_mout/(Na*Q)
        D = Na * (Ym * Q - c * K)
    r = D / den                                   # main-VCO cycles
    # modulus-dependent MMD delays (non-accumulating)
    dly = _mmd_delay(ym, p.mmd_kappa_m, p.mmd_table_m)
    if p.qec:
        dly = dly - _mmd_delay(ya, p.mmd_kappa_a, p.mmd_table_a)
    r_tot = r + (dly - dly.mean()) / p.t_vco
    return dict(y=y, E=E, ya=ya, ym=ym, D=D, den=den, r_dsm=r, r=r_tot, mmd_delay=dly)


def edge_times_float(p: CascParams, y):
    """Independent float computation of the edge instants (seconds) by summing
    the MMD periods of ideal, locked aux / main clocks (used for the C0 check)."""
    T_aout = 1 / p.f_aux
    T_mout = p.t_vco
    ya = _delayed(y, p.lat_a) if p.qec else np.zeros_like(y)
    ym = _delayed(y, p.lat_m)
    t_ref = np.cumsum((p.Na + ya) * T_aout)
    t_fb = np.cumsum((p.Nm + ym) * T_mout)
    return t_ref, t_fb


# ----------------------------------------------------------------------------
# Noise synthesis
# ----------------------------------------------------------------------------
def synth_noise(S_func, fs, n, rng):
    """Real Gaussian sequence (rate fs, length n) with one-sided PSD S_func(f)."""
    f = np.fft.rfftfreq(n, 1 / fs)
    S = np.zeros_like(f)
    S[1:] = S_func(f[1:])
    amp = np.sqrt(S * fs * n / 4)
    X = amp * (rng.standard_normal(len(f)) + 1j * rng.standard_normal(len(f)))
    X[0] = 0
    if n % 2 == 0:
        X[-1] = X[-1].real * math.sqrt(2)
    return np.fft.irfft(X, n)


def _fold(S_func, fs, nz=4):
    def Sf(f):
        tot = S_func(f)
        for m in range(1, nz + 1):
            tot = tot + S_func(m * fs - f) + S_func(m * fs + f)
        return tot
    return Sf


def aux_L_components(p: CascParams, f, bw=None):
    """Aux-PLL output phase noise components at f_aux [linear L, 1/Hz]."""
    f = np.maximum(np.abs(np.asarray(f, float)), 1.0)
    Ha2 = np.abs(H_aux(p, f, bw)) ** 2
    out = {}
    if p.ref_floor is not None:
        out["aux_ref"] = 10 ** (p.ref_floor / 10) * (p.n_int / 2) ** 2 * Ha2
    if p.aux_inband is not None:
        out["aux_spd"] = 10 ** (p.aux_inband / 10) * (1 + p.aux_flicker / f) * Ha2
    if p.aux_vco_L1M is not None:
        out["aux_vco"] = 10 ** (p.aux_vco_L1M / 10) * (1e6 / f) ** 2 * np.abs(1 - H_aux(p, f, bw)) ** 2
    return out


def aux_timing_psd(p: CascParams, f):
    """One-sided PSD [s^2/Hz] of the aux-clock timing error (before sampling)."""
    comps = aux_L_components(p, f)
    if not comps:
        return np.zeros_like(np.asarray(f, float))
    L = sum(comps.values())
    return 2 * L / (2 * math.pi * p.f_aux) ** 2


def cp_timing_psd(p: CascParams, f):
    return p.cp_tn ** 2 * (1 + p.cp_flicker / np.asarray(f, float))


def vco3_cycles_psd(p: CascParams, f):
    """1/f^3 part of the free-running main VCO phase PSD [cycles^2/Hz]."""
    f = np.asarray(f, float)
    return 2 * 10 ** (p.vco_L1M / 10) * (1e6 / f) ** 2 * (p.vco_f3 / f) / (2 * math.pi) ** 2


# ----------------------------------------------------------------------------
# Main-loop kernel
# ----------------------------------------------------------------------------
@njit(cache=True)
def _main_loop(r, nt, ncp, dth3, t_vco, icp, beta, Phi, b2, os_, sig_vco,
               theta0, t_sat, seed):
    np.random.seed(seed)
    n = r.shape[0]
    z = np.zeros(4)
    zn = np.zeros(4)
    z[3] = theta0
    out = np.empty(n * os_)
    e_arr = np.empty(n)
    up = 1.0 + 0.5 * beta
    dn = 1.0 - 0.5 * beta
    for k in range(n):
        e = (r[k] - z[3]) * t_vco + nt[k]
        if e > t_sat:
            e = t_sat
        elif e < -t_sat:
            e = -t_sat
        e_arr[k] = e
        if e >= 0:
            q = icp * up * e
        else:
            q = icp * dn * e
        q += icp * ncp[k]
        z[1] += b2 * q
        for s in range(os_):
            for i in range(4):
                acc = 0.0
                for j in range(4):
                    acc += Phi[i, j] * z[j]
                zn[i] = acc
            for i in range(4):
                z[i] = zn[i]
            if sig_vco > 0:
                z[3] += sig_vco * np.random.randn()
            out[k * os_ + s] = z[3]
        z[3] += dth3[k]
    return out, e_arr


def simulate(p: CascParams, seq=None, keep_e=False):
    """Time-domain simulation.  Returns excess output phase (cycles of f_out)
    at rate f_pfd*os after the settling period, plus diagnostics."""
    seq = seq if seq is not None else build_sequences(p)
    n = p.n_cyc
    lf = loop_filter(p)
    h = p.t_pfd / p.os
    Phi, Gam, b = C.cp_state_space(lf, p.kvco, h)
    rng = np.random.default_rng(p.seed + 1000)
    fs = p.f_pfd
    # reference-path timing noise (aux PLL + aux MMD) and feedback MMD jitter
    nt = np.zeros(n)
    if any(v is not None for v in (p.ref_floor, p.aux_inband, p.aux_vco_L1M)):
        nt -= synth_noise(_fold(lambda f: aux_timing_psd(p, f), fs), fs, n, rng)
    if p.aux_mmd_jit > 0:
        nt -= p.aux_mmd_jit * rng.standard_normal(n)
    if p.main_mmd_jit > 0:
        nt += p.main_mmd_jit * rng.standard_normal(n)
    ncp = synth_noise(lambda f: cp_timing_psd(p, f), fs, n, rng) if p.cp_tn is not None else np.zeros(n)
    if p.vco_L1M is not None and p.vco_f3 > 0:
        ph3 = synth_noise(lambda f: vco3_cycles_psd(p, f), fs, n, rng)
        dth3 = np.diff(np.concatenate(([ph3[-1]], ph3)))
    else:
        dth3 = np.zeros(n)
    sig_vco = C.wiener_step_sigma(p.vco_L1M, 1e6, fs * p.os) if p.vco_L1M is not None else 0.0
    r = seq["r"]
    theta0 = float(r[: min(n, 4096)].mean())
    out, e = _main_loop(r.astype(np.float64), nt, ncp, dth3, p.t_vco, p.icp, p.beta,
                        Phi, b[1], p.os, sig_vco, theta0, 0.95 * p.t_pfd, p.seed + 7)
    theta = out[p.settle * p.os:]
    if p.out_floor is not None:
        S = 2 * 10 ** (p.out_floor / 10) / (2 * math.pi) ** 2      # cycles^2/Hz
        theta = theta + math.sqrt(S * fs * p.os / 2) * rng.standard_normal(len(theta))
    es = e[p.settle:]
    res = dict(theta=theta, fs=fs * p.os, f_out=p.f_out, f_pfd=fs, lf=lf, seq=seq, params=p,
               e_mean=float(es.mean()), e_min=float(es.min()), e_max=float(es.max()),
               e_rms=float(es.std()))
    if keep_e:
        res["e"] = es
    return res


# ----------------------------------------------------------------------------
# Spectral helpers
# ----------------------------------------------------------------------------
def pn_stitched(res, f_split=3e5, nperseg_hi=2 ** 16, dec=64):
    """Phase noise [dBc/Hz] from 1 kHz to f_pfd/2: low band from a decimated
    per-cycle record (fine resolution), high band from the os-rate record."""
    th = res["theta"]
    p = res["params"]
    fs = res["fs"]
    f_hi, L_hi = C.phase_noise(th, fs, nperseg=nperseg_hi)
    th1 = th[p.os - 1:: p.os]
    x = th1 - np.linspace(th1[0], th1[-1], len(th1))     # remove drift before filtering
    d_left = dec
    while d_left > 1:
        q = 8 if d_left >= 8 else d_left
        # Kaiser-windowed polyphase anti-alias filter (stop-band ~ -100 dB) so that
        # strong noise above the new Nyquist does not alias into the low band
        x = signal.resample_poly(x, 1, q, window=("kaiser", 10.0))
        d_left //= q
    fs_lo = p.f_pfd / dec
    nps = int(min(2 ** 14, 2 ** int(math.floor(math.log2(len(x) / 4)))))
    f_lo, L_lo = C.phase_noise(x, fs_lo, nperseg=nps)
    m_lo = f_lo < f_split
    m_hi = f_hi >= f_split
    return np.concatenate((f_lo[m_lo], f_hi[m_hi])), np.concatenate((L_lo[m_lo], L_hi[m_hi]))


def jitter(res_or_f, L=None, f1=1e3, f2=1e8, f_carrier=None):
    if L is None:
        res = res_or_f
        f, L = pn_stitched(res)
        return C.rms_jitter(f, L, res["f_out"], f1, f2)
    return C.rms_jitter(res_or_f, L, f_carrier, f1, f2)


# ----------------------------------------------------------------------------
# Linear analytic model
# ----------------------------------------------------------------------------
def q_noise_cycles_psd(p: CascParams, f):
    """One-sided PSD [cycles^2/Hz] of the MASH 1-1-1 accumulated error E/Q
    (uniform white e3, var 1/12, shaped by (1-z^-1)^2)."""
    f = np.asarray(f, float)
    return (1 / 12) * (2 / p.f_pfd) * np.abs(2 * np.sin(np.pi * f / p.f_pfd)) ** 4


def q_total_cycles_psd(p: CascParams, f):
    """PSD [cycles^2/Hz] of the DSM-driven PFD timing error: accumulated
    Q-error through G(z) PLUS the linear modulus-dependent MMD delay mismatch,
    which is driven by the same MASH error e3 and therefore adds coherently:
        r = [G(z) (1-z^-1)^2 + (k_m z^-lat_m - k_a z^-lat_a)/T_vco (1-z^-1)^3] e3."""
    f = np.asarray(f, float)
    zinv = np.exp(-2j * np.pi * f / p.f_pfd)
    a = p.alpha
    if p.qec:
        G = ((p.Na + a) * zinv ** p.lat_m - (p.Nm + a) * zinv ** p.lat_a) / (p.Na + a)
        kap = (p.mmd_kappa_m * zinv ** p.lat_m - p.mmd_kappa_a * zinv ** p.lat_a) / p.t_vco
    else:
        G = zinv ** p.lat_m
        kap = p.mmd_kappa_m * zinv ** p.lat_m / p.t_vco
    d = 1 - zinv
    T = G * d ** 2 + kap * d ** 3
    return (1 / 12) * (2 / p.f_pfd) * np.abs(T) ** 2


def analytic_pn(f, p: CascParams, include_q=True):
    """Component L(f) [dBc/Hz] at the main output from the linearised loop."""
    f = np.asarray(f, float)
    H, Lg = H_main(p, f)
    H2 = np.abs(H) ** 2
    E2 = np.abs(1 / (1 + Lg)) ** 2
    wv2 = (2 * math.pi * p.f_out) ** 2
    out = {}
    # aux PLL: timing at the aux clock = phase/(2 pi f_aux); sampled at f_pfd
    comps = aux_L_components(p, f)
    for k in comps:
        Sk = _fold(lambda x, k=k: aux_L_components(p, x)[k], p.f_pfd)(f)
        out[k] = 10 * np.log10(Sk * (p.f_out / p.f_aux) ** 2 * H2 + 1e-300)
    if p.aux_mmd_jit > 0:
        out["aux_mmd"] = 10 * np.log10(wv2 * 2 * p.aux_mmd_jit ** 2 / p.f_pfd * H2 / 2)
    if p.main_mmd_jit > 0:
        out["main_mmd"] = 10 * np.log10(wv2 * 2 * p.main_mmd_jit ** 2 / p.f_pfd * H2 / 2)
    if p.cp_tn is not None:
        out["cp"] = 10 * np.log10(wv2 * cp_timing_psd(p, f) * H2 / 2)
    if p.vco_L1M is not None:
        Lv = 10 ** (p.vco_L1M / 10) * (1e6 / f) ** 2 * (1 + p.vco_f3 / f)
        out["vco"] = 10 * np.log10(Lv * E2)
    if p.out_floor is not None:
        out["out_floor"] = np.full_like(f, p.out_floor)
    if include_q:
        out["q"] = 10 * np.log10((2 * math.pi) ** 2 * q_total_cycles_psd(p, f) * H2 / 2 + 1e-300)
    tot = sum(10 ** (v / 10) for v in out.values())
    out["total"] = 10 * np.log10(tot)
    return out


def group_components(A):
    """Group analytic components into the paper's breakdown categories."""
    lin = {k: 10 ** (v / 10) for k, v in A.items() if k != "total"}
    g = dict(aux=sum(lin.get(k, 0) for k in ("aux_ref", "aux_spd", "aux_vco")),
             cp=lin.get("cp", 0.0),
             vco=lin.get("vco", 0.0) + lin.get("out_floor", 0.0),
             q=lin.get("q", 0.0),
             other=sum(lin.get(k, 0) for k in ("aux_mmd", "main_mmd")))
    return g


def analytic_jitters(f, p: CascParams, f1=1e3, f2=1e8):
    A = analytic_pn(f, p)
    g = group_components(A)
    out = {}
    for k, v in g.items():
        if np.any(v > 0):
            out[k] = C.rms_jitter(f, 10 * np.log10(v + 1e-300), p.f_out, f1, f2)
        else:
            out[k] = 0.0
    out["total"] = C.rms_jitter(f, A["total"], p.f_out, f1, f2)
    return out, A


def analytic_grid(n=4000, f1=1e3, f2=1e8):
    return np.logspace(math.log10(f1), math.log10(f2), n)


# ----------------------------------------------------------------------------
# Spur helper
# ----------------------------------------------------------------------------
def spur_levels(res, harmonics=(1, 2, 3)):
    """SSB spur levels [dBc] at h*alpha*f_pfd from the per-cycle phase record."""
    p = res["params"]
    th = res["theta"][p.os - 1:: p.os]
    fsp = p.alpha * p.f_pfd
    per = int(round(1 / p.alpha)) if p.alpha > 0 else 1
    m = (len(th) // per) * per if per < len(th) else len(th)
    th = th[:m]
    out = {}
    for h in harmonics:
        if h * fsp < p.f_pfd / 2:
            out[h] = C.spur_dbc(th, p.f_pfd, h * fsp)
    return out


# ----------------------------------------------------------------------------
# Locking transient (event-driven, tri-state PFD, real MMD counters)
# ----------------------------------------------------------------------------
@njit(cache=True)
def _transient(y1, y2, Na1, Nm1, Na2, Nm2, faux1, faux2, t_aux, s_aux, fband1, fband2,
               Phi, Gam, icp, dt, t0, t1, rec_every):
    """Fixed-step (dt) event simulation.  Each MMD counts its own input cycles
    (aux clock / main VCO) and takes the next shared-DSM value at every output
    edge; at t = 0 both switch to the new channel (y2, Na2, Nm2).  The CP
    current is the tri-state PFD output averaged over the step (edge instants
    interpolated inside the step); the VCO phase advance uses the LF state at the
    start of the step (dt << T_vco)."""
    nsteps = int((t1 - t0) / dt)
    z = np.zeros(4)
    zn = np.zeros(4)
    pha = 0.0
    phm = 0.0
    ca = Na1 + y1[0]
    cm = Nm1 + y1[0]
    ka = 1
    km = 1
    new_a = False
    new_m = False
    state = 0
    nrec = nsteps // rec_every + 1
    t_rec = np.empty(nrec)
    fm_rec = np.empty(nrec)
    fa_rec = np.empty(nrec)
    ir = 0
    acc_m = 0.0
    acc_a = 0.0
    nacc = 0
    n_s = s_aux.shape[0]
    n1 = y1.shape[0]
    n2 = y2.shape[0]
    for st in range(nsteps):
        t = t0 + st * dt
        if t < 0:
            fa = faux1
            fb = fband1
        else:
            x = t / t_aux
            idx = int(x)
            if idx >= n_s - 1:
                sa = s_aux[n_s - 1]
            else:
                w = x - idx
                sa = s_aux[idx] * (1 - w) + s_aux[idx + 1] * w
            fa = faux1 + (faux2 - faux1) * sa
            fb = fband2
        dpa = fa * dt
        dz3 = 0.0
        for j in range(4):
            dz3 += Phi[3, j] * z[j]
        dpm = fb * dt + (dz3 - z[3])
        ev_a = -1.0
        if pha + dpa >= ca:
            ev_a = (ca - pha) / dpa
        ev_m = -1.0
        if phm + dpm >= cm:
            ev_m = (cm - phm) / dpm
        cur = state
        if ev_a >= 0 and ev_m >= 0:
            if ev_a <= ev_m:
                q = cur * ev_a
                cur = _pfd(cur, 1)
                q += cur * (ev_m - ev_a)
                cur = _pfd(cur, 2)
                q += cur * (1 - ev_m)
            else:
                q = cur * ev_m
                cur = _pfd(cur, 2)
                q += cur * (ev_a - ev_m)
                cur = _pfd(cur, 1)
                q += cur * (1 - ev_a)
        elif ev_a >= 0:
            q = cur * ev_a
            cur = _pfd(cur, 1)
            q += cur * (1 - ev_a)
        elif ev_m >= 0:
            q = cur * ev_m
            cur = _pfd(cur, 2)
            q += cur * (1 - ev_m)
        else:
            q = float(cur)
        state = cur
        I = icp * q
        for i in range(4):
            acc = Gam[i] * I
            for j in range(4):
                acc += Phi[i, j] * z[j]
            zn[i] = acc
        for i in range(4):
            z[i] = zn[i]
        pha += dpa
        phm += dpm
        if ev_a >= 0:
            if t < 0:
                ca += Na1 + y1[ka % n1]
            else:
                if not new_a:
                    new_a = True
                    ka = 0
                ca += Na2 + y2[ka % n2]
            ka += 1
        if ev_m >= 0:
            if t < 0:
                cm += Nm1 + y1[km % n1]
            else:
                if not new_m:
                    new_m = True
                    km = 0
                cm += Nm2 + y2[km % n2]
            km += 1
        acc_m += dpm
        acc_a += dpa
        nacc += 1
        if nacc == rec_every:
            t_rec[ir] = t + dt - 0.5 * nacc * dt
            fm_rec[ir] = acc_m / (nacc * dt)
            fa_rec[ir] = acc_a / (nacc * dt)
            ir += 1
            acc_m = 0.0
            acc_a = 0.0
            nacc = 0
    return t_rec[:ir], fm_rec[:ir], fa_rec[:ir]


@njit(cache=True)
def _pfd(state, ev):
    """Tri-state PFD: ev=1 reference edge, ev=2 feedback edge."""
    if ev == 1:
        return 0 if state == -1 else 1
    return 0 if state == 1 else -1


def lock_transient(p: CascParams, Na2=12, Nm2=13, K2=2 ** 15, n_int2=127,
                   band_err=-100e6, t_pre=0.3e-6, t_post=1.5e-6, dt=5e-12, rec=200):
    """Frequency transient for a channel switch (paper Fig. 19.2.5 bottom):
    aux N_int n_int -> n_int2 (aux frequency follows the step response of H_a),
    MMDs (Na+a, Nm+a) -> (Na2+b, Nm2+b), main VCO coarse band preset to the new
    channel with a residual error band_err (assumed, read from the measured
    transient), then the main loop pulls in with a tri-state PFD."""
    alpha1, alpha2 = p.K / p.Q, K2 / p.Q
    fa1 = p.f_aux
    fa2 = p.f_ref * n_int2 / 2
    fo1 = fa1 * (p.Nm + alpha1) / (p.Na + alpha1)
    fo2 = fa2 * (Nm2 + alpha2) / (Na2 + alpha2)
    y1, _ = C.mash111(p.K, p.Q, 2 ** 16, p.dither, p.seed)
    y2, _ = C.mash111(K2, p.Q, 2 ** 16, p.dither, p.seed + 1)
    lf = loop_filter(p)
    Phi, Gam, b = C.cp_state_space(lf, p.kvco, dt)
    # aux frequency step response (H_a type-II), sampled
    t_aux = 1e-9
    tt = np.arange(0, 3e-6, t_aux)
    a = 1 + 2 * p.aux_zeta ** 2
    wn = 2 * math.pi * p.aux_bw / math.sqrt(a + math.sqrt(a * a + 1))
    sysa = signal.lti([2 * p.aux_zeta * wn, wn * wn], [1, 2 * p.aux_zeta * wn, wn * wn])
    _, s_aux = signal.step(sysa, T=tt)
    t, fm, fa = _transient(y1.astype(np.int64), y2.astype(np.int64), p.Na, p.Nm, Na2, Nm2,
                           fa1, fa2, t_aux, s_aux, fo1, fo2 + band_err, Phi, Gam, p.icp,
                           dt, -t_pre, t_post, rec)
    return dict(t=t, f_main=fm, f_aux=fa, f_out1=fo1, f_out2=fo2, f_aux1=fa1, f_aux2=fa2,
                t_aux_step=tt, s_aux=s_aux)


def settle_time(t, f, f_final, tol, t_start=0.0):
    """Last time the (recorded) frequency leaves f_final +- tol after t_start."""
    m = t >= t_start
    tt, ff = t[m], f[m]
    bad = np.where(np.abs(ff - f_final) > tol)[0]
    if len(bad) == 0:
        return 0.0
    if bad[-1] == len(ff) - 1:
        return float("nan")
    return float(tt[bad[-1] + 1] - t_start)
