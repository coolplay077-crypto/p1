# 交接说明

> **项目**：Wu et al., JSSC 2019 模拟小数分频采样 PLL 的 Python 行为级复刻，以及推荐的混合 DTC 非线性校准（NLC）设计
> **日期**：2026-11-04
> **状态**：行为级复刻与方案设计已完成；尚未做定点（bit-true）、晶体管级和流片验证

## 1. 一页摘要

**复刻已与论文实测对齐。** 积分抖动 76.8 fs（实测 74.2 fs），non-doubler 模式 99.3 fs（实测 96.2 fs），FoM −249.5 dB（论文 −249.7 dB），近整数小数杂散 −63.6 至 −65 dBc（实测 −63.9 至 −66 dBc）。

**推荐方案是“混合 NLC”**，由三部分组成：

1. 上电或量产测试时测一次 DTC 曲线，生成逆映射表 M（8192 项 × 10 bit，输入分辨率 1/8 LSB），消除弓形 INL 和随机 DNL。
2. 后台 g2 sign-LMS，回归量为 Φe·(1 − 2x)，跟踪测量之后弓形的漂移。
3. 论文原有的 K_DTC 和 DCC 环路保持不变；全部环路共用同一个比较器输出的 PHE，不增加模拟电路。

**主要结果**（12 个失配样本的中位数，取 Δf = 20 / 100 / 400 kHz 中的最差值）：

| 指标 | 不校准（论文） | 混合方案 |
|---|---|---|
| 论文 DTC 小数杂散 | −61.2 dBc | −72.4 dBc |
| 小缓冲 DTC（C_fix 0.5 pF）小数杂散 | −57.3 dBc | −73.3 dBc |
| 小缓冲 DTC 近整数抖动（6240.1 MHz） | 89.6 fs | 76.6 fs |
| 论文 DTC，测量后弓形漂移 50 % | — | −72.3 dBc |
| 普通小数信道抖动（6333.7 MHz） | 76.9 fs | 76.5 fs |

**设计报告阶段新增的两条规则：**

- g2 必须在 50 µs gear-shift 之后才开启（`nlc_start=50e-6`）。从 0 µs 开启时，K_DTC / DCC 的最差收敛时间会从 38 / 29 µs 拉长到 70 / 55 µs。
- 前台测量误差的形态决定精度要求。逐码独立误差需 ≤ 0.1 LSB rms；若 INL 由相邻码 DNL 累加得到，需 ≤ 0.025 LSB rms，即每步约 2 fs。同为 0.1 LSB 时，累加型误差会使杂散变为 −61.4 dBc，比不校准还差。

**最大风险**是前台测量方法尚未确定，见第 6 节。

## 2. 交付物

| 路径 | 内容 |
|---|---|
| `docs/design_report_hybrid_nlc.md` | 设计报告（10 节：摘要、背景、目标、架构、原理、参数、仿真结果、硬件代价、风险、附录） |
| `docs/design_report_hybrid_nlc.pdf` | 同一报告的排版版本（16 页，含架构图和 3 张结果图） |
| `docs/img/` | 报告插图 |
| `README.md` | 项目总览：复刻结果、NLC 研究、运行方法、文件结构 |
| `spll/` | 模型包（参数、DTC 物理模型、环路模型、numba 内核、仿真与分析） |
| `experiments/` | 生成全部图表和结果的脚本 |
| `results/` | 实验结果（JSON / TXT） |
| `figures/` | 复刻与 NLC 研究的图（fig0–fig12） |
| `tests/test_model.py` | 8 项回归测试 |
| `legacy/v1_before_fulltext/` | 第一版模型（只依据摘要和专利写成，已过时，仅备查） |

在线可编辑版报告在 Claude Docs 上：<https://claude.ai/artifact/48uyL4ytTFpgYy9w4DcmbG>（仅作者账户可见）。仓库中的 `.md` / `.pdf` 是 2026-11-04 导出的快照。

## 3. 快速开始

```bash
pip install -r requirements.txt
```

```bash
python tests/test_model.py
```

在仓库根目录运行混合方案，测 Δf = 100 kHz 处的小数杂散（numba 编译缓存建好后约 3 s，应输出 −73.8 dBc）：

```python
import sys
sys.path[:0] = [".", "experiments"]          # 在仓库根目录运行
from spll import near_integer, spur_run
from run_nlc import frac_spur

p = near_integer(100e3, nlc="fglut+poly", mu_g3=0.0, nlc_start=50e-6)   # 混合方案，Δf = 100 kHz
rq, _ = spur_run(p, n_conv=300000, avg=100000)                          # 收敛 → 冻结 → 无噪测杂散
print(f"{frac_spur(rq, p, 100e3):.1f} dBc")
```

## 4. 代码导览

| 文件 | 看什么 |
|---|---|
| `spll/params.py` | 全部参数。每项都标注来源：[P] 论文给出，[M] 用 Fig. 13 实测拟合，[A] 假设。NLC 相关参数在 “DTC nonlinearity calibration” 一节 |
| `spll/core.py` | 逐周期内核。DTC 码字通路（含 NLC 预失真）在 “DTC code (+ NLC)” 段，g2 等 LMS 更新在 “background LMS loops” 段 |
| `spll/simulate.py` | `simulate()`、`spur_run()`（先带噪收敛，再冻结校准、关闭噪声测杂散），以及 `fg_inverse_map()`（逆映射表生成） |
| `spll/dtc.py` | RC 延迟变斜率 DTC 的物理模型，以及三种 DTC 场景 `SCENARIOS` |
| `experiments/run_nlc.py` | NLC 方案对比、Monte-Carlo、抖动、漂移；`frac_spur()` 是报告使用的杂散定义 |

`nlc` 参数的取值：

| 取值 | 含义 |
|---|---|
| `none` | 论文设计，只做增益校准 |
| `poly` | 后台多项式；`mu_g3=0` 时为纯 g2 |
| `pwl` / `lut` | 后台 8 段 PWL / 32 项按码索引的 LUT（存在可观测性问题，不推荐） |
| `fglut` | 前台逆映射表 |
| `fglut+poly` | **混合方案**（推荐配置：`mu_g3=0`、`nlc_start=50e-6`） |

前台测量相关参数：`fg_meas_err`（rms 误差，单位 LSB，默认 0.1）、`fg_meas_mode`（`iid` 逐码独立，或 `cumdnl` 相邻码 DNL 累加）、`fg_drift`（测量之后弓形的相对变化）。

## 5. 结果复现

| 命令 | 输出 | 耗时（4 核） |
|---|---|---|
| `python experiments/calibrate_noise.py` | `results/noise_fit.json` | 约 2 s |
| `python experiments/run_repro.py` | `figures/fig0–7`、`results/repro_summary.json` | 约 1 min |
| `python experiments/run_nlc.py` | `figures/fig8–12`、`results/nlc_summary.json` | 约 2 min |
| `python experiments/check_hybrid_startup.py` | 打印到终端（存档见 `results/hybrid_startup.txt`） | 约 2 min |
| `python experiments/check_fg_measurement.py` | `results/fg_measurement.json` | 约 5 min |
| `python experiments/check_fg_measurement.py cumdnl:0.025 cumdnl:0.05` | 合并进同一个 JSON | 约 2 min |

开发环境：Python 3.13，numpy 2.5，scipy 1.18，numba 0.68，matplotlib 3.11。

## 6. 已知局限与待办（按优先级）

1. **确定前台测量方法，并量化其误差形态。** 这是方案成立的前提。频谱法（逐码切换 i 与 i+1，读一阶边带）得到的是 DNL，累加成 INL 后误差是随机游走，每步需达到约 2 fs 才够用。可以评估的替代方案：对每个码独立测量的片上 TDC；或者先测二进制电容阵列各位的权重、再拟合平滑弓形，避免 1023 步误差累加。
2. **默认参数与报告结论的关系。** 代码中 `nlc_start` 的默认值仍为 0。`results/nlc_summary.json`（报告中的 Monte-Carlo、抖动、漂移数据）是在 `nlc_start=0` 下得到的；50 µs 规则只在 `check_hybrid_startup.py` 中验证过，那里的杂散差别不超过 0.3 dB（论文 DTC）。若把默认值改为 50e-6，需重跑 `run_nlc.py`。
3. **bit-true 定点模型。** 目前数字部分是浮点运算。需要确定 g2、Φe、x 的字长（报告给出建议值：g2 取 1 符号位 + 3 整数位 + 16 小数位，Φe 取 14 bit，x 取高 8 位），并验证表的 1/8 LSB 分辨率能否降低。按整数码索引的 1k 项变体尚未验证。
4. **扩展漂移模型。** 目前只模拟了弓形幅度的漂移；还需要加入 DNL 与电源变化，并验证切换信道时沿用 g2 是否可行。
5. **记忆效应。** 静态表无法校正记忆效应，低 bleed DTC 的杂散停在约 −71 dBc。可以评估以前一个码为第二维度的预失真。
6. **码字窗口位置。** 码范围中点正好落在 MSB 跳变处，MSB 的 DNL 会在 Φe = 0 处形成台阶，对应频率为 Δf 的锯齿波。可以评估把窗口移离该点的效果。
7. **模型局限**：DTC 物理模型（√C 斜率律、二进制权重电容失配、一阶记忆效应）是假设，只用论文 Fig. 11 和 Fig. 16a 校准过；Monte-Carlo 只有 12 个失配样本；杂散在冻结校准、关闭噪声后测得；未建模 S/H 电荷注入引起的参考杂散、频率捕获和温度对噪声的影响。

## 7. 参考资料

这些论文和教程因版权原因未放入仓库：

- W. Wu et al., “A 28-nm 75-fs<sub>rms</sub> Analog Fractional-N Sampling PLL With a Highly Linear DTC Incorporating Background DTC Gain Calibration and Reference Clock Duty Cycle Correction,” *IEEE JSSC*, vol. 54, no. 5, pp. 1254–1265, May 2019.
- “A 14-nm Ultra-Low Jitter Fractional-N PLL Using a DTC Range Reduction Technique and a Reconfigurable Dual-Core VCO,” *IEEE JSSC*, 2021.
- W. Wu, “Design of DTC-Assisted High Performance Fractional-N PLLs,” IEEE CAS 教程讲义，2024-11-10。
- W. Wu, “Digital-to-Time Converter and Its Application to Fractional-N Frequency Synthesis Circuits from a Systems Perspective,” *IEEE Solid-State Circuits Magazine*, Winter 2025.
