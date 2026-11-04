"""Regression checks of the behavioural model.

    python -m pytest -q tests        (or)   python tests/test_model.py
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from spll import DTCModel, SPLLParams, noise_budget, simulate  # noqa: E402
from spll import analysis as an  # noqa: E402

N, D = 1 << 19, 1 << 14


def _jitter(p):
    r = simulate(p, N + D, n_discard=D)
    f, s = an.timing_psd(r.tau_steady(), r.fs_out, nperseg=1 << 16)
    return r, f, s, an.integrated_jitter(f, s)


def test_time_domain_matches_linear_model():
    """With calibrations frozen the kernel must reproduce the analytic noise model."""
    p = SPLLParams(cal_gain=False, cal_dcc=False)
    r, f, s, j = _jitter(p)
    ja = an.integrated_jitter(f, noise_budget(p, f, dtc=r.dtc)["Total (analytic)"])
    assert abs(j / ja - 1) < 0.05, (j, ja)


def test_jitter_close_to_paper():
    _, _, _, j = _jitter(SPLLParams())
    assert 65e-15 < j < 85e-15, j


def test_dtc_gain_calibration_converges():
    for err in (-0.15, 0.15):
        r = simulate(SPLLParams(dtc_gain_err=err), 20000)
        g = np.mean(r.kd[-4000:]) / r.kd_ideal
        assert abs(g - 1) < 0.003, (err, g)


def test_gain_calibration_near_integer_channel():
    r = simulate(SPLLParams(f_out=58 * 104e6 + 20e3, dtc_gain_err=0.1), 40000)
    assert abs(np.mean(r.kd[-4000:]) / r.kd_ideal - 1) < 0.003


def test_dcc_converges_from_1ns():
    r = simulate(SPLLParams(duty_err_s=1e-9), 8000)
    assert abs(np.mean(r.dcc[-2000:]) - 1e-9) < 2e-12


def test_no_dtc_is_much_worse():
    _, _, _, j0 = _jitter(SPLLParams())
    _, _, _, j1 = _jitter(SPLLParams(use_dtc=False))
    assert j1 > 5 * j0


def test_dtc_linearity_models():
    cs = DTCModel(SPLLParams(dtc_type="constant_slope")).summary()
    vs = DTCModel(SPLLParams(dtc_type="inverter_vs")).summary()
    assert cs["inl_fit_pk_ps"] < 0.5 and vs["inl_fit_pk_ps"] > 3.0


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
