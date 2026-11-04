"""Stimulus / noise generation and kernel wrapper."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .core import run_kernel
from .dtc import DTCModel
from .loop import ramp_tau, substep_matrices, t_lock, v_lock
from .noise import (edge_white_psd, ktc_s1, ktc_s2, shaped_noise, vco_psd, xo_psd)
from .params import SPLLParams

NLC_ID = {"none": 0, "poly": 1, "pwl": 2, "lut": 3, "fglut": 4, "fglut+poly": 5}


@dataclass
class SimResult:
    p: SPLLParams
    m_sub: int
    n_discard: int
    tau: np.ndarray
    x: np.ndarray
    v2: np.ndarray
    phe: np.ndarray
    kd: np.ndarray
    dcc: np.ndarray
    vref: np.ndarray
    code: np.ndarray
    g2: np.ndarray
    g3: np.ndarray
    pwl: np.ndarray
    lut: np.ndarray
    dtc: DTCModel
    kd_ideal: float
    extra: dict = field(default_factory=dict)

    @property
    def fs_out(self) -> float:
        return self.m_sub * self.p.f_ref

    def tau_steady(self) -> np.ndarray:
        return self.tau[self.n_discard * self.m_sub:]

    def time_us(self) -> np.ndarray:
        return np.arange(self.x.size) * self.p.t_ref * 1e6

    def frozen(self, last: int = 8000) -> dict:
        """Averaged converged calibration state (to freeze it in noiseless runs)."""
        return dict(kd=float(np.mean(self.kd[-last:])), dcc=float(np.mean(self.dcc[-last:])),
                    g2=float(np.mean(self.g2[-last:])), g3=float(np.mean(self.g3[-last:])),
                    pwl=self.pwl.copy(), lut=self.lut.copy())


def fg_inverse_map(dtc: DTCModel, meas_err: float, rng, mode: str = "iid") -> np.ndarray:
    """Foreground NLC: the DTC curve is measured once (e.g. on-chip TDC / spectrum method of
    the author's tutorial, rms error meas_err in LSB) and inverted: for a requested code cf
    (1/8-LSB grid) pick the integer code whose MEASURED delay is closest to the best-fit line."""
    if mode == "cumdnl":
        # INL = running sum of the measured DNL steps: the error is a random walk in code;
        # scaled so that its rms about the best-fit line equals meas_err
        w = np.cumsum(rng.standard_normal(dtc.delay.size))
        w -= np.polyval(np.polyfit(dtc.codes, w, 1), dtc.codes)
        err = meas_err * w / np.sqrt(np.mean(w ** 2))
    else:
        err = meas_err * rng.standard_normal(dtc.delay.size)
    meas = dtc.delay + err * dtc.lsb_fit
    slope, off = np.polyfit(dtc.codes, meas, 1)
    target = off + slope * (np.arange(8 * dtc.codes.size) / 8.0)
    idx = np.searchsorted(meas, target)
    idx = np.clip(idx, 1, dtc.codes.size - 1)
    lo, hi = meas[idx - 1], meas[idx]
    best = np.where(np.abs(target - lo) <= np.abs(hi - target), idx - 1, idx)
    return best.astype(float)


def simulate(p: SPLLParams, n_cycles: int, m_half: int = 1, n_discard: int = 0,
             state: dict | None = None) -> SimResult:
    """Run the PLL for n_cycles reference cycles.  `state` (from SimResult.frozen) sets the
    initial calibration values (K_DTC, dcc, g2, g3, PWL nodes)."""
    rng = np.random.default_rng(p.seed)
    n = int(n_cycles)
    m_sub = 2 * m_half
    dtc = DTCModel(p)
    phi, g_u, g_i = substep_matrices(p, m_half)
    t_vco = p.t_vco
    kd_ideal = t_vco / dtc.lsb_fit
    st = dict(state or {})
    kd0 = st.get("kd", p.kdtc_init if p.kdtc_init is not None else t_vco / p.dtc_lsb_design)
    dcc0 = st.get("dcc", p.dcc_init)
    g2_0 = st.get("g2", 0.0)
    g3_0 = st.get("g3", 0.0)
    nseg = p.pwl_segments
    pwl0 = st.get("pwl", kd0 * (-1.0 + 2.0 * np.arange(nseg + 1) / nseg))
    if len(pwl0) != nseg + 1:
        pwl0 = kd0 * (-1.0 + 2.0 * np.arange(nseg + 1) / nseg)
    nbins = (1 << p.dtc_bits) >> p.lut_shift
    lut0 = np.asarray(st.get("lut", np.zeros(nbins)), float)
    if lut0.size != nbins:
        lut0 = np.zeros(nbins)
    code_mid = 0.5 * (dtc.table.size - 1)
    inv_map = np.zeros(1)
    if p.nlc in ("fglut", "fglut+poly"):
        # the table is measured at the calibration condition; fg_drift = relative change of
        # the static bow between measurement and operation (e.g. temperature)
        dtc_meas = DTCModel(p.with_(dtc_inl_end_lsb=p.dtc_inl_end_lsb / (1.0 + p.fg_drift)))
        inv_map = fg_inverse_map(dtc_meas, p.fg_meas_err, np.random.default_rng(p.seed + 99),
                                 p.fg_meas_mode)

    # ------------------------------------------------------------------ noises
    def white(sigma):
        return sigma * rng.standard_normal(n) if (p.noise and sigma > 0) else np.zeros(n)

    def edge(share):
        if not p.noise:
            return np.zeros(n)
        s = np.sqrt(share) * p.ref_white
        fl = shaped_noise(n, p.f_ref, lambda f: share * edge_white_psd(p) * p.ref_flicker_fc / f,
                          rng)
        return s * rng.standard_normal(n) + fl

    parity = np.where(np.arange(n) % 2 == 0, 1.0, -1.0)
    if p.noise:
        x_xo = shaped_noise(n, p.f_ref, lambda f: xo_psd(p, f), rng)
        x_vco = shaped_noise(n * m_sub + 1, p.f_ref * m_sub, lambda f: vco_psd(p, f), rng)
        v_gm = (p.gm_en * np.sqrt(p.f_ref / 2) * rng.standard_normal(n) +
                shaped_noise(n, p.f_ref, lambda f: p.gm_en ** 2 * p.gm_fc / f, rng))
    else:
        x_xo = np.zeros(n)
        x_vco = np.zeros(n * m_sub + 1)
        v_gm = np.zeros(n)
    duty = (p.duty_err / 2.0) * (parity < 0) if p.doubler else np.zeros(n)
    e_ref = x_xo + edge(1.0 - p.div_share) + duty
    n_div = edge(p.div_share)
    n_s1 = white(ktc_s1(p))
    n_s2 = white(ktc_s2(p))
    n_cmp = white(p.cmp_noise)
    i_gm = p.gm * v_gm

    # ----------------------------------------------- start close to lock
    q = np.linspace(-0.98, 0.98, 2001)
    codes = np.clip(np.floor(code_mid + kd0 * q + 0.5), 0, dtc.table.size - 1).astype(int)
    off = np.mean(q * t_vco - dtc.table[codes])
    dint0 = np.floor(dcc0 / t_vco + 0.5)
    tau0 = off - 0.5 * dcc0 - p.duty_err / 4.0 * p.doubler - t_lock(p)
    del dint0

    out_tau = np.empty(n * m_sub)
    names = ("x", "v2", "phe", "kd", "dcc", "vref", "g2", "g3")
    out = {k: np.empty(n) for k in names}
    out_code = np.empty(n, dtype=np.int64)
    out_pwl = np.empty(nseg + 1)
    out_lut = np.empty(nbins)
    gear_cycles = p.gear_cycles if p.gear_time > 0 else 1 << 62
    nlc_start = int(round(p.nlc_start * p.f_ref))
    run_kernel(n, m_half, phi, g_u, g_i,
               np.int64(p.alpha_int), np.int64(p.acc_bits), t_vco,
               dtc.table, dtc.mem_coef, code_mid,
               e_ref, n_div, n_s1, n_s2, n_cmp, i_gm, x_vco, parity,
               p.vdd_ramp, ramp_tau(p), v_lock(p), p.lam, p.cmp_os, p.v_ref,
               p.vref_dac_step, p.vref_sd_gain,
               p.cal_gain, p.cal_dcc and p.doubler, gear_cycles, p.mu_k, p.mu_dcc, kd0, dcc0,
               NLC_ID[p.nlc], p.mu_g2, p.mu_g3, g2_0, g3_0, np.asarray(pwl0, float),
               p.mu_pwl, nlc_start, lut0, p.lut_shift, p.mu_lut, p.nlc_leak, p.nlc_weight,
               int(round(p.nlc_gear_time * p.f_ref)), inv_map, tau0,
               out_tau, out["x"], out["v2"], out["phe"], out["kd"], out["dcc"], out["vref"],
               out_code, out["g2"], out["g3"], out_pwl, out_lut)
    return SimResult(p=p, m_sub=m_sub, n_discard=int(n_discard), tau=out_tau, x=out["x"],
                     v2=out["v2"], phe=out["phe"], kd=out["kd"], dcc=out["dcc"],
                     vref=out["vref"], code=out_code, g2=out["g2"], g3=out["g3"],
                     pwl=out_pwl, lut=out_lut, dtc=dtc, kd_ideal=kd_ideal,
                     extra=dict(tau0=tau0, t_lock=t_lock(p)))


def spur_run(p: SPLLParams, n_conv: int = 60000, n_meas: int = 1 << 17, m_half: int = 1,
             avg: int = 8000):
    """Converge all background loops with noise, freeze them, then simulate noiselessly so
    that only deterministic (fractional) tones remain.  Returns (SimResult, frozen state)."""
    r = simulate(p.with_(noise=True), n_conv)
    stt = r.frozen(avg)
    pq = p.with_(noise=False, cal_gain=False, cal_dcc=False)
    rq = simulate(pq, n_meas + (1 << 14), m_half=m_half, n_discard=1 << 14, state=stt)
    return rq, stt
