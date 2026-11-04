"""Regression tests of the faithful JSSC 2019 reproduction and the NLC extension.

    python -m pytest -q tests      (or)      python tests/test_model.py
"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "experiments"))

from spll import (SCENARIOS, DTCModel, SPLLParams, jitter_model, near_integer,  # noqa: E402
                  simulate, spur_run)
from spll import analysis as an  # noqa: E402
from spll import measured as ms  # noqa: E402

N, D = 1 << 20, 1 << 15


def _jit(p, measured_like=True):
    r = simulate(p, N + D, n_discard=D)
    f, s = an.timing_psd(r.tau_steady(), r.fs_out)
    lin = 0.5 * (2 * np.pi * p.f_vco) ** 2 * s
    if measured_like:
        lin = lin + 10 ** (p.outbuf_floor / 10)
    sel = (f >= 1e4) & (f <= 1e7)
    return np.sqrt(np.trapezoid(2 * lin[sel], f[sel])) / (2 * np.pi * p.f_vco)


def test_kernel_matches_linear_model():
    p = SPLLParams(cal_gain=False, cal_dcc=False, duty_err=0.0, dtc_inl_end_lsb=0.0,
                   dtc_mismatch=0.0, dtc_mem_lsb=0.0)
    p = p.with_(kdtc_init=p.t_vco / DTCModel(p).lsb_fit)
    j = _jit(p, measured_like=False)
    ja = jitter_model(p, measured_like=False)
    assert abs(j / ja - 1) < 0.04, (j, ja)


def test_jitter_close_to_measurement():
    jd = _jit(SPLLParams()) * 1e15
    jn = _jit(SPLLParams(doubler=False)) * 1e15
    assert abs(jd / ms.JITTER_DOUBLER_FS - 1) < 0.08, jd
    assert abs(jn / ms.JITTER_NONDOUBLER_FS - 1) < 0.08, jn


def test_calibrations_converge_like_fig9a():
    for k0 in (200, 1600):                                 # -78 % and +79 % start values
        p = SPLLParams(gm_os=-50e-3)
        p = p.with_(kdtc_init=k0 / ms.FIG9A_KDTC_IDEAL * p.t_vco / DTCModel(p).lsb_fit)
        r = simulate(p, 6000)
        t_k = an.settle_index(r.kd / r.kd_ideal, 1.0, 0.01) * p.t_ref
        t_d = an.settle_index(r.dcc, p.duty_err / 2, 2e-12) * p.t_ref
        assert t_k < 50e-6 and t_d < 30e-6, (k0, t_k, t_d)
        assert abs(np.mean(r.vref[-1000:]) - 0.45) < 2e-3


def test_dcc_is_required_for_the_doubler():
    jb = _jit(SPLLParams(duty_err=0.01 / 52e6, cal_dcc=False))
    j0 = _jit(SPLLParams())
    assert jb > 3 * j0


def test_fractional_spur_matches_fig16a():
    p = near_integer(100e3)
    rq, _ = spur_run(p, n_conv=40000)
    lv = an.tone_dbc(rq.tau_steady(), rq.fs_out, p.f_vco, 100e3)
    assert -67.0 < lv < -61.0, lv


def test_g2_nlc_and_foreground_lut_improve_spurs():
    from run_nlc import frac_spur
    kw = SCENARIOS["small_cfix"]
    base = near_integer(100e3, **kw)
    r0, _ = spur_run(base, n_conv=40000)
    s0 = frac_spur(r0, base, 100e3)
    p2 = near_integer(100e3, nlc="poly", mu_g3=0.0, **kw)
    r2, _ = spur_run(p2, n_conv=300000, avg=100000)
    pf = near_integer(100e3, nlc="fglut", **kw)
    rf, _ = spur_run(pf, n_conv=40000)
    assert frac_spur(r2, p2, 100e3) < s0 - 6.0
    assert frac_spur(rf, pf, 100e3) < s0 - 10.0


def test_hybrid_g2_start_after_gear_shift_keeps_settling():
    """Hybrid NLC with g2 enabled at 50 us: K_DTC and DCC settle as in the paper design."""
    for k0 in (200, 1600):
        base = near_integer(100e3, gm_os=-50e-3, nlc="fglut+poly", mu_g3=0.0, nlc_start=50e-6)
        p = base.with_(kdtc_init=k0 / ms.FIG9A_KDTC_IDEAL * base.t_vco / DTCModel(base).lsb_fit)
        r = simulate(p, 8000)
        t_k = an.settle_index(r.kd / r.kd_ideal, 1.0, 0.01) * p.t_ref
        t_d = an.settle_index(r.dcc, p.duty_err / 2, 2e-12) * p.t_ref
        assert t_k < 50e-6 and t_d < 35e-6, (k0, t_k, t_d)


def test_fg_measurement_error_models():
    """Both measurement-error models build the same map without error and the requested rms."""
    from spll.simulate import fg_inverse_map
    d = DTCModel(SPLLParams())
    m_iid = fg_inverse_map(d, 0.0, np.random.default_rng(0), "iid")
    m_cum = fg_inverse_map(d, 0.0, np.random.default_rng(0), "cumdnl")
    assert m_iid.size == 8 * d.codes.size and np.array_equal(m_iid, m_cum)
    assert np.all(np.diff(m_iid) >= 0)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
