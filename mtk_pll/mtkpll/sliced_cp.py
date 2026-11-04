"""Behavioural model of the MediaTek sliced-charge-pump fractional-N PLL
(US 11,509,315 B2, "Fractional-N PLL and sliced charge pump control method").

Architecture reproduced (patent FIG. 3 / 4 / 5-14 / 15):

    N.f -> SDM(35) -> {D_N, D_f}
    D_f -> accumulator(37, mod X) -> SEL (=B) and carry S
    D_DIVISOR = D_N + S  -> MMD(34) -> CK_MMD
    CK_MMD -> DTC(361: DFF chain clocked by CK_VCO + MUX) -> CK_DTC = CK_MMD + B*T_VCO
    retimer(362, DFFs on CK_VCO) -> CK_DIV,1 / CK_DIV,2 ...
    PFD_i + CP_i (current w_i*Icp) -> shared LPF(32) -> VCO(33)

Supported slicing:
    'conv'   : X = 1, one PFD/CP (patent FIG. 1, reference design)
    'two'    : two slices (1-1/X)*Icp and (1/X)*Icp, B in 0..X-1   (FIG. 5/7/9)
    'binary' : 1+log2(X) slices 1/X,1/X,2/X,4/X..., each delayed 0/1 T_VCO
               by one bit of B                                     (FIG. 11/13)

Model type: per-reference-cycle, exact state-space (impulse-invariant)
discretisation of the CP/LPF/VCO loop with `os` sub-steps per reference
period for the output spectrum.  CP charge of each slice is computed from its
own edge time, so slice mismatch, CP UP/DN non-linearity, pre/post-retimer
skews and retimer slips act on the real per-slice pulses.  Pulse-shape ripple
inside a reference period is NOT modelled (charge is applied as an impulse);
see the report for the boundary of validity.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict

import numpy as np
from numba import njit

from . import common as C


@dataclass
class SlicedCPParams:
    # frequency plan
    f_ref: float = 52e6
    N: int = 115
    K: int = int(round(0.2718281828 * 2 ** 24))   # fractional numerator
    Q: int = 2 ** 24                                # SDM modulus
    dither: bool = True
    # slicing
    arch: str = "two"          # 'conv' | 'two' | 'binary'
    X: int = 8                 # number of B levels (quantisation-step divider)
    # loop
    icp: float = 2e-3          # total CP current
    kvco: float = 100e6        # Hz/V
    fc: float = 800e3          # open-loop crossover
    pm: float = 55.0           # phase margin [deg]
    p3_ratio: float = 6.0      # extra R3/C3 pole at p3_ratio*fc (0 -> 2nd-order filter)
    c3_ratio: float = 0.1
    # CP linearisation (bleed / offset)
    t_off: float | None = None # None -> automatic: min dither range + t_guard
    t_guard: float = 40e-12
    t_rst: float = 80e-12      # PFD reset pulse (both UP/DN on -> noise)
    beta: float = 0.0          # CP UP/DN mismatch: I_up=(1+b/2)I, I_dn=(1-b/2)I
    # slice current mismatch
    eps: tuple | None = None   # relative error of each slice current (len M)
    unit_sigma: float = 0.0    # 'two' arch only: X unit cells, sigma of unit error
    dem: str = "static"        # 'static' | 'random' (unit-cell rotation for slice 2)
    # timing skews
    post_skew: tuple | None = None   # constant per-slice skew after retimer (dT2+dT3)
    dt1: float = 0.0           # pre-retimer skew of the B=0 bypass path (dT1, FIG. 15)
    retimed: bool = True
    rt_margin: float = 1.0     # retimer setup margin [s] (large -> never slips)
    rt_sigma: float = 0.0      # jitter on the retimer data-arrival vs clock
    mmd_jit: float = 0.0       # MMD output jitter (only seen if not retimed)
    # noise
    vco_L1M: float | None = -120.0    # VCO L(1 MHz) [dBc/Hz], 1/f^2
    ref_floor: float | None = -165.0  # ref-clock floor at f_ref [dBc/Hz]
    pfd_jit: float = 80e-15    # rms jitter per PFD slice (independent)
    cp_noise: bool = True
    vov: float = 0.25          # CP current-source overdrive (noise model)
    gamma_n: float = 1.0
    # simulation
    os: int = 8
    n_cyc: int = 2 ** 19
    settle: int = 2 ** 14
    seed: int = 1

    # ------------------------------------------------------------------ derived
    @property
    def nf(self):
        return self.N + self.K / self.Q

    @property
    def f_vco(self):
        return self.nf * self.f_ref

    @property
    def t_vco(self):
        return 1.0 / self.f_vco

    @property
    def t_ref(self):
        return 1.0 / self.f_ref

    @property
    def x_eff(self):
        return 1 if self.arch == "conv" else self.X

    def slices(self):
        """Nominal slice weights and number of slices."""
        X = self.x_eff
        if self.arch == "conv":
            return np.array([1.0])
        if self.arch == "two":
            return np.array([1 - 1 / X, 1 / X])
        if self.arch == "binary":
            nb = int(round(math.log2(X)))
            assert 2 ** nb == X, "binary slicing needs X = 2^n"
            return np.array([1 / X] + [2 ** i / X for i in range(nb)])
        raise ValueError(self.arch)

    @property
    def sicp(self):
        """One-sided noise PSD [A^2/Hz] of the full CP (UP+DN sources)."""
        kT = 1.380649e-23 * 300
        return 2 * 4 * kT * self.gamma_n * (2 * self.icp / self.vov)


# ----------------------------------------------------------------------------
# Patent signal chain: SDM -> {D_N, D_f} -> accumulator -> SEL(B), S -> divisor
# ----------------------------------------------------------------------------
def build_sequences(p: SlicedCPParams):
    X = p.x_eff
    Q = p.Q
    W = X * (p.N * Q + p.K)            # fine-SDM input word = X * N.f * Q
    I0, Kf = divmod(W, Q)
    y_sdm, E = C.mash111(Kf, Q, p.n_cyc, p.dither, p.seed)
    y = I0 + y_sdm                     # fine SDM output, LSB = T_VCO / X
    D_N = y // X                       # integer part   (patent D_N)
    D_f = y % X                        # fractional part (patent D_f)
    acc = np.cumsum(D_f)               # accumulator 37
    B = acc % X                        # SEL  -> DTC delay code B
    carry_cum = acc // X
    S = np.diff(np.concatenate(([0], carry_cum)))  # carry S
    divisor = D_N + S                  # D_DIVISOR (MMD modulus)
    # coarse-edge accumulated error in VCO cycles, exact integer arithmetic
    k1 = np.arange(1, p.n_cyc + 1, dtype=np.int64)
    num = np.cumsum(divisor) * (Q * X) - k1 * W   # = (E - B*Q)  [1/(Q*X) cycles]
    r1 = num / (Q * X)
    r_eff = E / (Q * X)                # effective (current-weighted) edge error
    # delay codes per slice
    w = p.slices()
    M = len(w)
    d = np.zeros((p.n_cyc, M), np.int64)
    if p.arch == "two":
        d[:, 1] = B
    elif p.arch == "binary":
        for i in range(1, M):
            d[:, i] = (B >> (i - 1)) & 1
    return dict(y=y, D_N=D_N, D_f=D_f, B=B, S=S, divisor=divisor, E=E,
                num=num, r1=r1, r_eff=r_eff, d=d, w=w, W=W)


def check_identity(seq, p: SlicedCPParams):
    """Exact checks of the patent arithmetic (returns dict of booleans)."""
    X, Q = p.x_eff, p.Q
    ok_num = bool(np.array_equal(seq["num"], seq["E"] - seq["B"] * Q))
    eff_mod = seq["divisor"] * X + np.diff(np.concatenate(([0], seq["B"])))
    ok_mod = bool(np.array_equal(eff_mod, seq["y"]))   # D_N+S+dB/X == y/X
    w = seq["w"]
    weighted = (seq["d"] * w[None, :]).sum(1)
    ok_w = bool(np.allclose(seq["r1"] + weighted, seq["r_eff"], atol=1e-12))
    return dict(coarse_error_identity=ok_num, effective_modulus_identity=ok_mod,
                weighted_edge_equals_fine_sdm=ok_w)


# ----------------------------------------------------------------------------
# Loop kernel
# ----------------------------------------------------------------------------
@njit(cache=True)
def _cp_loop(r1, d, w_act, w_nom, post_skew, path_skew, retimed, rt_margin,
             rt_sigma, mmd_jit, t_vco, icp, beta, ib, Phi, Gam, b2, os_,
             sig_ref, sig_pfd, sicp, t_rst, var_bleed, sig_vco, theta0, seed):
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
    for k in range(n):
        th = z[3]
        t_ref_err = sig_ref * np.random.randn() if sig_ref > 0 else 0.0
        t_mmd = mmd_jit * np.random.randn() if mmd_jit > 0 else 0.0
        kw = k if nw > 1 else 0
        q = 0.0
        for i in range(M):
            di = d[k, i]
            ex = post_skew[i]
            if sig_pfd > 0:
                ex += sig_pfd * np.random.randn()
            if retimed:
                m = rt_margin - path_skew[i, di]
                if rt_sigma > 0:
                    m += rt_sigma * np.random.randn()
                if m < 0:
                    di += 1
                    slips += 1
            else:
                ex += path_skew[i, di] + t_mmd
            e = (r1[k] + di - th) * t_vco + ex - t_ref_err
            I = w_act[kw, i] * icp
            if e >= 0:
                qi = I * up * e
            else:
                qi = I * dn * e
            if sicp > 0:
                qi += math.sqrt(sicp * w_nom[i] * (abs(e) + t_rst) * 0.5) * np.random.randn()
            q += qi
            if e < emin[i]:
                emin[i] = e
            if e > emax[i]:
                emax[i] = e
            esum[i] += e
        if var_bleed > 0:
            q += math.sqrt(var_bleed) * np.random.randn()
        z[1] += b2 * q
        for s in range(os_):
            for r in range(4):
                acc = -Gam[r] * ib
                for c in range(4):
                    acc += Phi[r, c] * z[c]
                zn[r] = acc
            for r in range(4):
                z[r] = zn[r]
            if sig_vco > 0:
                z[3] += sig_vco * np.random.randn()
            out[k * os_ + s] = z[3]
    return out, emin, emax, esum / n, slips


def loop_filter(p: SlicedCPParams):
    return C.design_cp_filter(p.icp, p.kvco, p.nf, p.fc, p.pm, p.p3_ratio, p.c3_ratio)


def auto_t_off(p: SlicedCPParams, seq):
    """Minimum CP offset so every slice pulse stays one-signed (linear CP)."""
    rel = seq["r1"][:, None] + seq["d"] - seq["r_eff"].mean()
    return float(p.t_guard - rel.min() * p.t_vco)


def simulate(p: SlicedCPParams, seq=None):
    seq = seq if seq is not None else build_sequences(p)
    w = seq["w"]
    M = len(w)
    lf = loop_filter(p)
    h = p.t_ref / p.os
    Phi, Gam, b = C.cp_state_space(lf, p.kvco, h)
    t_off = p.t_off if p.t_off is not None else auto_t_off(p, seq)

    # slice currents (static mismatch or unit-cell + DEM)
    if p.arch == "two" and p.unit_sigma > 0:
        rng = np.random.default_rng(p.seed + 101)
        du = rng.normal(0, p.unit_sigma, p.X)
        du -= du.mean()
        units = (1 + du) / p.X
        if p.dem == "random":
            j = rng.integers(0, p.X, p.n_cyc)
        else:
            j = np.full(p.n_cyc, p.X - 1)
        w2 = units[j]
        w_act = np.stack([units.sum() - w2, w2], axis=1)
    else:
        eps = np.zeros(M) if p.eps is None else np.asarray(p.eps, float)
        w_act = (w * (1 + eps))[None, :]
    post = np.zeros(M) if p.post_skew is None else np.asarray(p.post_skew, float)
    path = np.zeros((M, p.x_eff + 2))
    if M > 1:
        path[1:, 0] = p.dt1            # B=0 bypass path of the DTC MUX (FIG. 15 dT1)
    wsum = float(w_act.mean(0).sum())
    ib = p.icp * wsum * (1 + 0.5 * p.beta) * t_off / p.t_ref
    sig_ref = C.white_timing_sigma_from_floor(p.ref_floor, p.f_ref, p.f_ref) if p.ref_floor is not None else 0.0
    sig_vco = C.wiener_step_sigma(p.vco_L1M, 1e6, p.f_ref * p.os) if p.vco_L1M is not None else 0.0
    sicp = p.sicp if p.cp_noise else 0.0
    var_bleed = sicp * (ib / p.icp) * p.t_ref * 0.5 if p.cp_noise else 0.0
    theta0 = float(seq["r_eff"].mean() - t_off / p.t_vco)
    out, emin, emax, emean, slips = _cp_loop(
        seq["r1"].astype(np.float64), seq["d"], w_act.astype(np.float64), w.astype(np.float64),
        post, path, p.retimed, p.rt_margin, p.rt_sigma, p.mmd_jit, p.t_vco, p.icp,
        p.beta, ib, Phi, Gam, b[1], p.os, sig_ref, p.pfd_jit, sicp, p.t_rst,
        var_bleed, sig_vco, theta0, p.seed + 7)
    theta = out[p.settle * p.os:]
    return dict(theta=theta, fs=p.f_ref * p.os, f_vco=p.f_vco, emin=emin, emax=emax,
                emean=emean, slips=int(slips), t_off=t_off, lf=lf, seq=seq,
                sig_ref=sig_ref, ib=ib, params=p)


def pn(res, nperseg=2 ** 16):
    return C.phase_noise(res["theta"], res["fs"], nperseg=nperseg)


# ----------------------------------------------------------------------------
# Linear (s-domain) noise model for cross-checking the time-domain simulator
# ----------------------------------------------------------------------------
def analytic_pn(f, p: SlicedCPParams, t_off, emean=None):
    """Component phase-noise curves [dBc/Hz] from the linearised loop."""
    f = np.asarray(f, float)
    lf = loop_filter(p)
    Lg = C.cp_open_loop(f, p.icp, p.kvco, p.nf, lf)
    H2 = np.abs(Lg / (1 + Lg)) ** 2
    E2 = np.abs(1 / (1 + Lg)) ** 2
    w = p.slices()
    X = p.x_eff
    wv = (2 * np.pi * p.f_vco) ** 2
    out = {}
    # SDM (fine quantiser, LSB = T_VCO/X, MASH 1-1-1 -> phase shaped (1-z^-1)^2)
    S_r = (1 / X ** 2) / 12 * (2 / p.f_ref) * np.abs(2 * np.sin(np.pi * f / p.f_ref)) ** 4
    out["sdm"] = 10 * np.log10((2 * np.pi) ** 2 * S_r * H2 / 2)
    if p.vco_L1M is not None:
        out["vco"] = p.vco_L1M + 20 * np.log10(1e6 / f) + 10 * np.log10(E2)
    if p.ref_floor is not None:
        s = C.white_timing_sigma_from_floor(p.ref_floor, p.f_ref, p.f_ref)
        out["ref"] = 10 * np.log10(wv * 2 * s ** 2 / p.f_ref * H2 / 2)
    if p.pfd_jit > 0:
        out["pfd"] = 10 * np.log10(wv * 2 * p.pfd_jit ** 2 * np.sum(w ** 2) / p.f_ref * H2 / 2)
    if p.cp_noise:
        out["cp"] = 10 * np.log10(wv * 2 * cp_charge_var(p, t_off, emean) / p.icp ** 2 / p.f_ref * H2 / 2)
    tot = sum(10 ** (v / 10) for v in out.values())
    out["total"] = 10 * np.log10(tot)
    return out


def cp_charge_var(p: SlicedCPParams, t_off, emean=None):
    """Per-cycle CP+bleed noise charge variance [C^2] (on-time model)."""
    w = p.slices()
    if emean is None:
        emean = np.full(len(w), t_off)
    on = np.asarray(emean) + p.t_rst
    var = float(np.sum(p.sicp * w * on * 0.5))
    var += p.sicp * t_off * 0.5          # bleed source always on
    return var
