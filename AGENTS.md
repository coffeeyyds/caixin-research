# caixin-research — agent 使用说明（跨客户端通用）

本仓库是一个 Agent Skill：任何支持 markdown 指令文件加载的 AI 代理（ZCode、Claude Code、
Codex CLI、Gemini CLI、WorkBuddy、OpenCode、Amp 等，Windows / macOS / Linux 均可）均可使用。
核心入口永远是 `SKILL.md`，各家差异只在"把仓库放到哪个目录、以什么方式触发"。

## 通用能力要求

执行本 skill 的 agent 需要具备：

1. **能运行 shell 命令**（执行 `ego-browser nodejs` 脚本）；
2. **能读写本地文件**（落盘文章、笔记、报告）；
3. **已安装 ego-browser CLI**（`ego-browser -h` 可用）。

只要满足以上三点，skill 内容与具体客户端无关。

## 各客户端安装位置

| 客户端 | 推荐路径 | 触发方式 |
|---|---|---|
| ZCode | `~/.agents/skills/caixin-research/`（或 `~/.zcode/skills/`） | 自动触发或 `/caixin-research` |
| Claude Code | `~/.claude/skills/caixin-research/` | 自动触发或 `/caixin-research` |
| Codex CLI | `~/.codex/skills/caixin-research/`（`$CODEX_HOME/skills`） | `$skill-name` 引用 |
| Gemini CLI | `~/.gemini/skills/caixin-research/` | 按 Gemini 的 skills 说明加载 |
| WorkBuddy | `~/.workbuddy/skills/caixin-research/`（Win 即 `C:\Users\<用户名>\.workbuddy\skills\`） | 技能市场/重启后自动发现 |
| OpenCode / Amp 等 | 对应的 `skills/` 目录 | 同理，入口都是 `SKILL.md` |

通用安装（符号链接，一处更新处处生效）：

```bash
git clone https://github.com/coffeeyyds/caixin-research.git ~/skills/caixin-research
for d in ~/.agents ~/.claude ~/.codex ~/.gemini ~/.workbuddy; do
  [ -d "$d" ] && mkdir -p "$d/skills" && ln -sfn ~/skills/caixin-research "$d/skills/caixin-research"
done
```

Windows（PowerShell）：

```powershell
git clone https://github.com/coffeeyyds/caixin-research.git $HOME\skills\caixin-research
foreach ($d in @("$HOME\.agents", "$HOME\.claude", "$HOME\.codex", "$HOME\.gemini", "$HOME\.workbuddy")) {
  New-Item -ItemType Directory -Force -Path "$d\skills" | Out-Null
  New-Item -ItemType SymbolicLink -Path "$d\skills\caixin-research" -Target "$HOME\skills\caixin-research" -Force
}
```

（Windows 若不便使用符号链接，直接 `git clone` 到各客户端自己的 skills 目录也可以。）

## frontmatter 兼容性

`SKILL.md` 使用最小化 YAML frontmatter（仅 `name` + `description`），这是各家用得最广的公约子集；
不放 license header、不依赖任何客户端私有字段。如果某个客户端要求额外字段，在该客户端的
安装副本里追加即可，不要改本仓库的公约版本。

## 执行环境说明（Windows 与 macOS 同为一等公民）

浏览器驱动有两条路径，skill 会优先复用现成设施、没有才用自带方案（详见 SKILL.md"浏览器驱动选择"）：

- **自带 CDP 路径（Windows/Linux 推荐，macOS 亦可用）**：Edge 以
  `--remote-debugging-port=9222 --user-data-dir=<专用目录>` 启动，
  `scripts/caixin.mjs`（Node ≥18 + `npm install` 装 playwright-core）通过 CDP 连接，
  复用该 Edge 目录里已登录的财新会员会话。检索/抓取全部走这个命令行工具，
  无平台专有命令，Windows / macOS / Linux 一致。详见 [edge-driver.md](references/edge-driver.md)。
- **ego 路径（macOS，宿主已装 ego-browser 时）**：`ego-browser nodejs` heredoc 执行，
  配方与 CDP 路径相同。

两条路径下会员态都来自用户自己登录的浏览器；本 skill 不读取、不存储任何凭据。
