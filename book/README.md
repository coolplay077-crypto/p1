# CNT-ADPLL 交互式技术书 / Interactive Book

把《CNT_ADPLL 调研整合与核心问题报告》（V1.0）与《工程介绍》转换为**单文件、可离线打开**的中英双语交互式 HTML 书。

The research report and the engineering introduction rendered as a **single self-contained, offline** bilingual HTML book with interactive behavioural models.

## 打开 / Open

直接用浏览器打开 `book/dist/index.html`（无需服务器、无需联网）。
Open `book/dist/index.html` in any modern browser — no server, no network required.

## 功能 / Features

| 功能 | Feature |
|---|---|
| 全文搜索（正文、公式 LaTeX、术语、文献、交互模型、知识卡），`/` 或 `Ctrl+K` | Full-text search over text, equation LaTeX, terms, references, demos and knowledge cards (`/` or `Ctrl+K`) |
| 中文 / English / 中英对照（按小节对齐）切换，`L` | Chinese / English / side-by-side (section-aligned) switch (`L`) |
| 公式工具条：复制 LaTeX、推导卡片、打开对应交互模型 | Equation toolbar: copy LaTeX, derivation card, open the matching model |
| 交互建模：按公式与论证从底层重建的行为级模型与波形/数据动画 | Interactive behavioural models rebuilt from the equations, with waveform/data animations |
| 知识汇总：公式图谱、术语表、文献证据库、需求/不变量/问题清单、修订对照、概念图、速查表、自测题与闪卡 | Knowledge hub: formula atlas, glossary, evidence explorer, G/I/Q checklists, revision log, concept map, cheat sheet, quiz & flashcards |
| 悬停卡片：术语、文献 [Rxx]、公式引用 | Hover cards for terms, citations [Rxx] and equation references |
| 收藏、笔记（本机保存，可导出 Markdown）、阅读进度、继续阅读 | Bookmarks, notes (local, Markdown export), reading progress, continue reading |
| 浅色/深色主题、字号、专注模式、打印样式、手机布局 | Light/dark theme, font size, focus mode, print styles, phone layout |
| 在浏览器中复跑 L01–L06 逻辑检查（精确有理数） | Re-run the L01–L06 logical checks in the browser (exact rationals) |

交互模型均为依据文字描述重建的**理想化/行为级模型**，用于理解机制与边界，不是原文插图的复刻，也不是芯片指标。
All models are **idealized/behavioural reconstructions** from the text — not reproductions of the original figures and not silicon specifications.

## 构建 / Build

中文内容直接读取仓库内的源文档（唯一事实来源）；英文译文位于 `book/content/en/`。

```bash
cd book && npm install && cd ..
```

```bash
node book/build.mjs
```

输出 `book/dist/index.html`。构建会检查中英小节是否一一对应、组件映射是否存在。
This writes `book/dist/index.html` and warns about unpaired sections or missing widgets.

## 目录结构 / Layout

| 路径 | 内容 |
|---|---|
| `build.mjs` | Markdown + KaTeX → 单文件 HTML；交叉引用、术语、引用自动链接；搜索索引 |
| `src/template.html`, `src/app.css`, `src/app.js` | 页面骨架、样式（浅/深色 token）、应用外壳与 API |
| `src/widgets/_lib.js` | 交互组件工具库 `W`（SVG/控件/波形/精确有理数） |
| `src/widgets/*.js` | 每个交互模型一个文件（`Book.registerWidget`） |
| `src/pages/*.js` | 知识汇总页面（`Book.registerPage`） |
| `data/*.json` | 术语、文献、公式、清单、修订、概念图、测验数据；`widget-map.json` 决定模型嵌入位置 |
| `content/en/` | 英文译文（与中文按标题编号配对） |
| `dev/check.mjs` | 无头浏览器冒烟测试与截图 |
| `dev/check-translation.mjs` | 译文结构校验（公式、引用、表格、代码块逐节一致） |

### 开发检查 / Dev checks

```bash
node book/dev/check-translation.mjs
```

```bash
node book/dev/check.mjs --build --widget split-counter --page home,lab --themes light,dark --mobile
```
