# MTK PLL 量化噪声抵消（QNC）行为级 Python 模型

报告：
- [../docs/ISSCC2025_19.3_MTK多路径反馈PLL_复现与专利核对.md](../docs/ISSCC2025_19.3_MTK多路径反馈PLL_复现与专利核对.md)（主报告）
- [../docs/MTK_PLL_QNC_Python复现与非理想分析.md](../docs/MTK_PLL_QNC_Python复现与非理想分析.md)（专利理论、ISSCC 2008）

| 模型 | 来源 | 代码 | 实验脚本 |
|---|---|---|---|
| **多路径反馈小数分频 PLL（实测标定）** | **ISSCC 2025 paper 19.3（MediaTek）** | `mtkpll/multipath19p3.py` | `run_isscc25_19p3.py` |
| 切片电荷泵小数分频 PLL（sliced CP + 整数 T_VCO DTC + 重定时） | US 11,509,315 B2（MediaTek） | `mtkpll/sliced_cp.py` | `run_sliced_cp.py` |
| 小数分频 ADPLL（CTDC + 环路增益校准 + 数字相噪抵消） | ISSCC 2008 paper 10.1（MediaTek） | `mtkpll/adpll2008.py` | `run_adpll2008.py` |

公共工具（MASH 1-1-1、环路滤波器设计、相噪/杂散/抖动计算）在 `mtkpll/common.py`。

## 运行

```bash
pip install -r requirements.txt
```

```bash
python3 run_isscc25_19p3.py   # 约 20 s，输出 results/isscc25_19p3_results.json + D*.png（检查分 arith/consistency/validation 三类）
```

```bash
python3 run_sliced_cp.py      # 约 40 s，输出 results/sliced_cp_results.json + A*.png
```

```bash
python3 run_adpll2008.py      # 约 2 min，输出 results/adpll2008_results.json + B*.png
```

加 `--quick` 用较短记录做冒烟测试。每个脚本末尾打印 `n/m checks PASS`。检查项的状态有三种：`PASS`、`FAIL`，以及 `DEVIATION`（论文/专利声明在本模型中未复现，原因见报告）。

## 建模层级

- 每个参考周期一步的相位域模型。CP-PLL 的 LPF/VCO 采用精确状态空间离散化，ADPLL 的 DCO 采用 ZOH 积分。输出谱用 `os` 倍子步获得。
- 每个 CP 切片、每个 TDC 量化都按真实边沿时刻计算，所以失配、非线性、偏斜、重定时滑周期、TDC 零点 DNL 等都作用在真实时序上。
- 两套模型都与线性解析模型交叉核对过（相噪分量、闭环传函）。
- 不建模：参考周期内 CP 脉冲形状引起的纹波（参考杂散）、电源/衬底耦合、晶体管级器件噪声细节、DCO 电容阵列内部结构。
