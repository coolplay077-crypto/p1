"""Start-up interaction of the hybrid NLC with the paper's K_DTC / DCC loops.

1. Worst-case K_DTC and DCC settling over 5 initial K_DTC values (Fig. 9a: 200 ... 1600),
   4 channels (3 near-integer offsets + the Fig. 13 fractional channel) and 2 noise seeds,
   for: paper (no NLC), foreground LUT only, hybrid with g2 enabled at 0 us and at 50 us.
2. Spur spot-check: hybrid fractional spur with g2 enabled at 0 us vs 50 us.

    python experiments/check_hybrid_startup.py        (about 2 min)
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "experiments"))

from spll import SCENARIOS, DTCModel, SPLLParams, near_integer, simulate, spur_run  # noqa: E402
from spll import analysis as an  # noqa: E402
from spll import measured as ms  # noqa: E402
from run_nlc import frac_spur  # noqa: E402

CASES = (("paper (no NLC)", "none", 0.0), ("fg LUT only", "fglut", 0.0),
         ("hybrid, g2 on at 0 us", "fglut+poly", 0.0),
         ("hybrid, g2 on at 50 us", "fglut+poly", 50e-6))


def settling():
    print("worst-case settling (5 K_DTC starts x 4 channels x 2 seeds, 50 mV Gm offset)")
    for label, nlc, start in CASES:
        tk = td = 0.0
        for k0 in ms.FIG9A_KDTC_INIT:
            for off in (20e3, 100e3, 400e3, None):
                for seed in (1, 2):
                    kw = dict(gm_os=-50e-3, nlc=nlc, mu_g3=0.0, nlc_start=start, seed=seed)
                    base = SPLLParams(**kw) if off is None else near_integer(off, **kw)
                    p = base.with_(kdtc_init=k0 / ms.FIG9A_KDTC_IDEAL * base.t_vco
                                   / DTCModel(base).lsb_fit)
                    r = simulate(p, 8000)
                    tk = max(tk, an.settle_index(r.kd / r.kd_ideal, 1.0, 0.01) * p.t_ref)
                    td = max(td, an.settle_index(r.dcc, p.duty_err / 2, 2e-12) * p.t_ref)
        print(f"  {label:24s} K_DTC {tk * 1e6:5.1f} us   DCC {td * 1e6:5.1f} us")


def spurs():
    print("hybrid worst fractional spur at 20 / 100 / 400 kHz (dBc), seed 17")
    for scen in ("paper", "small_cfix"):
        for start in (0.0, 50e-6):
            out = []
            for off in (20e3, 100e3, 400e3):
                p = near_integer(off, nlc="fglut+poly", mu_g3=0.0, nlc_start=start,
                                 **SCENARIOS[scen])
                rq, _ = spur_run(p, n_conv=300000, avg=100000)
                out.append(frac_spur(rq, p, off))
            print(f"  {scen:10s} g2 on at {start * 1e6:3.0f} us: "
                  + " / ".join(f"{v:.1f}" for v in out))


if __name__ == "__main__":
    settling()
    spurs()
