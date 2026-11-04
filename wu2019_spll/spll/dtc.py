"""RC-delay (variable-slope) DTC of Wu et al. JSSC 2019, Sec. V-A, Fig. 10/11.

Delay stage: resistor R charges C(code) = C_fix + C_par + binary-weighted array (C_LSB = 2 fF).
The ramp crosses the inverter-buffer threshold after ln2*R*C(code) (exactly linear in C), but
the buffer's propagation delay depends on the input slope (~1/C): for an inverter driven by a
ramp the extra delay grows ~ sqrt(C)  ->  t(code) = ln2*R*C + k*sqrt(C)  (concave, "strong
2nd-order" INL, Fig. 11 / tutorial).  The large fixed capacitance (~2 pF of the oversized
inverter buffer) reduces the relative slope variation over the code range and keeps the INL
around 1 LSB, as in the paper.  Additional effects:
  * unit-capacitor mismatch (Pelgrom)                  -> DNL ~ +-0.2 LSB
  * code-dependent supply settling (memory effect)     -> spread < 0.3 LSB (applied in kernel)
"""
from __future__ import annotations

import numpy as np

from .params import SPLLParams

C_PAR = 0.1e-12          # [A] switch / routing parasitics of the delay node


def _array_cap(codes, bits, clsb, mismatch, rng):
    w = 2.0 ** np.arange(bits)
    if mismatch > 0:
        cb = w * clsb * (1.0 + mismatch / np.sqrt(w) * rng.standard_normal(bits))
    else:
        cb = w * clsb
    return ((codes[:, None] >> np.arange(bits)) & 1) @ cb


def _sqrt_bow_unit(c0, c1):
    """Max deviation of sqrt(C) from its chord over [c0, c1] (per unit k)."""
    s0, s1 = np.sqrt(c0), np.sqrt(c1)
    return (s1 - s0) ** 2 / (4.0 * (s1 + s0))


def slope_coefficient(p: SPLLParams) -> float:
    """k of the slope-dependent buffer delay, set at the paper geometry (C_fix = 2 pF) so that
    the static endpoint INL equals dtc_inl_end_lsb.  Keeping k and changing C_fix then
    predicts how the INL scales with the fixed capacitor (slide 17 of the author's tutorial)."""
    n = 1 << p.dtc_bits
    c0 = 2e-12 + C_PAR
    c1 = c0 + (n - 1) * p.dtc_clsb
    return p.dtc_inl_end_lsb * p.dtc_lsb / _sqrt_bow_unit(c0, c1)


class DTCModel:
    def __init__(self, p: SPLLParams):
        self.p = p
        n = 1 << p.dtc_bits
        self.codes = np.arange(n)
        rng = np.random.default_rng(p.dtc_seed)
        c = p.dtc_cfix + C_PAR + _array_cap(self.codes, p.dtc_bits, p.dtc_clsb,
                                            p.dtc_mismatch, rng)
        k = slope_coefficient(p)
        lsb = p.dtc_lsb * (1.0 + p.dtc_gain_err)
        s_c = np.polyfit(self.codes, c, 1)[0]
        s_sq = np.polyfit(self.codes, np.sqrt(c), 1)[0]
        a = (lsb - k * s_sq) / s_c                     # = ln2 * R
        self.r = a / np.log(2.0)
        t = a * c + k * np.sqrt(c)
        self.delay = t - t[0]                          # code-dependent delay [s]
        self.table = 40e-12 + self.delay               # absolute (intrinsic 40 ps assumed)
        self.lsb_fit, off = np.polyfit(self.codes, self.delay, 1)
        self.inl_fit = self.delay - (off + self.lsb_fit * self.codes)
        self.inl_end = self.delay - self.codes * (self.delay[-1] / (n - 1))
        self.dnl = np.diff(self.delay) / self.lsb_fit - 1.0
        # memory effect: dt = mem_coef*(code_prev - mid)*(code/mid), spread = dtc_mem_lsb LSB
        self.mem_coef = p.dtc_mem_lsb * self.lsb_fit / 512.0
        self.k = k
        self.cap = c

    def summary(self) -> dict:
        return dict(lsb_ps=float(self.lsb_fit * 1e12), range_ps=float(self.delay[-1] * 1e12),
                    r_ohm=float(self.r), c_fix_pf=float(self.p.dtc_cfix * 1e12),
                    inl_end_pk_lsb=float(np.max(np.abs(self.inl_end)) / self.lsb_fit),
                    inl_fit_pk_lsb=float(np.max(np.abs(self.inl_fit)) / self.lsb_fit),
                    dnl_pk_lsb=float(np.max(np.abs(self.dnl))),
                    mem_spread_lsb=float(self.p.dtc_mem_lsb))


# DTC scenarios used in the INL-calibration study ------------------------------------
SCENARIOS = {
    # paper design: C_fix ~2 pF, 400 uA bleeding current (INL ~1 LSB, memory < 0.3 LSB)
    "paper": dict(),
    # low-power DTC: bleeding current 10 uA -> max INL 2.4 LSB (Sec. V-A) and 3x memory
    "low_bleed": dict(dtc_inl_end_lsb=2.8, dtc_mem_lsb=0.9),
    # smaller / cheaper inverter buffer: fixed cap 0.5 pF (same physics, k unchanged)
    "small_cfix": dict(dtc_cfix=0.5e-12),
}
