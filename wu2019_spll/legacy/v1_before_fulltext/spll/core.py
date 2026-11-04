"""Cycle-by-cycle kernel of the DTC-based analog fractional-N sampling PLL (numba).

Per reference cycle k (all times relative to the ideal edge k*T_pd):

  1. DSM (MMD control) -> phase residue r[k] in output periods, r in [0, q_span)
  2. DCC: odd CLKFB edges are delayed by the DCC estimate d relative to even ones
     (integer part through the MMD, fractional part D_f differentially through the
     DTC)                                   -> DTC target q = r + 1/4 +- D_f/2
  3. DTC code = round(Kd*(q - q_mid) + mid-code)  (centred, so that Kd updates do not
     move the average delay; optionally 1st-order sigma-delta re-quantised)
  4. CLKFB (= sampling clock) time minus CLKREFX2 (= ramp start) time:
        dt = d_shift - tau_vco + (tau_DTC(code) - q*T_out) - e_ref + n_div
  5. SPD: ramp started by CLKREFX2 is sampled by CLKFB  -> Vs (S/H, kT/C noise)
  6. comparator sign(Vs - VREF_cmp) drives three background loops:
        VREF generator, DTC-gain sign-sign LMS, DCC sign-sign LMS
     The gain LMS correlates the comparator with sign(r - mid) ("q") or with the
     high-passed residue sign(r[k]-r[k-1]) ("dq"); the latter keeps the right sign
     when the residue pattern falls inside the loop bandwidth (near-integer channels).
  7. Gm*(Vs - VREF) is held for the period and integrated by the loop filter / VCO
     (exact ZOH, optionally split into m_sub sub-steps for an oversampled output)
"""
from __future__ import annotations

import numpy as np
from numba import njit


@njit(cache=True)
def run_kernel(n_cyc, m_sub, phi, gam, gr1, gr3,
               alpha_int, acc_bits, dsm_order, t_out, q_span,
               use_dtc, dtc_table, dtc_sig, kd0, code_mid, dtc_sdm,
               cal_gain, gain_ref, kd_t, kd_mu, cal_dcc, dcc0, dcc_t, dcc_mu,
               e_ref, n_dtc, n_div, n_slope, n_ktc, n_cmp, n_gm, n_r1, n_r3,
               spd_vlow, spd_vhigh, spd_va, spd_slope, t_lock, vref_gm,
               gm, cmp_off, vref_step,
               x_vco, z0,
               out_tau, out_dt, out_vs, out_c, out_kd, out_dcc, out_code, out_vcref):
    mask = (np.int64(1) << acc_bits) - 1
    scale = 1.0 / float(np.int64(1) << acc_bits)
    n_codes = dtc_table.shape[0]
    acc1 = np.int64(0)
    acc2 = np.int64(0)
    acc3 = np.int64(0)
    c3_prev = np.int64(0)
    z = z0.copy()
    zn = np.zeros(4)
    kd = kd0
    dcc = dcc0
    vcref = vref_gm
    sdm_e = 0.0
    ik = 0
    idc = 0
    nkd = kd_t.shape[0]
    ndc = dcc_t.shape[0]
    vrange = spd_vhigh - spd_vlow
    half_span = 0.5 * q_span
    q_mid = 0.5 * (q_span + 0.5)
    r_prev = 0.0
    for k in range(n_cyc):
        while ik + 1 < nkd and k >= kd_t[ik + 1]:
            ik += 1
        while idc + 1 < ndc and k >= dcc_t[idc + 1]:
            idc += 1
        # ---------------- delta-sigma modulator: phase residue -----------------
        acc1 += alpha_int
        acc1 &= mask
        if dsm_order == 1:
            r = acc1 * scale
        elif dsm_order == 2:
            acc2 += acc1
            c2 = acc2 >> acc_bits
            acc2 &= mask
            r = acc1 * scale - c2 + 1.0
        else:
            acc2 += acc1
            c2 = acc2 >> acc_bits
            acc2 &= mask
            acc3 += acc2
            c3 = acc3 >> acc_bits
            acc3 &= mask
            r = acc1 * scale - c2 - (c3 - c3_prev) + 2.0
            c3_prev = c3
        # ---------------- DCC: shift odd vs. even CLKFB edges by dcc ------------
        # integer part (round) -> MMD on odd edges; fractional part D_f in [-.5,.5)
        # -> DTC, applied differentially (+D_f/2 odd, -D_f/2 even) so that the
        # LMS dither of the estimate has no common-mode (in-band) component.
        par = k & 1
        dtot = dcc / t_out
        dint = np.floor(dtot + 0.5)
        dfr = dtot - dint
        if par == 1:
            sf = 0.5 * dfr
            dsh = (dint + sf) * t_out
        else:
            sf = -0.5 * dfr
            dsh = sf * t_out
        q = r + 0.25 + sf                    # DTC target in [0, q_span + 0.5)
        # ---------------- DTC ----------------------------------------------------
        if use_dtc:
            cf = kd * (q - q_mid) + code_mid
            if dtc_sdm:
                v = cf + sdm_e
                code = int(np.floor(v + 0.5))
                sdm_e = v - code
            else:
                code = int(np.floor(cf + 0.5))
            if code < 0:
                code = 0
            elif code > n_codes - 1:
                code = n_codes - 1
            tdtc = dtc_table[code] + dtc_sig[code] * n_dtc[k]
        else:
            code = 0
            tdtc = 0.0
        # ---------------- sampling phase detector --------------------------------
        tv = z[3] + x_vco[k * m_sub]
        dt = dsh - tv + (tdtc - q * t_out) - e_ref[k] + n_div[k]
        x = dt + t_lock + n_slope[k]
        if x <= 0.0:
            vr = 0.0
        else:
            vr = spd_va * (1.0 - np.exp(-spd_slope * x / spd_va))
            if vr > vrange:
                vr = vrange
        vs = spd_vlow + vr + n_ktc[k]
        # ---------------- comparator + background calibrations ------------------
        cval = 1.0 if (vs + cmp_off + n_cmp[k] - vcref) > 0.0 else -1.0
        out_kd[k] = kd
        out_dcc[k] = dcc
        out_vcref[k] = vcref
        vcref += vref_step * cval
        if cal_gain and use_dtc:
            if gain_ref == 0:      # classic: sign of the (centred) phase residue
                sq = 1.0 if r > half_span else (-1.0 if r < half_span else 0.0)
            else:                  # high-passed residue: sign(r[k] - r[k-1])
                drr = r - r_prev
                sq = 1.0 if drr > 0.0 else (-1.0 if drr < 0.0 else 0.0)
            kd -= kd_mu[ik] * cval * sq
        r_prev = r
        if cal_dcc:
            sp = 1.0 if par == 1 else -1.0
            dcc -= dcc_mu[idc] * cval * sp
        # ---------------- Gm -> loop filter -> VCO (ZOH) ------------------------
        u = gm * (vs - vref_gm) + n_gm[k]
        e1 = n_r1[k]
        e3 = n_r3[k]
        base = k * m_sub
        for m in range(m_sub):
            for i in range(4):
                acc = gam[i] * u + gr1[i] * e1 + gr3[i] * e3
                for j in range(4):
                    acc += phi[i, j] * z[j]
                zn[i] = acc
            for i in range(4):
                z[i] = zn[i]
            out_tau[base + m] = z[3] + x_vco[base + m + 1]
        out_dt[k] = dt
        out_vs[k] = vs
        out_c[k] = cval
        out_code[k] = code
    return z
