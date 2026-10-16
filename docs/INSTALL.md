# 安装 AI-Ping 并配置 AI

适用于 Windows x64。推荐使用正式 Release 的便携运行包；它包含 Electron 和原生输入辅助程序，无需为日常运行安装 Node.js、Git 或 C++ 编译器。Codex 接入需要另行安装／登录 Codex；API 接入只需要可用服务和视觉模型。

把 [README 的安装提示词](../README.md#让-ai-帮你安装) 交给能操作本机的 AI 助手后，它可以照本页完成安装。浏览器登录、API Key 输入和系统提权仍由你本人完成。

## 1. 安装程序

1. 打开 [最新 Release](https://github.com/yc0203/AI-Ping/releases/latest)。
2. 下载 `AI-Ping-0.1.0-win-x64.zip` 和 `SHA256SUMS.txt`。
3. 在 PowerShell 中运行 `Get-FileHash .\AI-Ping-0.1.0-win-x64.zip -Algorithm SHA256`，与校验文件中对应文件名的哈希比较。
4. 解压到有写入权限的个人目录，如 `C:\Users\你的用户名\Apps\AI-Ping`。解压后应能找到 `AI-Ping.exe`、`resources` 和 `tools\configure-ai.ps1`。
5. 已有版本更新时先退出托盘程序，保留旧目录中的 `data`，不要用空配置覆盖。不要把旧电脑的加密密钥视为可直接移植的新电脑凭据。

程序默认不设置开机自启。启动后可以从原设置面板自行调整热键、音量等。

## 2A. 配置本地 Codex

“本地 Codex”是使用本机 Codex CLI 作为接入进程，模型请求仍由它配置的服务处理，并非保证离线推理。

### 检查安装与登录

已有 Codex 时，先检查：

```powershell
codex --version
codex login status
```

未安装时，按 [官方 Codex CLI 文档](https://developers.openai.com/codex/cli) 安装。使用 npm 的一种安装方式是 `npm install -g @openai/codex@latest`；需要先具备可用的 Node.js/npm。官方也给出了这一 [npm 安装命令](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)。登录运行 `codex login`，由本人完成浏览器授权；已有有效登录则不必重复登录。参见 [官方身份验证说明](https://developers.openai.com/codex/auth)。

AI-Ping 会尝试寻找 PATH 中的 `codex.exe` 和本机桌面应用的 Codex 二进制。npm 安装通常还提供 `codex.cmd` 包装器；**AI-Ping 的路径需要填写真实的 `codex.exe`，不能填 `codex.cmd`**。若自动查找失败，可用以下命令定位候选：

```powershell
$codexRoot = Join-Path (npm root -g) '@openai'
Get-ChildItem -LiteralPath $codexRoot -Filter codex.exe -Recurse -File |
  Select-Object -ExpandProperty FullName
```

选择与你系统架构相符的二进制；不要盲目使用列表第一项。已有桌面版 Codex 的用户也可以在设置里选择对应的可执行文件。AI 助手不应读取、输出或复制 `auth.json`、访问令牌或其他软件的凭据文件。

### 通过配置脚本写入

先从 AI-Ping 的托盘菜单退出程序，再在解压目录中运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\configure-ai.ps1 `
  -Provider codex `
  -ExePath .\AI-Ping.exe `
  -CodexPath 'C:\你的实际安装路径\codex.exe'
```

这只为本次脚本进程设置 ExecutionPolicy，不修改系统执行策略。自动查找可用时可以省略 `-CodexPath`。模型留空使用 Codex 现有配置，需要指定时添加 `-CodexModel '实际模型名称'`；脚本不会改写全局 Codex 配置。

脚本检测到 Codex 本机连接和登录可用后保存配置。失败会给出错误，不会谎报成功。连接检测不等于已验证所选模型的图片能力，后者需实际发送一个适当的示例确认。

### 通过界面配置

也可以启动 `AI-Ping.exe` →“AI 与标记设置”→“本机 Codex”，填入路径或留空自动查找，保存后点击“检测登录与连接”。

## 2B. 配置兼容 API

准备好三个非秘密参数和你的密钥：

| 参数 | 如何填写 |
| --- | --- |
| Base URL | 服务给出的 API 基础地址，通常包含 `/v1`；不要再手动拼接 `/responses` 或 `/chat/completions` |
| 模型 | 服务提供商实际提供的模型 ID；截图任务必须支持图像输入 |
| 协议 | `responses` 或 `chat`，按该服务支持的协议填写 |
| API Key | 在本机隐藏输入，或使用当前进程环境变量；不放进提示词、命令行参数、源码或 Git |

并非所有聊天 API 都兼容。Anthropic Messages、Gemini 原生接口等专用格式不能直接填入；需要服务提供兼容接口。远程服务要求 HTTPS；`localhost`、`127.0.0.1`、`[::1]` 的本机服务允许 HTTP。

先退出 AI-Ping，在解压目录执行，替换地址和模型：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\configure-ai.ps1 `
  -Provider api `
  -ExePath .\AI-Ping.exe `
  -BaseUrl 'https://api.example.com/v1' `
  -Model '服务商的视觉模型ID' `
  -ApiMode chat `
  -PromptForKey
```

脚本会提示在本机输入密钥，屏幕不回显。它把配置通过一次性子进程环境变量交给 AI-Ping，程序读取后立即移除该变量，由 Electron safeStorage 加密后保存到 `data\ai.json`，不会把密钥当成可见的启动参数。脚本保留已有标记绑定和个性化设置。

如果你已在**当前进程**设置 `AI_PING_API_KEY`，可以将 `-PromptForKey` 改为 `-UseEnvironmentKey`。AI 助手不能打印这个环境变量；不需要为本程序新建持久环境变量或 `.env` 文件。无密钥的本机服务可用 `-NoApiKey`，该选项会清除 AI-Ping 原先保存的 API 密钥。

配置脚本只校验地址／模型／协议格式并保存，不会调用模型；成功输出不意味着密钥有额度或模型能读图。也可以直接在 AI 设置页面填写这些参数，API Key 输入框会由程序加密保存。

## 3. 启动并验收

1. 运行 `AI-Ping.exe`，确认设置中的接入方式正确。后续可以在设置中切换 Codex／API。
2. 点击“仅截图”，按住左键拖动一个矩形，松开后应出现选区旁的小浮窗。试一下复制／保存截图，这不会向 AI 发请求。
3. 对不含个人信息的示例使用“解释这里”或“截图翻译”，预览后再点击发送。API 请求会交给你设置的服务；Codex 请求交给本机 Codex 配置的服务。
4. 核实确实有答案、可以继续追问。浮窗支持复制和“展开”完整对话；脚本和安装助手应分别报告哪些检查已完成，哪些尚未验证。

默认轮盘是 Alt + 左键拖动，Ctrl + Alt + P 暂停／恢复标记；热键可以在原设置中修改。Ctrl + Alt + A 打开面板如果被其他应用占用，可通过托盘菜单操作。

## 4. 没有 Release 时从源码构建

需要 Windows x64、Node.js 22+、Git、Visual Studio 2022 Build Tools 的“使用 C++ 的桌面开发”工具链及 Windows SDK。安装 Build Tools 需要系统授权，AI 助手应说明要安装的组件再请求系统授权。

```powershell
git clone https://github.com/yc0203/AI-Ping.git
cd AI-Ping
npm ci
npm run build:helper
npm run typecheck
npm test
npm run build
npx electron-builder --win --x64 --dir --publish never
```

运行程序位于 `release\win-unpacked\AI-Ping.exe`。配置时使用仓库中的 `tools\configure-ai.ps1`，并给 `-ExePath` 传入该文件的完整路径。安装程序使用 `npm run dist` 生成。

不要用仓库旁不存在的 `../app` 作为构建前提；`package:local` 只服务于原开发工作区。无需复制开发者的运行数据、密钥或 Codex 登录文件。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 配置脚本提示先关闭程序 | 关闭窗口还不够，从系统托盘菜单退出后重试 |
| 找不到 Codex | 指定真实 `codex.exe`；npm 的 `.cmd` 包装器不能直接传给本程序 |
| Codex 尚未登录 | 运行 `codex login`，本人完成授权，再配置或检测 |
| API 返回 401／403 | 检查该服务的密钥和账户权限；不要将密钥贴到 Issue |
| API 返回 404 | 检查 Base URL、模型 ID、协议，避免重复拼接接口路径 |
| API 返回 429 | 检查服务额度、限流和模型访问条件 |
| 能聊天但不识别截图 | 改用该服务支持图片输入的模型；不能只依据模型名称推断 |
| 划词读不到 | 使用截图翻译；有些控件禁止复制或不提供可访问文本 |
| 面板黑块／闪烁 | 先用默认软件渲染启动，不添加 `--enable-gpu` |
| 换电脑后密钥无法解密 | 在新电脑重新输入密钥，不分享整个 `data` 目录 |

## 给安装助手的完成标准

- 运行包来源是 `yc0203/AI-Ping` 的正式 Release，或构建自该仓库源码。
- 哈希核对通过；原有用户数据保留。
- AI-Ping 可启动，已明确写入并核实所选接入方式。
- Codex 本机连接检测通过，或 API 配置格式验证和加密保存通过；未调用推理时如实说明。
- 框选、小浮窗可以打开，完成情况有证据。
- 没有回显、提交或打包个人截图、密钥或登录令牌。
