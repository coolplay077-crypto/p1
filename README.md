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

# MTK PLL 量化噪声抵消（QNC）Python 复现

对 MediaTek 两份资料做行为级复现、非理想因素分析和设计注意项评估：US 11,509,315 B2 切片电荷泵小数分频 PLL，以及 ISSCC 2008 10.1 ADPLL。

- **报告：** [docs/MTK_PLL_QNC_Python复现与非理想分析.md](docs/MTK_PLL_QNC_Python复现与非理想分析.md)
- **模型与脚本：** [mtk_pll/](mtk_pll/)，结果在 `mtk_pll/results/`

```bash
cd mtk_pll && pip install -r requirements.txt
```

```bash
python3 run_sliced_cp.py && python3 run_adpll2008.py
```
