"""Digital-to-time converter (DTC) models.

Two physically motivated transfer curves are provided:

* ``inverter_vs`` - a conventional *variable-slope* DTC: an inverter (R_on) charges a
  digitally switched capacitor bank C(code); the next inverter detects the threshold.
  Its delay is  t(C) = R_on*ln2*C + sqrt(2*C_L2*R_on*C/G_m2): the second term is the
  slope-dependent switching delay of the detecting inverter (input ramp slope ~ 1/C),
  which bends the curve (dominantly 2nd-order INL, ~1-2 % of full scale).

* ``constant_slope`` - the "highly linear DTC" option: a constant current I0 charges
  C_R from a code-dependent start voltage V_init(code) (R-string DAC) up to a fixed
  threshold.  The detector always sees the same slope, so the slope-dependent term
  vanishes; only the finite output resistance of the (cascoded) current source and
  DAC element mismatch remain (INL < 0.5 LSB).

The abstract of the paper states only that the DTC is "highly linear"; the exact
circuit is not public, so ``constant_slope`` is our physically motivated stand-in.
"""
from __future__ import annotations

import numpy as np

from .params import SPLLParams


def _segmented_cap_bank(codes, n_bits, cu, sigma_u, rng, n_bin=5):
    """Capacitance of a segmented bank: (n_bits-n_bin) thermometer MSBs + n_bin binary LSBs.
    Element of n units has relative mismatch sigma_u/sqrt(n) (Pelgrom)."""
    n_msb = n_bits - n_bin
    bin_w = 2 ** np.arange(n_bin)
    bin_c = bin_w * cu * (1 + sigma_u / np.sqrt(bin_w) * rng.standard_normal(n_bin))
    th_units = 2 ** n_bin
    th_c = th_units * cu * (1 + sigma_u / np.sqrt(th_units) *
                            rng.standard_normal(2 ** n_msb - 1))
    th_cum = np.concatenate(([0.0], np.cumsum(th_c)))
    lsb_part = codes & (2 ** n_bin - 1)
    msb_part = codes >> n_bin
    c_bin = ((lsb_part[:, None] >> np.arange(n_bin)) & 1) @ bin_c
    return th_cum[msb_part] + c_bin


def _inverter_vs(codes, p: SPLLParams, rng):
    r_on, c0, c_l2, g_m2 = 1e3, 20e-15, 4e-15, 2e-3
    cu = 0.287e-15
    c = c0 + _segmented_cap_bank(codes, p.dtc_bits, cu, 0.01, rng)
    k = np.sqrt(2.0 * c_l2 * r_on / g_m2)
    return r_on * np.log(2.0) * c + k * np.sqrt(c)


def _constant_slope(codes, p: SPLLParams, rng):
    n = 1 << p.dtc_bits
    i0, c_r, r_o = 200e-6, 200e-15, 500e3          # cascoded current source
    slope0 = i0 / c_r                               # 1 V/ns
    v_span = n * p.dtc_lsb * slope0                 # DAC span (~0.23 V)
    v_min = 20e-3                                   # minimum ramp headroom
    # R-string DAC with 1 % unit-resistor mismatch
    r = 1.0 + 0.01 * rng.standard_normal(n)
    v_dac = v_span * np.concatenate(([0.0], np.cumsum(r)[:-1])) / r.sum()
    a = i0 * r_o                                    # V_inf - V_th of the RC-like source
    tau = r_o * c_r
    x = v_min + v_dac[codes]                        # V_th - V_init(code)
    return tau * np.log1p(x / a)                    # exact finite-r_o charging time


class DTCModel:
    """Delay table, jitter table and linearity metrics of one DTC instance."""

    t_intrinsic = 35e-12

    def __init__(self, p: SPLLParams):
        self.p = p
        n = 1 << p.dtc_bits
        self.codes = np.arange(n)
        rng = np.random.default_rng(p.dtc_seed)
        if p.dtc_type == "ideal":
            t = self.codes * p.dtc_lsb
        elif p.dtc_type == "constant_slope":
            t = _constant_slope(self.codes, p, rng)
        elif p.dtc_type == "inverter_vs":
            t = _inverter_vs(self.codes, p, rng)
        else:
            raise ValueError(p.dtc_type)
        t = t - t[0]
        # normalise the physical curve to the nominal LSB, then apply the PVT error
        lsb_raw, off_raw = np.polyfit(self.codes, t, 1)
        if p.dtc_inl_scale != 1.0:     # scale the non-linearity around the best-fit line
            line = off_raw + lsb_raw * self.codes
            t = line + p.dtc_inl_scale * (t - line)
            t = t - t[0]
        t = t * (p.dtc_lsb / lsb_raw) * (1.0 + p.dtc_gain_err)
        self.delay = t                                   # code-dependent part [s]
        self.table = self.t_intrinsic + t                # absolute delay [s]
        frac = t / (n * p.dtc_lsb)
        self.sigma = np.sqrt(p.dtc_jit_fixed ** 2 + (p.dtc_jit_fs * frac) ** 2)
        self.lsb_fit, off = np.polyfit(self.codes, t, 1)
        self.inl_fit = t - (off + self.lsb_fit * self.codes)
        self.inl_end = t - (t[0] + self.codes * (t[-1] - t[0]) / (n - 1))
        self.dnl = np.diff(t) / self.lsb_fit - 1.0

    # ideal digital gain: DTC codes per output period
    def kd_ideal(self, t_out: float) -> float:
        return t_out / self.lsb_fit

    def summary(self) -> dict:
        return dict(type=self.p.dtc_type,
                    lsb_ps=self.lsb_fit * 1e12,
                    range_ps=self.delay[-1] * 1e12,
                    inl_fit_pk_ps=np.max(np.abs(self.inl_fit)) * 1e12,
                    inl_end_pk_ps=np.max(np.abs(self.inl_end)) * 1e12,
                    inl_fit_pk_lsb=np.max(np.abs(self.inl_fit)) / self.lsb_fit,
                    dnl_pk_lsb=np.max(np.abs(self.dnl)))
