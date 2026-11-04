"""Cycle-by-cycle kernel of the analog fractional-N sampling PLL of Wu et al., JSSC 2019.

Per CLKREFX2 cycle k (times relative to the ideal k*T_ref grid):
  1. MASH 1-1 DSM (Fig. 8c), input = FCW_frac + dcc_comp[k]; Phi_e[k] = c2 - acc1/2^B is the
     accumulated quantisation error (in T_vco), D[k] = sum(dcc_comp) the intended CLKFB shift
  2. DTC in the REFERENCE path: code = offset + K_DTC*Phi_e (+ optional NLC terms);
     tau_DTC = table[code] + memory effect (code-dependent supply settling)
  3. SPD: CLKDTC starts the RC ramp V = VDD*(1-exp(-x/tau_r)), CLKFB samples it:
        x = t_FB - t_DTC = (Phi_e + D)*T_vco - tau_vco + n_div - e_ref - tau_DTC
     two-stage sampler: V_S2[k] = (1-lam)*V_S2[k-1] + lam*V_S1[k]   (eq. 5)
  4. comparator PHE_sign = sign(V_S2 - Vref_adj), Vref_adj from a 1st-order digital DSM +
     1-bit Delta-V DAC (Fig. 5c)
  5. background loops (Fig. 8a):  K_DTC += a1*PHE*Phi_e ;
        dcc_err += a2*(PHE[k]-PHE[k-1])*even_cycle ; dcc_comp = -dcc_err*even_cycle
     optional NLC (extension):  'poly': g2, g3 on (Phi_e^2 - <Phi_e^2>), (Phi_e^3 - 0.4 Phi_e)
                                'pwl' : node values of a piecewise-linear DTC map
                                'lut' : code-indexed correction table (bins of 2^shift codes)
  6. P path + Gm/C_I path + VCO, exact ZOH; V_S2 changes in the middle of the period (z^-0.5)
"""
from __future__ import annotations

import numpy as np
from numba import njit


@njit(cache=True)
def run_kernel(n_cyc, m_half, phi, g_u, g_i,
               alpha_int, acc_bits, t_vco,
               dtc_table, mem_coef, code_mid,
               e_ref, n_div, n_s1, n_s2, n_cmp, i_gm, x_vco, parity,
               vdd, tau_r, v_lock, lam, cmp_os, vref0, vref_step, sd_gain,
               cal_gain, cal_dcc, gear_cycles, mu_k, mu_dcc, kd0, dcc0,
               nlc, mu_g2, mu_g3, g2_0, g3_0, pwl0, mu_pwl, nlc_start,
               lut0, lut_shift, mu_lut, leak, nlc_weight, nlc_gear_cycles, inv_map,
               tau0,
               out_tau, out_x, out_v2, out_phe, out_kd, out_dcc, out_vref, out_code,
               out_g2, out_g3, out_pwl, out_lut):
    mod = np.int64(1) << acc_bits
    scale = 1.0 / float(mod)
    n_codes = dtc_table.shape[0]
    m_sub = 2 * m_half
    acc1 = np.int64(0)
    acc2 = np.int64(0)
    dsum = np.int64(0)
    kd = kd0
    dcc_err = dcc0 / t_vco                 # VCO periods
    g2 = g2_0
    g3 = g3_0
    m2 = 1.0 / 6.0
    npwl = pwl0.shape[0]
    nseg = npwl - 1
    anchor = nseg // 2
    pwl = pwl0.copy()
    pwl_active = nlc == 2 and nlc_start <= 0
    nbins = lut0.shape[0]
    lut = lut0.copy()
    hits = np.zeros(nbins)
    b = 0
    v2 = v_lock
    vref = vref0
    sd_acc = 0.0
    sd_y = 1.0
    phe_prev = 1.0
    code_prev = int(code_mid)
    z = np.zeros(3)
    z[2] = tau0
    zn = np.zeros(3)
    for k in range(n_cyc):
        gear = 0.25 if k >= gear_cycles else 1.0
        gear_n = gear / 16.0 if k >= nlc_gear_cycles else gear
        even = parity[k]
        # ---------------------------------------------------- DSM with DCC word
        dword = -np.int64(np.floor(dcc_err * mod + 0.5)) * np.int64(even)
        acc1 += alpha_int + dword
        c1 = acc1 // mod
        acc1 -= c1 * mod
        acc2 += acc1
        c2 = acc2 // mod
        acc2 -= c2 * mod
        xs = acc1 * scale
        phi_e = c2 - xs
        dsum += dword
        dsh = dsum * scale * t_vco
        # ---------------------------------------------------- DTC code (+ NLC)
        if nlc == 2 and (not pwl_active) and k >= nlc_start:
            pwl_active = True
            for j in range(npwl):
                pwl[j] = kd * (-1.0 + 2.0 * j / nseg)
        seg = 0
        fr = 0.0
        if pwl_active:
            u = (phi_e + 1.0) * 0.5 * nseg
            seg = int(np.floor(u))
            if seg < 0:
                seg = 0
            elif seg > nseg - 1:
                seg = nseg - 1
            fr = u - seg
            cf = code_mid + (1.0 - fr) * pwl[seg] + fr * pwl[seg + 1]
        else:
            cf = code_mid + kd * phi_e
            if nlc == 1 or nlc == 5:
                cf += g2 * (phi_e * phi_e - m2) + g3 * (phi_e * phi_e * phi_e - 0.4 * phi_e)
            if nlc == 4 or nlc == 5:
                # foreground calibration: inverse of the MEASURED DTC curve (1/8-LSB grid)
                ii = int(np.floor(cf * 8.0 + 0.5))
                if ii < 0:
                    ii = 0
                elif ii > inv_map.shape[0] - 1:
                    ii = inv_map.shape[0] - 1
                cf = inv_map[ii]
            if nlc == 3:
                b = int(np.floor(cf)) >> lut_shift
                if b < 0:
                    b = 0
                elif b > nbins - 1:
                    b = nbins - 1
                cf += lut[b]
        code = int(np.floor(cf + 0.5))
        if code < 0:
            code = 0
        elif code > n_codes - 1:
            code = n_codes - 1
        tdtc = dtc_table[code] + mem_coef * (code_prev - code_mid) * (code / code_mid)
        # ---------------------------------------------------- SPD
        tv = z[2] + x_vco[k * m_sub]
        x = (phi_e * t_vco + dsh - tv + n_div[k]) - (e_ref[k] + tdtc)
        if x > 0.0:
            v1 = vdd * (1.0 - np.exp(-x / tau_r))
        else:
            v1 = 0.0
        v1 += n_s1[k]
        v2n = (1.0 - lam) * v2 + lam * v1 + n_s2[k]
        # ---------------------------------------------------- comparator + Vref DAC
        phe = 1.0 if (v2n + cmp_os + n_cmp[k] - vref) > 0.0 else -1.0
        out_kd[k] = (pwl[npwl - 1] - pwl[0]) * 0.5 if pwl_active else kd
        out_dcc[k] = dcc_err * t_vco
        out_vref[k] = vref
        out_g2[k] = g2
        out_g3[k] = g3
        sd_acc += sd_gain * phe - sd_y
        sd_y = 1.0 if sd_acc >= 0.0 else -1.0
        vref += vref_step * sd_y
        # ---------------------------------------------------- background LMS loops
        if cal_gain:
            if pwl_active:
                # observable regressor: Phi_e*(w_j(1-x) - w_j(-x)) for each node j
                g = mu_pwl * gear_n * phe * phi_e
                for side in range(2):
                    uu2 = ((1.0 - xs) if side == 0 else -xs)
                    sgn = 1.0 if side == 0 else -1.0
                    u2 = (uu2 + 1.0) * 0.5 * nseg
                    s2 = int(np.floor(u2))
                    if s2 < 0:
                        s2 = 0
                    elif s2 > nseg - 1:
                        s2 = nseg - 1
                    f2 = u2 - s2
                    if s2 != anchor:
                        pwl[s2] += sgn * g * (1.0 - f2)
                    if s2 + 1 != anchor:
                        pwl[s2 + 1] += sgn * g * f2
                if leak > 0.0:
                    # leakage of the inner nodes toward the straight line through the end
                    # nodes: modes the LMS cannot observe decay instead of drifting
                    sl = 0.5 * (pwl[npwl - 1] - pwl[0])
                    for j in range(1, npwl - 1):
                        if j != anchor:
                            pwl[j] -= leak * (pwl[j] - sl * (-1.0 + 2.0 * j / nseg))
            else:
                kd += mu_k * gear * phe * phi_e
                if (nlc == 1 or nlc == 5) and k >= nlc_start:
                    # observable (zero conditional-mean) regressors: phi(Phi_e)-E[phi|x]
                    # = Phi_e*(phi(1-x)-phi(-x)), x = acc1/2^B  (MASH 1-1: Phi_e = c2 - x)
                    # weighting 4x(1-x) de-emphasises x ~ 0/1 where the carry toggles
                    # slowly (in-band) and the loop phase shift would bias the estimate
                    wx = 4.0 * xs * (1.0 - xs) if nlc_weight else 1.0
                    g2 += mu_g2 * gear_n * phe * phi_e * (1.0 - 2.0 * xs) * wx
                    g3 += mu_g3 * gear_n * phe * phi_e * (0.6 - 3.0 * xs + 3.0 * xs * xs) * wx
                elif nlc == 3 and k >= nlc_start:
                    # code bins of the two toggle points Phi_e = 1-x and Phi_e = -x
                    b1 = int(np.floor(code_mid + kd * (1.0 - xs))) >> lut_shift
                    b0 = int(np.floor(code_mid - kd * xs)) >> lut_shift
                    if b1 > nbins - 1:
                        b1 = nbins - 1
                    if b0 < 0:
                        b0 = 0
                    lut[b1] += mu_lut * gear_n * phe * phi_e
                    lut[b0] -= mu_lut * gear_n * phe * phi_e
                    hits[b1] += 1.0
                    hits[b0] += 1.0
                    if leak > 0.0:
                        for i in range(nbins):
                            lut[i] *= 1.0 - leak
                    if (k & 255) == 0:
                        # remove the mean (absorbed by the loop phase) and the linear part
                        # (owned by the K_DTC loop) over the bins in use
                        sw = 0.0
                        sx = 0.0
                        sy = 0.0
                        for i in range(nbins):
                            if hits[i] > 0:
                                sw += 1.0
                                sx += i
                                sy += lut[i]
                        if sw > 1.0:
                            mx = sx / sw
                            my = sy / sw
                            sxx = 0.0
                            sxy = 0.0
                            for i in range(nbins):
                                if hits[i] > 0:
                                    sxx += (i - mx) * (i - mx)
                                    sxy += (i - mx) * (lut[i] - my)
                            slope = sxy / sxx if sxx > 0 else 0.0
                            for i in range(nbins):
                                if hits[i] > 0:
                                    lut[i] -= my + slope * (i - mx)
        m2 += (phi_e * phi_e - m2) * (1.0 / 1024.0)
        if cal_dcc:
            dcc_err += mu_dcc * gear * (phe - phe_prev) * even
        phe_prev = phe
        # ---------------------------------------------------- loop filter + VCO
        u_old = v2 - v_lock
        u_new = v2n - v_lock
        ig = i_gm[k]
        base = k * m_sub
        for m in range(m_sub):
            uu = u_old if m < m_half else u_new
            for i in range(3):
                acc = g_u[i] * uu + g_i[i] * ig
                for j in range(3):
                    acc += phi[i, j] * z[j]
                zn[i] = acc
            for i in range(3):
                z[i] = zn[i]
            out_tau[base + m] = z[2] + x_vco[base + m + 1]
        out_x[k] = x
        out_v2[k] = v2n
        out_phe[k] = phe
        out_code[k] = code
        v2 = v2n
        code_prev = code
    for j in range(npwl):
        out_pwl[j] = pwl[j]
    for j in range(nbins):
        out_lut[j] = lut[j]
    return z
