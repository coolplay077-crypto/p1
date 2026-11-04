"""Measured / reported data of Wu et al., JSSC 2019, used as reproduction targets.

Fig. 13 markers are read from the analyzer screenshot (exact values printed on it);
Fig. 16(a) points are digitised from the plot (+-0.3 dB, offsets approximate).
"""

CARRIER_FIG13 = 6.333659790e9

# Fig. 13, doubler mode (f_ref = 104 MHz): offset [Hz] -> L(f) [dBc/Hz]
FIG13_DOUBLER = {1e3: -84.2679, 1e4: -106.6729, 1e5: -112.5639, 2e5: -114.0092,
                 4e5: -115.0574, 1e6: -118.0062, 1e7: -141.6799, 2e7: -144.8948}
JITTER_DOUBLER_FS = 74.229          # 10 kHz - 10 MHz, -53.6022 dBc
# Fig. 13, non-doubler mode (f_ref = 52 MHz)
FIG13_NONDOUBLER = {1e3: -84.4837, 1e4: -103.7674, 1e5: -109.8802, 2e5: -111.4774,
                    4e5: -111.7173, 1e6: -117.9866, 1e7: -141.7824, 2e7: -145.0527}
JITTER_NONDOUBLER_FS = 96.156       # -51.3541 dBc

# Fig. 16(a): fractional spur [dBc] vs offset for f_vco = 60*104 MHz -/+ offset
FIG16A_OFFSETS = [10e3, 20e3, 50e3, 100e3, 200e3, 400e3, 600e3, 800e3, 1.2e6, 1.65e6]
FIG16A_MINUS = [-64.4, -64.3, -64.9, -66.0, -64.9, -64.8, -65.1, -65.8, -67.0, -68.3]
FIG16A_PLUS = [-64.7, -65.4, -63.9, -65.0, -64.9, -64.6, -64.9, -64.4, -68.1, -71.8]

# Fig. 15: near-integer channel 6240.1 MHz
FIG15_SPUR_100K_DBC = -66.1
REF_SPUR_DBC = -70.06

# Fig. 9(a) (simulation in the paper): K_DTC start values, ideal value 895 in their
# fixed-point scaling; DCC < 20 us, K_DTC < 50 us even for +-80 % initial error,
# comparator threshold settles to 0.45 V for a 50 mV Gm/comparator mismatch.
FIG9A_KDTC_INIT = [200, 400, 800, 1200, 1600]
FIG9A_KDTC_IDEAL = 895

# Table I / Sec. VI
TABLE1 = dict(technology="28nm", f_ref_mhz="52x2", f_out_ghz=6.33, jitter_fs=75,
              inband_pn_dbc=-115.1, frac_spur_dbc=-64, ref_spur_dbc=-70.2, power_mw=18.9,
              fom_db=-249.7, area_mm2=0.45)
POWER_MW = dict(VCO=13.5, DTC=2.7, MMDIV=1.1, SPD_Gm_cal=1.6)

# Fig. 2(b) linear-model breakdown @ 6720 MHz, 10 kHz-200 MHz (share of jitter power)
FIG2B_TOTAL_FS = 87.5
FIG2B_SHARE = {"REF + DTC": 0.39, "VCO": 0.51, "MMDIV": 0.06, "SPD + Gm": 0.04}
