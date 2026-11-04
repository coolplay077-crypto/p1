"""Parameters of the faithful behavioural reproduction of

    W. Wu et al., "A 28-nm 75-fs_rms Analog Fractional-N Sampling PLL With a Highly Linear
    DTC Incorporating Background DTC Gain Calibration and Reference Clock Duty Cycle
    Correction," IEEE JSSC, vol. 54, no. 5, pp. 1254-1265, May 2019.

Tags:  [P] stated in the paper (section / figure given)
       [M] fitted to the paper's measured phase noise, Fig. 13 (experiments/calibrate_noise.py)
       [A] assumption (not given in the paper)
"""
from __future__ import annotations

from dataclasses import dataclass, replace

KB = 1.380649e-23


@dataclass
class SPLLParams:
    # ------------------------------------------------------------- reference ----
    f_xo: float = 52e6              # [P] 52-MHz crystal reference
    doubler: bool = True            # [P] Fig. 7 XOR doubler -> CLKREFX2 = 104 MHz
    duty_err: float = 48.5e-12      # [P] Sec. VI: duty-cycle error ~48.5 ps, defined as
                                    #     |T_even - T_odd| (Fig. 7); falling-edge-derived
                                    #     CLKREFX2 edges are displaced by duty_err/2
    f_out: float = 6.333659790e9    # [P] Fig. 13 measurement channel

    # ------------------------------------------------------------ DSM / MMDIV ----
    acc_bits: int = 24              # [A] MASH 1-1 accumulator width (Fig. 8c)

    # -------------------------------------------- DTC (Sec. V-A, Figs. 10, 11) ----
    dtc_bits: int = 10              # [P]
    dtc_lsb: float = 0.642e-12      # [P] measured resolution 642 fs (design ~650 fs)
    dtc_lsb_design: float = 0.650e-12   # [P] used for the initial K_DTC look-up value
    dtc_clsb: float = 2e-15         # [P] C_LSB = 2 fF
    dtc_cfix: float = 2e-12         # [P] fixed load (oversized inverter buffer) ~2 pF
    dtc_inl_end_lsb: float = 1.4    # [P] static bow of Fig. 11 (endpoints -1.2, mid +0.2 LSB)
                                    #     -> sets the slope-dependent-delay coefficient at the
                                    #     reference geometry C_fix = 2 pF
    dtc_mismatch: float = 0.005     # [A] unit-cap mismatch -> DNL ~ +-0.2 LSB [P]
    dtc_mem_lsb: float = 0.3        # [P] memory-effect spread < 0.3 LSB @ 400 uA bleed
    dtc_gain_err: float = 0.0       # PVT error of the DTC slope (for experiments)
    dtc_seed: int = 17              # mismatch realisation representative of the measured chip
                                    #     (worst spur -64 dBc; 24-seed MC median -62.5 dBc)

    # ------------------------------------------- SPD (Sec. II, V-B, Fig. 12) ----
    vdd_ramp: float = 1.0           # [A] ramp swings 0 -> 1 V (Fig. 1b: 0.5 V lock point)
    k_slope: float = 5e9            # [P] 5 GV/s at the lock point (RC ramp)
    c_s1: float = 200e-15           # [P] two-stage sampler, lambda = C_S1/(C_S1+C_S2) = 0.5
    c_s2: float = 200e-15           # [P]
    v_ref: float = 0.5              # [P] Gm reference voltage
    gm_os: float = 0.0              # Gm input offset [V] (Fig. 9 case: 50 mV mismatch)
    cmp_os: float = 0.0             # comparator offset [V]

    # --------------------------------- loop: P path + Gm/C_I path (Sec. II) ----
    kvco_p: float = 4.855e6         # [M] proportional varactor gain [Hz/V] -> f_unity 620 kHz
    kvco_ratio: float = 12.0        # [P] K_VCO_P/K_VCO_I < 1/10 (value 1/12 assumed)
    gm: float = 1.9e-6              # [A] "a few microamperes" Gm -> zero ~120 kHz
    c_i: float = 30e-12             # [P] C_I ~30 pF for ~600 kHz BW
    f_rc2: float = 15e6             # [A] first-order R2-C2 filter after the sampler

    # ------------------------------------------------------------------ noise ----
    ref_white: float = 312.9e-15    # [M] per-edge white jitter of CLKREFX2 buffer + DTC +
                                    #     MMDIV (DTC quantisation is simulated separately)
    ref_flicker_fc: float = 100.8e3  # [M] 1/f corner of that per-edge noise
    div_share: float = 0.13         # [A] share of the per-edge noise assigned to MMDIV
                                    #     (paper's linear model: MMDIV 6% vs REF 39%)
    xo_l_1k: float = -126.64        # [M] XO 1/f^3 noise at 1 kHz (52 MHz carrier)
    xo_l_floor: float = -168.0      # [A]
    vco_l_1m: float = -125.0        # [P] free-running VCO at 1 MHz (Sec. V-B: -125 dBc/Hz)
    vco_f3: float = 10e3            # [M] VCO 1/f^3 corner (fit hits the 10 kHz bound)
    outbuf_floor: float = -146.86   # [M] PLL test-buffer floor (Sec. VI: buffer dominates
                                    #     beyond 10 MHz) - only added to "measured-like" PN
    gm_en: float = 190e-9           # [A] Gm input-referred white noise [V/rtHz]
    gm_fc: float = 20e3             # [A] Gm flicker corner
    cmp_noise: float = 0.5e-3       # [A] strong-arm comparator input noise [V rms]
    temp_k: float = 300.0

    # ------------------------------------- background calibrations (Sec. III, IV) ----
    cal_gain: bool = True           # [P] sign-data LMS: K += a1*PHE_sign*Phi_e
    cal_dcc: bool = True            # [P] dcc_err += a2*(1-z^-1)PHE_sign*even_cycle
    mu_k: float = 0.5               # [A] a1 (DTC codes per unit Phi_e per update)
    mu_dcc: float = 2.0e-4          # [A] a2 (VCO periods per update)
    gear_time: float = 50e-6        # [P] gear-shift a1, a2 -> a/4 after 50 us
    vref_dac_step: float = 2e-3     # [P] 1-bit Delta-V DAC, ~2 mV
    vref_sd_gain: float = 1.0 / 64  # [A] alpha < 1 before the 1st-order digital DSM (Fig. 5c)
    kdtc_init: float | None = None  # initial K_DTC (None -> T_vco / LSB_design look-up)
    dcc_init: float = 0.0           # initial dcc_err [s]

    # --------------------------------- DTC nonlinearity calibration (extension) ----
    nlc: str = "none"               # 'none' | 'poly' | 'pwl' | 'lut' | 'fglut' | 'fglut+poly'
    mu_g2: float = 0.25             # poly: a for g2 (codes per update)
    mu_g3: float = 0.25             # poly: a for g3
    pwl_segments: int = 8           # pwl: number of segments over Phi_e in [-1, 1]
    mu_pwl: float = 0.5             # pwl: a for the node values (codes per update)
    lut_shift: int = 5              # lut: bin = code >> lut_shift (32-code bins, 32 entries)
    mu_lut: float = 0.02            # lut: step per update (codes)
    nlc_leak: float = 1e-4          # pwl/lut leakage per cycle (regularises unobservable modes)
    nlc_weight: bool = False        # poly: optionally weight regressors by 4x(1-x)
    nlc_gear_time: float = 200e-6   # NLC loops: second gear-shift (mu/16) for low estimate noise
    fg_meas_err: float = 0.1        # fglut: rms error of the one-time DTC-curve measurement [LSB]
    fg_meas_mode: str = "iid"       # fglut: 'iid' = independent error per code; 'cumdnl' = INL built
                                    #     as the running sum of measured DNL steps (spectrum method),
                                    #     scaled to the same rms after the best-fit line
    fg_drift: float = 0.0           # fglut: bow change between measurement and operation
    nlc_start: float = 0.0          # time at which NLC adaptation is enabled [s]

    # ------------------------------------------------------------- simulation ----
    noise: bool = True
    seed: int = 1
    power_w: float = 18.9e-3        # [P] VCO 13.5 + DTC 2.7 + MMDIV 1.1 + SPD/Gm/cal 1.6 mW

    # ------------------------------------------------------------- derived ----
    @property
    def f_ref(self) -> float:
        return self.f_xo * (2 if self.doubler else 1)

    @property
    def t_ref(self) -> float:
        return 1.0 / self.f_ref

    @property
    def n_int(self) -> int:
        return int(self.f_out // self.f_ref)

    @property
    def alpha_int(self) -> int:
        return int(round((self.f_out / self.f_ref - self.n_int) * (1 << self.acc_bits)))

    @property
    def fcw(self) -> float:
        return self.n_int + self.alpha_int / float(1 << self.acc_bits)

    @property
    def f_vco(self) -> float:
        """Synthesised frequency (quantised FCW)."""
        return self.fcw * self.f_ref

    @property
    def t_vco(self) -> float:
        return 1.0 / self.f_vco

    @property
    def lam(self) -> float:
        return self.c_s1 / (self.c_s1 + self.c_s2)

    @property
    def kvco_i(self) -> float:
        return self.kvco_ratio * self.kvco_p

    @property
    def gear_cycles(self) -> int:
        return int(round(self.gear_time * self.f_ref))

    def with_(self, **kw) -> "SPLLParams":
        return replace(self, **kw)


def near_integer(offset_hz: float, n: int = 60, **kw) -> SPLLParams:
    """Channel n*104 MHz + offset (Fig. 15/16a use n = 60)."""
    p = SPLLParams(**kw)
    return p.with_(f_out=n * p.f_ref + offset_hz)
