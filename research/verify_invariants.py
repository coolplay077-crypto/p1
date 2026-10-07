"""Logical checks for the report. Not an RTL/AMS/PVT or metastability sign-off."""
from fractions import Fraction
from pathlib import Path
import json

results = []
def record(name, count, fn, boundary):
    fn()
    results.append(dict(test=name, cases=count, result="PASS", scope=boundary))

def split_check():
    for M in (4, 8):
        for n in range(4096):
            C, q = divmod(n, M)
            assert M*C+q == n
record("L01_split_count", 8192, split_check, "Arithmetic only; assumes coherent C and q")

def torn_check():
    for M in (4, 8):
        for C in range(64):
            before, after = M*C+M-1, M*(C+1)
            old_high_new_low, new_high_old_low = M*C, M*(C+1)+M-1
            assert old_high_new_low-after == -M
            assert new_high_old_low-before == M
record("L02_torn_wrap", 128, torn_check, "Two ideal torn-word fault patterns; no bit-level analog model")

def residue_check():
    for M in (4, 8):
        for n in range(256):
            assert n % M == (n+M) % M
            assert n % 2 == (n+M) % 2
record("L03_low_state_blind_spot", 512, residue_check, "A whole-block error cannot be seen from low residue/parity alone")

def multiphase_check():
    for C in range(32):
        for a in range(8):
            for eps in (Fraction(0), Fraction(1,64), Fraction(-1,64)):
                phi_div = C + Fraction(a,8) + eps
                q,p=divmod(a,2)
                phi_raw = 4*C + q + Fraction(p,2) + 4*eps
                assert 4*phi_div == phi_raw
record("L04_clock_unit_conversion", 768, multiphase_check, "Ideal /4 and uniform eight-phase grid, aligned phase origins")

def branch_check():
    for J in range(64):
        for mu in (Fraction(-1,4),Fraction(0),Fraction(1,4),Fraction(3,4)):
            assert J-mu == (J+1)-(mu+1)
record("L05_anchor_equivalence", 256, branch_check, "Exact phase-domain identity; time normalization must match")

def sat_check():
    limit=Fraction(1,4)
    def sat(x): return max(-limit, min(limit,x))
    pairs=((Fraction(1,3),Fraction(3,4)),(Fraction(1,2),Fraction(2)),
           (Fraction(-1,3),Fraction(-3,4)),(Fraction(-1,2),Fraction(-2)))
    for x,y in pairs:
        assert x!=y and sat(x)==sat(y)
record("L06_saturation_noninvertibility",4,sat_check,"Saturation is non-injective; not an implementation of a TDC")

p=Path(__file__).with_name("logical_check_results.json")
p.write_text(json.dumps({"checks":results,"total_cases":sum(r["cases"] for r in results)}, ensure_ascii=False, indent=2),encoding="utf-8")
print(p.read_text())
