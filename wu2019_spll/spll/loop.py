"""Sampling PD + resistor-less PI loop of Fig. 1 / Fig. 12 as an exact sampled-data model.

Continuous part, state z = [v_P, v_I, tau]  (deviations from the locked operating point)
    v_P : V_CTRL_P after the R2-C2 filter, driven by the held sampler voltage V_S2
    v_I : V_CTRL_I on C_I, charged by Gm*(v_P) (+ Gm noise current)
    tau : VCO excess timing (phase lead) in seconds
    dv_P/dt = (u - v_P)/tau2,  dv_I/dt = gm*v_P/C_I + i_n/C_I,
    dtau/dt = (K_VCO_P*v_P + K_VCO_I*v_I)/f_vco
Sampler (eq. 5): V_S2[k] = (1-lam)*V_S2[k-1] + lam*V_S1[k], updated half a reference period
after the CLKFB sampling edge (z^-0.5), then held  ->  the first half of each period sees the
old V_S2, the second half the new one.
"""
from __future__ import annotations

import numpy as np
from scipy.linalg import expm

from .params import SPLLParams


def ramp_tau(p: SPLLParams) -> float:
    """RC time constant of the slope generator so that dV/dt = K_slope at V_ref."""
    return (p.vdd_ramp - p.v_ref) / p.k_slope


def v_lock(p: SPLLParams) -> float:
    """Locked sampled voltage: Gm input (incl. offset) sees zero average current."""
    return p.v_ref + p.gm_os


def k_slope_lock(p: SPLLParams) -> float:
    return (p.vdd_ramp - v_lock(p)) / ramp_tau(p)


def t_lock(p: SPLLParams) -> float:
    return -ramp_tau(p) * np.log(1.0 - v_lock(p) / p.vdd_ramp)


def continuous(p: SPLLParams):
    tau2 = 1.0 / (2 * np.pi * p.f_rc2)
    a = np.array([[-1.0 / tau2, 0.0, 0.0],
                  [p.gm / p.c_i, 0.0, 0.0],
                  [p.kvco_p / p.f_vco, p.kvco_i / p.f_vco, 0.0]])
    b_u = np.array([1.0 / tau2, 0.0, 0.0])
    b_i = np.array([0.0, 1.0 / p.c_i, 0.0])
    return a, b_u, b_i


def zoh(a, bs, t):
    n, m = a.shape[0], len(bs)
    big = np.zeros((n + m, n + m))
    big[:n, :n] = a
    for j, b in enumerate(bs):
        big[:n, n + j] = b
    e = expm(big * t)
    return e[:n, :n], [e[:n, n + j].copy() for j in range(m)]


def substep_matrices(p: SPLLParams, m_half: int):
    """Matrices for one sub-step of length T/(2*m_half)."""
    a, b_u, b_i = continuous(p)
    phi, (g_u, g_i) = zoh(a, [b_u, b_i], p.t_ref / (2 * m_half))
    return phi, g_u, g_i


def period_model(p: SPLLParams):
    """Per-reference-period linear model, state s = [z(3), w = V_S2[k-1]], input dt[k]
    (timing error at the SPD), plus noise inputs.  Returns dict of matrices."""
    a, b_u, b_i = continuous(p)
    ph, (gu, gi) = zoh(a, [b_u, b_i], p.t_ref / 2)
    lam, ks = p.lam, k_slope_lock(p)
    A = np.zeros((4, 4))
    A[:3, :3] = ph @ ph
    A[:3, 3] = ph @ gu + (1 - lam) * gu
    A[3, 3] = 1 - lam
    B_dt = np.zeros(4)
    B_dt[:3] = lam * ks * gu
    B_dt[3] = lam * ks
    B_v2 = np.zeros(4)            # voltage noise added to V_S2 at charge sharing
    B_v2[:3] = gu
    B_v2[3] = 1.0
    B_i = np.zeros(4)             # Gm noise current (held over the period)
    B_i[:3] = ph @ gi + gi
    C = np.array([0.0, 0.0, 1.0, 0.0])
    return dict(A=A, B_dt=B_dt, B_v2=B_v2, B_i=B_i, C=C, ks=ks)


def transfer_functions(p: SPLLParams, f: np.ndarray) -> dict:
    m = period_model(p)
    z = np.exp(1j * 2 * np.pi * f * p.t_ref)
    M = z[:, None, None] * np.eye(4)[None] - m["A"][None]
    rhs = np.stack([m["B_dt"], m["B_v2"], m["B_i"]], axis=1).astype(complex)
    sol = np.linalg.solve(M, np.broadcast_to(rhs, (f.size, 4, 3)))
    g_dt, g_v2, g_i = sol[:, 2, 0], sol[:, 2, 1], sol[:, 2, 2]
    G = g_dt                                   # open loop: dt -> tau  (dt = n - tau)
    return dict(G=G, H_in=G / (1 + G), H_vco=1 / (1 + G), H_v2=g_v2 / (1 + G),
                H_i=g_i / (1 + G))


def loop_metrics(p: SPLLParams) -> dict:
    f = np.logspace(3, np.log10(p.f_ref / 2 * 0.999), 8000)
    tf = transfer_functions(p, f)
    g = tf["G"]
    i = np.argmin(np.abs(np.abs(g) - 1))
    h = np.abs(tf["H_in"])
    j = np.flatnonzero(h < 1 / np.sqrt(2))
    f_z = p.kvco_ratio * p.gm / p.c_i / (2 * np.pi)
    return dict(f_unity=float(f[i]), phase_margin=float(180 + np.degrees(np.angle(g[i]))),
                f_3db=float(f[j[0]]) if j.size else np.nan,
                peaking_db=float(20 * np.log10(h.max())), f_zero=float(f_z),
                k_slope_lock=float(k_slope_lock(p)))
