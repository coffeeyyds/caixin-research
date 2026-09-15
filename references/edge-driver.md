# Edge CDP 驱动指南（Windows / macOS / Linux 通用）

当宿主环境没有 ego-browser（或任何现成浏览器自动化设施）时，用本仓库自带的
`scripts/caixin.mjs` 驱动 Edge 完成检索与抓取。原理：Edge 以远程调试模式启动，
Node 通过 CDP（playwright-core `connectOverCDP`）连接，复用浏览器内已登录的财新
会员会话——与 ego 路径的会话复用逻辑一致，脚本不读取、不存储任何凭据。

## 一次性准备

1. 安装 Node.js ≥ 18（`node -v` 可用）。
2. 安装脚本依赖（只需一次）：

```bash
cd <skill目录>/scripts
npm install          # 安装 playwright-core（不下载浏览器）
```

3. 以远程调试模式启动 Edge，并**使用专用用户目录**：

为什么必须专用目录：Chromium 新版（Chrome/Edge 136+）禁止对默认用户目录开远程
调试；同时把自动化会话与日常浏览隔离也更安全。财新会员在该目录里登录一次即可
长期保持。

Windows（PowerShell）：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:USERPROFILE\.caixin-edge-profile" `
  --no-first-run --no-default-browser-check `
  "https://www.caixin.com/"
```

（Edge 安装路径若不同，可用 `Get-Command msedge` 或注册表查询；macOS 为
`/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`，Linux 通常为
`microsoft-edge`。）

4. 在打开的 Edge 里登录财新会员（首次），保持该窗口不关。
5. 验证调试端口：访问 `http://127.0.0.1:9222/json/version` 应返回 JSON。

## 日常使用

```bash
cd <skill目录>/scripts

# 检索：时间倒序近两月候选（--until 为时间窗下限）
node caixin.mjs search "创新药" --tab 综合 --sort time --pages 10 --until 2026-07-15 --out candidates.json

# 深度稿：杂志标签 + 智能排序
node caixin.mjs search "创新药" --tab 杂志 --sort smart --pages 8 --out weekly.json

# 抓取：按清单批量（--only 可选序号/区间），或单篇
node caixin.mjs grab --list candidates.json --outdir ../caixin-<话题>-<日期>/articles --only 1,3,5-9
node caixin.mjs grab --url https://weekly.caixin.com/2026-06-20/102455860.html --out articles/01-标题.md
```

- `--tab`：综合（默认）/ 杂志 / 数据通 / 我闻 / mini；`--sort`：time（默认）/ smart。
- `--min`：正文最小字数阈值（默认 500；收录短快讯时可调低，如 `--min 120`）。
- `--cdp`：调试端口非 9222 时指定，如 `--cdp http://127.0.0.1:9333`
  （或环境变量 `CAIXIN_CDP`）。
- 输出约定：search 写 JSON 候选清单（title/url/date/channel/summary）；
  grab 逐篇写 md（元信息头 + 正文），控制台只打印 OK/SKIP/GATED 简报。
- SKIP 规则：GATED = 正文区出现"订阅后继续阅读/本文共计N字"（权限外，
  数据通/我闻等独立付费产品即此类，静默跳过）；SHORT = 低于 --min 字数。

## 与 ego 路径的配方一致性

两条驱动路径共用同一套站点配方（见 caixin-site.md）：搜索网关 API、
`.content p` 正文选择器、"余下全文/下一页余下全文/展开全文"按钮、
反 AI 注入文本剥离、URL 日期提取。差异只在驱动 API：

| 操作 | ego-browser | caixin.mjs (CDP) |
|---|---|---|
| 页面请求 | `page.fetch(url, opts)` | `page.evaluate(() => fetch(...))` |
| 点击展开 | `page.click("text=余下全文")` | `page.locator("text=...").first().click()` |
| 抽取 | `page.evaluate(fn)` | 同（playwright 同名 API） |

排查提示：连接失败（ECONNREFUSED）多为 Edge 未启动或端口不符；抽取全 SHORT
多为该 Edge 目录未登录会员；脚本 `--cdp` 指向正确端口即可。
