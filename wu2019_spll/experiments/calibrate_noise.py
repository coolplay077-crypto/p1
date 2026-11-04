"""Fit the unknown noise levels to the paper's measured phase noise (Fig. 13).

Both measured traces (doubler mode f_ref = 104 MHz and non-doubler mode f_ref = 52 MHz,
same 6.3337 GHz channel, 8 markers each) are fitted simultaneously with ONE set of
parameters.  The two modes differ only in f_ref, so the fit tests the model physics: per-edge
reference-path noise must drop by 3 dB when the edge rate doubles, VCO/buffer must not move.

Fixed from the paper: VCO -125 dBc/Hz @ 1 MHz (Sec. V-B).
Free parameters: per-edge white jitter, its 1/f corner, XO close-in noise, VCO 1/f^3 corner,
proportional VCO gain (loop bandwidth), test-buffer floor.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from spll import SPLLParams, jitter_model, l_model, loop_metrics, measured as ms  # noqa: E402

NAMES = ["ref_white", "ref_flicker_fc", "xo_l_1k", "vco_l_1m", "vco_f3", "kvco_p",
         "outbuf_floor"]
LOG = {"ref_white", "ref_flicker_fc", "vco_f3", "kvco_p"}
X0 = [330e-15, 55e3, -127.0, -123.0, 150e3, 4.6e6, -147.0]
LB = [100e-15, 3e3, -150.0, -130.0, 10e3, 2e6, -160.0]
UB = [800e-15, 1e6, -110.0, -115.0, 2e6, 12e6, -140.0]


def _to_x(v):
    return np.array([np.log10(a) if n in LOG else a for n, a in zip(NAMES, v)])


def _from_x(x):
    return {n: (10 ** a if n in LOG else a) for n, a in zip(NAMES, x)}


def params_from(d):
    return SPLLParams(**d)


FIXED = {"vco_l_1m": -125.0}       # [P] Sec. V-B: VCO PN -125 dBc/Hz at 1-MHz offset
FREE = [n for n in NAMES if n not in FIXED]


def _full(xf):
    v = _to_x(X0)
    for k, n in enumerate(FREE):
        v[NAMES.index(n)] = xf[k]
    for n, val in FIXED.items():
        v[NAMES.index(n)] = np.log10(val) if n in LOG else val
    return v


def residuals(x, w1k=0.3):
    d = _from_x(x)
    res = []
    for meas, dbl in ((ms.FIG13_DOUBLER, True), (ms.FIG13_NONDOUBLER, False)):
        p = SPLLParams(doubler=dbl, **d)
        f = np.array(list(meas))
        lm = l_model(p, f, measured_like=True)
        w = np.where(f < 5e3, w1k, 1.0)
        res.append(w * (lm - np.array(list(meas.values()))))
    return np.concatenate(res)


def fit():
    idx = [NAMES.index(n) for n in FREE]
    sol = least_squares(lambda xf: residuals(_full(xf)), _to_x(X0)[idx],
                        bounds=(_to_x(LB)[idx], _to_x(UB)[idx]), x_scale="jac")
    sol.x = _full(sol.x)
    return _from_x(sol.x), sol


def main():
    d, sol = fit()
    out = {"fitted": d}
    rep = {}
    for meas, dbl, jm in ((ms.FIG13_DOUBLER, True, ms.JITTER_DOUBLER_FS),
                          (ms.FIG13_NONDOUBLER, False, ms.JITTER_NONDOUBLER_FS)):
        p = SPLLParams(doubler=dbl, **d)
        f = np.array(list(meas))
        lm = l_model(p, f)
        rep["doubler" if dbl else "non_doubler"] = dict(
            offsets=list(meas), measured=list(meas.values()), model=[float(v) for v in lm],
            jitter_model_fs=jitter_model(p) * 1e15, jitter_measured_fs=jm)
    out["report"] = rep
    out["loop"] = loop_metrics(SPLLParams(**d))
    out["rms_residual_db"] = float(np.sqrt(np.mean(residuals(sol.x, w1k=1.0) ** 2)))
    (ROOT / "results").mkdir(exist_ok=True)
    (ROOT / "results" / "noise_fit.json").write_text(json.dumps(out, indent=2, default=float))
    print(json.dumps(out, indent=1, default=float))


if __name__ == "__main__":
    main()
