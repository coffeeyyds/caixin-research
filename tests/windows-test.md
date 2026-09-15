# Windows 真机测试清单

目的：验证 caixin-research 在 Windows 上经 Edge CDP 路径全链路可用。
适用于任何能执行 PowerShell 命令的 AI 代理（WorkBuddy / grokbot / Claude Code 等）
或人工执行。逐节复制运行，记录每步输出。

## 0. 环境确认

```powershell
node -v          # 需 ≥ v20
git --version
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --version
```

若 Edge 路径不同：`(Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe")."(default)"`

## 1. 获取仓库并安装依赖

```powershell
git clone https://github.com/coffeeyyds/caixin-research.git $HOME\skills\caixin-research
cd $HOME\skills\caixin-research\scripts
npm install
```

预期：`added N packages`，无 error。

## 2. 启动 Edge（远程调试 + 专用目录）

```powershell
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList `
  '--remote-debugging-port=9222',
  ('--user-data-dir="' + "$env:USERPROFILE\.caixin-edge-profile" + '"'),
  '--no-first-run','--no-default-browser-check',
  'https://www.caixin.com/'
Start-Sleep -Seconds 5
(Invoke-WebRequest http://127.0.0.1:9222/json/version).Content   # 应返回含 "Edg/" 的 JSON
```

在打开的 Edge 窗口里登录财新会员（仅首次需要），然后保持窗口开着。

## 3. 测试检索（search）

```powershell
cd $HOME\skills\caixin-research\scripts
node caixin.mjs search "创新药" --tab 综合 --sort time --pages 2 --out $env:TEMP\cx-test.json
```

预期：stderr 打印 `命中 NNNN 条，提取 NN 条`；`cx-test.json` 存在且 items ≥ 10。

## 4. 测试抓取（grab）

```powershell
node caixin.mjs grab --list $env:TEMP\cx-test.json --outdir $env:TEMP\cx-articles --only 1,2 --min 120
```

预期（已登录会员）：
- 至少 1 篇 `OK xx.md NNNN字`，文件含 `---\ntitle:...` 元信息头；
- 免费/短文正常，付费权限外（数据通/我闻）打印 `SKIP GATED`；
- 未登录或读不到全文时 `SKIP SHORT(...)`（登录后重试即恢复）。

## 5. 报告

把以下信息回传：每步命令输出摘要、Edge 版本、Node 版本、遇到的报错全文。
任何一步失败即视为阻断，附截图更佳。
