# B1 回执 — A Plus Operator 骨架（Phase B 任务卡 1）

- 时间：2026-11-17 13:47–14:15（奥克兰时间 NZDT）
- 执行：Codex工程（箱子上本地 clone `/workspace/tech/aplus-marketing-v3`，分支 `feat/b1-skeleton`）
- 远端：`origin = https://github.com/justin2tang-png/aplus-marketing-v3.git`（**只设了地址；没有 push、没开 PR**；repo-local `user.name/email`，全局 git config 未动）
- 冻结的 Dashboard V2：**未修改**。箱子上没有它的源码，只读参考了 `/workspace/aplus-review/{REPORT,FREEZE-RECORD,A-Plus-Operator-Plan-v2}.md`（Pi 调用方式、合规/品牌规则、DPAPI/SQLite 方案）和 `/workspace/tech/pi-content-director/app.py` 里已验证的 Pi 命令行。

> ⚠️ 本回执里的测试全部是 **Linux 箱子上的模拟**：mock provider、假 Pi CLI、xvfb 里跑的 Linux 版 Electron。
> **Windows 安装包还没在任何 Windows 机器上装过；还没有生成过一篇真实 GPT 文案。** 不能当作生产验收。

## 1. 做了什么

| 要求 | 实现 | 位置 |
|---|---|---|
| Electron 骨架 | Electron 45.3.3；`contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`；preload 只暴露 15 个白名单 `ipcRenderer.invoke` 通道；禁新窗口/禁导航；单实例锁；CSP `default-src 'self'` | `src/main/main.js` `preload.js` `ipc.js` |
| Windows 安装包 | electron-builder 26.18.0，NSIS x64，`publish: null` + `--publish never`；Linux 交叉打包 | `electron-builder.yml` `scripts/build-win.sh` |
| 原生模块 | better-sqlite3 13.2.0 是 **N-API** 版，npm 包自带 `prebuilds/win32-x64.node`（ABI 稳定，不需要按 Electron 版本重编），`npmRebuild:false`，`asarUnpack`；安装包里只放 win32-x64 那一个 `.node`。已验证是 **PE32+ x86-64 DLL**（见 §4） | — |
| 本地 SQLite | `<userData>/aplus-operator.db`，WAL，`PRAGMA user_version` 迁移；表 `contents / settings / secrets / meta` | `src/main/db.js` |
| 每日自动备份 | 启动时若最近备份 >24h 就备份；之后每小时检查一次（timer unref）；用 SQLite 在线 backup API；文件 `backups/aplus-YYYYMMDD-HHmmss.db`；保留最近 N 份（默认 7，设置页可改 1–60）；设置页可手动「立即备份」 | `src/main/backup.js` |
| 设置页 + 密钥加密 | 密钥只用 Electron `safeStorage`（Windows = DPAPI）加密后存 DB；**加密不可用时直接拒绝保存，绝不明文落盘**；renderer 只拿得到掩码（`••••` + 后 4 位）；解密失败显示「cannot decrypt」不崩 | `src/main/settings.js` |
| 可替换 AI provider | 注册表 `register/get/list`；契约 `generate({prompt, topic, settings, signal}) -> {text, model}`；现有 `pi-cli`（默认）和 `mock` | `src/main/providers/` |
| Pi Agent CLI provider | 见 §2 | `pi-cli.js` `launch.js` |
| 链路 | 生成页：输入主题 → 生成 → 审阅/修改标题正文 → 保存到内容库；内容库：列表/搜索 → 打开 → 修改（含状态 draft/approved）→ 保存/删除 | `src/renderer/` |
| 提示词业务规则 | NZ English；不承诺获批、不写「最低利率」或具体利率（除非主题里给了）；不编造客户评价或数据；结尾固定写 “General information only — not financial advice. Talk to an adviser about your situation.”；要求只返回 JSON `{title, body, hashtags}`，解析失败时整段输出当正文 | `src/main/prompt.js` |
| UI 风格 | 参照 V2：浅色后台、左侧深蓝导航（#1f3a5f）、青绿主按钮（#0f9d8a）、8px 圆角卡片、中英双语标签、字体包含 Microsoft YaHei | `src/renderer/styles.css` |

## 2. Pi CLI 调用（假设与依据）

- 包：`@mariozechner/pi-coding-agent` 0.73.1（bin `pi`）。我只在箱子上的 `/tmp` 里 `npm pack` 了这个包，用来读 `--help` 和源码；**没在箱子上登录 Pi，也没运行它**。
- 参数（默认，设置页全部可改）：
  `--provider openai-codex --model gpt-6.1-sol --thinking high --print --no-tools --no-extensions --no-skills --no-context-files --no-session`
  - 0.73.1 的 `--thinking` 只接受 `off|minimal|low|medium|high|xhigh`，没有旧 Dashboard 用的 “max”，所以默认用 `high`（Peggy 指定），也可以选 `xhigh`。
  - 超时默认 360 秒（沿用旧 `pi-codex-content.mjs`）。
- 默认路径：Windows 上是 `%APPDATA%\npm\pi.cmd`，在主进程里展开（大小写不敏感）；在其他系统上是 `pi`。
- **提示词默认从 stdin 传入**（`pi.promptVia=stdin`）。依据 0.73.1 源码：stdin 不是 TTY 时，pi 会把管道读到的内容当作消息，并进入 print 模式。也可以改成 `arg`，即旧的 `-p <prompt>` 写法。
- Windows 上 `.cmd` 不能在不经过 shell 的情况下 spawn（EINVAL），所以 `launchMode=auto` 时：
  1. **node-entry（首选）**：找 `<pi.cmd 所在目录>\node_modules\@mariozechner\pi-coding-agent\dist\cli.js`，用 app 自己的 exe 加 `ELECTRON_RUN_AS_NODE=1` 直接跑，不经过 cmd.exe。提示词放在 stdin 或 argv 都安全。
  2. **cmd-shim（兜底）**：`cmd.exe /d /s /c "<转义后的命令行>"`，`windowsVerbatimArguments`。参数按 cross-spawn 的方法转义：`^` 转义 `( ) % ! ^ " < > & |`，反斜杠和引号按 CommandLineToArgvW 规则处理。参数里有换行会直接拒绝；这种模式下**强制用 stdin 传提示词**。
  3. 也可以手动指定 `direct` 或 `cmd-shim`。
- spawn 一律用 `shell:false`、`windowsHide:true`（避免以前的黑色控制台窗口），`cwd=os.tmpdir()`（不让 Pi 读到项目上下文文件）。stdout 和 stderr 按 utf8 采集，各限 2 MB。超时时 Windows 用 `taskkill /T /F` 杀进程树，其他系统用 SIGKILL。出错信息带退出码和 stderr 最后 1000 字符。
- 输出从 stdout 读取，再用 `parseCopyOutput` 解析：先找第一个 JSON 对象（允许包在 ```json 代码块里），找不到就把整段输出当正文。

## 3. 测试（真实输出，Linux 箱子上跑）

```
$ npm run test:unit          # node --test 'test/unit/*.test.js'
ℹ tests 122
ℹ pass 122
ℹ fail 0
```
覆盖：db（CRUD、迁移幂等）、backup（假时钟判断是否到期、生成文件、只保留 N 份、备份文件是有效 SQLite 且含数据）、settings（safeStorage stub；DB 字节里没有明文；加密不可用时拒绝；掩码；解密失败兜底）、providers（注册表；mock；pi-cli 用假 CLI 测 stdin、argv、非零退出加 stderr、超时、空输出、超过 2 MB、取消；spawn 选项断言 `shell:false` 和 `windowsHide:true`）、launch（buildPiArgs；win32 的 node-entry、cmd-shim、direct；`%APPDATA%` 展开；quoteForCmd 覆盖 `"` `&` `|` `%VAR%` `^` `<` `>` `()`、结尾反斜杠、路径含空格、中文「首次置业 KiwiSaver」、换行拒绝；cmd-shim 强制 stdin）、prompt 解析、PE 校验。
完整输出：`docs/evidence/logs/unit-tests.txt`

```
$ xvfb-run -a -s "-screen 0 1400x1000x24" npm run test:e2e   # Playwright _electron，Linux 版 Electron
  ok   - A1 app opens on Create screen
  ok   - A2 automatic backup created on first start
  ok   - A3 switch provider to mock in Settings and save
  ok   - A4 enter topic and generate copy
  ok   - A5 review/edit title and body, save to library
  ok   - A6 library lists the saved item; open and edit it (status approved)
  ok   - A7 quit and relaunch the app with the same userData
  ok   - A8 content persists after restart (title, body, status)
  ok   - B1 configure pi-cli provider with fake Pi CLI path (direct, stdin)
  ok   - B2 generate through spawned fake Pi; prompt (incl. Chinese) delivered via stdin
E2E steps: 10 passed, 0 failed
```
完整输出：`docs/evidence/logs/e2e.txt`

### 截图（`docs/evidence/`，E2E 自动截取）
- `01-create-empty.png` 生成页（空）
- `02-generated.png` mock 生成后、审阅修改中
- `03-library.png` 内容库打开并修改（approved）
- `04-settings.png` 设置页（provider、Pi 参数、密钥、备份）
- `05-after-restart-library.png` 重启后内容仍在
- `06-pi-cli-fake-generated.png` 用 pi-cli 和假 Pi 生成（显示的正文是假 CLI 回显的提示词）

## 4. 安装包

```
$ scripts/build-win.sh        # = electron-builder --win nsis --x64 --publish never
release/APlusOperator-Setup-0.1.0.exe
  size   122,228,099 bytes (~117 MiB)
  sha256 f86ea39888a54dc9b0ea1a1e2aab89586a5b9890b86e5f1bb27a0230eebf36e3
release/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node
  sha256 2442992c114c9dcaa299c2495370f09a890e02706e96c642f9f8d61ce2998848
  scripts/check-pe.js -> PASS: PE32+ x86-64 DLL
  pefile -> machine 0x8664, optional-header magic 0x20b (PE32+), is_dll True,
            exports napi_register_module_v1 / node_api_module_get_api_version_v1
```
- 打包日志：`docs/evidence/logs/build-win.txt`；校验日志：`docs/evidence/logs/installer-verify.txt`。
- app.asar 里只有 `package.json` 和 `src/**`，加上生产依赖；不含测试、文档、日志。
- `file` 命令没法用：箱子的 apt 源访问失败（http 返回 500，https 的 SSL 中断），所以改用自写的 PE 头解析加 pip 装的 `pefile` 做两次独立校验。
- **Wine**：NSIS 生成卸载程序时要跑一个中间 exe，Linux 上通常靠 Wine。箱子上 apt 不可用；electron-builder 自带的便携 Wine 11（toolsets.wine 1.0.1）缺 `x86_64-windows` 的 DLL，起不来。解决办法是 `build/wine-shim/bin/wine`：它调用 electron-builder 自带的纯 JS `UninstallerReader`（electron-builder 在 macOS Catalina+ 上用的就是这个），从中间安装包里直接提取卸载程序，不执行任何 Windows 代码。**只在 Linux 打包时用**；在 Windows 上直接跑 `npx electron-builder --win nsis --x64 --publish never` 就行，不需要这个 shim。

## 5. 哪些是模拟或未验证

- mock provider 和假 Pi CLI（`test/fixtures/fake-pi.js`）：**没调用过真实的 Pi 或 GPT**。
- E2E 跑的是 Linux 版 Electron（xvfb），不是 Windows。
- Linux 上 `safeStorage` 后端是 `basic_text`，app 会判为「加密不可用」，并按设计拒绝保存密钥。所以 **DPAPI 加密只用 stub 做了单元测试，没在真 Windows 上测过**。
- 安装包**未签名**（没有证书），所以 Windows SmartScreen 会提示「未知发布者」。exe 的图标和版本信息也没写（`signAndEditExecutable:false`，避免依赖 Wine），用的是默认 Electron 图标。
- 安装包**没在 Windows 上安装过**。node-entry 和 cmd-shim 两种启动方式只做了参数构造的单元测试，没在 Windows 上真跑过。
- 每小时的备份 timer 只用假时钟做了单元测试，E2E 只验证了「首次启动就备份」。

## 6. Justin 在 Windows 上要做的（验收步骤）

1. 把 `release/APlusOperator-Setup-0.1.0.exe` 拷到 Windows 电脑（核对 sha256 `f86ea398…36e3`），双击安装。SmartScreen 提示时选「更多信息 → 仍要运行」。
2. 打开 A Plus Operator → **设置 Settings**：
   - Provider 选 `Pi Agent CLI`。
   - Pi 路径：默认 `%APPDATA%\npm\pi.cmd`。如果 Pi 装在别处，填实际路径（`where pi` 可以查）。
   - provider `openai-codex`、model `gpt-6.1-sol`、thinking `high`、timeout `360`、launch mode `auto`、prompt via `stdin`。
   - 保存。
   - 这台 Windows 的 Pi 要事先已登录 openai-codex（Pi 用它自己的登录，app 不存这个凭据）。
3. **生成 Create**：输入一个真实主题 → 生成 → 改几个字 → 「保存到内容库」。
   - 如果失败：把错误信息截图发回来（含退出码和 stderr 尾部）。可以先试把 launch mode 改成 `cmd-shim`，或者把 prompt via 改成 `arg`。
4. 内容库里打开这篇，再改一下保存。**完全退出 app，再重新打开**，确认内容还在。
5. 设置页的备份区应该显示 1 份备份（`%APPDATA%\A Plus Operator\backups\`）。可以点「立即备份」再看一次。
6. 可选：在「密钥 Secrets」里存一个测试值，确认 Encryption 显示 available（DPAPI），列表里只显示掩码。
7. 如果启动失败：会弹出错误框，并写 `%APPDATA%\A Plus Operator\startup-error.log`。

## 7. 已知风险

- **node-entry 模式**用 Electron 内置的 Node 跑 Pi。Pi 要求 Node ≥20.6，Electron 45 内置的 Node 满足；但如果 Pi 依赖用 `npm -g` 装在 Windows 系统 Node 下编译的原生模块，可能不兼容。这种情况改用 `cmd-shim`，它会走系统 Node。
- 如果 Pi 0.73.1 之后改了 stdin 和 print 模式的行为，就改用 `promptVia=arg`。node-entry 下 argv 能安全带换行和中文；cmd-shim 下不行，所以会强制用 stdin。
- `ELECTRON_RUN_AS_NODE` 需要 Electron 的 runAsNode fuse 开着（默认是开的）。以后如果为了安全关掉这个 fuse，node-entry 就会失效。
- 安装包约 117 MiB，大部分是 Electron 本体。没签名会有 SmartScreen 提示。没设置图标。
- 备份保留 N 份是按文件名里的时间戳排序；手动改名的文件也会被算进去。
- 箱子上的 E2E 不能替代 Windows 实测；阶段 D 也明确规定「开发机测试不能当交付证据」。

## 8. Codex 使用记录

- CLI：`CODEX_HOME=~/.codex-allen codex exec --skip-git-repo-check -s workspace-write`（Allen 账户），model `gpt-6.1-sol`，reasoning effort 为默认值（日志显示 none）。
- 第 1 轮：按 `docs/B1-SPEC.md` 实现全部文件和单元测试，**47,582 tokens**，没遇到额度报错。问题是代码写成了压缩成一行的风格，没法审。
- 第 2 轮：改成可读格式，把单元测试拆细（扩到 121 个），加 Windows 转义和 spawn 选项的测试，修 UI（侧栏、本地时间、切换标签时清掉 toast）。**122,279 tokens**，没遇到额度报错。
- **Codex 写的**：`src/**`、`test/unit/**`、`test/fixtures/fake-pi.js`、`scripts/check-pe.js`、`electron-builder.yml` 初版。
- **我（Codex工程）写的或改的**：`docs/B1-SPEC.md`、`package.json` 初版和 `.gitignore`、依赖安装、`electron-builder.yml` 的 files 过滤、`build/wine-shim/`、`scripts/build-win.sh`；E2E 重写（加了正文修改、内容库二次修改、状态持久化、假 Pi 场景，加 `--disable-gpu` 解决 xvfb 截图失败）；侧栏 CSS 修正；启动失败写日志并弹窗；`listSecrets` 解密失败兜底，外加 1 个单元测试；所有打包、校验和本回执。
- Codex 的会话日志在 `.tmp/`（已 gitignore，不提交）。

## 9. 复现命令

```
npm ci && node node_modules/electron/install.js   # npm 11 的 allowScripts 可能拦住 electron 的 postinstall，需要手动下载 Electron 二进制
npm run test:unit
xvfb-run -a -s "-screen 0 1400x1000x24" npm run test:e2e
scripts/build-win.sh
node scripts/check-pe.js release/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node
```
