"""Sensitivity of the foreground LUT and the hybrid to the one-time INL measurement.

Error models (rms about the best-fit line, in LSB):
  iid     independent error per code (e.g. an on-chip TDC averaging each code)
  cumdnl  INL = running sum of the measured DNL steps (spectrum method of Wu, SSC-M 2025,
          Fig. 11): the error is a random walk in code (a 1/f^2 spectrum over code)

Worst fractional spur over 20 / 100 / 400 kHz, median over 3 measurement/noise seeds,
mismatch seed 17.

    python experiments/check_fg_measurement.py        (about 5 min on 4 cores)
    python experiments/check_fg_measurement.py cumdnl:0.025 cumdnl:0.05   (extra cases, merged)
"""
import json
import multiprocessing as mp
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "experiments"))

from spll import SCENARIOS, near_integer, spur_run  # noqa: E402
from run_nlc import frac_spur  # noqa: E402

CASES = (("iid", 0.0), ("iid", 0.1), ("iid", 0.25), ("cumdnl", 0.1), ("cumdnl", 0.25))
METHODS = {"fglut": dict(nlc="fglut"), "hybrid": dict(nlc="fglut+poly", mu_g3=0.0)}
OFFS = (20e3, 100e3, 400e3)
SEEDS = (1, 2, 3)


def _run(args):
    scen, meth, mode, err, off, seed = args
    p = near_integer(off, fg_meas_mode=mode, fg_meas_err=err, seed=seed,
                     **METHODS[meth], **SCENARIOS[scen])
    if meth == "hybrid":
        rq, _ = spur_run(p, n_conv=300000, avg=100000)
    else:
        rq, _ = spur_run(p, n_conv=40000)
    return frac_spur(rq, p, off)


def main(cases=CASES):
    jobs = [(s, m, mode, err, o, seed) for s in ("paper", "small_cfix") for m in METHODS
            for mode, err in cases for seed in SEEDS for o in OFFS]
    with mp.get_context("fork").Pool(4) as pool:
        res = np.array(pool.map(_run, jobs)).reshape(2, len(METHODS), len(cases), len(SEEDS),
                                                     len(OFFS))
    worst = res.max(axis=-1)                   # worst offset per seed
    med = np.median(worst, axis=-1)
    path = ROOT / "results" / "fg_measurement.json"
    out = json.loads(path.read_text()) if (cases is not CASES and path.exists()) else {}
    for i, s in enumerate(("paper", "small_cfix")):
        for j, m in enumerate(METHODS):
            for c, (mode, err) in enumerate(cases):
                key = f"{s}/{m}/{mode}/{err}"
                out[key] = dict(median_worst=float(med[i, j, c]),
                                per_seed_worst=[float(v) for v in worst[i, j, c]])
                print(f"{key:28s} median worst {med[i, j, c]:6.1f} dBc   per seed "
                      + " ".join(f"{v:6.1f}" for v in worst[i, j, c]))
    path.write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    extra = tuple((a.split(":")[0], float(a.split(":")[1])) for a in sys.argv[1:])
    main(extra or CASES)
