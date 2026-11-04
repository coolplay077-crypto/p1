"""High-level wrapper: builds stimuli / noise and runs the numba kernel."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .core import run_kernel
from .dtc import DTCModel
from .loopfilter import (design_loop_filter, discretize, kpd, spd_lock_time,
                         state_space)
from .noise import (gm_current_psd, ktc_voltage, resistor_psd, shaped_noise,
                    vco_timing_psd, xo_timing_psd)
from .params import SPLLParams


@dataclass
class SimResult:
    p: SPLLParams
    m_sub: int
    n_discard: int
    tau: np.ndarray        # VCO excess timing (phase lead) at m_sub*f_pd  [s]
    dt: np.ndarray         # SPD timing error per cycle [s]
    vs: np.ndarray         # sampled voltage per cycle [V]
    c: np.ndarray          # comparator decisions
    kd: np.ndarray         # digital DTC gain (codes / T_out)
    dcc: np.ndarray        # DCC estimate [s]
    code: np.ndarray       # DTC code
    vcref: np.ndarray      # comparator reference voltage
    kd_ideal: float
    dtc: DTCModel
    lf: object
    extra: dict = field(default_factory=dict)

    @property
    def fs_out(self) -> float:
        return self.m_sub * self.p.f_pd

    def tau_steady(self) -> np.ndarray:
        return self.tau[self.n_discard * self.m_sub:]

    def time_us(self) -> np.ndarray:
        return np.arange(self.dt.size) * self.p.t_pd * 1e6


def _schedule(t, mu):
    return np.asarray(t, dtype=np.int64), np.asarray(mu, dtype=np.float64)


def simulate(p: SPLLParams, n_cycles: int, m_sub: int = 1, n_discard: int = 0,
             kd_override: float | None = None, dcc_override: float | None = None,
             lf=None) -> SimResult:
    rng = np.random.default_rng(p.seed)
    n = int(n_cycles)
    lf = lf or design_loop_filter(p)
    a, b_i, b_r1, b_r3 = state_space(p, lf)
    phi, (gam, gr1, gr3) = discretize(a, [b_i, b_r1, b_r3], p.t_pd / m_sub)

    dtc = DTCModel(p)
    kd_ideal = dtc.kd_ideal(p.t_out)
    kd_nominal = p.t_out / p.dtc_lsb          # designer's preset: nominal LSB
    kd0 = kd_nominal * (1.0 + p.kd_init_err) if kd_override is None else kd_override
    dcc0 = p.dcc_init if dcc_override is None else dcc_override
    code_mid = 0.5 * (dtc.table.size - 1)       # centred DTC code

    # ------------------------------------------------------------- noises -----
    nz = 1.0 if p.noise else 0.0
    t_pd = p.t_pd

    def white(sigma):
        if sigma == 0.0 or not p.noise:
            return np.zeros(n)
        return sigma * rng.standard_normal(n)

    if p.noise:
        x_xo = shaped_noise(n, p.f_pd, lambda f: xo_timing_psd(p, f), rng)
        x_vco = shaped_noise(n * m_sub + 1, p.f_pd * m_sub,
                             lambda f: vco_timing_psd(p, f), rng)
    else:
        x_xo = np.zeros(n)
        x_vco = np.zeros(n * m_sub + 1)
    parity = (np.arange(n) & 1).astype(float)
    e_ref = x_xo + white(p.ref_buf_jitter) + p.duty_err_s * parity
    n_dtc = white(1.0)
    n_div = white(p.div_jitter)
    n_slope = white(p.spd_slope_jitter)
    n_ktc = white(ktc_voltage(p))
    n_cmp = white(p.cmp_noise)
    n_gm = white(np.sqrt(gm_current_psd(p) / (2 * t_pd)))
    n_r1 = white(np.sqrt(resistor_psd(p, lf.r1) / (2 * t_pd)))
    n_r3 = white(np.sqrt(resistor_psd(p, lf.r3) / (2 * t_pd)))

    # ------------------------------------------- start (approximately) locked --
    q_mid = 0.5 * (p.q_span + 0.5)
    qg = (np.arange(4096) + 0.5) / 4096 * p.q_span + 0.25
    if p.use_dtc:
        codes = np.clip(np.floor(kd0 * (qg - q_mid) + code_mid + 0.5), 0,
                        dtc.table.size - 1).astype(int)
        off_dtc = np.mean(dtc.table[codes] - qg * p.t_out)
    else:
        off_dtc = -np.mean(qg) * p.t_out
    dint0 = np.floor(dcc0 / p.t_out + 0.5)          # MMD part of the DCC shift (odd edges)
    tau0 = off_dtc + 0.5 * dint0 * p.t_out - 0.5 * p.duty_err_s
    z0 = np.array([0.0, 0.0, 0.0, tau0])

    kd_t, kd_mu = _schedule(p.kd_sched_t, p.kd_sched_mu)
    dc_t, dc_mu = _schedule(p.dcc_sched_t, p.dcc_sched_mu)

    out_tau = np.empty(n * m_sub)
    out = {k: np.empty(n) for k in ("dt", "vs", "c", "kd", "dcc", "vcref")}
    out_code = np.empty(n, dtype=np.int64)

    run_kernel(n, m_sub, phi, gam, gr1, gr3,
               np.int64(p.alpha_int), np.int64(p.acc_bits), p.dsm_order, p.t_out, p.q_span,
               p.use_dtc, dtc.table, dtc.sigma * nz, kd0, code_mid, p.dtc_sdm,
               p.cal_gain, 1 if p.gain_ref == 'dq' else 0, kd_t, kd_mu, p.cal_dcc, dcc0, dc_t, dc_mu,
               e_ref, n_dtc, n_div, n_slope, n_ktc, n_cmp, n_gm, n_r1, n_r3,
               p.spd_vlow, p.spd_vhigh, p.spd_va, p.spd_slope, spd_lock_time(p), p.spd_vref,
               p.gm, p.cmp_offset, p.vref_step,
               x_vco, z0,
               out_tau, out["dt"], out["vs"], out["c"], out["kd"], out["dcc"],
               out_code, out["vcref"])

    return SimResult(p=p, m_sub=m_sub, n_discard=int(n_discard), tau=out_tau,
                     dt=out["dt"], vs=out["vs"], c=out["c"], kd=out["kd"], dcc=out["dcc"],
                     code=out_code, vcref=out["vcref"], kd_ideal=kd_ideal, dtc=dtc, lf=lf,
                     extra=dict(kpd=kpd(p), tau0=tau0))


def converge_then_freeze(p: SPLLParams, n_conv: int = 40000, avg_last: int = 8000):
    """Run the background calibrations with noise, return the averaged converged values
    (used to freeze the loops in noiseless spur simulations)."""
    r = simulate(p.with_(noise=True), n_conv)
    kd = float(np.mean(r.kd[-avg_last:]))
    dcc = float(np.mean(r.dcc[-avg_last:]))
    return kd, dcc
