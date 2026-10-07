---
title: "CNT-based ADPLL：整数相位保留、相干快照与短量程 TDC"
subtitle: "CKV/4、CKV/8、共享状态与物理选沿的多轮调研整合报告"
author: "技术研究报告"
date: "整合复核版 V1.0 · 2026-10-03"
lang: zh-CN
---

**报告定位：** 文献证据整理、核心问题定义、统一相位模型与验证框架。不是已完成晶体管验证的电路定版，也不是专利新颖性结论。

**覆盖材料：** 2026-09-27 与 2026-09-28 两份既有调研报告、当前对话新增的 TI / ETRI / Sony 等线索，以及本次可取得的公开原文。历史报告已经读取；未取得全部历史对话逐字记录，因此本文不充当原始问答存档。

**阅读路线：** 第 1–3 章说明问题与坐标；第 4–5 章给出文献证据及其边界；第 6–10 章展开时序、物理选沿与接口；第 11–13 章记录修订、验证和未解决项；第 14 章及附录提供引用入口和原图定位。

# 1. 核心问题与结论摘要

## 1.1 核心问题的正式表述

> 在 CNT / VPA / phase-domain ADPLL 中，能否将宽位整数相位计数器的高位降至 CKV/4 或 CKV/8 工作，同时完整保留原始 CKV 周期编号；再把低位状态、参考相关快照和被选择的真实物理边沿关联起来，使有限量程 TDC 只测局部时间残差，并在计数进位、异步采样、选沿切换和 TDC 饱和时，仍得到坐标一致、可判断有效性的完整相位观测？

这里有两个相互关联、但不能混为一谈的任务。第一是**测量链**：持续记录振荡器实际走过的周期，并在参考事件附近形成粗细联合时间戳。第二是**执行链**：低速并行状态或预测命令如何在高速侧生成指定的物理边沿。P/S、one-hot、移位状态机和多相选择器只是执行链的候选实现，不等于整个测量问题已经解决。

本项目进一步关心：低位计数状态能否直接或经确定映射，兼任 physical-edge identity / selector 的控制信息。目标不是另找一个普通小数分频器，而是保留 CNT-based ADPLL 的持续整数相位观测。

## 1.2 已有证据足以支持什么

**宽位计数器可以拆分降速。** TI 的 /8 实施例、Xu/Lindfors 的 /4 相位累加器，以及 ETRI 的 /4 计数器都提供了直接结构依据。降速的是高位算术及部分采样后处理，并非必须丢弃原始周期的低位状态。[R01–R04]

**整数与小数测量必须有显式的一致性机制。** 双候选重定时、延迟匹配读出、冗余相位状态和整数周期修正均有公开依据。Havens 和 Sony 尤其说明，小数/多相状态不仅用于 fine phase，也可以反向校验 coarse epoch。[R01][R05][R07][R08][R10][R11]

**物理选沿与短量程 TDC 可以用于 phase-domain ADPLL。** Kuo 2018、MediaTek 的选相专利，以及 Zong 2019 的 DTC/TDC 链分别提供不同实现。但“缩短 TDC 输入的真实时间间隔”与“数字上减去整周期”不是一回事。[R06][R09][R11]

## 1.3 本次必须纠正的三点

第一，不能通用地写成 $8C+q+e/8+\epsilon$。其中 $q$ 可能已包含 $e$ 所表达的整周期位置；而 $e/8$ 的单位也可能是**分频后周期**，不是原始 CKV 周期。必须先统一时钟节点、相位原点和量纲。

第二，不能把所有 epoch 错配都归结为 ±1 个原始周期。对于 $N=MC+q$，高、低位在组边界发生撕裂采样时，两个典型错误分别是相对相应合法状态的 $-M$ 与 $+M$。/8 高位错一组与 raw-CKV 错一周期是不同故障。

第三，Sony 不是“此前没有共享状态方法”的证据起点。Havens 专利已同时包含整数计数、小数检测、sub-fractional TDC，以及利用小数状态消除 one-count uncertainty 的处理。Sony 的贡献应定位为另一条明确、紧凑的共享状态与修正实现，而不是本次搜索已经证明的最早先例。[R07][R08]

## 1.4 当前结论的边界

尚未核实到一篇与以下完整组合严格同构的公开实现：**raw CKV 的 /8 高位计数 + 3-bit 原周期 residue + 该状态直接控制物理选沿 + short TDC + 完整 epoch/validity 接口**。更强的工程扩展还包括 MASH future-edge planning、执行侧真实回执和 fine 饱和后的 coarse 接管。

“未核实到”只描述当前证据集，不能推导为“没有先前技术”。同样，能够把不同文献中的局部机制拼成合理架构，不等于组合后的时序、因果性和模拟误差已经通过验证。

# 2. 研究范围与需求冻结

## 2.1 必须保持的目标

| 编号 | 需求 | 验收语义 |
|---|---|---|
| G1 | 持续整数相位观测 | CNT 记录实际 CKV 周期，不是只在目标命中时才记录命令状态 |
| G2 | 高位降速 | 宽位高位允许在 /4 或 /8 域工作，少量低位状态可继续高速运行 |
| G3 | 原周期编号不丢失 | 相位模型可追溯到所选原始 CKV 节点，而非只保留慢时钟边沿 |
| G4 | 粗细观测一致 | coarse 与 fine 对应同一物理锚点，或携带显式、可验证的坐标变换 |
| G5 | fine 真实量程受控 | 目标为约一个原始 CKV 周期或更小；必须按真实输入间隔检查 |
| G6 | 边界与故障可辨识 | wrap、采样错配、无效码、饱和、丢沿、重复沿不能静默变成有效相位 |
| G7 | P/S 不替代 CNT | P/S 或 slot executor 负责物理边沿执行，不删除参考相关的 coarse 测量 |

上述需求继承前两份报告的目标；本次只澄清语义，没有把目标改为普通分频器研究。[H01][H02]

## 2.2 文献筛选的边界

优先纳入真正以 oscillator-cycle count / variable phase 参与主相位测量的 ADPLL/DPLL。高速计数器、retimer 和 selected-edge TDC 可以分别构成局部证据，但需要注明它们没有覆盖的接口。

通用 serializer、普通 fractional divider、phase-switching divider 可以作为门控、重定时或无毛刺选相的电路参考，不能仅因其有“/4”“多相”或“P/S”就认定与目标同构。[R18]

## 2.3 证据等级与复核状态

| 标记 | 含义 | 本报告的使用规则 |
|---|---|---|
| A-P | 本次核对了专利原文及相关结构/说明 | 证明披露了某种方法；不等于硅片实测 |
| A-J | 本次核对了论文原文和关键图 | 论文内明确给出的结构可作为直接证据；不外推到本项目 PVT |
| B | 官方元数据/摘要可核对，内部电路未充分核实 | 只保留为相关线索，不补写不可见连接 |
| H | 前轮报告保存了结论，本次未重新取得完整原始证据 | 保留历史贡献，明确不能与本次直接复核混称 |
| D | 本报告推导、示例或候选工程规范 | 不是原文公式、不是已完成的电路验证 |

证据等级评价的是**支撑力度与读取范围**，不是论文或专利本身的质量排序。H 也不表示内容必然错误，只表示本次的可复核链条尚不完整。

# 3. 统一时钟节点与相位坐标

## 3.1 CKV、DCO、预分频输出不能跨文献直接同名代换

不同资料对 CKV 的命名不同。Bogdan 基线中的 CKV、Kuo 论文中的多相 CKV，以及 Zong 论文中经过前置分频的 CKV，不应被自动视为同一层级的振荡器节点。Zong 的系统图明确存在约 20 GHz 基波经过 /4 与 /2 后进入 phase detector 的 CKV；其 counter 内部的再分组是另一层问题。[R11]

本报告将**希望完整保留周期编号的那个时钟节点**统一称为 $CK_0$，其周期为 $T_0$、频率为 $f_0$。它可能就是 LC DCO，也可能是已被工程明确选定的预分频节点。只要改变 $CK_0$，所有 CNT 权重、FCW、fine 归一化和 edge ID 都必须一起换算。

| 符号 | 定义 | 单位/范围 |
|---|---|---|
| $CK_0,T_0,f_0$ | 目标原始计数时钟及其周期、频率 | s、Hz |
| $M$ | 高、低计数分组倍率 | 本报告主要取 4 或 8 |
| $C$ | 高位组计数，经原点/延迟对齐后的值 | 一个计数代表 $M$ 个 $CK_0$ 周期 |
| $q$ | 组内原周期 residue | $0,\ldots,M-1$；不是 TDC 小数码 |
| $N$ | 原周期整数编号 | $N=MC+q$ |
| $J$ | 某个实际原始上升沿的绝对编号 | 原周期 |
| $\alpha$ | 选中边沿相对该上升沿的周期内偏移 | 原周期；只在独立存在该自由度时加入 |
| $\mu$ | 参考至被选边沿的有符号相位间隔 | 原周期 |
| $T_d$ | 分组慢时钟的周期 | $T_d=MT_0$，理想固定倍率 |
| $a$ | 某一多相周期内的区域标签 | 必须另给时钟节点和映射表 |

## 3.2 整数分解是定义，不是 CDC 正确性的证明

对已对齐的、逻辑一致的状态，定义：

$$
N=MC+q,\qquad C=\operatorname{floor}(N/M),\quad q=N\bmod M. \tag{1}
$$

合法连续计数必须满足：

$$
(C,M-1)\longrightarrow(C+1,0). \tag{2}
$$

式 (1) 对正确状态当然成立，但不能由此证明“任意时刻独立采样 C 和 q 后拼接都正确”。后者是电路的同步、延迟匹配、编码和边界校正问题。

此外，普通二进制 $q[2]$ 的上升沿对应低三位 3→4，下降沿对应 7→0。因此，“把 q 的最高位当 /8 时钟”之后，还必须核对高位触发极性、复位原点及流水延迟。不能只看信号名 CKVD8 就默认它的某个有效沿等于式 (2) 的 carry。

## 3.3 完整相位的通用表达

以连续展开的原时钟相位 $\Phi_0(t)$ 为定义，实际被选物理边沿的坐标记为：

$$
A_k=J_k+\alpha_k. \tag{3}
$$

从参考事件 $t_{R,k}$ 到该边沿 $t_{E,k}$ 的精确相位间隔为：

$$
\mu_k=\int_{t_{R,k}}^{t_{E,k}} f_0(t)\,dt. \tag{4}
$$

于是：

$$
\Phi_0(t_{R,k})=A_k-\mu_k. \tag{5}
$$

这里 $\mu$ 的符号由积分上下限决定；选择 preceding edge 或 following edge 都可用同一公式，不再用一个未定义的“±TDC”掩盖约定。

在一个局部间隔内近似频率恒定，才有：

$$
\widehat{\mu}_k\approx\frac{\widehat{\Delta t}_k}{\widehat T_0[k]}. \tag{6}
$$

快速调频、强瞬态或跨多个周期时，应评估式 (6) 相对式 (4) 的误差。若间隔内频率估计误差有界为 $\delta f_{max}$，则有简单上界 $|\delta\mu|\leq\delta f_{max}|\Delta t|$。这也是为什么过长的 selected-edge 间隔不宜仅靠固定周期归一化。

## 3.4 为什么不能直接叠加 q 和 Octal

以一个**理想 /4、八相均匀分布且相位原点对齐**的示例说明。若 $a=0\ldots7$ 是分频后周期内的八相区域，则：

$$
\Phi_d=C_d+\frac{a}{8}+\epsilon_d.
$$

换算为原周期：

$$
\Phi_0=4\Phi_d=4C_d+\frac{a}{2}+4\epsilon_d. \tag{7}
$$

再令 $q=\operatorname{floor}(a/2)$、$p=a\bmod2$，得到：

$$
\Phi_0=4C_d+q+\frac{p}{2}+\epsilon_0,\qquad\epsilon_0=4\epsilon_d. \tag{8}
$$

此时 a 已经含有 q 的信息；再把 $q+a/8$ 相加就是混合单位并可能重复计数。式 (7)–(8) 是量纲推导，不是对某篇原文 decoder truth table 的逐码复刻。真实电路还需要处理相位排列、边沿极性、DCC 和原点偏置。

# 4. 文献证据：逐项解释其价值和边界

## 4.1 TI：/8 高低位分解与 SEL_EDGE 候选选择

**来源：** US20050195917A1，*Method and apparatus for crystal drift compensation*，Staszewski / Leipold；同族 WO2005086759A2。核心在 Fig.4，而非仅看标题。[R01]

原文给出 CKV 驱动的 mod-8 低位 `RV<2:0>`、CKVD8 驱动的高位 `RV<8:3>`，以及分别在 CKV 上升沿、下降沿采样 FREF 得到的两套重定时/低位采样候选；`SEL_EDGE` 参与候选选择。CKVD8 还承担部分延迟处理。

**证据价值：** 直接证明少量高速低位状态与降频高位可以组成 VPA，且 fine-side 边沿判定可参与 coarse 路径选择。

**边界：** 它不能被解释为“先把 fine TDC 输入统一变为 8T0，再由 snapshot 自动压缩成 T0”，也不直接披露本项目的 P/S 绝对边沿执行器。高位极性与流水原点应以 Fig.4 逐路径核对，不能机械拼接。

## 4.2 Xu / Lindfors：/4 快速状态，先采样再编码

**来源：** ISCAS 2008 论文与 WO2009053531A1，*Phase accumulator for digital phase locked loop*。[R02][R03]

专利的示例使用低速高六位 modulo incrementer 和高速移位状态。低位信息在 CKR 采样后由 4-to-2 encoder 恢复；某些实施方式还使用高计数器最低位参与解码。相关结构/真值表见 Fig.6–7。

**证据价值：** “原周期 residue 必须保留”不等于“一定用高速二进制低位加法器”。高速侧可以保存易于实现的状态，慢速侧再解码。

**边界：** 状态编码并不免除 epoch 一致性。该资料不能单独证明同一低位状态已经控制 short-TDC 的物理选沿，也不能把所有 encoder 输入假定为独立同步的普通总线。

## 4.3 ETRI：/4 carry 与连续计数的直接实例

**来源：** US20130156147A1，*High speed counter apparatus*。[R04]

该实施例使用低两位状态形成与 carry 相关的 CKVD4，并由其驱动高位；描述了低位 11→00 与高位进位的关系，组合得到连续的 8-bit 计数。

**证据价值：** 可用于核对式 (1)–(2) 所要求的 count lineage：慢计数不能只是任意同频 /4 时钟驱动，必须与低位 wrap 在逻辑上关联。

**边界：** 连续计数成立，不等于参考相关 snapshot 已经安全；此来源也不是共享 short-TDC、selected-edge 和完整相位重建的证明。

## 4.4 CN105071798：把采样延迟匹配到计数传播

**来源：** CN105071798A，*应用于全数字PLL的低功耗相位累加器*，重点 Fig.4–6。[R05]

该方案以异步低位和同步高位降低计数功耗，将 CKR 的采样时刻按各级传播延迟展开，再统一重采样输出。其方法针对的是“各位并非同时稳定”，不是要求所有位物理上同一时刻锁存。

**证据价值：** 相干快照的本质是同一逻辑 epoch，而不是所有寄存器使用零偏差时钟。

**边界：** 最终统一输出并不自动证明中间每一级的 setup/hold 满足。必须同时校验数据和采样路径的 min/max 延迟、同源误差与 PVT 差异；延迟链不能被当作理想常数。

## 4.5 Kuo 2018：八相选相与 short TDC，但必须换对单位

**来源：** F.-W. Kuo et al., TCAS-I 2018；Fig.2、Fig.5–6 为重点。[R06]

该 ADPLL 将 DCO 的 /4 输出构成八相 CKV，配合预测选相、短 TDC 和多候选参考重定时。Octal 信息与 fine TDC 配合，而 variable phase 另有整数采样路径。论文实验部分给出的 DCO 调谐范围为 5.7–8.4 GHz；/4 后相应为 1.425–2.1 GHz。

**必须修正：** 论文中“约 2 GHz”的节点不能误写成“原始 DCO 约 2 GHz 再 /4”。八相区域的 $T_V/8$ 以论文 CKV 周期为基准；若换算到前置 /4 之前的周期 $T_0$，其理想间隔是 $T_0/2$，不是 $T_0/8$。

**边界：** 该实现是周期内多相选择，不能未经映射就等同于 raw-CKV 的 3-bit /8 integer residue 或 whole-cycle slot executor。

## 4.6 Havens：比 Sony 更早的共享状态与 sub-fractional 检测

**来源：** US8692598B2，*Digital phase locked loop*，J. H. Havens；重点 Fig.2–4。[R08]

其反馈计数器同时包含 integer、fractional 和 sub-fractional TDC。整数值由高位 `cnt[7:1]` 与分频状态 `ckh[0]` 组成；多相半速状态被采样用于 fractional detector，并保留 even/odd 信息，以处理同步器引入的 one-count uncertainty。

**证据价值：** 共享状态、整数边界校验和更细的 TDC 测量并非直到 Sony 才出现。它同时说明，冗余状态的覆盖范围必须与可能的 epoch 错误匹配。

**边界：** 这里的 half-rate / parity 结构不能直接替代 /8 block-epoch 检查。其 sub-fractional 实现也不是未经修改就等同 Kuo 的预测选相后单个 short TDC。

## 4.7 Sony：明确的整数/分频状态复用与两个 XOR 修正

**来源：** US11936392B2，*Phase locked loop, electronic device, and method for controlling phase locked loop*，Kurihara / Fujiwara；Fig.6、Fig.11–12。[R07]

`CNTO[0]` 与慢 accumulator 高位共同形成整数码；`CNTO[3:0]` 又由 REFCLK 直接采为 VFRAC。VINT 则经过参考重定时后采样。原文据两条路径的状态差异，生成：

$$
CRRCT=VINT[0]\oplus VFRAC[0],\qquad SIGN=VFRAC[0]\oplus VFRAC[3]. \tag{9}
$$

| CRRCT | SIGN | 原实施例送往 phase comparator 的修正 |
|---|---|---|
| 0 | 任意 | 0 |
| 1 | 0 | −1 |
| 1 | 1 | +1 |

**边界：** 该实施例用多相 latch/correction 替代比较例中的传统 TDC；不能说它已接上本项目 short TDC。VFRAC 是带周期冗余的状态码，Fig.12 的值跨至 1.75，并非普通纯小数二进制。修正量的“1”必须按其原相位单位解释。[R07]

不能从式 (9) 推出对任意异步错误都保证唯一复原。该专利原文个别 retiming 节点/位序表述也需结合 Fig.6、8、11、12 交叉确认，本文不把网页中的全局相位公式直接转写为 RTL。

## 4.8 MediaTek 与 Marvell：坐标偏移与独立边界校验

**US8593182B2：** raw-CKV VPA 与 shifted CKV′ 的 TDC 路径共存，使用附加的 PHF2 补偿选相坐标；原文给出 $PHE=PHR+PHF1+PHF2-PHV$，并有单脉冲相关实施例。它支持“保留原 CNT，同时显式补偿 selected edge offset”。但 whole-cycle absolute-edge executor 是本项目的进一步综合，不是该公式自动完成的功能。[R09]

**US9306586B2：** 使用 RF counter/TDC skew correction 及独立的边界估计信息，判断 fractional code 应接近 0 还是 1，从而修正整周期错配。它提示不能让 fine code 同时承担全部的范围、边界和自我可信性判断；估计器自身的模糊区域同样要约束。[R10]

## 4.9 Zong 2019：同一实芯片中的 split counter、匹配读出和 DTC/TDC

**来源：** Z. Zong, P. Chen, R. B. Staszewski, JSSC 2019；Fig.1、Fig.9–10。[R11]

8-bit PHV_I 使用两位异步低位和六位同步高位。Fig.9 的 CKS_0/1/2 沿采样链匹配计数传播；正文说明，在匹配条件下采样位于计数位稳定后的约半个 CKV 周期。系统还采用 DTC-assisted TDC，检测溢出/下溢并在瞬态采用限幅输出。

**证据价值：** 这是 split counter、明确采样时序和有限 TDC 在同一 ADPLL 内共存的直接论文证据。

**边界：** Fig.1 的 CKV 已是约 20 GHz 基波经 /8 后的节点，不能把 Fig.9 的低两位等同于“20 GHz 基波全部周期的低两位”。其饱和限幅策略也不能等同于“饱和仍是精确 fine”或本项目已经验证的 coarse-only fallback。

## 4.10 历史线索必须保留，但不提高复核等级

| 资料 | 前轮贡献 | 本次状态 |
|---|---|---|
| Bogdan / Balsara 2006 原书 | raw CKV TDC、PHF_I、SEL_EDGE、CKVD8 time-deferred PHV | H；本次读取了旧报告，未重新取得原书对应页 [R13] |
| Jiang 2011 MSc | mod-8、retimer 与 incrementor 协作、整数修正 | H；既有报告有记录，原 PDF 链接本次读取不稳定 [R12] |
| Yin 2013 PhD | Counter/PTDC interface、边界 alternative-edge 一致性 | H；保留 Ch.4 §4.3.5 的定位，未重新逐图核对 [R14] |
| Staszewski JSSC 2011 | 选相跨整周期边界与 integer-count 处理 | H；不把选相 270°→0° 直接等同 raw /4 计数组进位 [R15] |
| S. Liu JSSC 2016 | 混合高速计数器相关实现 | H；不是本次完整 executor 先例 [R16] |
| H. Liu JSSC 2025 | counter、反馈时钟生成和 timing-margin 相关方向 | B；官方来源可定位，具体 /4 连线不作已核实结论 [R17] |

# 5. 跨文献证据矩阵：不能把局部“是”拼成整体“已完成”

| 来源 | 高位降速/低位状态 | 粗细一致性机制 | 物理选沿/细测量 | 对本目标仍缺少什么 |
|---|---|---|---|---|
| TI [R01] | /8 明确 | 双候选与 SEL_EDGE | TDC-side 判定协作 | 本项目 P/S 执行与完整事件接口 |
| Xu [R02] | /4，shift-state decode | 解码与高位状态耦合 | 未证明目标 short TDC 连接 | 低位到物理选沿的直接映射 |
| ETRI [R04] | /4，carry 同源 | 计数连续性 | 无对应完整 fine 链 | REF snapshot 与 fine stitching |
| CN [R05] | 异步/同步分组 | 延迟匹配、最终重采样 | 非核心披露 | 选沿、残差与有效性联动 |
| Kuo [R06] | /4 后八相 | 多候选重定时、区域处理 | 预测选相与 short TDC | raw integer residue 的直接复用 |
| Havens [R08] | 半速状态兼 integer LSB | fractional parity 校验 | fractional + sub-fractional TDC | /8 block epoch 与目标执行器 |
| Sony [R07] | CNTO 兼 integer/fractional | 两个 XOR、0/±1 修正 | 多相 latch；非目标短 TDC | /8 residue、short TDC、执行回执 |
| MediaTek [R09] | 持续 VPA | 显式 PHF2 坐标项 | shifted edge、TDC、单脉冲 | whole-cycle slot 的完整协议 |
| Marvell [R10] | RF counter | 独立 skew/boundary 判断 | TDC 与整数边界校正 | /4-/8 高低位执行集成 |
| Zong [R11] | CKV 节点上的 2+6 split | CKS 匹配采样 | DTC + 有限 TDC | 上游原周期身份及目标 P/S 链 |

这些来源支持三类**相互补充**的方法：TI/Xu/ETRI 解释如何保存周期状态；CN/Zong/Havens/Sony/Marvell 解释如何保持或恢复一致性；Kuo/MediaTek 解释物理选相和局部 fine 测量。表中的空白不是格式遗漏，而是仍需完成的接口论证。

本报告不按“哪篇最像”给出单一无条件结论。若关注 /8 split，TI 最直接；若关注共享状态与修正，Havens/Sony 更直接；若关注 short TDC 物理选相，Kuo/MediaTek 更直接；若关注 split counter 的采样波形，Zong Fig.9 最适合作为当前核对入口。这是按问题分工，不是把某篇说成完整目标的替代品。

# 6. 核心难点一：epoch 错误必须按层级分类

## 6.1 /8 跨组例子：两个合法数与两个撕裂数

设旧状态为 $C=10,q=7$，下一原始边沿触发低位回零、高位进位。对应：

| 状态 | 高位 C | 低位 q | 8C+q | 含义 |
|---|---:|---:|---:|---|
| 跨组前 | 10 | 7 | 87 | 合法旧状态 |
| 跨组后 | 11 | 0 | 88 | 合法新状态 |
| 旧高位 + 新低位 | 10 | 0 | 80 | 相对新状态 88 错 −8 |
| 新高位 + 旧低位 | 11 | 7 | 95 | 相对旧状态 87 错 +8 |

这个例子不是模拟某篇专利，而是式 (1) 下的故障注入推导。它证明：当故障属于**高低字撕裂**，仅允许 ±1 raw cycle 的修正器覆盖不了上述两种错误。

相对另一侧合法锚点比较时，差值也可能表现为 ±7。因此必须先指定应该关联的旧/新 epoch，不能只凭错误绝对值反推修正类别。

## 6.2 raw-cycle correction 与 block correction 分开定义

建议相位整合接口写为：

$$
N_{\mathrm{corr}}=M(C_{\mathrm{cap}}+\kappa_C)+q_{\mathrm{corr}}+\kappa_N. \tag{10}
$$

其中 $\kappa_C$ 单位为一个慢计数组，$\kappa_N$ 单位为一个原始 CKV 周期；$q_{\mathrm{corr}}$ 还可能是经合法码/状态重构后的 residue。不要用同一个无单位 `kappa` 混合三种职责。

$\kappa_C\in\{-1,0,+1\}$ 只有在采样延迟及同步延迟已证明最多跨一组时才合理。如果捕获可延迟多组，修正集合必须扩展，或直接将该观测判为无效。校正范围是一项由时序上界导出的规范，不是预先任意选的编码宽度。

## 6.3 为什么“看 q 或 raw parity”可能完全看不出高位错组

对 $M=4$ 或 8：

$$
(N+M)\bmod M=N\bmod M,
$$

而且：

$$
(N+M)\bmod2=N\bmod2. \tag{11}
$$

因此，一个完整组的误差不改变 q，也不改变原周期的奇偶性。直接把 Havens/Sony 的某个 low-bit XOR 搬到 /8 模型，未必能检测高位错组。

要检测 block mismatch，需要额外保留能跨组翻转的状态，例如高位最低位的独立观测、wrap toggle/sequence，或者保证高位取自确定候选 epoch 的捕获协议。即便使用高位 parity，也只能在**错误已被限定到相邻组**时区分；相差两个组会再次出现别名。这是冗余码覆盖范围问题。

## 6.4 边界允许两种坐标，但不能允许两条链各选一种

设参考正好靠近相邻边沿 J 与 J+1。下面两个相位表示相同：

$$
J-\mu=(J+1)-(\mu+1). \tag{12}
$$

因此，合格的 coarse/fine 交接不一定需要每次都选择预先认定的唯一边沿。它需要所选整数锚点与 fine interval **共同变换**。整数取 J+1、fine 却仍相对 J，才会生成一个周期的错误。

式 (12) 是精确相位域等式。用单个平均周期把长时间间隔归一化时，还要满足第 3.3 节的近似条件。不能把代数一致性误当作任意时域模型都精确。

## 6.5 亚稳态声明的合理边界

一位变化的 Gray/Johnson 状态可以限制数字码相邻性，但不会让该采样触发器不再具有模拟亚稳态风险。延迟匹配和双候选选择也依赖器件、布线、占空比及安全窗口。

本报告采用两层验收：在定义的数字延迟/边界模型中证明不存在静默错码；在晶体管与 PVT 模型中，另行评估亚稳态传播、决策延迟及剩余失效率。当前不把任何专利的功能描述当作本项目“任意相位、绝对零失败”的验证结果。

# 7. 核心难点二：snapshot 的三条实现路线与时序约束

## 7.1 路线 A：多候选捕获与安全路径选择

思路是由 rising/falling 或多个相位生成不同参考重定时候选，分别捕获相位信息，再根据边界侧信息选择安全候选。TI 和 Kuo 提供相关直接实现；Havens/Marvell 展示额外状态判断的重要性。[R01][R06][R08][R10]

工程上要区分三件事：数据候选是否稳定、选择控制是否稳定、选择之后的整个元组是否来自同一候选。不能只让每个候选寄存器满足 setup/hold，却用一个可能晚到或亚稳的 select 去组合切换大总线。

建议以“候选元组”为选择单位：`{coarse, low_state, boundary_side, fine_anchor_id, candidate_id}`。选择后再输出有效事件，而不是 coarse 选 A、fine 默认为 B。

## 7.2 路线 B：沿计数传播方向匹配采样时刻

设第 i 组数据对应目标逻辑边沿 $t_E$，其传播延迟落在 $[d_i^{min},d_i^{max}]$；采样时间为 $t_{S,i}$。必要约束为：

$$
 t_{S,i}^{min}\geq t_E+d_i^{max}+t_{su,i}, \tag{13}
$$

$$
 t_{S,i}^{max}+t_{h,i}\leq t_{next,i}+d_{next,i}^{min}. \tag{14}
$$

这里 $t_{next,i}$ 是该组下一次可能改写的逻辑事件，未必每组都等于 $t_E+T_0$。更重要的是，所有组须针对同一个目标逻辑 epoch；把任意组都“等到稳定再采”并不能保证采到同一拍。

Zong Fig.9 的理想匹配提供了约半个 CKV 周期的相对读出位置。移植到本项目时应计算实际余量：

$$
 m_i=t_{S,i}^{min}-t_E-d_i^{max}-t_{su,i},\quad
 h_i=t_{next,i}+d_{next,i}^{min}-t_{S,i}^{max}-t_{h,i}. \tag{15}
$$

验收条件是每组 $m_i>0,h_i>0$，且所有组属于同一 epoch。[R05][R11]

## 7.3 路线 C：有界错配与冗余校正

Havens/Sony 说明可以允许已知类型的 integer capture ambiguity，再从 fractional state 识别和修正。但必须先建立“所有可能错误状态”的集合，而不是先选一个 XOR 再期待它覆盖所有错误。[R07][R08]

对 /8 最低要求是分别列出：低位合法相邻变化、高位错一组、高低位撕裂、fine anchor 延迟一 raw cycle、phase-selector 绕回、同步器延迟超过假设范围。不同错误可能需要不同冗余信息和不同无效处理。

## 7.4 三条路线不能用一个模块名代替完整证明

| 路线 | 能直接解决的问题 | 仍须独立证明 |
|---|---|---|
| 多候选 | 避开特定边界附近的危险采样位置 | select 稳定、元组原子选择、固定/变化延迟 |
| 匹配延迟 | 各计数位传播不同步 | PVT min/max、同一逻辑 epoch、复位与采样脉冲宽度 |
| 冗余校正 | 有界、可辨识的 epoch 不一致 | 故障集合覆盖、修正单位、歧义时 INVALID |

可组合这些方法，但组合后必须重新检查联合状态空间。不能把某文献的 safe retimer 与另一文献的 correction 直接相加，就认为所有边界自然闭合。

# 8. 核心难点三：P/S 与物理边沿执行的因果性

## 8.1 P/S 的系统语义应是“执行指定边沿”

目标边沿编号分解为：

$$
J_{\mathrm{plan}}=MH_J+s_J,\qquad s_J\in\{0,\ldots,M-1\}. \tag{16}
$$

慢速域处理高位匹配、未来计划和并行控制；高速少量状态负责 slot / phase-local enable、脉冲形成及根时钟重定时。持续 CNT 仍独立记录实际经过的 $CK_0$ 周期。

建议的功能数据流如下。它是本报告的架构综合，不是某篇原图的重绘。

```text
实际 CK0 → 持续高/低计数状态 → REF 相关安全快照 → coarse anchor
                     │
计划 J_plan → 高位命中 + slot 控制 → 物理选沿/门控 → 实际边沿
                                                       │
                                            执行侧观察 J_observed
                                                       │
REF → 局部 fine 测量 ← 被选真实边沿 ──────────────────────┘
                     │
             元组一致性 + VALID/SAT + 坐标重建 → phase error
```

## 8.2 不允许把计划当作已执行证据

必须区分 `J_plan` 与 `J_observed`。后者由实际执行路径、可信高速状态或边沿回执形成，不能把计划字延迟若干拍后改名为 `J_exec`。

原因是错沿、丢沿、重复沿和 gate control 晚到，可能完全不改变数字计划。若测量链只使用命令值，其重建相位在模型里看似正确，真实物理边沿却可能已经偏移一拍。

执行回执可以来自目标 slot 对应的稳定计数影子、受控的 launch acknowledgement 或匹配后状态；具体电路仍待确定。回执本身与实际输出之间的固定流水偏移也必须可追溯。

## 8.3 后知后觉的低速 snapshot 不能生成已经过去的最近边沿

这是候选方案必须显式回答的因果性问题：REF 到来后，经过 snapshot、CDC、decode、低速计算再去控制 selector，REF 附近的某个 CKV 边沿可能早已过去。即使 q 算得完全正确，也不能倒退时间把那条边沿重新送入 TDC。

只有三类实现路径能闭合这一点：事先预测并在目标前提交选择；高速前端并行捕获候选/局部时间信息后再慢速解码；或者选用未来可执行边沿，并接受、校准其时间间隔及量程需求。

Kuo 的 time-predictive 选相属于具有先验规划的路线；不能把它理解为“参考到来后任意慢速算完，再无代价选择刚刚过去的最近相位”。[R06]

## 8.4 选沿 deadline 与 late 策略

设选择控制必须在目标边沿前 $t_{\mathrm{setup,exec}}$ 建立，命令在执行器到达时刻为 $t_{\mathrm{arrive}}$，则需要：

$$
t_{\mathrm{arrive}}+t_{\mathrm{setup,exec}}+t_{\mathrm{guard}}\leq t_{\mathrm{target}}. \tag{17}
$$

若不满足，不能悄悄在下一 slot 补发并仍返回原 edge ID。必须明确采用 `LATE/MISS`、重新规划一个不同的 J，或切换测量策略。任何补发都应改变执行回执及相位坐标。

对相邻事件，还要保证连续两个合法 pulse 不合并、不丢失、不重复。通用 PISO 输出连续“1”的电平行为，不一定等于需要的两个独立采样边沿。

## 8.5 MASH 属于扩展层，不是本次文献同构判断的偷换条件

前轮方案包含 MASH future edge。本次基础问题首先解决持续 CNT、/M residue、snapshot 与 selected-edge fine 的对应关系。MASH 只在这一接口上提供目标序列；它的阶数、状态范围、dither 和反馈预测误差还需另行量化。

不能因为某篇资料没有 MASH，就否定其对基础测量问题的直接贡献；也不能因为找到了 MASH 分频器，就认为原周期 CNT 与 fine 接口自然得到解决。

# 9. 核心难点四：fine 的真实量程、饱和与校准

## 9.1 CNT 的大范围与 TDC 的物理小范围是两种职责

CNT 可以表示参考与当前状态之间的多周期差，保持锁定跟踪瞬态中的 coarse 观测；但它不改变两个 TDC 输入端之间已经存在的物理时间间隔。短 TDC 的量程必须通过实际选沿、捕获结构、预测或 DTC 等机制约束。[R06][R09][R11]

假设饱和函数 $Q(x)$ 把所有 $x\geq R$ 都输出 R，则 $Q(1.5R)=Q(3R)=R$。只知道这个输出不能恢复原输入。之后再减某个整数周期，也不能恢复已被压成同一码的 fine 信息。

因此，“数字可以做 modulo”不能证明“模拟 TDC 可以缩到一个周期”。前者是数值表示，后者是物理可观测性。

## 9.2 路径延迟、DTC 与归一化的符号

定义 TDC 引脚实际时间差：

$$
d_{\mathrm{pin}}=(t_E+\tau_E)-(t_R+\tau_R).
$$

需要恢复的原事件间隔为：

$$
\widehat{\Delta t}=\widehat d_{\mathrm{pin}}-(\widehat\tau_E-\widehat\tau_R). \tag{18}
$$

若 DTC 插在参考路径，其延迟计入 $\tau_R$；若插在反馈路径，则计入 $\tau_E$。必须统一使用式 (18) 的路径定义，不能一处把 DTC 当已补偿，另一处再次添加。

时间 LSB 归一化为：

$$
\widehat\mu=(\mathrm{code}-\mathrm{code}_0)\frac{\mathrm{LSB}_t}{\widehat T_0}+o_{\mathrm{phase}}. \tag{19}
$$

其中 $o_{\mathrm{phase}}$ 是剩余的校准相位偏置。`LSB_t`、`code_0`、选相/DCC偏差、差分路径延迟和周期估计需要携带校准版本。将 raw code 直接当作原周期小数，可能把增益或时钟节点差错隐藏在相位环路中。

## 9.3 Fine 采用条件

建议：

$$
F_{\mathrm{usable}}=V_{\mathrm{code}}\land V_{\mathrm{range}}\land V_{\mathrm{anchor}}
\land V_{\mathrm{epoch}}\land V_{\mathrm{cal}}. \tag{20}
$$

其中各 V 分别表示对应的有效性判据，$F_{\mathrm{usable}}$ 对应接口 `fine_usable`。`range_ok` 必须来自电路可实现的 saturate/overflow/窗口检查，而不是仿真器里不可见的理想真实相位。`anchor_ok` 则要求实际所选物理边沿与其编号一致。

一侧饱和可能仍保留“误差方向”信息。这种信息可以参与单独定义的限幅控制策略，如 Zong 的瞬态处理，但不能标记为精确的 fine residual。[R11]

## 9.4 Coarse 接管不等于删除 fine，更不等于凭空加一个 FLL

当 fine 无效、coarse 仍可靠时，可以使用已定义的粗相位估计和量化误差上界；或保留符号/区间信息进入受控策略。若 coarse 也无法判定，则本次观测必须 invalid，而不是强行拼接。

以参考累加相位 $R[k]$ 和 coarse 观测 $N_R[k]$ 为例：

$$
e_c[k]=R[k]-N_R[k]. \tag{21}
$$

这是量化较粗的**相位误差**。其差分才对应：

$$
e_c[k]-e_c[k-1]=FCW[k]-(N_R[k]-N_R[k-1]). \tag{22}
$$

所以 CNT 不天然意味着一条独立 FLL。只有另行设计频率误差控制器、状态机或增益路径时，才应称为 FLL-assisted 控制。

fine 恢复时还必须检查坐标偏置一致与控制状态连续，不能因 phase_source 切换引入人为整周期跳变。冻结积分、限幅积分或分阶段重新准入都属于需要闭环验证的策略，本文不预设已经优选完成。

## 9.5 一个说明量程的数值例子

以下是理想计算示例，不是芯片指标：原始 $f_0=8$ GHz，则 $T_0=125$ ps。/4 周期为 500 ps；均匀八相间距是 62.5 ps。若可选择最近相位，理想 signed residual 可在半个相位间距内；若必须选择后继相位，则最大等待接近一个相位间距。

在这两种理想范围之外，还要增加预测误差、相位不均匀、路径误差、瞬态频偏及判决 guard。即使“八相”存在，也不能不说明选沿因果性就直接把 TDC 量程写成 ±31.25 ps。范围必须由实际测量流程导出。

# 10. 面向实现的事件接口与不变量

## 10.1 建议的 EventFrame

以下是接口建议，不是已发布 RTL。

| 字段组 | 建议字段 | 定义要点 |
|---|---|---|
| 事件身份 | `event_id, ref_kind, reset_epoch` | 区分本次参考、双沿类别及复位世代 |
| 计数坐标 | `clock_node_id, M, C_cap, q_cap` | 明确数的是哪个时钟节点；禁止无单位混接 |
| 捕获来源 | `candidate_id, capture_epoch, wrap_tag` | 指明候选及跨组状态；不能只保留数值 |
| 计划/执行 | `J_plan, J_observed, edge_polarity` | 实际回执独立于命令；极性影响细相位原点 |
| 修正 | `kappa_C, kappa_N, alpha_sel` | 分别为组单位、原周期单位、周期内偏移 |
| Fine | `fine_raw, fine_valid, sat_hi, sat_lo` | 码值与可信性分离；饱和不等于精确残差 |
| 校准 | `tdc_gain_epoch, period_epoch, path_epoch` | fine 与 coarse 权重必须使用相容的校准 |
| 异常 | `late, miss, duplicate, encoding_invalid` | 执行错误不可被普通相位码掩盖 |
| 输出 | `phase_source, phase_value, uncertainty` | fine/coarse/invalid 及明确的误差上界或区间 |

原先的 `{C,q,TDC}`，以及后来增加 edge/correction 的四元组，都不足以完整表达上述执行、单位和有效性。接口不必把所有字段都实现为宽总线，但其语义必须有硬件对应。

## 10.2 必须保持的不变量

| 编号 | 不变量 | 违反后的处理 |
|---|---|---|
| I1 | 实际 CK0 周期连续，$N=MC+q$ 的原点与 carry 一致 | 阻断有效相位；检查复位/极性/计数实现 |
| I2 | coarse 与 fine 同锚点，或显式记录锚点变换 | 校正或 INVALID，不静默相加 |
| I3 | correction 的单位和可覆盖错误集合明确 | 超界置无效；不截断成 ±1 |
| I4 | J_observed 反映真实执行，不由 J_plan 自证 | 标记回执未证实，不进入 fine_valid |
| I5 | fine 量程、码合法性和校准全部满足 | 降级使用 coarse/区间/无效 |
| I6 | 两种边界候选在共同坐标下等价 | 不一致视为 coarse/fine stitching 错误 |
| I7 | 低速计算符合选沿 deadline | late/miss 或重新规划并更新 J |
| I8 | 全 counter rollover 采用明确模运算窗口 | 超出可展开范围时 reset/reacquire |

对 W-bit 总计数，模差转换为有符号差时，要保证期望差及采样间隔落在可唯一展开的窗口，典型条件是幅度小于 $2^{W-1}$。这是一项计数宽度和观测间隔的联合约束，不是增加一个符号位就自动成立。

## 10.3 相位整合的伪代码

```text
on complete_event(frame):
    check_clock_node_and_reset_epoch(frame)
    coarse = decode_and_align_coarse(frame)
    observed = verify_physical_edge_identity(frame)

    if coarse.valid and observed.valid and fine_is_usable(frame):
        anchor = observed.J + frame.alpha_sel
        mu = normalize_fine_with_matching_calibration(frame)
        phase = anchor - mu
        return FINE, phase, fine_error_bound

    if coarse.valid:
        return COARSE, coarse.phase_estimate, coarse.error_bound

    return INVALID, no_new_measurement
```

这段伪代码刻意不指定 coarse controller 的增益和积分动作，因为测量有效性与控制器故障恢复不是同一问题。控制层必须对 `COARSE/INVALID` 有单独、可验证的状态处理。

# 11. 前几轮结论的修订与保留记录

| 前轮表述或倾向 | 本报告处理 | 原因 |
|---|---|---|
| “/8 使 fine TDC 必然看到 8 个原周期，再由 snapshot 压回去” | 不成立，必须逐节点核对 | counter 降速、TDC 输入预分频与物理选沿是三件不同的事 [R01][R06][R11] |
| “Sony 才首次找到同状态参与整数与小数” | 收紧为另一条直接实现 | Havens 已有共享 half-rate state、fractional correction 和 sub-fractional TDC [R08] |
| “统一采用 κ=−1/0/+1” | 改为带单位、带故障集合的修正 | raw-cycle 与 block-cycle 不同；高低位撕裂可错 ±M |
| “$8C+q+e/8+\epsilon$ 可作通用相位公式” | 撤回通用性，改用锚点减残差 | q/e 可能重复表示同一相位区间；e/8 的时钟单位未统一 |
| “Kuo 原始 DCO 约 2 GHz，再 /4” | 更正时钟层级 | 其 DCO 范围 5.7–8.4 GHz，约 2 GHz 是 /4 后量级 [R06] |
| “Zong /4 split 保留的是原始 20 GHz 全部周期” | 不作此结论 | Fig.9 的 counter 基准是前置 /8 后的 CKV [R11] |
| “相干必须等于同时锁存” | 保留逻辑相干定义 | 匹配延迟读出可在不同时刻取得同一逻辑 epoch [R05][R11] |
| “所有边界必须复原唯一物理边沿” | 改为一致候选或无效 | 不同锚点可以表示同一参考相位；不能把器件亚稳风险写成绝对保证 |
| “数字整数相消即可删除 CNT” | 明确不能这样推导 | CNT 仍是真实 coarse 观测、回执校验与无效 fine 下的测量基础 |
| “通用 PISO 是 CNT-ADPLL 直接先例” | 维持前轮降级 | 只能证明执行器原语，不能证明粗细相位链完整 [R18] |

此次整合不是抹去前轮成果：/4-/8 split、persistent CNT、边界校正、short TDC、selected-edge coordinate、SAT/VALID 及执行回执等主线均保留。修订的是证据范围、单位、时序假设和不能直接推广的结论。

# 12. 本次已执行的检查与后续验证方案

## 12.1 已执行：六组逻辑/量纲检查

本次使用 Python 的精确有理数运算执行了以下检查。它们用于发现公式和接口层错误，不包含 RTL 时序、亚稳态模型、闭环噪声、AMS 或 PVT。

| 检查 | 范围 | 案例数 | 结果 |
|---|---|---:|---|
| L01 计数分解 | M=4/8；N=0…4095 | 8192 | 通过 |
| L02 跨组撕裂 | M=4/8；64 个组；两种撕裂模式 | 128 组案例 | 确认相对对应合法锚点为 ±M |
| L03 低位盲区 | M=4/8；256 个 N | 512 | 确认 +M 不改变 residue 和 raw parity |
| L04 时钟单位换算 | 32 个组、8 相、3 个 signed residual | 768 | 分频相位与原相位表达一致 |
| L05 锚点等价 | 64 个 J、4 个 μ | 256 | $J-\mu=(J+1)-(\mu+1)$ |
| L06 饱和不可逆 | 四对不同输入 | 4 | 输出可相同，不能从饱和码反推输入 |

合计 **9860 个定义明确的逻辑案例**。计数不是“9860 次电路仿真”；L02 每个案例内检查两个撕裂结果，表内沿用脚本的案例计数定义。源码与 JSON 结果随整合包附带。

## 12.2 第一层：事件级 golden model

模型必须从原始真实边沿时间驱动持久 CNT，再分别模拟采样、执行和有限 TDC。禁止直接把理想 $\Phi_0(t_R)$ 喂给 decoder 或用其生成电路不可获得的 VALID。

建议覆盖 /4、/8 全部 residue；跨组、全宽 rollover；rising/falling 候选切换；高位/低位不同传播延迟；fine 正负量程与饱和；选择码晚到；丢沿、重复沿、相邻脉冲；复位相位不同；固定路径延迟与校准版本错配。

验收输出不是只看 PLL 锁住，而是逐事件比较 `J_observed`、coarse anchor、最终 phase 与 ground truth，并统计每类故障能否被识别或被正确补偿。

## 12.3 第二层：RTL/门级时序验证

重点检查 carry 极性、shift-state decode、候选元组选择、snapshot 生命周期、异步输入同步延迟、load/shift ownership、短脉冲、门控 latch 与根时钟 retiming。对每类异步路径给出明确的 STA/CDC 约束，而非简单全部 false-path。

最小输出应包含：每个事件的原边沿编号、C/q 原码、候选编号、边界标签、修正量及单位、J_plan/J_observed、fine_raw、VALID/SAT、最终相位和实际延迟。发现错误时应能回到同一编号的物理沿，而不是只回到一个时间戳日志行。

## 12.4 第三层：晶体管/PVT 验证

必须补齐数字模型无法证明的部分：亚稳态解析时间、validity/selection 本身的亚稳传播、Johnson/Gray 非法码、delay-matching 失配、占空比、路径供电敏感度、mux/gate 毛刺、窄脉冲、TDC 饱和判定和回执电路的扰动。

本报告没有运行上述验证，也没有给出虚构的最差 PVT margin。第 7 章的参数化约束应转为实际电路的 min/max 表，而不是在未选工艺/负载前填写一个貌似确定的 ps 数值。

## 12.5 闭环验证不能替代局部正确性

周期性 epoch 错误可能表现为 spur，偶发错组可能表现为长尾抖动或 cycle slip。PLL 能重新拉回并不意味着 detector 正确。因此顺序应为：事件身份正确 → 有效性完整 → 局部时序通过 → 再比较闭环噪声、spur、锁定时间与恢复时间。

需要记录相位误差峰值及分布、fine min/max/histogram、SAT 占比、修正触发分布、无效观测连续长度、edge mismatch 次数和模式切换的相位不连续。所有频谱测试还需注明采样率、相干窗口、长度和归一化单位。

# 13. 尚未闭合的核心问题与下一步研究清单

## 13.1 当前真正的文献空白

基础交集仍是：**一个明确原始时钟节点的 /4 或 /8 split counter，低位 residue 直接关联 selected physical edge，short TDC 测量该边沿附近残差，并明确给出同一观测的 epoch/validity 机制。**

公开资料已经分别支持组成环节，有些资料覆盖其中多项。尚缺的是把所有连接、编码和时序在一份可核验的实现中同时闭合；不能用“行业常用”补足空白。

## 13.2 必须先回答的五个工程问题

| 问题 | 必须形成的具体产物 | 完成判据 |
|---|---|---|
| Q1：到底以哪个节点作为原周期？ | clock-node 表与全部倍率/相位原点 | CNT、FCW、TDC、DTC、edge ID 同一量纲 |
| Q2：C/q 在边界如何关联？ | 全 residue、wrap、候选切换真值表 | 每个允许状态都对应合法锚点或 INVALID |
| Q3：低位如何控制真实选沿？ | raw-state→slot→physical-edge 映射及 deadline | 不能生成过去边沿；late/miss 行为确定 |
| Q4：谁证明实际边沿编号？ | J_observed 电路与独立校验路径 | 计划错误/丢沿注入后不会自证通过 |
| Q5：short TDC 何时可信？ | 物理量程预算、SAT/VALID、校准/降级规范 | 饱和码不作为精确 fine，coarse 仍可解释 |

## 13.3 调研的收敛顺序

首先完成 TI / Xu / ETRI 的 carry、极性和解码关系；随后把 Havens/Sony 的冗余状态迁移为**带明确错误集合**的 /4-/8 epoch 表。第三步检查 Kuo/MediaTek 所使用的物理选相是否满足本项目执行因果性，而不是只看同样有一个 MUX。最后再接 MASH、DTC/QNC、REF X2 等扩展，并保留原始基线回归。

Jiang、Yin 和 Bogdan 原书仍是值得补齐原始页的历史线索；H. Liu 2025 的 counter/feedback-generator 内部图是另一个优先补证项。这些任务是本报告的后续研究清单，不代表已经安排自动后台执行。

## 13.4 关于差异点的表述

“低位状态同时服务整数与小数”本身已有相关公开披露，不能仅以这句话概括潜在差异。更具体的研究对象应是：原周期 residue 的映射、实际选沿回执、block/raw-cycle 两级修正、有限 TDC 的有效性及恢复协议。

是否构成可保护的差异，仍需逐项对照专利权利要求、实施例和更完整的先前技术；本报告只提供技术证据与缺口，不给出新颖性、侵权或可授权结论。

# 14. 参考文献与原始入口

以下链接用于复核原文。A-P/A-J/B/H 的含义见第 2.3 节。专利同族不重复计算为独立技术先例；本文没有把检索列表理解为穷尽性检索。

**[R01] TI / Staszewski–Leipold.** *Method and apparatus for crystal drift compensation*. US20050195917A1，公开于 2005-09-08；同族 WO2005086759A2。**A-P**。重点：Fig.4，mod-8、RV 高低位、CKVD8 与 SEL_EDGE。原文：[US 公布文本](https://patents.google.com/patent/US20050195917A1/en)；[WO 同族文本](https://patents.google.com/patent/WO2005086759A2/en)。

**[R02] L. Xu, S. Lindfors.** *Phase accumulator for digital phase locked loop*. WO2009053531A1。**A-P**。重点：Fig.6–7，高六位 /4、shift state、采样后 encoder。原文：[专利文本](https://patents.google.com/patent/WO2009053531A1/en)。

**[R03] L. Xu, S. Lindfors.** “A High-Speed Variable Phase Accumulator for an ADPLL Architecture.” *IEEE ISCAS*, 2008, pp. 1736–1739. DOI: **10.1109/ISCAS.2008.4541773**。**B（论文元数据；内部细节以 R02 的已核原文支撑）**。入口：[DOI](https://doi.org/10.1109/ISCAS.2008.4541773)；[Aalto 论文记录](https://research.aalto.fi/en/publications/a-high-speed-variable-phase-accumulator-for-an-adpll-architecture/)。

**[R04] ETRI.** *High speed counter apparatus*. US20130156147A1。**A-P**。重点：低两位、CKVD4、11→00 carry 与组合计数。原文：[专利文本](https://patents.google.com/patent/US20130156147A1/en)。

**[R05]** *应用于全数字PLL的低功耗相位累加器*. CN105071798A。**A-P**。重点：Fig.4–6、CKR 分级延迟、各组采样与最终重采样。原文：[中文专利文本](https://patents.google.com/patent/CN105071798A/zh)。

**[R06] F.-W. Kuo et al.** “An All-Digital PLL for Cellular Mobile Phones in 28-nm CMOS With −55 dBc Fractional and −91 dBc Reference Spurs.” *IEEE Transactions on Circuits and Systems I*, 65(11), 2018, pp. 3756–3768. DOI: **10.1109/TCSI.2018.2855972**。**A-J**。重点：Fig.2、5–6，DCO/CKV 节点及实验部分调谐范围。入口：[DOI](https://doi.org/10.1109/TCSI.2018.2855972)；[TU Delft 记录](https://repository.tudelft.nl/record/uuid:bd6e56fd-2ea1-4a7f-8dbe-0154ce63742d)；[作者机构 PDF](https://pure.tudelft.nl/ws/portalfiles/portal/47074026/46622583_08438325.pdf)。

**[R07] T. Kurihara, T. Fujiwara; Sony Semiconductor Solutions.** *Phase locked loop, electronic device, and method for controlling phase locked loop*. US11936392B2，授权文本日期 2024-03-19；美国公布文本 US20220231694A1，2022-07-21；同族 WO2020246092A1，2020-12-10；优先权 2019-06-06。**A-P**。重点：Fig.6、8、11、12，CNTO、VINT、VFRAC、CRRCT/SIGN。入口：[US 授权文本](https://patents.google.com/patent/US11936392B2)；[WO 同族](https://patents.google.com/patent/WO2020246092A1/en)。注意“2022 年公开”只适用于所列美国公布文本，不是整个家族最早公开时间。

**[R08] J. H. Havens; LSI.** *Digital phase locked loop*. US8692598B2。**A-P**。重点：Fig.2–4，integer / fractional / sub-fractional、half-rate state、even/odd 与 one-count uncertainty。原文：[专利文本](https://patents.google.com/patent/US8692598B2/en)。

**[R09] A.-S. Lin, R. B. Staszewski, Y.-H. Cho; MediaTek.** *Frequency synthesizer and associated method*. US8593182B2。**A-P**。重点：PHV / PHF1 / PHF2、phase shifter、phase selector 及单脉冲实施例。原文：[专利文本](https://patents.google.com/patent/US8593182B2/en)。

**[R10]** *Methods and devices for implementing all-digital phase locked loop*. US9306586B2。**A-P**。重点：RF-counter/TDC skew、独立 estimator E、Fig.20–25 附近实施例。原文：[专利文本](https://patents.google.com/patent/US9306586B2/en)。

**[R11] Z. Zong, P. Chen, R. B. Staszewski.** “A Low-Noise Fractional-N Digital Frequency Synthesizer With Implicit Frequency Tripling for mm-Wave Applications.” *IEEE JSSC*, 54(3), 2019, pp. 755–767. DOI: **10.1109/JSSC.2018.2883397**。**A-J**。重点：Fig.1、9–10，CKV 节点、2+6 counter、CKS sampling、DTC/TDC。入口：[DOI](https://doi.org/10.1109/JSSC.2018.2883397)；[TU Delft 原文记录](https://repository.tudelft.nl/record/uuid:556432e9-11a7-47f2-9019-18e7ccc9f1fd)。

**[R12] W. Jiang.** *ADPLL Design for WiMAX*. MSc thesis, Delft University of Technology, 2011. **H**。前轮定位 Chapter 2，TDC / Retimer / Incrementor cooperation，Fig.2-12 至 2-20。历史入口：[作者导师站 PDF](https://bogdanst.com/dissertation/2011-09-18_Wenlong_Jiang_MSc_ADPLL.pdf)。本次该链接读取不稳定，不作为“本次已逐图复核”的证据。

**[R13] R. B. Staszewski, P. T. Balsara.** *All-Digital Frequency Synthesizer in Deep-Submicron CMOS*. Wiley, 2006. **H**。前轮使用用户原书 PDF；定位 Ch.4 §4.5、§4.7.4，Fig.4.14、4.17、4.26、4.27。本次未重取原书页；不编造可访问的全文下载地址。

**[R14] J. Yin.** *A DC–48 GHz CMOS All-Digital Frequency Synthesizer for Software-Defined Radios*. PhD thesis, HKUST, 2013. **H**。前轮定位 Ch.4 §4.3.5 “Counter and PTDC Interface”、Fig.4.6–4.11。本次不新增未经核验的直接下载 URL。

**[R15] R. B. Staszewski et al.** “Spur-Free Multirate All-Digital PLL for Mobile Phones in 65 nm CMOS.” *IEEE JSSC*, 46(12), 2011, pp. 2904–2919. DOI: **10.1109/JSSC.2011.2162769**。**H**。前轮关注 Fig.20–22 的 quadrature phase switching 与 integer boundary。入口：[DOI](https://doi.org/10.1109/JSSC.2011.2162769)。

**[R16] S. Liu.** “A Fractional-N Counter-Assisted DPLL With Parallel Sampling ILFD.” *IEEE JSSC*, 51(6), 2016. DOI: **10.1109/JSSC.2016.2557810**。**H**。保留前轮 hybrid high-speed counter 线索，不作为本项目完整架构先例。入口：[DOI](https://doi.org/10.1109/JSSC.2016.2557810)。

**[R17] H. Liu et al.** “An Ultra-Low-Jitter Fast-Hopping Fractional-N PLL With LC DTC and Hybrid-Proportional Paths.” *IEEE JSSC*, 60(3), 2025, pp. 785–798. DOI: **10.1109/JSSC.2024.3514870**。**B**。保留 counter / feedback-clock generator / timing-margin 方向；未将具体 /4 连线升级为 A。入口：[DOI](https://doi.org/10.1109/JSSC.2024.3514870)；[IEEE SSCS 介绍](https://sscs.ieee.org/an-ultra-low-jitter-fast-hopping-fractional-n-pll-with-lc-dtc-and-hybrid-proportional-paths/)。

**[R18]** *Frequency divider with retimed control signal and related frequency dividing method*. US8653862B2。**H / 外围实现参考**。phase-local retiming / glitch-free switching，不是 CNT + reference snapshot + fine TDC 的直接先例。入口：[专利文本](https://patents.google.com/patent/US8653862B2/en)。

**[R19]** *Digital phase locked loop with integer channel mitigation*. US8050375B2。**H / 历史补充线索**。前轮关联相位旋转及 integer-part 处理；不作为本次新增硬结论。入口：[专利文本](https://patents.google.com/patent/US8050375B2/en)。

# 附录 A. 原图与波形定位索引

本报告给出的是可回到原文的定位，不把示意推导冒充原图。以下 PDF 页码以包含机构封面的下载版本为准；原文 figure 编号优先于 PDF 页数。

| 来源 | 图/位置 | 应核对的连接或波形 |
|---|---|---|
| TI [R01] | Fig.4；US PDF 第 9 页、Sheet 8 | mod-8、RV<2:0>、RV<8:3>、CKVD8、双候选与 SEL_EDGE |
| Xu [R02] | Fig.6–7 | shift taps、采样前后边界、高位 LSB 到 encoder 的依赖 |
| ETRI [R04] | 低两位与 CKVD4 实施例说明 | 11→00、CKVD4 有效沿、高位 carry 的对应 |
| CN [R05] | Fig.4–6 | 数据传播、CKR 各级延迟、最终统一输出 |
| Kuo [R06] | Fig.2；机构 PDF 第 3 页 | 多速率结构、variable phase、CKR 候选与预测选择 |
| Kuo [R06] | Fig.5–6；机构 PDF 第 5 页 | /4 八相、并行短 TDC 到共享短 TDC 的关系 |
| Havens [R08] | Fig.2–4 | ckh、cnt 高位、raw state、even/odd 与 sub-fractional 处理 |
| Sony [R07] | Fig.6；US PDF 第 8 页 | 同一 CNTO 到 integer 与 fractional 的两条路径 |
| Sony [R07] | Fig.11–12；US PDF 第 11–12 页 | XOR、位序、扩展 VFRAC 状态、修正方向 |
| Zong [R11] | Fig.1；机构 PDF 第 3 页 | 基波→/4→/2→CKV，避免时钟节点误认 |
| Zong [R11] | Fig.9–10；机构 PDF 第 9 页 | CKS_0/1/2 与 c[0]/c[1]/c[2:7] 逐级波形 |
| MediaTek [R09] | phase shifter 及单脉冲实施例 | selected CKV′、PHF2 与 TDC 的坐标 |
| Marvell [R10] | Fig.20–25 附近 | RF count / fractional skew 与独立边界估计 |

# 附录 B. 历史报告继承与内容对应

**[H01]** `CNT_based_ADPLL_CKV4_P_S_文献调研与架构收敛报告_2026-09-27`，本次完整读取 22 页 Word 正文；同名 Markdown 为简要摘要。继承 persistent CNT、selected-edge offset、J_plan/J_exec 区分、fine SAT 与原始计数的关系，以及通用 PISO 降级结论。

**[H02]** `CNT_ADPLL_CKD4_Snapshot_Literature_Research_Report_2026-09-28`，Research Log v0.4，本次完整读取 Markdown。继承 Xu /4、Zong delay-matched sampling、Jiang cooperation 与 coarse/fine stitching 的调研线索。

历史报告是本项目进展来源，不是独立的电路真实性证据。本次关键硬结论优先回到 [R01]–[R11] 中已复核的原始专利/论文；其余线索保留 H/B 状态。

**文档完整性：** Word 与 Markdown 正文同源。整合包另附 `verify_invariants.py` 与 `logical_check_results.json`，用于复算第 12.1 节；不包含第三方论文全文、字体文件、晶体管网表或未完成的 RTL。
