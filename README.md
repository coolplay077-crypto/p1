# CNT-based ADPLL

基于持续整数相位计数（CNT）的全数字锁相环研究项目：整数相位保留、相干快照与短量程 TDC。

- **交互式 HTML 书（中英双语）：** [book/dist/index.html](book/dist/index.html) —— 单文件、可离线打开；含全文搜索、中/英/对照切换、公式推导卡片、按公式重建的交互模型与波形动画、知识汇总。说明见 [book/README.md](book/README.md)。
- **工程介绍：** [docs/CNT_ADPLL_工程介绍.md](docs/CNT_ADPLL_工程介绍.md)
- **调研整合报告（V1.0，2026-10-03）：** [research/CNT_ADPLL_调研整合与核心问题报告.md](research/CNT_ADPLL_调研整合与核心问题报告.md)
- **逻辑/量纲检查：** `research/verify_invariants.py`，结果在 `research/logical_check_results.json`

复跑检查：

```bash
python3 research/verify_invariants.py
```
