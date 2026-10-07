# CNT-based ADPLL 工程介绍

**项目全称：** 基于持续整数相位计数（CNT）的全数字锁相环（ADPLL）——整数相位保留、相干快照与短量程 TDC

**文档性质：** 工程介绍。面向首次接触本项目的工程师、评审者和合作者，概括项目目标、核心问题、架构、关键约束、当前进展与下一步。内容全部整理自调研包《CNT_ADPLL 调研整合与核心问题报告》（整合复核版 V1.0，2026-10-03）及其附带的逻辑检查脚本。

**项目阶段：** 文献证据整理、问题定义、统一相位模型与验证框架已完成；尚未进入 RTL 定版、晶体管验证或专利新颖性结论阶段。

---

## 1. 一句话定位

在 CNT / VPA / phase-domain ADPLL 中，把宽位整数相位计数器的高位降到 CKV/4 或 CKV/8 速率运行，同时**不丢失任何一个原始 CKV 周期的编号**；再让低位状态、参考相关快照和真正被选中的物理边沿关联起来，使有限量程 TDC 只需测量局部时间残差，并在计数进位、异步采样、选沿切换和 TDC 饱和等边界场景下，仍能得到坐标一致、可判断有效性的完整相位观测。

## 2. 背景与动机

传统 ADPLL（Staszewski/Bogdan 基线）用一个全速 variable phase accumulator 记录 DCO 走过的整数周期，再用 TDC 测量参考沿到 DCO 沿的小数相位。随着 DCO 频率进入数 GHz 到 20 GHz 量级，宽位计数器以全速工作的功耗、时序和布线压力都在上升。业界已有多种"高位降速"做法（/4、/8 分组计数），也有多种"物理选相 + 短 TDC"做法。

本项目要解决的不是其中某一项，而是把这两类机制**接在一起**，并且保证接口在所有边界条件下自洽。调研发现，公开文献分别支持各个局部环节，但尚未核实到一篇与以下完整组合严格同构的实现：

> raw CKV 的 /8 高位计数 + 3-bit 原周期 residue + 该状态直接控制物理选沿 + short TDC + 完整 epoch/validity 接口

"未核实到"只描述当前证据集，不等于"没有先前技术"，也不等于拼接后的时序与因果性已经验证。

## 3. 两条链：测量链与执行链

项目中有两个相互关联但不能混为一谈的任务：

| 链路 | 职责 | 候选实现 |
|---|---|---|
| **测量链** | 持续记录振荡器实际走过的周期，并在参考事件附近形成粗（coarse）细（fine）联合时间戳 | 分组计数器 + 相干快照 + 短 TDC |
| **执行链** | 低速并行状态或预测命令如何在高速侧生成指定的物理边沿 | P/S（并串转换）、one-hot、移位状态机、多相选择器 |

P/S 等执行器只是执行链的候选实现，**不能替代 CNT 的测量功能**。项目还关心：低位计数状态能否直接或经确定映射，兼任 physical-edge identity / selector 的控制信息。

## 4. 工程目标（需求冻结）

| 编号 | 需求 | 验收语义 |
|---|---|---|
| G1 | 持续整数相位观测 | CNT 记录实际 CKV 周期，不是只在目标命中时才记录命令状态 |
| G2 | 高位降速 | 宽位高位允许在 /4 或 /8 域工作，少量低位状态可继续高速运行 |
| G3 | 原周期编号不丢失 | 相位模型可追溯到所选原始 CKV 节点，而非只保留慢时钟边沿 |
| G4 | 粗细观测一致 | coarse 与 fine 对应同一物理锚点，或携带显式、可验证的坐标变换 |
| G5 | fine 真实量程受控 | 目标约一个原始 CKV 周期或更小；必须按真实输入间隔检查 |
| G6 | 边界与故障可辨识 | wrap、采样错配、无效码、饱和、丢沿、重复沿不能静默变成有效相位 |
| G7 | P/S 不替代 CNT | P/S 或 slot executor 负责物理边沿执行，不删除参考相关的 coarse 测量 |

## 5. 统一相位坐标与术语

### 5.1 必须先定义"数的是哪个时钟"

不同文献中的 CKV 不是同一层级的节点（Bogdan 基线的 CKV、Kuo 的多相 CKV、Zong 经过 /4·/2 预分频的 CKV 各不相同）。本项目把**希望完整保留周期编号的那个时钟节点**统一记作 $CK_0$，周期 $T_0$、频率 $f_0$。改变 $CK_0$ 后，CNT 权重、FCW、fine 归一化和 edge ID 必须全部换算。

| 符号 | 定义 | 单位/范围 |
|---|---|---|
| $CK_0, T_0, f_0$ | 目标原始计数时钟及其周期、频率 | s、Hz |
| $M$ | 高、低计数分组倍率 | 4 或 8 |
| $C$ | 高位组计数（已对齐） | 一个计数 = $M$ 个 $CK_0$ 周期 |
| $q$ | 组内原周期 residue | $0 \ldots M-1$；**不是** TDC 小数码 |
| $N$ | 原周期整数编号 | $N = MC + q$ |
| $J$ | 某个实际原始上升沿的绝对编号 | 原周期 |
| $\alpha$ | 选中边沿相对该上升沿的周期内偏移 | 原周期 |
| $\mu$ | 参考至被选边沿的有符号相位间隔 | 原周期 |
| $T_d$ | 分组慢时钟周期 | $T_d = M T_0$ |

### 5.2 核心公式

**整数分解（定义，不是 CDC 正确性证明）：**

$$N = MC + q,\qquad (C, M-1) \rightarrow (C+1, 0)$$

**完整相位表达（锚点减残差）：**

$$A_k = J_k + \alpha_k,\qquad \Phi_0(t_{R,k}) = A_k - \mu_k,\qquad \mu_k = \int_{t_{R,k}}^{t_{E,k}} f_0(t)\,dt$$

$\mu$ 的符号由积分上下限决定，preceding edge 和 following edge 共用同一公式。只有在局部频率近似恒定时才可用 $\hat\mu \approx \widehat{\Delta t} / \hat T_0$ 归一化；过长的 selected-edge 间隔不宜仅靠固定周期归一化。

### 5.3 三条已被纠正的表述

1. **不能通用地写 $8C + q + e/8 + \epsilon$。** $q$ 与多相区域码 $e$ 可能重复表示同一相位区间，且 $e/8$ 的单位可能是分频后周期而非原周期。改为"锚点减残差"。
2. **不能把所有 epoch 错配都归为 ±1 原周期。** 高低位在组边界撕裂采样时，典型错误是 $-M$ 与 $+M$（一整组），与 raw-CKV 错一周期是不同故障。
3. **Sony 专利不是共享状态方法的最早先例。** Havens（US8692598B2）已同时包含整数计数、小数检测、sub-fractional TDC 和利用小数状态消除 one-count uncertainty。

## 6. 系统架构

下图是报告给出的功能数据流综合（不是任何原图的重绘）：

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

模块职责：

- **持续计数器（CNT）：** 低 $\log_2 M$ 位以 $CK_0$ 速率保存状态（可以是二进制、Johnson/Gray、shift state 等），高位在 $T_d$ 域累加。高位时钟必须与低位 wrap 在逻辑上同源，不能是任意同频 /M 时钟。
- **相干快照：** 在参考事件附近捕获 $\{C, q\}$ 及边界侧信息。"相干"的本质是同一逻辑 epoch，不要求所有位物理上同一时刻锁存。
- **执行器（P/S / slot executor）：** 目标边沿 $J_{plan} = M H_J + s_J$，慢速域做高位匹配和未来计划，高速少量状态做 slot enable、脉冲形成和根时钟重定时。
- **执行回执：** 独立产生 $J_{observed}$，不能由 $J_{plan}$ 延迟几拍改名得到。
- **短 TDC：** 只测参考沿与被选真实物理边沿之间的局部残差，携带 SAT/VALID。
- **相位整合：** 校验元组一致性，输出 FINE / COARSE / INVALID 三态之一及误差上界。

## 7. 四大核心难点

### 7.1 epoch 错误必须按层级分类

以 $M=8$、旧状态 $C=10, q=7$ 跨组为例：

| 状态 | $C$ | $q$ | $8C+q$ | 含义 |
|---|---:|---:|---:|---|
| 跨组前 | 10 | 7 | 87 | 合法旧状态 |
| 跨组后 | 11 | 0 | 88 | 合法新状态 |
| 旧高位 + 新低位 | 10 | 0 | 80 | 相对 88 错 −8 |
| 新高位 + 旧低位 | 11 | 7 | 95 | 相对 87 错 +8 |

结论：

- 修正接口必须分单位：$N_{corr} = M(C_{cap} + \kappa_C) + q_{corr} + \kappa_N$，$\kappa_C$ 以组为单位、$\kappa_N$ 以原周期为单位；$\kappa_C \in \{-1, 0, +1\}$ 只在采样延迟已证明最多跨一组时成立。
- **低位盲区：** $(N+M) \bmod M = N \bmod M$ 且 $(N+M) \bmod 2 = N \bmod 2$。整组错误既不改变 $q$ 也不改变原周期奇偶性，因此直接搬用 Havens/Sony 的 low-bit XOR 未必能检测高位错组，需要额外保留跨组翻转的状态（高位 LSB 独立观测、wrap toggle 等）。
- **边界允许两种坐标：** $J - \mu = (J+1) - (\mu+1)$。coarse 与 fine 必须共同变换，不能一条链选 $J+1$、另一条链仍相对 $J$。
- 亚稳态是模拟风险，Gray/Johnson 编码只约束数字码相邻性，不消除亚稳态。验收分两层：数字模型证明无静默错码；晶体管/PVT 模型评估剩余失效率。

### 7.2 snapshot 的三条实现路线

| 路线 | 思路 | 文献依据 | 仍须独立证明 |
|---|---|---|---|
| A 多候选捕获 | rising/falling 或多相生成多个重定时候选，按边界侧信息选安全候选 | TI、Kuo、Havens、Marvell | select 稳定、元组原子选择 |
| B 匹配延迟采样 | 各计数组按传播延迟 $[d^{min}, d^{max}]$ 错开采样时刻，再统一重采样 | CN105071798、Zong Fig.9 | PVT min/max、所有组属同一 epoch |
| C 有界错配 + 冗余校正 | 允许已知类型的 capture ambiguity，从冗余状态识别修正 | Havens、Sony | 故障集合覆盖、修正单位、歧义时 INVALID |

路线 B 的时序约束：

$$t_{S,i}^{min} \ge t_E + d_i^{max} + t_{su,i},\qquad t_{S,i}^{max} + t_{h,i} \le t_{next,i} + d_{next,i}^{min}$$

验收条件为每组余量 $m_i > 0, h_i > 0$ 且所有组属于同一 epoch。三条路线可以组合，但组合后必须重新检查联合状态空间。建议以候选元组 `{coarse, low_state, boundary_side, fine_anchor_id, candidate_id}` 为原子选择单位。

### 7.3 P/S 与物理边沿执行的因果性

- **计划不是执行证据。** 错沿、丢沿、重复沿和 gate control 晚到可能完全不改变数字计划，必须由真实执行路径产生 $J_{observed}$。
- **后知后觉的低速 snapshot 不能生成已经过去的边沿。** REF 到来后经快照、CDC、解码、低速计算再控制 selector，附近的 CKV 沿可能早已过去。只有三类路径能闭合：事先预测并在目标前提交选择；高速前端并行捕获候选后慢速解码；选用未来可执行边沿并接受其量程代价。
- **选沿 deadline：** $t_{arrive} + t_{setup,exec} + t_{guard} \le t_{target}$。不满足时必须显式 `LATE/MISS` 或重新规划不同的 $J$，任何补发都要改变回执和相位坐标。
- MASH future-edge planning 属于扩展层，只在上述接口上提供目标序列，不是基础测量问题的一部分。

### 7.4 fine 的真实量程、饱和与校准

- CNT 可以表示多周期差，但**不改变 TDC 两个输入端已经存在的物理时间间隔**。饱和函数 $Q(x)$ 对 $x \ge R$ 输出相同值，事后数字减整周期无法恢复已压缩的信息。"数字可以做 modulo"不等于"模拟 TDC 可以缩到一个周期"。
- 路径延迟统一按 $\widehat{\Delta t} = \hat d_{pin} - (\hat\tau_E - \hat\tau_R)$ 处理；DTC 放在参考路径计入 $\tau_R$，放在反馈路径计入 $\tau_E$，不得重复补偿。
- fine 采用条件：$F_{usable} = V_{code} \land V_{range} \land V_{anchor} \land V_{epoch} \land V_{cal}$。`range_ok` 必须来自电路可实现的饱和/溢出检查，不是仿真器里的理想相位。
- fine 无效时可用 coarse 相位误差 $e_c[k] = R[k] - N_R[k]$ 接管。CNT 本身不自动构成 FLL；只有另行设计频率误差控制器时才称 FLL-assisted。
- 数值示例（理想计算，非芯片指标）：$f_0 = 8$ GHz 时 $T_0 = 125$ ps，/4 后周期 500 ps，均匀八相间距 62.5 ps。TDC 量程必须由实际测量流程推导，不能因为"有八相"就直接写 ±31.25 ps。

## 8. 面向实现的事件接口与不变量

### 8.1 EventFrame（接口建议，非已发布 RTL）

| 字段组 | 建议字段 | 定义要点 |
|---|---|---|
| 事件身份 | `event_id, ref_kind, reset_epoch` | 区分本次参考、双沿类别及复位世代 |
| 计数坐标 | `clock_node_id, M, C_cap, q_cap` | 明确数的是哪个时钟节点；禁止无单位混接 |
| 捕获来源 | `candidate_id, capture_epoch, wrap_tag` | 指明候选及跨组状态 |
| 计划/执行 | `J_plan, J_observed, edge_polarity` | 实际回执独立于命令 |
| 修正 | `kappa_C, kappa_N, alpha_sel` | 分别为组单位、原周期单位、周期内偏移 |
| Fine | `fine_raw, fine_valid, sat_hi, sat_lo` | 码值与可信性分离 |
| 校准 | `tdc_gain_epoch, period_epoch, path_epoch` | fine 与 coarse 权重使用相容的校准版本 |
| 异常 | `late, miss, duplicate, encoding_invalid` | 执行错误不可被普通相位码掩盖 |
| 输出 | `phase_source, phase_value, uncertainty` | fine/coarse/invalid 及误差上界 |

### 8.2 八条不变量

| 编号 | 不变量 | 违反后的处理 |
|---|---|---|
| I1 | 实际 $CK_0$ 周期连续，$N = MC + q$ 的原点与 carry 一致 | 阻断有效相位；检查复位/极性/计数实现 |
| I2 | coarse 与 fine 同锚点，或显式记录锚点变换 | 校正或 INVALID，不静默相加 |
| I3 | correction 的单位和可覆盖错误集合明确 | 超界置无效；不截断成 ±1 |
| I4 | $J_{observed}$ 反映真实执行，不由 $J_{plan}$ 自证 | 标记回执未证实，不进入 fine_valid |
| I5 | fine 量程、码合法性和校准全部满足 | 降级使用 coarse/区间/无效 |
| I6 | 两种边界候选在共同坐标下等价 | 不一致视为 stitching 错误 |
| I7 | 低速计算符合选沿 deadline | late/miss 或重新规划并更新 $J$ |
| I8 | 全 counter rollover 采用明确模运算窗口 | 超出可展开范围时 reset/reacquire |

### 8.3 相位整合伪代码

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

控制层必须对 COARSE / INVALID 有单独、可验证的状态处理；测量有效性与控制器故障恢复不是同一问题。

## 9. 文献基础与证据边界

### 9.1 证据等级

| 标记 | 含义 |
|---|---|
| A-P | 本次核对了专利原文及相关结构 |
| A-J | 本次核对了论文原文和关键图 |
| B | 官方元数据/摘要可核对，内部电路未充分核实 |
| H | 前轮报告保存了结论，本次未重新取得完整原始证据 |
| D | 本报告推导、示例或候选工程规范 |

### 9.2 跨文献证据矩阵

| 来源 | 高位降速/低位状态 | 粗细一致性机制 | 物理选沿/细测量 | 对本目标仍缺少什么 |
|---|---|---|---|---|
| TI US20050195917A1 [R01] | /8 明确 | 双候选与 SEL_EDGE | TDC-side 判定协作 | P/S 执行与完整事件接口 |
| Xu/Lindfors WO2009053531A1 [R02] | /4，shift-state decode | 解码与高位状态耦合 | 未证明 short TDC 连接 | 低位到物理选沿的直接映射 |
| ETRI US20130156147A1 [R04] | /4，carry 同源 | 计数连续性 | 无完整 fine 链 | REF snapshot 与 fine stitching |
| CN105071798A [R05] | 异步/同步分组 | 延迟匹配、最终重采样 | 非核心披露 | 选沿、残差与有效性联动 |
| Kuo TCAS-I 2018 [R06] | /4 后八相 | 多候选重定时 | 预测选相与 short TDC | raw integer residue 的直接复用 |
| Havens US8692598B2 [R08] | 半速状态兼 integer LSB | fractional parity 校验 | fractional + sub-fractional TDC | /8 block epoch 与目标执行器 |
| Sony US11936392B2 [R07] | CNTO 兼 integer/fractional | 两个 XOR、0/±1 修正 | 多相 latch | /8 residue、short TDC、执行回执 |
| MediaTek US8593182B2 [R09] | 持续 VPA | 显式 PHF2 坐标项 | shifted edge、TDC | whole-cycle slot 的完整协议 |
| Marvell US9306586B2 [R10] | RF counter | 独立 skew/boundary 判断 | TDC 与整数边界校正 | /4-/8 高低位执行集成 |
| Zong JSSC 2019 [R11] | 2+6 split | CKS 匹配采样 | DTC + 有限 TDC | 上游原周期身份及 P/S 链 |

三类相互补充的方法：TI/Xu/ETRI 说明如何保存周期状态；CN/Zong/Havens/Sony/Marvell 说明如何保持或恢复一致性；Kuo/MediaTek 说明物理选相和局部 fine 测量。表中空白是仍需完成的接口论证，不是格式遗漏。按问题分工的核对入口：/8 split 看 TI；共享状态与修正看 Havens/Sony；short TDC 物理选相看 Kuo/MediaTek；split counter 采样波形看 Zong Fig.9。

### 9.3 几个必须记住的单位陷阱

- Kuo 2018 的 DCO 范围是 5.7–8.4 GHz，"约 2 GHz"是 /4 后的节点；八相间距折算到前置 /4 之前的 $T_0$ 是 $T_0/2$，不是 $T_0/8$。
- Zong 2019 的 counter 基准是约 20 GHz 基波经 /8 后的 CKV，不能把其低两位当作 20 GHz 全部周期的低两位。
- TI 的 CKVD8 不能只看信号名就默认其某个有效沿等于 carry；普通二进制 $q[2]$ 的上升沿对应 3→4，下降沿对应 7→0。

## 10. 当前进展

### 10.1 已执行：六组逻辑/量纲检查

使用 Python 精确有理数运算执行，合计 **9860 个定义明确的逻辑案例**，全部通过。脚本与结果见仓库 `research/verify_invariants.py` 和 `research/logical_check_results.json`，已在本仓库环境复跑确认。

| 检查 | 范围 | 案例数 | 结论 |
|---|---|---:|---|
| L01 计数分解 | M=4/8；N=0…4095 | 8192 | $MC+q=N$ 恒成立 |
| L02 跨组撕裂 | M=4/8；64 组；两种撕裂模式 | 128 | 相对合法锚点误差为 ±M |
| L03 低位盲区 | M=4/8；256 个 N | 512 | +M 不改变 residue 和 raw parity |
| L04 时钟单位换算 | 32 组、8 相、3 个 residual | 768 | 分频相位与原相位表达一致 |
| L05 锚点等价 | 64 个 J、4 个 μ | 256 | $J-\mu=(J+1)-(\mu+1)$ |
| L06 饱和不可逆 | 四对不同输入 | 4 | 饱和码无法反推输入 |

这些检查只覆盖公式和接口层，**不包含** RTL 时序、亚稳态模型、闭环噪声、AMS 或 PVT。

### 10.2 相对前几轮的主要修订

| 前轮表述 | 本次处理 |
|---|---|
| "/8 使 fine TDC 必然看到 8 个原周期，再由 snapshot 压回去" | 不成立；counter 降速、TDC 输入预分频与物理选沿是三件不同的事 |
| "Sony 才首次找到同状态参与整数与小数" | 收紧；Havens 已有先例 |
| "统一采用 κ = −1/0/+1" | 改为带单位、带故障集合的修正 |
| "$8C+q+e/8+\epsilon$ 可作通用相位公式" | 撤回；改用锚点减残差 |
| "相干必须等于同时锁存" | 保留逻辑相干定义；匹配延迟读出可在不同时刻取得同一 epoch |
| "数字整数相消即可删除 CNT" | 明确不能；CNT 仍是真实 coarse 观测与回执校验基础 |
| "通用 PISO 是 CNT-ADPLL 直接先例" | 维持降级；只能证明执行器原语 |

/4-/8 split、persistent CNT、边界校正、short TDC、selected-edge coordinate、SAT/VALID 及执行回执等主线全部保留。

## 11. 验证计划（三层 + 闭环）

1. **事件级 golden model。** 从原始真实边沿时间驱动持久 CNT，分别模拟采样、执行和有限 TDC。禁止把理想 $\Phi_0(t_R)$ 直接喂给 decoder。覆盖 /4、/8 全部 residue、跨组与全宽 rollover、rising/falling 候选切换、不同传播延迟、fine 正负量程与饱和、选择码晚到、丢沿/重复沿、复位相位、校准版本错配。逐事件比较 $J_{observed}$、coarse anchor、最终 phase 与 ground truth。
2. **RTL/门级时序验证。** 重点：carry 极性、shift-state decode、候选元组选择、snapshot 生命周期、异步同步延迟、load/shift ownership、短脉冲、门控 latch、根时钟 retiming。每类异步路径给出明确 STA/CDC 约束，不简单全部 false-path。
3. **晶体管/PVT 验证。** 补齐数字模型无法证明的部分：亚稳态解析时间、validity/selection 的亚稳传播、非法码、delay-matching 失配、占空比、mux/gate 毛刺、窄脉冲、TDC 饱和判定、回执电路扰动。第 7.2 节的参数化约束要转为实际电路的 min/max 表。
4. **闭环验证不能替代局部正确性。** 顺序为：事件身份正确 → 有效性完整 → 局部时序通过 → 再比较噪声、spur、锁定与恢复时间。记录相位误差峰值与分布、fine 直方图、SAT 占比、修正触发分布、无效观测连续长度、edge mismatch 次数和模式切换的相位不连续。

## 12. 未闭合问题与下一步

### 12.1 必须先回答的五个工程问题

| 问题 | 必须形成的产物 | 完成判据 |
|---|---|---|
| Q1 以哪个节点作为原周期？ | clock-node 表与全部倍率/相位原点 | CNT、FCW、TDC、DTC、edge ID 同一量纲 |
| Q2 C/q 在边界如何关联？ | 全 residue、wrap、候选切换真值表 | 每个允许状态都对应合法锚点或 INVALID |
| Q3 低位如何控制真实选沿？ | raw-state → slot → physical-edge 映射及 deadline | 不能生成过去边沿；late/miss 行为确定 |
| Q4 谁证明实际边沿编号？ | $J_{observed}$ 电路与独立校验路径 | 计划错误/丢沿注入后不会自证通过 |
| Q5 short TDC 何时可信？ | 物理量程预算、SAT/VALID、校准/降级规范 | 饱和码不作为精确 fine，coarse 仍可解释 |

### 12.2 收敛顺序

1. 完成 TI / Xu / ETRI 的 carry、极性和解码关系核对。
2. 把 Havens/Sony 的冗余状态迁移为带明确错误集合的 /4-/8 epoch 表。
3. 检查 Kuo/MediaTek 的物理选相是否满足本项目执行因果性，而不只是"同样有一个 MUX"。
4. 最后再接 MASH、DTC/QNC、REF X2 等扩展，并保留原始基线回归。

待补证的历史线索：Jiang 2011 MSc、Yin 2013 PhD、Bogdan/Balsara 2006 原书对应页，以及 H. Liu JSSC 2025 的 counter/feedback-generator 内部图。

### 12.3 关于差异点的表述

"低位状态同时服务整数与小数"已有公开披露，不能作为差异点概括。更具体的研究对象是：原周期 residue 的映射、实际选沿回执、block/raw-cycle 两级修正、有限 TDC 的有效性及恢复协议。是否构成可保护的差异需另行对照权利要求，本项目目前不给出新颖性、侵权或可授权结论。

## 13. 仓库内相关文件

| 路径 | 内容 |
|---|---|
| `docs/CNT_ADPLL_工程介绍.md` | 本文档 |
| `research/CNT_ADPLL_调研整合与核心问题报告.md` | 调研整合报告全文（V1.0，2026-10-03），含第 14 章参考文献与附录 A 原图定位索引 |
| `research/verify_invariants.py` | 第 10.1 节六组逻辑检查的脚本 |
| `research/logical_check_results.json` | 脚本输出结果 |

## 14. 主要参考文献

完整条目、证据等级、同族专利和原图页码见整合报告第 14 章与附录 A。

- [R01] Staszewski, Leipold (TI). *Method and apparatus for crystal drift compensation*. US20050195917A1. A-P.
- [R02] Xu, Lindfors. *Phase accumulator for digital phase locked loop*. WO2009053531A1. A-P.
- [R03] Xu, Lindfors. "A High-Speed Variable Phase Accumulator for an ADPLL Architecture." ISCAS 2008. B.
- [R04] ETRI. *High speed counter apparatus*. US20130156147A1. A-P.
- [R05] *应用于全数字 PLL 的低功耗相位累加器*. CN105071798A. A-P.
- [R06] Kuo et al. "An All-Digital PLL for Cellular Mobile Phones in 28-nm CMOS…" IEEE TCAS-I 65(11), 2018. A-J.
- [R07] Kurihara, Fujiwara (Sony). *Phase locked loop, electronic device, and method…* US11936392B2. A-P.
- [R08] Havens (LSI). *Digital phase locked loop*. US8692598B2. A-P.
- [R09] Lin, Staszewski, Cho (MediaTek). *Frequency synthesizer and associated method*. US8593182B2. A-P.
- [R10] *Methods and devices for implementing all-digital phase locked loop*. US9306586B2. A-P.
- [R11] Zong, Chen, Staszewski. "A Low-Noise Fractional-N Digital Frequency Synthesizer With Implicit Frequency Tripling…" IEEE JSSC 54(3), 2019. A-J.
- [R12]–[R19] Jiang 2011、Staszewski/Balsara 2006、Yin 2013、Staszewski JSSC 2011、S. Liu JSSC 2016、H. Liu JSSC 2025、US8653862B2、US8050375B2：H/B 级历史与外围线索。
