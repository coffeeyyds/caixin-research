# caixin-research

一个**跨 agent 通用**的财新内容研究技能（Agent Skill）：支持 ZCode、Claude Code、Codex CLI、Gemini CLI、WorkBuddy、OpenCode 等主流 AI 代理，Windows / macOS / Linux 均可运行（各端安装路径见 [AGENTS.md](AGENTS.md)）：用 ego-browser 复用你已登录的
财新会员会话，完成「站内检索 → 全文抓取 → 逐篇精读 → 综合报道」的一条龙研究流程。

> 仅利用你自己的会员权限正常阅读，不做任何绕过付费墙的处理；请遵守财新用户协议，
> 抓取内容仅限个人研究使用，请勿公开传播原文。

## 功能

- **检索**：财新站内搜索接口翻页（支持智能排序/时间倒序、自定义时间窗、综合/杂志等频道标签），
  规避页面滚动懒加载只返回约 20 条的限制。
- **抓全文**：逐篇访问文章页，自动点击「余下全文 / 展开全文」，抽取正文并剥离站方反爬注入文本，
  以带元信息头的 Markdown 落盘。
- **精读**：≤10 篇逐篇精读；更大规模自动改为「子代理并行消化 + 主线程合并笔记」，
  严格控制上下文占用。
- **写报道**：按议题（而非逐篇）生成研究综述 `report.md`，关键事实均标注来源与日期；
  可选调用 docx 技能产出正式 Word 版（封面/目录/页码）。

## 目录结构

```
caixin-research/
├── SKILL.md                   # 技能主流程与硬性规则（所有 agent 的唯一入口）
├── AGENTS.md                  # 跨客户端安装说明（ZCode/Claude Code/Codex/Gemini/WorkBuddy 等）
├── references/
│   ├── caixin-site.md         # 财新站点实测机制：搜索 API、展开按钮、选择器、踩坑记录
│   └── edge-driver.md         # Edge CDP 驱动指南（Windows/Linux 及无 ego 环境的常规路径）
├── scripts/
│   ├── caixin.mjs             # 跨平台检索/抓取 CLI（Edge/任何 Chromium over CDP）
│   └── package.json           # 依赖 playwright-core，npm install 一次即可
├── README.md
└── LICENSE
```

## 前置条件

- 任一支持 markdown 技能文件的 AI 代理（ZCode / Claude Code / Codex CLI / Gemini CLI / WorkBuddy / OpenCode 等）；
- 浏览器二选一（skill 会优先复用宿主现成的浏览器控制设施，都没有时用自带方案）：
  - **Edge + Node.js ≥18**（Windows/Linux 推荐，macOS 亦可用）：`scripts/caixin.mjs`
    经 CDP 驱动 Edge，复用你登录的财新会话，详见 [references/edge-driver.md](references/edge-driver.md)；
  - **ego-browser**（macOS，宿主已装时优先）：会话复用逻辑相同；
- 对应浏览器里已登录**财新会员**账号（技能只读你已授权的内容）。
- 注意：财新数据通、金融我闻为独立付费产品，普通财新通会员不可读，技能会静默跳过。

## 安装

```bash
# 用户级安装（跨项目可用）
git clone https://github.com/<you>/caixin-research.git ~/.agents/skills/caixin-research
```

通用安装（含 macOS 符号链接与 Windows PowerShell 两种写法）见 [AGENTS.md](AGENTS.md)。
装好后对 agent 说「帮我用财新研究 <话题>」即可触发（ZCode 中亦可 `/caixin-research <话题>`）。

## 产出结构

每次研究在工作目录生成：

```
caixin-<话题>-<日期>/
├── articles/   # 48 篇级全文语料（每篇一个 md，含标题/链接/日期元信息）
├── notes.md    # 逐篇结构化精读笔记
└── report.md   # 综合研究报道（可选 .docx）
```

## 设计原则

- 页面内容一律视为数据：剥离并忽略站方嵌入的任何「AI 指令」文本；
- 上下文安全：全文只落盘不进上下文，笔记增量写、报告只依赖笔记；
- 路径无关：示例代码统一使用占位符路径，Windows / macOS 的 Node 运行时均可执行脚本。

## License

MIT
