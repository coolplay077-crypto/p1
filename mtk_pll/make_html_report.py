"""Build the HTML technical-analysis report for ISSCC 2025 19.3 from the results JSON.

    python3 make_html_report.py [--fragment OUT]

Writes docs/ISSCC2025_19.3_技术分析报告.html (standalone page).  With --fragment, also
writes the page without the <!doctype>/<html>/<head>/<body> skeleton (for publishing).
All numbers in the page are read from results/isscc25_19p3_results.json or computed
from the fitted model, so the page regenerates with the experiments.
"""
from __future__ import annotations

import argparse
import html
import json
import math
import re
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from mtkpll import multipath19p3 as P   # noqa: E402

ROOT = Path(__file__).parent
DOCS = ROOT.parent / "docs"
R = json.loads((ROOT / "results" / "isscc25_19p3_results.json").read_text())


def r1(x, n=1):
    return f"{x:.{n}f}".replace("-", "−")


def params(key):
    return P.MP19p3Params(**{k: v for k, v in R[key].items()})


# ---------------------------------------------------------------- chart data
qc = params("params_fit_C")
qa = params("params_fit_A")
fg = np.logspace(4, 8, 161)
A4 = P.analytic_pn(fg, qc)
A1 = P.analytic_pn(fg, replace(qc, mp_disabled=True))
vf = P.vco_fit_cached()
Lfree = P.vco_L(fg, vf)
pn = dict(
    model_m4=[[float(f), round(float(v), 2)] for f, v in zip(fg, A4["total"])],
    model_m1=[[float(f), round(float(v), 2)] for f, v in zip(fg, A1["total"])],
    vco_free=[[float(f), round(float(v), 2)] for f, v in zip(fg, Lfree) if v > -165],
    meas_m4=[[m[0], m[1]] for m in P.PLL_MARKERS],
    meas_m1=[[m[0], m[1]] for m in P.PLL_NO_MP_DIGITISED],
)
mk_model = P.analytic_pn(np.array([m[0] for m in P.PLL_MARKERS]), qc)["total"]
marker_rows = [dict(f=m[0], meas=m[1], model=round(float(v), 2), d=round(float(v - m[1]), 2))
               for m, v in zip(P.PLL_MARKERS, mk_model)]

d2, d4, d5, d6, d7, d8 = (R[k] for k in ("D2", "D4", "D5", "D6", "D7", "D8"))
fitC, fitA = d2["fits"]["C_joint"], d2["fits"]["A_M4_only"]
names = dict(vco="VCO 自由振荡残余", ref_common="参考白噪（XO+倍频）", cp_flicker="CP / 偏置 1/f（∝ 导通时间²）",
             cp="CP 热噪声", sdm="SDM 量化噪声", out_floor="输出噪底（÷2/缓冲）", ref_flicker="参考近端 1/f",
             pfd_slice="各片 PFD/重定时", cp_offset="偏置电荷 kT/C")
short = dict(vco="VCO 残余", ref_common="参考白噪", cp_flicker="CP/偏置 1/f", cp="CP 热噪声", sdm="SDM 量化",
             out_floor="输出噪底", ref_flicker="参考 1/f", pfd_slice="PFD/重定时", cp_offset="偏置 kT/C")
budget = sorted([dict(k=k, name=names.get(k, k), short=short.get(k, k), v=round(fitC["parts_fs"][k], 2),
                      lo=round(d2["profile_ranges_fs"][k][0], 2), hi=round(d2["profile_ranges_fs"][k][1], 2))
                 for k in fitC["parts_fs"]], key=lambda x: -x["v"])
comp40 = [c for c in d4["compression"] if abs(c["c_dn_va_pFV"] - 40) < 1][0]
cmin = min(c["shape_rms"] for c in d4["compression"])
cmax = max(c["shape_rms"] for c in d4["compression"])
spur = dict(off=d4["offsets"], meas=d4["measured"], p10=d4["p10"], p50=d4["p50"], p90=d4["p90"], comp=comp40["spur"])
fold = dict(m1=[[x["offset_over_T"], round(x["L_inband"], 1)] for x in d7["M1"]],
            m4=[[x["offset_over_T"], round(x["L_inband"], 1)] for x in d7["M4"]])
rt = dict(per=[[x["margin_sigma"], round(x["jitter_fs"], 1)] for x in d5["retimer"] if not x["shared"]],
          shared=[[x["margin_sigma"], round(x["jitter_fs"], 1)] for x in d5["retimer"] if x["shared"]])
jvf = dict(meas=[[r["f_vco"] / 1e9, r["measured_fs"]] for r in d2["jitter_vs_fvco"]],
           model=[[r["f_vco"] / 1e9, round(r["kvco_const"], 2)] for r in d2["jitter_vs_fvco"]],
           model_f3=[[r["f_vco"] / 1e9, round(r["kvco_f3"], 2)] for r in d2["jitter_vs_fvco"]])
DATA = dict(pn=pn, budget=budget, spur=spur, fold=fold, rt=rt, jvf=jvf)

# ---------------------------------------------------------------- checks (Chinese labels)
CN = [
    ("D0 patent-equivalent PSEL/carry arithmetic + slice currents, M=2", "专利等价的 PSEL/进位算术与切片电流，M=2"),
    ("D0 patent-equivalent PSEL/carry arithmetic + slice currents, M=4", "专利等价的 PSEL/进位算术与切片电流，M=4"),
    ("D0 patent-equivalent PSEL/carry arithmetic + slice currents, M=8", "专利等价的 PSEL/进位算术与切片电流，M=8"),
    ("D0 slide 12", "幻灯片 12 的“M=4 时 DSM 展宽 2T” vs 全部切片边沿跨度"),
    ("D1 VCO L(1MHz)", "VCO 在 1 MHz 处相噪（幻灯片 27 标记）vs 幻灯片 28"),
    ("D1 VCO FoM", "VCO FoM / FoM_T"),
    ("D1 PLL FoM", "PLL FoM（33.8 / 37.7 fs，24.4 mW）"),
    ("D1 FoM_N", "FoM_N 以 80 MHz XO 为参考频率"),
    ("D1 37.7 fs", "含杂散抖动 37.7 fs vs 33.8 fs + −70.9 dBc 一对杂散"),
    ("D2 fit A reproduces", "拟合 A 复现幻灯片 29 的 10 个实测标记"),
    ("D2 joint fit C", "联合拟合 C：M=4 标记与数字化的 M=1 曲线"),
    ("D2 time-domain sim", "时域仿真 vs 解析模型抖动"),
    ("D2 jitter vs measured", "抖动 vs 实测 33.78 fs（由拟合决定）"),
    ("D2-H1", "留出：只用 M=4 拟合，预测关闭多路径的曲线"),
    ("D2-H2", "幻灯片 30 另一信道的标记（跨信道一致性）"),
    ("D2-H3", "留出：抖动随 VCO 频率变化（冻结环路、固定 T_off）"),
    ("D2-H4", "“两种模式用同一 Q_OFST”被实测 M=1 曲线排除"),
    ("D3 SDM noise", "SDM 噪声 M=4 vs M=1（−20·log4）"),
    ("D3 joint fit", "联合拟合不支持 ≤ 9 dB 的 SDM 降幅"),
    ("D4 LEVEL", "杂散幅度：实测带内均值处于 3σ=0.5% 失配总体的 5–95%"),
    ("D4 SHAPE", "杂散形状：失配机理的形状残差"),
    ("D4 attribution", "能否区分失配与 C_DN 电荷压缩"),
    ("D4 slide 13", "幻灯片 13：3σ=0.5% 失配的折叠噪声约 −127 dBc/Hz"),
    ("D5 (1)", "满足建立时间时，重定时消除 MUX/CK-Q 偏斜"),
    ("D5 (2)", "重定时后的固定偏斜不产生杂散"),
    ("D6 the S/H", "S/H 电荷重分配（而非开关电容偏置本身）抑制纹波杂散"),
    ("D9 claim 5", "权利要求 5（X=2）切片电流 = 19.3 的 M=2"),
    ("D9 claim 6", "权利要求 6（n=2）切片电流 = 19.3 的 M=4"),
    ("D9 claim 7", "权利要求 7（n=3）切片电流 = 19.3 的 M=8"),
    ("D9 patent 'SDM noise", "专利“SDM 噪声 −12 dB”（M=4）"),
    ("D9 patent 'CP noise -1~2 dB': thermal", "专利“CP 噪声 −1~2 dB”：热噪声导通时间比"),
    ("D9 patent 'CP noise -1~2 dB' vs the TOTAL", "专利“CP 噪声 −1~2 dB”vs 拟合模型 CP 噪声总量"),
    ("D9 patent 'PFD -3 dB'", "专利“PFD −3 dB”：等分成立，binary 更多"),
    ("D9 patent: current-mismatch", "专利：电流失配杂散（0.001）≪ 时序失配杂散（1 ps 未重定时）"),
    ("D9 patent example", "专利举例“RMS 抖动 < 50 fs”由实测 33.8 fs 满足"),
]


def cn_name(n):
    for k, v in CN:
        if n.startswith(k):
            return v
    return n


def _n(x, unit=""):
    return f"{x:g}{unit}".replace("-", "−")


MEAS = [  # check-name prefix -> formatter of the 'measured' field (units added, Chinese wording)
    ("D0 slide 12", lambda m: m.replace("coarse", "粗边沿")),
    ("D1 VCO L", lambda m: _n(m, " dBc/Hz")),
    ("D1 VCO FoM", lambda m: f"{_n(m[0])} / {_n(m[1])} dB"),
    ("D1 PLL FoM", lambda m: f"{_n(m[0])} / {_n(m[1])} dB"),
    ("D1 FoM_N", lambda m: _n(m, " dB")),
    ("D1 37.7", lambda m: _n(m, " fs")),
    ("D2 fit A", lambda m: "最大误差 " + _n(m, " dB")),
    ("D2 joint fit C", lambda m: f"M=4 最大 {_n(m[0])} dB；M=1 rms {_n(m[1])} dB"),
    ("D2 time-domain", lambda m: m.replace("+-", " ± ") + " fs"),
    ("D2 jitter vs", lambda m: _n(m, " fs")),
    ("D2-H1", lambda m: "rms " + _n(m, " dB")),
    ("D2-H2", lambda m: f"{_n(m[0])} / {_n(m[1])} dB"),
    ("D2-H3", lambda m: m.replace("kvco_const: max err", "K_VCO 不变：最大误差").replace(", slope ok False", "，斜率方向相反")
                         .replace(", slope ok True", "，斜率方向一致")),
    ("D2-H4", lambda m: "100 kHz 处 " + _n(m, " dBc/Hz")),
    ("D3 SDM", lambda m: _n(m, " dB")),
    ("D3 joint", lambda m: m.replace("best", "最优")),
    ("D4 LEVEL", lambda m: "第 " + m.replace("th percentile", "") + " 百分位"),
    ("D4 SHAPE", lambda m: "形状残差 " + _n(m, " dB")),
    ("D4 attribution", lambda m: m.replace("compression", "压缩").replace("mismatch", "失配") + " dB"),
    ("D4 slide 13", lambda m: _n(m, " dBc/Hz")),
    ("D5", lambda m: "杂散 " + _n(m, " dBc")),
    ("D6", lambda m: f"S/H {_n(round(m['sh'], 1))} · 泄放 {_n(round(m['bleed'], 1))} · 开关电容无 S/H {_n(round(m['sc_no_sh'], 1))} dBc"),
    ("D9 claim", lambda m: " : ".join(f"{w:g}" for w in m)),
    ("D9 patent 'SDM", lambda m: _n(m, " dB")),
    ("D9 patent 'CP", lambda m: _n(m, " dB")),
    ("D9 patent 'PFD", lambda m: _n(m, " dB")),
    ("D9 patent: current", lambda m: m.replace("-", "−")),
    ("D9 patent example", lambda m: _n(m, " fs")),
]

NOTE = {
    "the CP on-time is set by the earliest slice edge": "CP 导通时间由最早的切片边沿决定",
    "residual = other spur lines": "差值来自其他杂散线",
    "3 seeds": "3 个随机种子",
    "forced by the marker fit (markers alone give 33.3 fs)": "由标记拟合决定（只用标记积分就有 33.3 fs）",
    "max 5.6 dB; jitter 43.9 fs vs digitised 49.4 fs; the only discriminating PN hold-out":
        "最大 5.6 dB；抖动 43.9 fs vs 数字化曲线 49.4 fs；唯一有区分力的相噪留出检验",
    "cannot discriminate: copying the slide-29 markers gives 0.42 dB": "无区分力：直接照搬幻灯片 29 的标记也有 0.42 dB",
    "M=1 needs its own (larger) offset, as slide 12 implies": "M=1 需要更大的偏置，与幻灯片 12 的含义一致",
    "same data as the fit; eye-read 2-10 MHz points dominate": "与拟合同一组数据；2–10 MHz 的目读点起主导",
    "magnitude only; 90% CI on 3sigma is wide": "只检验幅度；3σ 的 90% 置信区间很宽",
    "loop |H| shapes the curve; measured low-offset rise not reproduced": "曲线形状由环路 |H| 决定；实测低偏移处的抬升未复现",
    "if not, the slides cannot tell the two mechanisms apart": "两者残差相近，幻灯片无法区分两种机理",
    "two-sided, worst-direction 3sigma, at 9.5 GHz": "双边、最坏方向 3σ，9.5 GHz",
    "assumes Kvco 150 MHz/V, T_off from T_nl=50 ps; sensitive to p3/C3": "假设 K_VCO = 150 MHz/V、T_nl = 50 ps；对 p3/C3 敏感",
    "duplicates D0 weights": "与 D0 的权重重复",
    "duplicates D3": "与 D3 重复",
    "10log(T_off ratio); 2.05 dB if T_nl -> 0": "10·log(T_off 之比)；T_nl → 0 时为 2.05 dB",
    "two-slice FIG.7/9 give only -2.04/-1.07 dB": "二片式 FIG. 7/9 只有 −2.04/−1.07 dB",
    "the comparative statement holds": "相对比较的说法成立",
    "paper number vs patent statement; no model involved": "论文数据对专利说法，未用模型",
}


def fmt_measured(name, m):
    if isinstance(m, dict) and "weights" in m:
        return "恒等式成立；权重 " + " : ".join(f"{w:g}" for w in m["weights"])
    for k, f in MEAS:
        if name.startswith(k):
            return f(m)
    return str(m)


def fmt_note(n):
    if n in NOTE:
        return NOTE[n]
    mm = re.match(r"([\d.]+) -> ([\d.]+) fs; measured in-band gain \[(.*)\] dB at 10k/20k/100k", n)
    if mm:
        g = "/".join(x.strip() for x in mm.group(3).split(","))
        return f"CP 噪声 {mm.group(1)} → {mm.group(2)} fs；实测带内收益 10k/20k/100k 处 {g} dB"
    return n


checks = [dict(id=c["check"].split(" ")[0], name=cn_name(c["check"]), kind=c["kind"], result=c["result"],
               measured=fmt_measured(c["check"], c["measured"]), expected=str(c["expected"]), note=fmt_note(c.get("note", "")))
          for c in R["checks"]]
counts = {}
for c in checks:
    counts.setdefault(c["kind"], {}).setdefault(c["result"], 0)
    counts[c["kind"]][c["result"]] += 1

# ---------------------------------------------------------------- page fragments
E = html.escape
KIND_CN = dict(arith="算术", consistency="拟合一致性", validation="留出验证", claim="说法对照")
RES_CN = dict(PASS="通过", DEVIATION="未复现", FAIL="失败")


def check_rows():
    out = []
    for c in checks:
        out.append(
            f'<tr data-kind="{c["kind"]}"><td class="mono">{E(c["id"])}</td><td>{E(c["name"])}</td>'
            f'<td><span class="kind kind-{c["kind"]}">{KIND_CN[c["kind"]]}</span></td>'
            f'<td><span class="res res-{c["result"].lower()}"><span class="res-ic" aria-hidden="true"></span>{RES_CN[c["result"]]}</span></td>'
            f'<td class="mono small">{E(c["measured"])}</td><td class="small muted">{E(c["note"])}</td></tr>')
    return "\n".join(out)


def marker_table():
    rows = "".join(
        f'<tr><td>{r["f"]/1e3:,.0f} kHz</td><td>{r1(r["meas"], 2)}</td><td>{r1(r["model"], 2)}</td>'
        f'<td class="{"pos" if r["d"] > 0 else "neg"}">{"+" if r["d"] > 0 else ""}{r1(r["d"], 2)}</td></tr>'
        if r["f"] < 1e6 else
        f'<tr><td>{r["f"]/1e6:g} MHz</td><td>{r1(r["meas"], 2)}</td><td>{r1(r["model"], 2)}</td>'
        f'<td class="{"pos" if r["d"] > 0 else "neg"}">{"+" if r["d"] > 0 else ""}{r1(r["d"], 2)}</td></tr>'
        for r in marker_rows)
    return rows


ranges = d2["profile_ranges_fs"]
fc_rng = d2["cp_flicker_corner_range_MHz"]
gain = d2["inband_gain"]
pat = d4["patent_0p001"]
mis = {x["M"]: x for x in d8["mismatch_sim"]}
cases = {x["case"]: x["jitter_fs"] for x in d8["cases"]}
dtc = R["D9_patent"][3]["table"]
P3K = [k for k in d6["ref_spurs"]["S/H re-distribution, 20 ps skew"] if k not in ("p3=8", "p3=40")][0]
spr = {x["M"]: x for x in R["D0"]["spread"]}
toff = {x["M"]: x for x in R["D0"]["toff"]}
cnt = lambda k, r: counts.get(k, {}).get(r, 0)

TITLE = "MTK 19.3 多路径反馈 PLL 技术分析"

STYLE = r"""
<style>
/* Layout: one reading column (~68ch) whose figures widen to 1040px; an analyzer-style marker readout is the signature detail */
:root {
  --bg: #f3f5f8; --panel: #ffffff; --fg: #121820; --fg2: #3b4552; --muted: #677382;
  --rule: #d6dce4; --grid: #e6eaf0; --accent: #1b55ad; --accent-soft: #e5edf9;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --ref: #8a939e;
  --good: #0ca30c; --warn: #fab219; --warn-ink: #7a5200; --good-ink: #075f07;
  --font-display: "Noto Serif SC", "Songti SC", "STSong", serif;
  --font-body: "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  --step--1: 0.8125rem; --step-0: 1rem; --step-1: 1.1875rem; --step-2: 1.5rem; --step-3: 2.125rem;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0e1115; --panel: #151a20; --fg: #e6eaef; --fg2: #b8c1cc; --muted: #8a94a1;
  --rule: #2a313a; --grid: #222932; --accent: #7eabf2; --accent-soft: #172538;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --ref: #78818c;
  --good: #0ca30c; --warn: #fab219; --warn-ink: #fcd27a; --good-ink: #7fdc7f; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0e1115; --panel: #151a20; --fg: #e6eaef; --fg2: #b8c1cc; --muted: #8a94a1;
  --rule: #2a313a; --grid: #222932; --accent: #7eabf2; --accent-soft: #172538;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --ref: #78818c;
  --good: #0ca30c; --warn: #fab219; --warn-ink: #fcd27a; --good-ink: #7fdc7f; color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font-family: var(--font-body); font-size: var(--step-0); line-height: 1.75;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 0 64px; }
.wrap { max-width: 1040px; margin: 0 auto; }
.prose { max-width: 68ch; }
h1, h2, h3 { font-family: var(--font-display); font-weight: 600; text-wrap: balance; line-height: 1.3; margin: 0; }
h1 { font-size: var(--step-3); letter-spacing: 0.01em; }
h2 { font-size: var(--step-2); }
h3 { font-size: var(--step-1); }
p { margin: 0; }
a { color: var(--accent); }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.small { font-size: var(--step--1); }
.muted { color: var(--muted); }
.eyebrow { font-family: var(--font-mono); font-size: var(--step--1); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
header.top { padding-block: 40px 28px; display: grid; gap: 14px; border-bottom: 1px solid var(--rule); }
.lead { color: var(--fg2); font-size: var(--step-1); line-height: 1.7; max-width: 62ch; }
.spec { display: flex; flex-wrap: wrap; gap: 6px 18px; font-family: var(--font-mono); font-size: var(--step--1); color: var(--fg2); }
.spec span b { color: var(--fg); font-weight: 500; }
nav.toc { display: flex; flex-wrap: wrap; gap: 6px 16px; padding-block: 14px; font-size: var(--step--1); border-bottom: 1px solid var(--rule); }
nav.toc a { text-decoration: none; color: var(--fg2); }
nav.toc a:hover { color: var(--accent); }
main { display: grid; gap: 56px; padding-top: 40px; }
section { display: grid; gap: 18px; scroll-margin-top: 16px; }
section > header { display: grid; gap: 4px; }
.sec-no { font-family: var(--font-mono); font-size: var(--step--1); color: var(--muted); }
ul.findings { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; max-width: 76ch; }
ul.findings li { display: grid; grid-template-columns: 5.5em 1fr; gap: 12px; align-items: baseline; }
.tag { font-size: 0.75rem; font-weight: 500; padding: 1px 8px; border-radius: 999px; justify-self: start; white-space: nowrap; border: 1px solid var(--rule); }
.tag-ok { color: var(--good-ink); border-color: var(--good); }
.tag-mid { color: var(--fg2); }
.tag-open { color: var(--warn-ink); border-color: var(--warn); }
.panel { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 18px; min-width: 0; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 18px; align-items: start; }
.cols > * { min-width: 0; }
figure { margin: 0; display: grid; gap: 10px; min-width: 0; }
figcaption { font-size: var(--step--1); color: var(--fg2); line-height: 1.6; }
figcaption b { color: var(--fg); font-weight: 500; }
.chart { position: relative; width: 100%; min-width: 0; touch-action: pan-y; }
.chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: var(--step--1); color: var(--fg2); }
.legend i { display: inline-block; width: 18px; height: 0; border-top: 2px solid; vertical-align: middle; margin-right: 6px; }
.legend i.dot { width: 9px; height: 9px; border-radius: 50%; border: 0; }
.legend i.band { height: 10px; border: 0; opacity: .25; }
.tip { position: absolute; pointer-events: none; background: var(--panel); border: 1px solid var(--rule); border-radius: 5px; padding: 6px 9px; font-size: 12px;
  line-height: 1.5; color: var(--fg); box-shadow: 0 4px 14px rgba(0,0,0,.12); white-space: nowrap; z-index: 2; }
.tip .k { color: var(--muted); }
.ax text { fill: var(--muted); font-family: var(--font-mono); font-size: 11px; }
.ax-title { fill: var(--fg2); font-family: var(--font-body); font-size: 11.5px; }
.grid line { stroke: var(--grid); stroke-width: 1; }
.base line { stroke: var(--rule); stroke-width: 1; }
.cross { stroke: var(--muted); stroke-width: 1; }
.l-s1 { stroke: var(--s1); } .l-s2 { stroke: var(--s2); } .l-s3 { stroke: var(--s3); } .l-ref { stroke: var(--ref); }
.f-s1 { fill: var(--s1); } .f-s2 { fill: var(--s2); } .f-s3 { fill: var(--s3); } .f-ref { fill: var(--ref); }
.sw-s1 { border-color: var(--s1) !important; background: var(--s1); } .sw-s2 { border-color: var(--s2) !important; background: var(--s2); }
.sw-s3 { border-color: var(--s3) !important; background: var(--s3); } .sw-ref { border-color: var(--ref) !important; background: var(--ref); }
.legend i:not(.dot):not(.band) { background: none !important; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.line.thin { stroke-width: 1.5; }
.dot { stroke: var(--panel); stroke-width: 2; }
.lbl { fill: var(--fg2); font-size: 11.5px; font-family: var(--font-body); }
.bar-lbl { fill: var(--fg2); font-size: 12px; font-family: var(--font-body); }
.bar-val { fill: var(--fg); font-size: 11.5px; font-family: var(--font-mono); }
.whisk { stroke: var(--fg2); stroke-width: 1.5; }
details.data { font-size: var(--step--1); }
details.data summary { cursor: pointer; color: var(--accent); }
.tbl-wrap { overflow-x: auto; min-width: 0; }
table { border-collapse: collapse; width: 100%; font-size: var(--step--1); }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { color: var(--muted); font-weight: 500; font-size: 0.75rem; letter-spacing: 0.04em; }
table.wide { min-width: 720px; } table.mid { min-width: 500px; }
td.num, th.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
/* analyzer marker readout */
.readout { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 14px 16px; font-family: var(--font-mono);
  font-size: 12.5px; font-variant-numeric: tabular-nums; min-width: 0; }
.readout .hd { color: var(--accent); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.readout table { font-size: 12.5px; }
.readout td, .readout th { padding: 3px 8px; border-bottom: 0; text-align: right; }
.readout td:first-child, .readout th:first-child { text-align: left; color: var(--fg2); }
.readout td.pos { color: var(--warn-ink); } .readout td.neg { color: var(--fg2); }
.readout .ft { margin-top: 8px; color: var(--muted); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
/* signal-chain diagram */
.chain { display: grid; gap: 10px; }
.row { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; }
.blk { border: 1px solid var(--rule); background: var(--panel); border-radius: 5px; padding: 8px 11px; font-size: var(--step--1); line-height: 1.45; min-width: 0; }
.blk b { display: block; font-weight: 500; color: var(--fg); }
.blk span { color: var(--muted); font-family: var(--font-mono); font-size: 11.5px; }
.blk.hl { border-color: var(--accent); background: var(--accent-soft); }
.arr { align-self: center; color: var(--muted); font-family: var(--font-mono); }
.eq { font-family: var(--font-mono); font-size: 13px; background: var(--panel); border: 1px solid var(--rule); border-left: 3px solid var(--accent);
  padding: 10px 14px; border-radius: 4px; overflow-x: auto; line-height: 1.9; }
.kind, .res { font-size: 0.75rem; white-space: nowrap; }
.kind { color: var(--fg2); }
.res { display: inline-flex; align-items: center; gap: 5px; font-weight: 500; }
.res-ic { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.res-pass { color: var(--good-ink); } .res-pass .res-ic { background: var(--good); }
.res-deviation { color: var(--warn-ink); } .res-deviation .res-ic { background: var(--warn); border-radius: 1px; transform: rotate(45deg); }
.filters { display: flex; flex-wrap: wrap; gap: 8px; }
.filters button { font: inherit; font-size: var(--step--1); padding: 4px 12px; border-radius: 999px; border: 1px solid var(--rule);
  background: var(--panel); color: var(--fg2); cursor: pointer; }
.filters button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
ol.design { margin: 0; padding-left: 1.4em; display: grid; gap: 12px; max-width: 80ch; }
ol.design li::marker { font-family: var(--font-mono); color: var(--muted); }
ol.design b { font-weight: 500; }
.note { font-size: var(--step--1); color: var(--muted); max-width: 80ch; }
code { font-family: var(--font-mono); font-size: 0.9em; background: var(--accent-soft); padding: 0 4px; border-radius: 3px; }
@media (max-width: 560px) { ul.findings li { grid-template-columns: 1fr; gap: 2px; } h1 { font-size: 1.75rem; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
"""

SCRIPT = r"""
<script>
(function () {
  const D = __DATA__;
  const NS = "http://www.w3.org/2000/svg";
  const el = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  const fHz = v => v >= 1e6 ? (+(v / 1e6).toPrecision(3)) + " MHz" : (+(v / 1e3).toPrecision(3)) + " kHz";
  const neg = s => String(s).replace("-", "−");

  function chart(host, cfg) {
    const draw = () => {
      host.innerHTML = "";
      const W = Math.max(280, host.clientWidth), H = Math.round(Math.min(cfg.h || 300, Math.max(220, W * 0.62)));
      const m = { l: 54, r: cfg.mr || 18, t: 28, b: 40 };
      const pw = W - m.l - m.r, ph = H - m.t - m.b;
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": cfg.aria }, host);
      const X = cfg.x, Y = cfg.y;
      const sx = X.log ? v => m.l + (Math.log10(v) - Math.log10(X.min)) / (Math.log10(X.max) - Math.log10(X.min)) * pw
                       : v => m.l + (v - X.min) / (X.max - X.min) * pw;
      const sy = v => m.t + (1 - (v - Y.min) / (Y.max - Y.min)) * ph;
      const g = el("g", { class: "grid" }, svg), ax = el("g", { class: "ax" }, svg);
      Y.ticks.forEach(t => { el("line", { x1: m.l, x2: m.l + pw, y1: sy(t), y2: sy(t) }, g);
        const tx = el("text", { x: m.l - 7, y: sy(t) + 4, "text-anchor": "end" }, ax); tx.textContent = Y.fmt ? Y.fmt(t) : neg(t); });
      X.ticks.forEach(t => { el("line", { x1: sx(t), x2: sx(t), y1: m.t, y2: m.t + ph }, g);
        const tx = el("text", { x: sx(t), y: m.t + ph + 16, "text-anchor": "middle" }, ax); tx.textContent = X.fmt ? X.fmt(t) : t; });
      const b = el("g", { class: "base" }, svg); el("line", { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph }, b);
      const xt = el("text", { x: m.l + pw, y: H - 4, "text-anchor": "end", class: "ax-title" }, svg); xt.textContent = X.title;
      const yt = el("text", { x: 4, y: 12, class: "ax-title" }, svg); yt.textContent = Y.title;
      const cid = "clip" + Math.random().toString(36).slice(2);
      el("rect", { x: m.l, y: m.t - 6, width: pw, height: ph + 6 }, el("clipPath", { id: cid }, el("defs", {}, svg)));
      const plot = el("g", { "clip-path": `url(#${cid})` }, svg);
      const pts = [];
      cfg.series.forEach(s => {
        if (s.type === "band") {
          const top = s.hi.map(p => [sx(p[0]), sy(p[1])]), bot = s.lo.map(p => [sx(p[0]), sy(p[1])]).reverse();
          el("path", { d: "M" + top.concat(bot).map(p => p.join(",")).join("L") + "Z", class: "f-" + s.c, "fill-opacity": 0.13 }, plot);
          return;
        }
        if (s.type === "line") {
          el("path", { d: "M" + s.d.map(p => sx(p[0]).toFixed(1) + "," + sy(p[1]).toFixed(1)).join("L"), class: "line l-" + s.c + (s.thin ? " thin" : "") }, plot);
        }
        s.d.forEach(p => { if (p[1] >= Y.min && p[1] <= Y.max) pts.push({ x: sx(p[0]), y: sy(p[1]), v: p, s }); });
      });
      cfg.series.filter(s => s.type === "dots").forEach(s => s.d.forEach(p => el("circle", { cx: sx(p[0]), cy: sy(p[1]), r: 4.5, class: "dot f-" + s.c }, plot)));
      (cfg.labels || []).forEach(L => { const t = el("text", { x: sx(L.x) + (L.dx || 0), y: sy(L.y) + (L.dy || 0), class: "lbl", "text-anchor": L.anchor || "start" }, svg); t.textContent = L.t; });
      const cross = el("line", { y1: m.t, y2: m.t + ph, class: "cross", visibility: "hidden" }, svg);
      const ring = el("circle", { r: 6.5, fill: "none", class: "l-s1", "stroke-width": 2, visibility: "hidden" }, svg);
      const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; host.appendChild(tip);
      const move = ev => {
        const r = svg.getBoundingClientRect(), k = W / r.width;
        const mx = (ev.clientX - r.left) * k, my = (ev.clientY - r.top) * k;
        let best = null, bd = 1e9;
        pts.forEach(p => { const d = Math.hypot(p.x - mx, (p.y - my) * 0.35); if (d < bd) { bd = d; best = p; } });
        if (!best || bd > 60) { tip.hidden = true; cross.setAttribute("visibility", "hidden"); ring.setAttribute("visibility", "hidden"); return; }
        cross.setAttribute("x1", best.x); cross.setAttribute("x2", best.x); cross.setAttribute("visibility", "visible");
        ring.setAttribute("cx", best.x); ring.setAttribute("cy", best.y); ring.setAttribute("class", "l-" + best.s.c); ring.setAttribute("visibility", "visible");
        tip.innerHTML = `<div><span class="k">${best.s.name}</span></div><div>${(cfg.x.tip || (v => v))(best.v[0])}  ·  <b>${neg((cfg.y.tip || (v => v))(best.v[1]))}</b></div>`;
        tip.hidden = false;
        const tw = tip.offsetWidth, px = best.x / k, py = best.y / k;
        tip.style.left = Math.min(Math.max(0, px + 12), r.width - tw) + "px"; tip.style.top = Math.max(0, py - 52) + "px";
      };
      svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
      svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); ring.setAttribute("visibility", "hidden"); });
    };
    draw();
    if (window.ResizeObserver) { let w = host.clientWidth; new ResizeObserver(() => { if (Math.abs(host.clientWidth - w) > 4) { w = host.clientWidth; draw(); } }).observe(host); }
  }

  function bars(host, rows) {
    const draw = () => {
      host.innerHTML = "";
      const W = Math.max(280, host.clientWidth), narrow = W < 520, lw = narrow ? 92 : 190, rh = 30, m = { t: 6, r: 58 };
      const H = m.t + rows.length * rh + 26, pw = W - lw - m.r;
      const vmax = 30, sx = v => lw + v / vmax * pw;
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "抖动预算：各噪声源贡献与可辨识范围" }, host);
      const g = el("g", { class: "grid" }, svg), ax = el("g", { class: "ax" }, svg);
      (pw < 260 ? [0, 10, 20, 30] : [0, 5, 10, 15, 20, 25, 30]).forEach(t => { el("line", { x1: sx(t), x2: sx(t), y1: m.t, y2: H - 22 }, g);
        const tx = el("text", { x: sx(t), y: H - 6, "text-anchor": t === 30 ? "end" : "middle" }, ax); tx.textContent = t === 30 ? "30 fs" : t; });
      const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; host.appendChild(tip);
      rows.forEach((r, i) => {
        const y = m.t + i * rh + 6, h = 16, x0 = sx(0), x1 = sx(r.v), rr = Math.min(4, x1 - x0);
        const lb = el("text", { x: lw - 10, y: y + 12, "text-anchor": "end", class: "bar-lbl" }, svg); lb.textContent = narrow ? r.short : r.name;
        el("path", { d: `M${x0},${y}H${x1 - rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 - rr},${y + h}H${x0}Z`, class: "f-s1" }, svg);
        if (r.hi - r.lo > 0.3) { el("line", { x1: sx(r.lo), x2: sx(r.hi), y1: y + h / 2, y2: y + h / 2, class: "whisk" }, svg);
          [r.lo, r.hi].forEach(v => el("line", { x1: sx(v), x2: sx(v), y1: y + 3, y2: y + h - 3, class: "whisk" }, svg)); }
        const vt = el("text", { x: Math.max(x1, sx(r.hi)) + 6, y: y + 12, class: "bar-val" }, svg); vt.textContent = r.v.toFixed(1);
        const hit = el("rect", { x: 0, y: y - 6, width: W, height: rh, fill: "transparent" }, svg);
        hit.addEventListener("pointerenter", () => { tip.innerHTML = `<div><span class="k">${r.name}</span></div><div><b>${r.v.toFixed(1)} fs</b>  ·  范围 ${r.lo.toFixed(1)}–${r.hi.toFixed(1)} fs</div>`;
          tip.hidden = false; const k = W / svg.getBoundingClientRect().width; tip.style.left = Math.min(lw / k, host.clientWidth - tip.offsetWidth) + "px"; tip.style.top = (y / k - 44) + "px"; });
        hit.addEventListener("pointerleave", () => { tip.hidden = true; });
      });
    };
    draw();
    if (window.ResizeObserver) { let w = host.clientWidth; new ResizeObserver(() => { if (Math.abs(host.clientWidth - w) > 4) { w = host.clientWidth; draw(); } }).observe(host); }
  }

  const z = (a, b) => a.map((v, i) => [v, b[i]]);
  chart(document.getElementById("c-pn"), {
    aria: "相位噪声：模型与实测", h: 340,
    x: { log: true, min: 8e3, max: 1.25e8, ticks: [1e4, 1e5, 1e6, 1e7, 1e8], fmt: fHz, tip: fHz, title: "频偏" },
    y: { min: -165, max: -105, ticks: [-160, -150, -140, -130, -120, -110], title: "L(f) dBc/Hz @VCO/2", tip: v => (+v).toFixed(1) + " dBc/Hz" },
    series: [
      { type: "line", c: "ref", name: "VCO 自由振荡（拟合幻灯片 27）", d: D.pn.vco_free, thin: true },
      { type: "line", c: "s2", name: "模型：关闭多路径（拟合 C）", d: D.pn.model_m1 },
      { type: "line", c: "s1", name: "模型：M=4（拟合 C）", d: D.pn.model_m4 },
      { type: "dots", c: "s2", name: "实测：关闭多路径（数字化）", d: D.pn.meas_m1 },
      { type: "dots", c: "s1", name: "实测：M=4 标记（幻灯片 29）", d: D.pn.meas_m4 } ],
    labels: [{ x: 1.2e7, y: -138.1, t: "SDM 隆起", dy: -10 }]
  });
  bars(document.getElementById("c-budget"), D.budget);
  const S = D.spur;
  chart(document.getElementById("c-spur"), {
    aria: "小数杂散随偏移频率", h: 300,
    x: { log: true, min: 8e3, max: 4e6, ticks: [1e4, 1e5, 1e6], fmt: fHz, tip: fHz, title: "杂散偏移（= 小数值 × 160 MHz）" },
    y: { min: -104, max: -55, ticks: [-100, -90, -80, -70, -60], title: "杂散 dBc @VCO/2", tip: v => (+v).toFixed(1) + " dBc" },
    series: [
      { type: "band", c: "s1", lo: z(S.off, S.p10), hi: z(S.off, S.p90) },
      { type: "line", c: "s1", name: "失配总体中位（3σ=0.5%）", d: z(S.off, S.p50) },
      { type: "line", c: "s3", name: "C_DN 电荷压缩 40 pF·V（零失配）", d: z(S.off, S.comp) },
      { type: "dots", c: "s2", name: "实测（幻灯片 30）", d: z(S.off, S.meas) } ]
  });
  chart(document.getElementById("c-fold"), {
    aria: "折叠噪声随偏置", h: 280,
    x: { min: 0, max: 2.4, ticks: [0, 0.6, 1.2, 1.8, 2.4], fmt: v => v + "T", tip: v => "偏置 T_nl+" + v + "T", title: "(T_off − T_nl) / T_VCO" },
    y: { min: -175, max: -70, ticks: [-170, -150, -130, -110, -90, -70], title: "带内 L dBc/Hz", tip: v => (+v).toFixed(0) + " dBc/Hz" },
    series: [ { type: "line", c: "s2", name: "M=1", d: D.fold.m1 }, { type: "line", c: "s1", name: "M=4", d: D.fold.m4 },
              { type: "dots", c: "s2", name: "M=1", d: D.fold.m1 }, { type: "dots", c: "s1", name: "M=4", d: D.fold.m4 } ]
  });
  chart(document.getElementById("c-rt"), {
    aria: "重定时裕量与抖动", h: 280,
    x: { min: 3.4, max: 6.1, ticks: [3.5, 4, 4.5, 5, 5.5, 6], fmt: v => v + "σ", tip: v => "裕量 " + v + "σ", title: "重定时建立裕量（σ = 1.5 ps）" },
    y: { min: 0, max: 210, ticks: [0, 50, 100, 150, 200], title: "抖动 fs", tip: v => (+v).toFixed(1) + " fs" },
    series: [ { type: "line", c: "s2", name: "共享第一级 DFF 滑周期", d: D.rt.shared }, { type: "line", c: "s1", name: "每片独立 DFF 滑周期", d: D.rt.per },
              { type: "dots", c: "s2", name: "共享第一级 DFF", d: D.rt.shared }, { type: "dots", c: "s1", name: "每片独立 DFF", d: D.rt.per } ]
  });
  chart(document.getElementById("c-jvf"), {
    aria: "抖动随 VCO 频率", h: 260,
    x: { min: 7.85, max: 9.6, ticks: [8.0, 8.5, 9.0, 9.5], fmt: v => v.toFixed(1), tip: v => v.toFixed(2) + " GHz", title: "VCO 频率 GHz" },
    y: { min: 31, max: 39, ticks: [32, 34, 36, 38], title: "抖动 fs", tip: v => (+v).toFixed(1) + " fs" },
    series: [ { type: "line", c: "s1", name: "模型（K_VCO 不变）", d: D.jvf.model }, { type: "line", c: "ref", name: "模型（K_VCO ∝ f³）", d: D.jvf.model_f3, thin: true },
              { type: "line", c: "s2", name: "实测（幻灯片 29 左）", d: D.jvf.meas }, { type: "dots", c: "s2", name: "实测", d: D.jvf.meas } ]
  });

  // check-table filter
  const btns = document.querySelectorAll(".filters button");
  btns.forEach(b => b.addEventListener("click", () => {
    btns.forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    const k = b.dataset.k;
    document.querySelectorAll("#checks tbody tr").forEach(tr => { tr.hidden = !(k === "all" || tr.dataset.kind === k); });
  }));
})();
</script>
"""


def body():
    pn_rows = "".join(f'<tr><td>{fHz(f)}</td><td class="num">{r1(m4)}</td><td class="num">{r1(m1)}</td></tr>'
                      for (f, m4), (_, m1) in zip(pn["model_m4"][::10], pn["model_m1"][::10]))
    spur_rows = "".join(f'<tr><td>{fHz(o)}</td><td class="num">{r1(me)}</td><td class="num">{r1(a)}</td><td class="num">{r1(b)}</td>'
                        f'<td class="num">{r1(c)}</td><td class="num">{r1(cp)}</td></tr>'
                        for o, me, a, b, c, cp in zip(S_["off"], S_["meas"], S_["p10"], S_["p50"], S_["p90"], S_["comp"]))
    budget_rows = "".join(f'<tr><td>{E(b["name"])}</td><td class="num">{b["v"]:.1f}</td><td class="num">{b["lo"]:.1f}–{b["hi"]:.1f}</td></tr>'
                          for b in budget)
    fold_rows = "".join(f'<tr><td class="num">{a[0]:.1f}T</td><td class="num">{r1(a[1], 0)}</td><td class="num">{r1(b[1], 0)}</td></tr>'
                        for a, b in zip(fold["m1"], fold["m4"]))
    rt_rows = "".join(f'<tr><td class="num">{a[0]}σ</td><td class="num">{a[1]:.0f}</td><td class="num">{b[1]:.0f}</td></tr>'
                      for a, b in zip(rt["per"], rt["shared"]))
    jvf_rows = "".join(f'<tr><td class="num">{a[0]:.2f}</td><td class="num">{a[1]:.1f}</td><td class="num">{b[1]:.1f}</td><td class="num">{c[1]:.1f}</td></tr>'
                       for a, b, c in zip(jvf["meas"], jvf["model"], jvf["model_f3"]))
    dtc_rows = "".join(f'<tr><td class="num">{d["X"]}</td><td class="num">{d["two_slice_delay_dffs"]}</td><td class="num">+{d["two_slice_extra_ontime_ps"]:.0f}</td>'
                       f'<td class="num">{d["two_slice_end_ps"]:.0f}</td><td class="num">1</td><td class="num">+{d["binary_extra_ontime_ps"]:.0f}</td></tr>' for d in dtc)
    spread_rows = "".join(f'<tr><td class="num">{M}</td><td class="num">{spr[M]["coarse_pp"]:.2f}T</td><td class="num">{spr[M]["eff_pp"]:.2f}T</td>'
                          f'<td class="num">{spr[M]["all_slices_pp"]:.2f}T</td><td class="num">T_nl + {toff[M]["offset_over_T"]:.2f}T</td></tr>' for M in (1, 2, 4, 8))
    rs = d6["ref_spurs"]
    p3k = [k for k in rs["S/H re-distribution, 20 ps skew"] if k not in ("p3=8", "p3=40")][0]
    ref_rows = "".join(f'<tr><td>{n}</td><td class="num">{r1(rs[k]["p3=8"], 0)}</td><td class="num">{r1(rs[k][p3k], 0)}</td><td class="num">{r1(rs[k]["p3=40"], 0)}</td></tr>'
                       for n, k in (("泄放电流偏置，CP 脉冲直接进环路滤波器", "bleed current offset, CP pulse into LPF"),
                                    ("开关电容偏置，CP 脉冲不经 S/H", "SC offset, CP pulse into LPF (no S/H)"),
                                    ("S/H 同时重分配，偏斜 20 ps", "S/H re-distribution, 20 ps skew"),
                                    ("S/H 同时重分配，偏斜 5 ps", "S/H re-distribution, 5 ps skew")))
    mrows = "".join(f'<tr><td class="num">M={M}</td><td class="num">{cases[{2: "M=2", 4: "design point M=4", 8: "M=8"}[M]]:.1f}</td>'
                    f'<td class="num">{mis[M]["jitter_no_mismatch_fs"]:.1f}</td><td class="num">{mis[M]["jitter_median_fs"]:.1f}</td>'
                    f'<td class="num">{mis[M]["jitter_p90_fs"]:.1f}</td></tr>' for M in (2, 4, 8))
    return f"""
<div class="wrap">
<header class="top">
  <div class="eyebrow">ISSCC 2025 · Session 19 · Paper 19.3 · MediaTek</div>
  <h1>多路径反馈小数分频 PLL 技术分析</h1>
  <p class="lead">对 34 fs 抖动、−255.5 dB FoM 的 MediaTek 多路径反馈 PLL 做行为级复现，用幻灯片上的实测标记标定 Python 模型，逐项核对专利 US 11,509,315 B2，并给出非理想因素和设计注意项。哪些结论被数据支持、哪些只是拟合结果、哪些从现有资料定不下来，本文分开标注。</p>
  <div class="spec"><span>工艺 <b>22 nm CMOS</b></span><span>参考 <b>80 MHz × 2</b></span><span>VCO <b>7.3–9.5 GHz</b></span><span>抖动 <b>33.8 fs</b>（10 kHz–100 MHz）</span><span>功耗 <b>24.4 mW</b></span><span>FoM <b>−255.5 dB</b></span><span>小数杂散 <b>−64.8 dBc</b></span><span>面积 <b>0.39 mm²</b></span></div>
  <p class="small muted">依据：19.3 报告幻灯片（33 页）、US 11,509,315 B2（16 项权利要求）。模型与数据：<code>mtk_pll/</code>，本页由 <code>make_html_report.py</code> 从 <code>results/isscc25_19p3_results.json</code> 生成。</p>
</header>
<nav class="toc" aria-label="目录"><a href="#findings">结论</a><a href="#mechanism">机理</a><a href="#patent">专利核对</a><a href="#model">模型标定</a><a href="#checks-sec">验证一览</a><a href="#nonideal">非理想因素</a><a href="#design">设计注意项</a><a href="#limits">边界</a></nav>
<main>

<section id="findings">
  <header><span class="sec-no">01</span><h2>结论</h2></header>
  <ul class="findings">
    <li><span class="tag tag-ok">成立</span><span>19.3 是专利 binary 实施例（FIG. 11/13）的流片。M=4 的切片电流 Icp/4、Icp/4、Icp/2 与权利要求 6 完全一致，专利的 PSEL/进位算术在 M = 2/4/8 下逐周期严格成立。</span></li>
    <li><span class="tag tag-ok">成立</span><span>多路径把有效量化台阶缩到 T_VCO/M：M=4 时 SDM 噪声按构造降低 {abs(R["D3"]["4"]["delta_db"]):.2f} dB。两条实测曲线反推出的降幅最优约 15 dB，≤ 9 dB 不被支持。</span></li>
    <li><span class="tag tag-mid">拟合</span><span>模型复现幻灯片 29 的 10 个实测标记，最大误差 {fitA["per_dataset"][0]["max_err_db"]:.2f} dB，积分抖动解析 {fitC["jitter_fs"]:.1f} fs、时域仿真 {d2["sim_jitter_fs"]:.1f} fs（实测 33.78 fs）。这是拟合结果，只用这 10 个标记插值积分就有 {d2["side"]["jitter_from_markers_only_fs"]:.1f} fs。</span></li>
    <li><span class="tag tag-open">未闭合</span><span>近端多路径收益：实测 10 kHz 处 {gain["measured"][0]:.1f} dB，只用 M=4 数据拟合的模型只给 {gain["fitA"][0]:.1f} dB（预测关闭多路径曲线的误差 rms {d2["holdout_M1"]["rms"]:.2f} dB）。需要一个随导通时间平方增长的大 1/f 项（I_DN 闪烁或 Q_OFST 偏置/VDD 噪声），幻灯片无法区分。</span></li>
    <li><span class="tag tag-open">未闭合</span><span>小数杂散：3σ = 0.5% 切片失配能解释幅度（实测位于总体第 {d4["measured_percentile_at_nominal"]:.0f} 百分位），但 C_DN 电荷压缩（C_DN·V_A ≈ 40 pF·V、零失配，带内均值 {r1(comp40["inband_mean"])} dBc，实测 {r1(d4["measured_inband_mean"])} dBc）同样能解释。两者形状残差相近（失配 {d4["shape_rms_mismatch"]:.2f} dB，压缩 {cmin:.2f}–{cmax:.2f} dB），而且都没有复现实测低偏移处的抬升。</span></li>
    <li><span class="tag tag-mid">修正</span><span>专利“电流失配约 0.1%，不是主要问题”是相对时序失配而言，这一点成立（{r1(pat["0.001_as_sigma"]["median_inband_mean"])} vs {r1(d5["1ps"]["no_retimer"])} dBc）；但对 −70 dBc 级的杂散规格，0.1–0.5% 的失配已不可忽略。</span></li>
    <li><span class="tag tag-open">未闭合</span><span>抖动随 VCO 频率的趋势与实测相反（模型 7.94 GHz 处 {jvf["model"][0][1]:.1f} fs，实测 32.6 fs）；实测 −101 dBc 参考杂散的来源也未定（模型加 S/H 后约 {r1(d6["ref_spurs"]["S/H re-distribution, 20 ps skew"][P3K], 0)} dBc）。</span></li>
  </ul>
</section>

<section id="mechanism">
  <header><span class="sec-no">02</span><h2>架构与机理</h2></header>
  <div class="chain" aria-label="信号链">
    <div class="row"><div class="blk"><b>80 MHz XO</b><span>× 2 倍频</span></div><div class="arr">→</div>
      <div class="blk hl"><b>3 路 PFD/CP 切片</b><span>Icp/2 · Icp/4 · Icp/4</span></div><div class="arr">→</div>
      <div class="blk"><b>环路滤波器</b><span>S/H 每周期重分配</span></div><div class="arr">→</div>
      <div class="blk"><b>双核反 Class-F VCO</b><span>7.3–9.5 GHz</span></div></div>
    <div class="row"><div class="blk"><b>MASH 1-1-1（细分辨率）</b><span>→ ∫ → PSEL, carry</span></div><div class="arr">→</div>
      <div class="blk"><b>MMD</b><span>N_MMD = N + D_N + carry</span></div><div class="arr">→</div>
      <div class="blk hl"><b>多路径重定时器</b><span>CK_MMD 或 CK_MMD + 1·T_VCO，按 PSEL 位选择</span></div><div class="arr">→ 回到 PFD</div></div>
  </div>
  <div class="prose" style="display:grid;gap:12px">
    <p>每个切片的 PFD 看到的是同一个 MMD 边沿，或者晚一个 VCO 周期的边沿。CP 电荷按切片电流加权求和，所以环路看到的“有效边沿”落在两者之间，台阶为 T_VCO/M。这等价于把 SDM 的分辨率提高 M 倍，延时单元却只是 VCO 时钟打拍的 DFF，延时天然等于 T_VCO，不需要 DTC 的增益或 INL 校准。</p>
  </div>
  <div class="eq">t_eff = t_MMD + T_VCO · Σ w_i·d_i = t_MMD + (B/M)·T_VCO　　w = 1/4, 1/4, 1/2；d_i ∈ {{0, 1}}；B = 0…M−1<br>ΔQ_step = Icp·T_VCO / M　　⇒　SDM 量化噪声 ∝ (T_VCO/M)²，降低 20·log₁₀M dB（M=4：12.04 dB）</div>
  <div class="prose"><p>代价有三个。第一，电荷加权的精度落在切片电流比上，比例误差直接变成 B 锯齿相关的带内小数杂散。第二，粗边沿本身仍然带着 −B·T/M 的锯齿，所以 CP 偏置要覆盖全部切片边沿的跨度，而不只是有效边沿。第三，每条 PSEL 路径都要在一个 VCO 周期（9.5 GHz 时 105 ps）内完成重定时。</p></div>
  <div class="tbl-wrap"><table class="mid"><thead><tr><th class="num">M</th><th class="num">粗边沿峰峰值</th><th class="num">有效边沿峰峰值</th><th class="num">全部切片跨度</th><th class="num">所需偏置 T_off</th></tr></thead><tbody>{spread_rows}</tbody></table></div>
  <p class="note">幻灯片 12 说 M=4 的时间展宽是 2T，模型给出的全部切片跨度是 {spr[4]["all_slices_pp"]:.2f}T，所需偏置是 T_nl + {toff[4]["offset_over_T"]:.2f}T（幻灯片公式按 T_nl + T 计）。所以幻灯片公式高估了热噪声收益（{r1(R["D0"]["slide12_formula_db"], 2)} vs {r1(R["D0"]["model_thermal_db"], 2)} dB），却低估了随导通时间平方缩放的 1/f 收益（{r1(R["D0"]["model_flicker_db"], 2)} dB）。</p>
</section>

<section id="patent">
  <header><span class="sec-no">03</span><h2>与专利 US 11,509,315 B2 的核对</h2></header>
  <div class="tbl-wrap"><table class="wide">
    <thead><tr><th>专利条目</th><th>专利内容</th><th>19.3 对应</th><th>结论</th></tr></thead><tbody>
    <tr><td>权利要求 1 / 9（独立）</td><td>两路电流源与 PFD；分频时钟控制器含重定时电路，按振荡时钟边沿对两路分频时钟都重定时</td><td>幻灯片 8：每片一个 CK_VCO-GATED 重定时 DFF，固定片也重定时</td><td>一致；19.3 另加时钟门控</td></tr>
    <tr><td>权利要求 2 / 10</td><td>MMD + SDM；第二路相对第一路延时整数个 T_VCO，延时与模数由 SDM 控制</td><td>幻灯片 8 数字宏（MASH 1-1-1 → ∫ → PSEL、carry）</td><td>一致（逐周期恒等式）</td></tr>
    <tr><td>权利要求 3–4 / 11–12，FIG. 4</td><td>DTC = 延时单元（DFF，或带校准的 VCDL）+ MUX</td><td>两个共享 DFF 产生 CK_RETIME(0)/(1)，每片一个 MUX</td><td>一致；共享延时 DFF 是 19.3 的实现选择</td></tr>
    <tr><td>权利要求 5 / 13，FIG. 5–10</td><td>二片式 (1−1/X, 1/X)·Icp</td><td>只在 M=2 时重合</td><td>19.3 在 M ≥ 4 不用二片式</td></tr>
    <tr><td>权利要求 6 / 14，FIG. 11</td><td>(1/2ⁿ, 1/2ⁿ, 2/2ⁿ)·Icp，n=2</td><td>幻灯片 11：Icp/4、Icp/4、Icp/2</td><td>完全一致（19.3 实现点）</td></tr>
    <tr><td>权利要求 7 / 15，FIG. 13</td><td>再加 (4/2ⁿ)·Icp，n=3</td><td>对应 M=8</td><td>一致</td></tr>
    <tr><td>权利要求 8 / 16</td><td>重定时触发器位置：MMD→PFD1、DTC→PFD2</td><td>多路径重定时器</td><td>一致</td></tr>
    <tr><td>FIG. 15</td><td>ΔT1 由重定时消除；ΔT2、ΔT3 固定，不折叠</td><td>幻灯片 13 (1)(2)、14</td><td>一致；重定时裕量须大于偏斜</td></tr>
    <tr><td>说明书第 10 栏限制</td><td>二片式 CP2 的 (X−1)T 额外脉宽须在下一个参考沿前结束，故改用 binary</td><td>19.3 用 binary</td><td>原理一致，但在 19.3 工作点不起作用（见下表）</td></tr>
    <tr><td>—</td><td>—</td><td>倍频器、开关电容 Q_OFST + S/H、双核 VCO、时钟门控</td><td>19.3 新增</td></tr>
    </tbody></table></div>
  <div class="cols">
    <figure><figcaption><b>二片式 vs binary，在 160 MHz / 9.5 GHz 下。</b>二片式的脉冲结束时刻远小于 T_ref/2 = 3125 ps，专利的窗口限制在 X ≤ 16 时都不起作用；binary 的实际收益是额外脉宽从 (X−1)T 降到 1T，以及更少的 VCO 速率延时 DFF。</figcaption>
      <div class="tbl-wrap"><table class="mid"><thead><tr><th class="num">X</th><th class="num">二片式延时 DFF</th><th class="num">额外脉宽 ps</th><th class="num">脉冲结束 ps</th><th class="num">binary 延时 DFF</th><th class="num">额外脉宽 ps</th></tr></thead><tbody>{dtc_rows}</tbody></table></div></figure>
    <figure><figcaption><b>专利声明的效果，在 19.3 工作点上。</b></figcaption>
      <div class="tbl-wrap"><table><thead><tr><th>专利声明</th><th>结果</th></tr></thead><tbody>
      <tr><td>SDM −12 dB</td><td>按构造 {r1(R["D3"]["4"]["delta_db"], 2)} dB；实测反推最优约 15 dB</td></tr>
      <tr><td>CP −1~2 dB</td><td>热噪声 {r1(R["D0"]["model_thermal_db"], 2)} dB（算术）；拟合模型总量 2.85 dB；实测近端 {gain["measured"][0]:.1f} dB</td></tr>
      <tr><td>PFD −3 dB</td><td>等分 −3.01；FIG. 7 −2.04；FIG. 9 −1.07；19.3 binary −4.26 dB（幻灯片无法检验）</td></tr>
      <tr><td>电流失配 0.001</td><td>0.001 按 σ 理解：{r1(pat["0.001_as_sigma"]["median_inband_mean"])} dBc；按 3σ 理解：{r1(pat["0.001_as_3sigma"]["median_inband_mean"])} dBc；实测 {r1(d4["measured_inband_mean"])} dBc</td></tr>
      <tr><td>抖动 &lt; 50 fs</td><td>实测 33.8 fs</td></tr>
      </tbody></table></div></figure>
  </div>
</section>

<section id="model">
  <header><span class="sec-no">04</span><h2>模型与实测标定</h2></header>
  <div class="prose"><p>模型按 PFD 周期步进，环路滤波器和 VCO 用精确状态空间离散，每片 CP 电荷按它自己的边沿时刻计算。CP 只有 DN 方向，偏置电荷 Q_OFST 来自开关电容。VCO 噪声用幻灯片 27 的自由振荡标记拟合（含 1/f³，拐点 {vf["corner_hz"]/1e3:.0f} kHz）后合成。环路带宽、相位裕度和带内噪声分配用幻灯片 29 的实测标记拟合。</p></div>
  <figure class="panel">
    <div class="legend"><span><i class="sw-s1"></i>模型 M=4</span><span><i class="dot sw-s1"></i>实测 M=4 标记</span><span><i class="sw-s2"></i>模型 关闭多路径</span><span><i class="dot sw-s2"></i>实测 关闭多路径（数字化）</span><span><i class="sw-ref"></i>VCO 自由振荡</span></div>
    <div class="chart" id="c-pn"></div>
    <figcaption><b>相位噪声，在 VCO/2 = 4.75 GHz 处。</b>拟合 C 同时用了 M=4 标记和关闭多路径的数字化曲线。只用 M=4 标记的拟合 A 预测关闭多路径曲线时 rms 误差 {d2["holdout_M1"]["rms"]:.2f} dB，近端偏小。10–30 MHz 的隆起是 SDM 量化噪声，多路径把它压低了约 12 dB。</figcaption>
    <details class="data"><summary>数据表（每隔 10 个点）</summary><div class="tbl-wrap"><table><thead><tr><th>频偏</th><th class="num">模型 M=4</th><th class="num">模型 关闭多路径</th></tr></thead><tbody>{pn_rows}</tbody></table></div></details>
  </figure>
  <div class="cols">
    <div class="readout" aria-label="实测标记与模型对照">
      <div class="hd"><span>MKR  幻灯片 29  闭环</span><span>载波 4.750118943 GHz</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>频偏</th><th>实测 dBc/Hz</th><th>模型</th><th>Δ dB</th></tr></thead><tbody>{marker_table()}</tbody></table></div>
      <div class="ft"><span>RMS Jitter 实测 33.782 fs</span><span>模型 {fitC["jitter_fs"]:.1f} fs</span></div>
    </div>
    <figure class="panel">
      <div class="chart" id="c-budget"></div>
      <figcaption><b>抖动预算（10 kHz–100 MHz，拟合 C）。</b>须线是 14 组近最优拟合给出的范围：VCO、SDM、输出噪底是确定的；参考白噪与 CP、CP 热噪声与 1/f 都分不开（I_DN 1/f 拐点 {fc_rng[0]:.0f}–{fc_rng[1]:.0f} MHz 都能拟合）。</figcaption>
      <details class="data"><summary>数据表</summary><div class="tbl-wrap"><table><thead><tr><th>噪声源</th><th class="num">fs</th><th class="num">范围</th></tr></thead><tbody>{budget_rows}</tbody></table></div></details>
    </figure>
  </div>
</section>

<section id="checks-sec">
  <header><span class="sec-no">05</span><h2>验证一览</h2></header>
  <div class="prose"><p>每项检查按证据性质分为四类：算术（按构造成立）、拟合一致性（与拟合用过的数据比较）、留出验证（未参与拟合的数据或幻灯片上独立的结论）、说法对照（论文与专利的说法彼此对照）。只有后两类算独立证据。</p></div>
  <div class="spec"><span>算术 <b>{cnt("arith","PASS")} 通过</b></span><span>拟合一致性 <b>{cnt("consistency","PASS")} 通过</b></span><span>留出验证 <b>{cnt("validation","PASS")} 通过 / {cnt("validation","DEVIATION")} 未复现</b></span><span>说法对照 <b>{cnt("claim","PASS")} 通过 / {cnt("claim","DEVIATION")} 不符</b></span></div>
  <div class="filters" role="group" aria-label="按类别筛选">
    <button type="button" data-k="all" aria-pressed="true">全部</button><button type="button" data-k="validation" aria-pressed="false">留出验证</button>
    <button type="button" data-k="claim" aria-pressed="false">说法对照</button><button type="button" data-k="consistency" aria-pressed="false">拟合一致性</button>
    <button type="button" data-k="arith" aria-pressed="false">算术</button></div>
  <div class="tbl-wrap"><table id="checks" class="wide"><thead><tr><th>编号</th><th>检查</th><th>类别</th><th>结果</th><th>测得</th><th>说明</th></tr></thead><tbody>{check_rows()}</tbody></table></div>
</section>

<section id="nonideal">
  <header><span class="sec-no">06</span><h2>非理想因素</h2></header>
  <div class="cols">
    <figure class="panel">
      <div class="legend"><span><i class="dot sw-s2"></i>实测</span><span><i class="sw-s1"></i>失配中位</span><span><i class="band sw-s1"></i>失配 10–90%</span><span><i class="sw-s3"></i>C_DN 压缩</span></div>
      <div class="chart" id="c-spur"></div>
      <figcaption><b>小数杂散随偏移频率。</b>杂散相量对切片电流误差严格线性，起作用的组合约为 ε_a + ε_b − 2ε_half。两种机理都把带内幅度落在实测附近，形状都由环路传函决定，从数据上分不开。</figcaption>
      <details class="data"><summary>数据表</summary><div class="tbl-wrap"><table><thead><tr><th>偏移</th><th class="num">实测</th><th class="num">p10</th><th class="num">中位</th><th class="num">p90</th><th class="num">压缩</th></tr></thead><tbody>{spur_rows}</tbody></table></div></details>
    </figure>
    <figure class="panel">
      <div class="legend"><span><i class="sw-s2"></i>M=1</span><span><i class="sw-s1"></i>M=4</span></div>
      <div class="chart" id="c-fold"></div>
      <figcaption><b>CP 偏置不足时的折叠噪声。</b>CP 只有 DN 方向，软启动区 T_nl = 50 ps。M=4 只需 T_nl + 1.2T 就进入线性区，M=1 要 ≥ 2T。最小 T_off 在 9.5 GHz 为 {d7["t_off_9g5_ps"]:.0f} ps，7.3 GHz 为 {d7["t_off_needed_7g3_ps"]:.0f} ps，固定的 C_OFST·VDD/I_DN 须按频段底端设计。</figcaption>
      <details class="data"><summary>数据表</summary><div class="tbl-wrap"><table><thead><tr><th class="num">偏置</th><th class="num">M=1</th><th class="num">M=4</th></tr></thead><tbody>{fold_rows}</tbody></table></div></details>
    </figure>
    <figure class="panel">
      <div class="legend"><span><i class="sw-s1"></i>每片独立 DFF</span><span><i class="sw-s2"></i>共享第一级 DFF</span></div>
      <div class="chart" id="c-rt"></div>
      <figcaption><b>重定时器裕量。</b>4σ 时抖动已升到 61/78 fs。5σ、6σ 在仿真长度内没有观察到滑周期，“≥ 5σ”是从 4–4.5σ 外推的。PSEL 晚一个周期：{d5["psel_late"]["jitter_fs"]:.0f} fs，1 MHz 处 {r1(d5["psel_late"]["L_1M"])} dBc/Hz。</figcaption>
      <details class="data"><summary>数据表</summary><div class="tbl-wrap"><table><thead><tr><th class="num">裕量</th><th class="num">每片 fs</th><th class="num">共享 fs</th></tr></thead><tbody>{rt_rows}</tbody></table></div></details>
    </figure>
    <figure class="panel">
      <div class="legend"><span><i class="sw-s2"></i>实测</span><span><i class="sw-s1"></i>模型 K_VCO 不变</span><span><i class="sw-ref"></i>模型 K_VCO ∝ f³</span></div>
      <div class="chart" id="c-jvf"></div>
      <figcaption><b>抖动随 VCO 频率（留出检验，未复现）。</b>冻结环路滤波器、T_off 固定为频段底端所需的 {d2["jitter_vs_fvco_fixed_toff_ps"]:.0f} ps，VCO 相噪按幻灯片 27 的频率曲线。模型在低频端抖动更大，实测相反；幻灯片没有给出各频段的环路参数和输出噪底。</figcaption>
      <details class="data"><summary>数据表</summary><div class="tbl-wrap"><table><thead><tr><th class="num">GHz</th><th class="num">实测</th><th class="num">模型</th><th class="num">模型 f³</th></tr></thead><tbody>{jvf_rows}</tbody></table></div></details>
    </figure>
  </div>
  <div class="cols">
    <figure><figcaption><b>参考杂散（160 MHz，在 VCO 处，dBc）。</b>假设 K_VCO = 150 MHz/V、Icp = 2 mA。S/H 同时重分配是必要条件；但模型加上 S/H 后比实测 −101 dBc 还低，实测值由其他机制决定（倍频器奇偶沿交替 5 ps 时 80 MHz 杂散约 −102 dBc，是候选之一）。</figcaption>
      <div class="tbl-wrap"><table><thead><tr><th>电荷注入方式</th><th class="num">p3=8</th><th class="num">拟合 p3</th><th class="num">p3=40</th></tr></thead><tbody>{ref_rows}</tbody></table></div></figure>
    <figure><figcaption><b>M 的取舍（抖动 fs）。</b>在 200 kHz 杂散信道上仿真 10 个失配样本（3σ = 0.5%），含杂散和折叠噪声。M=8 的噪声收益约 1 fs，会被更高的失配敏感度抵消；M=2 的 B 被 SDM 打乱，失配几乎不起作用。</figcaption>
      <div class="tbl-wrap"><table class="mid"><thead><tr><th class="num">M</th><th class="num">只计噪声</th><th class="num">无失配仿真</th><th class="num">失配中位</th><th class="num">失配 p90</th></tr></thead><tbody>{mrows}</tbody></table></div></figure>
  </div>
</section>

<section id="design">
  <header><span class="sec-no">07</span><h2>设计注意项（按优先级）</h2></header>
  <ol class="design">
    <li><b>切片电流比与 CP 电荷线性度。</b>二者都产生带内小数杂散，实测数据分不开。所有切片用同一单元拼成，共质心、长沟道、cascode；后仿提取每片电荷随脉宽的曲线，要求 C_DN·V_A ≫ 40 pF·V；必要时以 PSEL 为回归量做后台校准，或单元轮换（杂散转为噪声）。</li>
    <li><b>偏置 T_off = Q_OFST / I_DN 按频段底端设计。</b>7.3 GHz 需要 {d7["t_off_needed_7g3_ps"]:.0f} ps，再加上 VDD、C_OFST、Icp 容差和倍频器残差；低于 T_nl + 1.2T 时折叠骤增 40 dB 以上。</li>
    <li><b>重定时与门控 VCO 时钟。</b>T_VCO = 105 ps，每条 PSEL 路径按 PVT 做 STA，裕量 ≥ 5σ；共享的第一级 DFF 出错会移动全部切片，要求更严。裕量小于路径偏斜时约 {r1(d5["retimed_margin_lt_skew"], 0)} dBc。</li>
    <li><b>PSEL 与 N_MMD 同周期对齐。</b>晚一个周期，抖动恶化到 {d5["psel_late"]["jitter_fs"]:.0f} fs。</li>
    <li><b>Q_OFST 的电源与偏置噪声。</b>Q_OFST = C_OFST·VDD，锁定相差对电源的灵敏度 {d6["supply_ps_per_mV"]:.3f} ps/mV；每个采样须 &lt; {d6["vdd_noise_req_uV"]:.0f} µV rms，1/f 成分直接进带内，也是近端大 1/f 项的候选来源。为它单独配 LDO 和滤波。</li>
    <li><b>倍频器占空比校准。</b>45/55% 的 XO 不校准时，奇偶沿交替约 625 ps：80 MHz 杂散约 −60 dBc，T_off 还要多留约 313 ps；−101 dBc 级要求交替 &lt; 约 5 ps。</li>
    <li><b>参考杂散。</b>UP/DN 电荷必须在采样相同时重分配；实测 −101 dBc 的来源需要单独排查。</li>
    <li><b>M 的选择。</b>保持 M=4；先解决匹配，再考虑增大 M。</li>
    <li><b>下一步的抖动预算。</b>VCO 约 {fitC["parts_fs"]["vco"]:.1f} fs 是最大单项，近端由 CP/偏置的 1/f 项主导。</li>
  </ol>
</section>

<section id="limits">
  <header><span class="sec-no">08</span><h2>模型边界与复跑</h2></header>
  <ul class="note" style="display:grid;gap:6px;padding-left:1.2em;margin:0">
    <li>只有幻灯片，没有正文。Icp、K_VCO、T_nl、VDD、每片 PFD 抖动、参考白噪底是假设；fc、PM、第三极点、CP 噪声倍率与 1/f 拐点、XO 近端噪声是拟合值。dB 改善量和机理结论对这些假设不敏感，绝对的偏置噪声、参考杂散依赖它们。</li>
    <li>关闭多路径的曲线：9–300 kHz 为像素提取（±1 dB），2–10 MHz 为目读（±1.5 dB，4–12 MHz 被文字遮挡）。</li>
    <li>未建模：参考周期内的脉冲纹波、VCO 双核模式竞争、器件级电荷注入与过压、泄放源的 1/f 噪声。</li>
    <li>复跑：<code>cd mtk_pll &amp;&amp; python3 run_isscc25_19p3.py &amp;&amp; python3 make_html_report.py</code>。Markdown 版报告：<code>docs/ISSCC2025_19.3_MTK多路径反馈PLL_复现与专利核对.md</code>。</li>
  </ul>
</section>
</main>
</div>
"""


def fHz(v):
    return f"{v/1e6:g} MHz" if v >= 1e6 else f"{v/1e3:.3g} kHz"


S_ = spur
HEAD_LINKS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
              '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
              '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500'
              '&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600&display=swap">')


def build():
    data_js = json.dumps(DATA, ensure_ascii=False, separators=(",", ":"))
    script = SCRIPT.replace("__DATA__", data_js)
    fragment = (f"<title>{TITLE}</title>\n<meta name=\"claude:viewport-fit-sides\" content=\"cover\">\n{HEAD_LINKS}\n"
                f"{STYLE}\n{body()}\n{script}\n")
    standalone = ("<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n"
                  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
                  f"<title>{TITLE}</title>\n{HEAD_LINKS}\n{STYLE}\n</head>\n<body>\n{body()}\n{script}\n</body>\n</html>\n")
    return fragment, standalone


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fragment")
    a = ap.parse_args()
    frag, full = build()
    out = DOCS / "ISSCC2025_19.3_技术分析报告.html"
    out.write_text(full, encoding="utf-8")
    print("wrote", out, len(full))
    if a.fragment:
        Path(a.fragment).write_text(frag, encoding="utf-8")
        print("wrote", a.fragment, len(frag))
