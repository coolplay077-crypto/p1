# CNT-based ADPLL

基于持续整数相位计数（CNT）的全数字锁相环研究项目：整数相位保留、相干快照与短量程 TDC。

- **工程介绍：** [docs/CNT_ADPLL_工程介绍.md](docs/CNT_ADPLL_工程介绍.md)
- **调研整合报告（V1.0，2026-10-03）：** [research/CNT_ADPLL_调研整合与核心问题报告.md](research/CNT_ADPLL_调研整合与核心问题报告.md)
- **逻辑/量纲检查：** `research/verify_invariants.py`，结果在 `research/logical_check_results.json`

复跑检查：

```bash
python3 research/verify_invariants.py
```

## 相关子项目

- **Wu 2019 JSSC 采样 PLL 复刻与混合 DTC 非线性校准设计：** [wu2019_spll/](wu2019_spll/)。交接说明见 [wu2019_spll/docs/HANDOFF.md](wu2019_spll/docs/HANDOFF.md)，设计报告见 [wu2019_spll/docs/design_report_hybrid_nlc.md](wu2019_spll/docs/design_report_hybrid_nlc.md)。
