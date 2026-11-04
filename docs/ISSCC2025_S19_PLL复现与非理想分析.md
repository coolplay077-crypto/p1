# ISSCC 2025 Session 19 小数分频 PLL：Python 复现验证、非理想因素分析与设计注意项

**对象：** ISSCC 2025 Session 19《Frequency Synthesizers and Series-Resonance VCOs》中的两篇论文
- **19.3（MediaTek，主对象）**：*A Fractional-N PLL with 34fs_rms Jitter and −255.5dB FoM Based on a Multipath Feedback Technique*（C.-C. Hung, C.-H. Shen, C.-L. Lin, M. Tzou, K. Fong, Y.-L. Hsueh）。资料：33 页报告幻灯片。
- **19.2（东京大学，同场对照）**：*A 96fs_rms-Jitter, −70.6dBc-Fractional-Spur Cascaded PLL Employing Two MMDs with Shared DSM for Quantization Noise Cancellation*（H. Zhang, Y. Zhu, M. Osada, T. Iizuka）。资料：3 页 Digest。

**模型与脚本：** [`mtk_pll/`](../mtk_pll/)。19.3 对应 `mtkpll/multipath19p3.py` + `run_isscc25_19p3.py`；19.2 对应 `mtkpll/cascaded_mmdqec.py` + `run_isscc25_19p2.py`。
**结果：** `mtk_pll/results/isscc25_19p3_results.json`、`isscc25_19p2_results.json`，图 `D*.png`（19.3）、`C*.png`（19.2）。
**版本：** V2.0，2026-11-04（替代基于错误资料的 V1.0，见 §0）。

---

## 0. 资料与范围

- 两份 PDF 中只有 **19.3 是 MediaTek** 的。19.2 是东京大学的论文，与 19.3 同场，同样做 ΔΣ 量化噪声抵消（QNC），作为对照一并复现。
- 19.3 是 MediaTek 专利 **US 11,509,315 B2** 的流片实现：二者共同发明人为 Yu-Li Hsueh，结构都是 binary 切片 CP + VCO 时钟重定时 + "MASH→积分器→PSEL/进位" 数字宏。所以 V1.0 报告里专利部分（切片 CP 的机理与非理想分析）是 19.3 的理论基础，本版直接复用并用实测数据检验。V1.0 中的 ISSCC 2008 ADPLL 与本次目标无关。
- 19.3 只有幻灯片，没有正文。凡是幻灯片没给的量（Icp、K_VCO、环路滤波器、各噪声源分配），都用**实测曲线拟合**得到，或者标注为假设（§2.3）。

---

## 1. 结论速览

（本节在评审与 19.2 结果完成后定稿。）

---

## 2. 19.3（MediaTek）：架构、复现方法与模型标定

### 2.1 架构要点（幻灯片 8~20、27~32）

| 模块 | 幻灯片给出的事实 | 建模方式 |
|---|---|---|
| 参考 | 80 MHz XO → 倍频器 DBL → 160 MHz PFD | f_PFD = 160 MHz；XO 近端噪声（1/f²）+ 白底，拟合 |
| 多路径反馈 | P = log₂M 位 PSEL，P+1 个 PFD/CP 切片，电流 Icp/2、Icp/4、…、Icp/M、Icp/M；多路径重定时器（VCO 门控时钟打拍的 DFF + MUX）给每片 CK_MMD 或 CK_MMD + 1·T_VCO；实现取 M = 4 | 与专利 binary 切片（FIG. 13）逐周期等价，整数恒等式校验；切片权重 [1/2, 1/4, 1/4] |
| 数字宏 | MASH 1-1-1 + 积分器（输出 PSEL 与进位）+ 加 N 得 N_MMD | 专利等价实现：细分辨率 MASH → {整数, 小数} → 累加器 → PSEL、进位 |
| CP | 单极性脉冲（锁定相差 T_fix）；偏置电荷 Q_OFST = C_OFST·VDD 由开关电容产生（不是泄放电流）；保持/采样两相，电荷每周期在采样相一次性重分配到 C1 | 每片按自身边沿计算电荷；偏置可选 'sc'（2kT·C_OFST 复位噪声、无纹波）或 'bleed'（电流源热噪声、连续纹波） |
| VCO | 双核反 Class-F，9.5 GHz、20% 调谐、15.4 mW、−126.59 dBc/Hz@1 MHz | 用幻灯片 27 实测自由振荡标记拟合 a₃/f³ + a₂/f² + a₀，按此谱合成相噪序列 |
| 输出与测量 | 在 VCO/2（≈4.75 GHz）测；10 kHz~100 MHz 积分抖动 33.78 fs（无杂散）、37.69 fs（含杂散）；24.4 mW；FoM −255.5 dB | VCO 相位 /2 后加上拟合出的输出噪底 a₀ |

### 2.2 模型（`mtkpll/multipath19p3.py`）

- **核心：** 每个 PFD 周期一步，四状态环路滤波器（C2‖(R1+C1) + R3/C3）+ VCO 的精确状态空间离散；os = 2 子步得到 0~160 MHz 输出谱；每片 CP 电荷按自己的边沿时刻计算。
- **噪声源：**
  - 合成的 VCO 自由振荡相噪（含 1/f³）
  - 公共参考白噪 + XO 近端 1/f²
  - 每片独立的 PFD/重定时抖动
  - CP 热噪声 16kTγ·Icp/V_ov，按导通时间计算，另含拟合出的 1/f 拐点
  - 偏置源噪声（SC 或泄放电流）
  - 输出噪底
- **解析模型：** 与仿真同参数的线性 s 域分量模型，用于交叉校验和快速拟合。

### 2.3 用实测数据标定

拟合数据：幻灯片 29 的 10 个闭环相噪标记（M=4），以及我从幻灯片 29 截图中数字化的"w/o multipath"浅色曲线（M=1，读数精度约 ±1.5 dB）。

| 拟合 | 自由参数 | 结果 | M=4 残差 | M=1 残差 |
|---|---|---|---|---|
| A：只拟合 M=4 | fc、PM、极点比 p3、参考白噪、XO 1/f² | fc 0.58 MHz，PM 69°，闭环 −3 dB 带宽 0.86 MHz | rms 0.33 dB | — |
| **C：联合拟合（采用）** | 再加 CP 噪声倍率、CP 1/f 拐点 | fc 0.59 MHz，PM 63°，BW 0.92 MHz，p3 = 26×fc，CP 倍率 1.04，CP 1/f 拐点 148 kHz，参考白噪 → 0 | rms 0.52 dB | rms 0.62 dB |

- 交越频率被锁定在 0.6 MHz 左右：固定 fc = 0.5/0.8/1.0 MHz 时，拟合残差升到 1.1/1.5/2.5 dB。
- **可辨识性：** 参考白噪与 CP 热噪声都是白噪，只能靠"M 改变 → CP 导通时间改变"区分。联合拟合把白噪全部归给 CP，依据是实测 M=1→M=4 带内改善约 1 dB。这个结论受数字化精度限制，所以同时给出拟合 A 作对照。
- 未拟合、只是假设的量：Icp = 2 mA、K_VCO = 150 MHz/V、T_nonlin = 50 ps、VDD = 0.8 V、每片 PFD 抖动 60 fs。相对结论（dB 改善、机理）对它们不敏感；绝对的参考杂散、偏置噪声依赖它们。

---

## 3. 19.3：复现验证结果

（D0~D8 详细结果，评审后定稿。）

---

## 4. 19.3：非理想因素分析与设计注意项

（评审后定稿。）

---

## 5. 19.2（东京大学）：复现与非理想因素

（待 19.2 工作流完成后填写。）

---

## 6. 两种 QNC 思路对照

（定稿时填写。）

---

## 7. 模型边界

（定稿时填写。）
