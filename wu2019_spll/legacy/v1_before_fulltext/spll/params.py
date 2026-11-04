"""Parameter set for the behavioural reproduction of

    W. Wu, C.-W. Yao, K. Godbole, et al., "A 28-nm 75-fs_rms Analog Fractional-N
    Sampling PLL With a Highly Linear DTC Incorporating Background DTC Gain
    Calibration and Reference Clock Duty Cycle Correction," IEEE JSSC, vol. 54,
    no. 5, pp. 1254-1265, May 2019 (RFIC 2018 conference version).

Only a handful of numbers are public in the abstract / RFIC version / Samsung patents
(US 10,581,418 and US 10,725,432).  They are grouped under "paper" below.  All other
values are engineering assumptions chosen so that the model is physically plausible
and lands on the published performance (75 fs rms, 10 kHz-10 MHz).  Change them freely.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

KB = 1.380649e-23  # Boltzmann constant


@dataclass
class SPLLParams:
    # ---------------------------------------------------------------- paper ----
    f_xo: float = 52e6            # "52-MHz reference clock"
    doubler: bool = True          # reference clock doubler -> CLKREFX2 (104 MHz PD rate)
    f_out: float = 6.0e9          # output channel; paper covers 5.5-7.3 GHz
    dtc_bits: int = 10            # 10-bit DTC (RFIC 2018 version)
    c_sh: float = 200e-15         # sample-and-hold capacitor (~200 fF, author's tutorial)
    power_w: float = 18.9e-3      # reported total power (only used for the FoM)

    # ---------------------------------------------------------- assumptions ----
    temp_k: float = 300.0

    # divider / delta-sigma modulator
    dsm_order: int = 2            # 1: accumulator, 2: MASH 1-1, 3: MASH 1-1-1
                                  # DTC must span (q_span + 0.5)*T_out, q_span = 1/2/4
    acc_bits: int = 24
    div_jitter: float = 25e-15    # MMD + retimer white jitter per edge [s]

    # DTC (sits in the feedback path: CLKFB = DTC(CLKDIV) is the *sampling* clock)
    dtc_type: str = "constant_slope"  # 'constant_slope' | 'inverter_vs' | 'ideal'
    dtc_lsb: float = 0.45e-12     # nominal LSB -> 10-bit range 460 ps >= 2.5*T_out(5.5 GHz)
    dtc_gain_err: float = 0.0     # PVT error of the actual delay/code slope
    dtc_jit_fixed: float = 60e-15 # code-independent DTC jitter
    dtc_jit_fs: float = 80e-15    # extra jitter (in quadrature) at full-scale delay
    dtc_sdm: bool = True          # 1st-order sigma-delta re-quantisation of DTC LSB
    dtc_seed: int = 3             # seed of the DTC element-mismatch pattern
    dtc_inl_scale: float = 1.0    # scales the INL (deviation from the best-fit line)
    use_dtc: bool = True          # False -> plain fractional-N sampling PLL (no cancellation)

    # reference path (XO + doubler + inverter buffers)
    xo_l_floor: float = -164.5    # XO phase-noise floor [dBc/Hz] at f_xo
    xo_l_10k: float = -152.0      # XO 1/f^3 noise referred to 10 kHz [dBc/Hz]
    ref_buf_jitter: float = 155e-15  # doubler + reference inverter-buffer jitter / edge
    duty_err_s: float = 0.0       # XO duty-cycle error expressed as the time shift of
                                  # the odd (falling-edge) CLKREFX2 edges [s]

    # sampling phase detector: slope generator (started by CLKREFX2) + S/H
    spd_slope: float = 2.5e9      # ramp slope I/C [V/s]  (2.5 mV/ps)
    spd_vlow: float = 0.15        # ramp reset level [V]
    spd_vhigh: float = 0.85       # ramp clipping level [V]
    spd_va: float = 15.0          # finite-r_o compression voltage of the ramp source [V]
    spd_vref: float = 0.5         # Gm reference (lock point) [V]
    spd_slope_jitter: float = 40e-15  # slope-generator current noise -> timing [s]

    # Gm + loop filter + VCO
    gm: float = 200e-6            # transconductor [S]
    gm_nf: float = 3.0            # Gm current-noise excess factor (4kT*nf*gm)
    kvco: float = 50e6            # VCO gain referred to the output [Hz/V]
    f_c: float = 1.0e6            # design unity-gain frequency of the loop [Hz]
    lf_b: float = 4.0             # zero = f_c/b, pole = f_c*b
    f_p3: float = 16e6            # extra R3-C3 pole [Hz]
    c3_ratio: float = 0.2         # C3 = c3_ratio * C2
    lf_design_fout: float = 6.0e9 # loop filter is sized once at this output frequency

    # VCO phase noise referred to the output (scaled with 20log(f_out/6 GHz))
    vco_l_1m: float = -123.0      # [dBc/Hz] at 1 MHz offset, 6 GHz (FoM~189 @ ~10 mW)
    vco_f3: float = 200e3         # 1/f^3 corner [Hz]
    vco_l_floor: float = -160.0   # far-out floor [dBc/Hz]

    # comparator + background calibrations (Samsung patents US10725432 / US10581418)
    cmp_offset: float = 3e-3      # comparator offset [V] (cancelled by the VREF generator)
    cmp_noise: float = 0.3e-3     # comparator input noise [V rms]
    vref_step: float = 20e-6      # VREF-generator step per comparator decision [V]
    cal_gain: bool = True         # background DTC gain calibration (sign-sign LMS)
    gain_ref: str = "dq"          # LMS regressor: 'dq' = sign(r[k]-r[k-1]), 'q' = sign(r-mid)
    cal_dcc: bool = True          # background reference duty-cycle correction
    kd_init_err: float = 0.0      # extra error of the preset digital gain (vs nominal LSB)
    dcc_init: float = 0.0         # initial DCC estimate [s]
    kd_sched_t: tuple = (0, 256, 1024, 4096, 16384)          # gear-shift instants [cycles]
    kd_sched_mu: tuple = (2.0, 0.5, 0.125, 0.03125, 0.0078125)  # LMS steps [DTC codes]
    dcc_sched_t: tuple = (0, 256, 1024, 4096, 16384)
    dcc_sched_mu: tuple = (8e-12, 2e-12, 0.5e-12, 0.125e-12, 0.03125e-12)  # [s]

    # simulation control
    noise: bool = True            # master switch of every random source
    seed: int = 1

    # ------------------------------------------------------------ derived ----
    @property
    def f_pd(self) -> float:
        return self.f_xo * (2 if self.doubler else 1)

    @property
    def t_pd(self) -> float:
        return 1.0 / self.f_pd

    @property
    def n_int(self) -> int:
        return int(self.f_out // self.f_pd)

    @property
    def alpha_int(self) -> int:
        """Fractional FCW word of the accumulator (fixed point, acc_bits)."""
        frac = self.f_out / self.f_pd - self.n_int
        return int(round(frac * (1 << self.acc_bits)))

    @property
    def fcw(self) -> float:
        """Exact (quantised) frequency control word."""
        return self.n_int + self.alpha_int / float(1 << self.acc_bits)

    @property
    def f_out_q(self) -> float:
        """Output frequency actually synthesised by the quantised FCW."""
        return self.fcw * self.f_pd

    @property
    def t_out(self) -> float:
        return 1.0 / self.f_out_q

    @property
    def q_span(self) -> float:
        """Span of the DSM phase residue, in output periods."""
        return {1: 1.0, 2: 2.0, 3: 4.0}[self.dsm_order]

    @property
    def dtc_span_needed(self) -> float:
        """DTC range needed [s]: residue span + 1/2 period for the differential DCC."""
        return (self.q_span + 0.5) * self.t_out

    def with_(self, **kw) -> "SPLLParams":
        return replace(self, **kw)


def channel(f_out: float, **kw) -> SPLLParams:
    return SPLLParams(f_out=f_out, **kw)
