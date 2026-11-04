# CNT-based ADPLL

基于持续整数相位计数（CNT）的全数字锁相环研究项目：整数相位保留、相干快照与短量程 TDC。

- **工程介绍：** [docs/CNT_ADPLL_工程介绍.md](docs/CNT_ADPLL_工程介绍.md)
- **调研整合报告（V1.0，2026-10-03）：** [research/CNT_ADPLL_调研整合与核心问题报告.md](research/CNT_ADPLL_调研整合与核心问题报告.md)
- **逻辑/量纲检查：** `research/verify_invariants.py`，结果在 `research/logical_check_results.json`

复跑检查：

```bash
python3 research/verify_invariants.py
```

---

# MediaTek ISSCC 2025 19.3 多路径反馈 PLL：Python 复现与专利 US 11,509,315 核对

- **主报告：** [docs/ISSCC2025_19.3_MTK多路径反馈PLL_复现与专利核对.md](docs/ISSCC2025_19.3_MTK多路径反馈PLL_复现与专利核对.md)，包括复现验证、与专利的逐项核对、非理想因素和设计注意项。
- **前期报告（专利切片 CP 理论 + ISSCC 2008 ADPLL）：** [docs/MTK_PLL_QNC_Python复现与非理想分析.md](docs/MTK_PLL_QNC_Python复现与非理想分析.md)
- **模型与脚本：** [mtk_pll/](mtk_pll/)，结果在 `mtk_pll/results/`

```bash
cd mtk_pll && pip install -r requirements.txt
```

```bash
python3 run_isscc25_19p3.py
```
