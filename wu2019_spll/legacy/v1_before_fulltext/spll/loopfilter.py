"""Gm-driven passive loop filter + VCO as an exact zero-order-hold state-space model.

State z = [v_C1, v_2, v_3, tau]:
  v_2   : node driven by the Gm current (C2 to ground, R1-C1 branch to ground)
  v_3   : VCO tuning node after the extra R3-C3 pole
  tau   : VCO excess timing (phase lead) in seconds, d tau/dt = Kvco*v_3/f_out

The S/H output is held for a whole reference period, so the Gm current is piecewise
constant and the discretisation below (matrix exponential) is exact.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.linalg import expm

from .params import SPLLParams


def spd_lock_time(p: SPLLParams) -> float:
    """Ramp time at which the slope generator crosses the lock point V_REF."""
    dv = p.spd_vref - p.spd_vlow
    return -(p.spd_va / p.spd_slope) * np.log(1.0 - dv / p.spd_va)


def spd_slope_eff(p: SPLLParams) -> float:
    """Small-signal SPD gain dV/dt at the lock point (ramp compression included)."""
    return p.spd_slope * np.exp(-p.spd_slope * spd_lock_time(p) / p.spd_va)


def kpd(p: SPLLParams) -> float:
    """Phase-detector + Gm gain  [A per second of timing error]."""
    return p.gm * spd_slope_eff(p)


@dataclass
class LoopFilter:
    r1: float
    c1: float
    c2: float
    r3: float
    c3: float


def design_loop_filter(p: SPLLParams) -> LoopFilter:
    """Classic type-II, 3rd-order design: zero at f_c/b, pole at f_c*b, |L(f_c)|=1."""
    wc = 2 * np.pi * p.f_c
    b = p.lf_b
    c_tot = kpd(p) * p.kvco * b / (p.lf_design_fout * wc ** 2)
    c2 = c_tot / b ** 2
    c1 = c_tot - c2
    r1 = (b / wc) / c1
    c3 = p.c3_ratio * c2
    r3 = 1.0 / (2 * np.pi * p.f_p3 * c3)
    return LoopFilter(r1, c1, c2, r3, c3)


def state_space(p: SPLLParams, lf: LoopFilter):
    r1, c1, c2, r3, c3 = lf.r1, lf.c1, lf.c2, lf.r3, lf.c3
    a = np.array([
        [-1 / (r1 * c1), 1 / (r1 * c1), 0.0, 0.0],
        [1 / (r1 * c2), -1 / (r1 * c2) - 1 / (r3 * c2), 1 / (r3 * c2), 0.0],
        [0.0, 1 / (r3 * c3), -1 / (r3 * c3), 0.0],
        [0.0, 0.0, p.kvco / p.f_out_q, 0.0],
    ])
    b_i = np.array([0.0, 1 / c2, 0.0, 0.0])                 # Gm current
    b_r1 = np.array([-1 / (r1 * c1), 1 / (r1 * c2), 0.0, 0.0])  # series noise of R1
    b_r3 = np.array([0.0, 1 / (r3 * c2), -1 / (r3 * c3), 0.0])  # series noise of R3
    return a, b_i, b_r1, b_r3


def discretize(a, bs, t):
    """Exact ZOH discretisation: returns Phi and the list of input vectors."""
    n = a.shape[0]
    m = len(bs)
    big = np.zeros((n + m, n + m))
    big[:n, :n] = a
    for j, b in enumerate(bs):
        big[:n, n + j] = b
    e = expm(big * t)
    return e[:n, :n], [e[:n, n + j].copy() for j in range(m)]
