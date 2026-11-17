# B1 task card — A Plus Operator skeleton (spec for implementer)

Minimal **Windows-targeted Electron app** "A Plus Operator" for A Plus Finance (NZ loan/mortgage broker; operator Becky).
Plain CommonJS JavaScript, no bundler, no TypeScript, no UI framework. Keep dependencies minimal:
runtime dep `better-sqlite3@13.2.0` only; devDeps `electron@45.3.3`, `electron-builder@26.18.0`, `playwright@1.65.1`.
Unit tests use the built-in `node:test` + `node:assert` (no vitest/jest).

## Layout
```
package.json            name aplus-operator, productName "A Plus Operator", main src/main/main.js
electron-builder.yml
.gitignore              node_modules/ release/ dist/ *.db *.db-* .env .env.* !.env.example test-results/ .tmp/
src/main/main.js        app bootstrap, BrowserWindow (contextIsolation:true, nodeIntegration:false, sandbox:true, preload)
src/main/preload.js     contextBridge.exposeInMainWorld('aplus', {...}) — only whitelisted ipcRenderer.invoke channels
src/main/ipc.js         registers ipcMain.handle handlers; validates inputs (strings, lengths)
src/main/db.js          openDatabase(filePath) -> repo object; schema migration via PRAGMA user_version
src/main/backup.js      BackupManager
src/main/settings.js    SettingsStore (plain settings JSON in DB table `settings`, secrets encrypted)
src/main/providers/index.js     provider registry
src/main/providers/mock.js      deterministic mock provider
src/main/providers/pi-cli.js    Pi Agent CLI provider
src/main/providers/launch.js    pure functions: buildPiArgs, resolveLaunch, quoteForCmd (Windows cmd.exe escaping)
src/main/prompt.js      buildCopyPrompt(topic, options) + parseCopyOutput(stdout)
src/renderer/index.html, styles.css, app.js   (CSP meta: default-src 'self'; no inline scripts)
test/unit/*.test.js
test/fixtures/fake-pi.js        fake CLI used by tests
test/e2e/app.e2e.js             Playwright _electron end-to-end
scripts/check-pe.js             verifies a .node file is PE32+ x86-64 DLL (parse headers; `file` is not installed on the box)
```
npm scripts: `start` (electron .), `test:unit` (node --test test/unit), `test:e2e` (node test/e2e/app.e2e.js), `dist:win` (electron-builder --win nsis --x64).

## 1. Electron skeleton
- `app.requestSingleInstanceLock()`.
- userData override: if env `APLUS_USER_DATA_DIR` is set, call `app.setPath('userData', it)` before ready (used by tests).
- DB file: `<userData>/aplus-operator.db`. Backups: `<userData>/backups/`.
- All renderer<->main via `ipcMain.handle` / `ipcRenderer.invoke`. Channels:
  `content:list`, `content:get`, `content:create`, `content:update`, `content:delete`,
  `ai:generate` ({topic, platform, tone}) -> {title, body, provider, model},
  `ai:providers` -> [{id,label}],
  `settings:get` -> settings with secrets masked, `settings:save`, `secrets:set` ({name,value}), `secrets:clear` ({name}),
  `secrets:status` -> {encryptionAvailable, backend, names:[{name, masked}]},
  `backup:status` -> {lastBackupAt, count, dir}, `backup:now`,
  `app:info` -> {version, userData, platform}.
- No `remote`, no `shell.openExternal` of untrusted URLs, deny new windows (`setWindowOpenHandler` -> deny), block navigation.

## 2. SQLite (better-sqlite3)
Tables: `contents(id INTEGER PK, topic TEXT, title TEXT, body TEXT, platform TEXT, status TEXT CHECK in ('draft','approved'), provider TEXT, model TEXT, created_at TEXT, updated_at TEXT)`,
`settings(key TEXT PK, value TEXT)`, `secrets(name TEXT PK, ciphertext BLOB, updated_at TEXT)`, `meta(key TEXT PK, value TEXT)`.
WAL mode, foreign_keys on. Repo functions: listContents({search?}), getContent(id), createContent(obj), updateContent(id, patch), deleteContent(id).

## 3. Daily backup — BackupManager({db, dir, keep=7, now=()=>new Date(), intervalMs=60*60*1000})
- `latestBackupTime()` from newest file `aplus-YYYYMMDD-HHmmss.db` in dir (parse name; fall back to mtime).
- `isDue()` true if no backup or newest older than 24h.
- `runBackup()` uses `db.backup(target)` (online backup API, await it) to `aplus-<stamp>.db`, then prune to `keep` newest; records `meta.last_backup_at`.
- `start()`: run once if due, then `setInterval(check, intervalMs)` (unref'd); `stop()`.
- Settings: backup keep count configurable (`backup.keep`, default 7, 1..60).

## 4. Settings + secrets
- SettingsStore({db, safeStorage}) — `safeStorage` is injected (Electron's in app, a stub in tests).
- Non-secret settings (JSON values): `ai.provider` (default `pi-cli`), `pi.path` (default on win32 `%APPDATA%\npm\pi.cmd` expanded from process.env.APPDATA; else `pi`),
  `pi.provider` (default `openai-codex`), `pi.model` (default `gpt-6.1-sol`), `pi.thinking` (default `high`; allowed off|minimal|low|medium|high|xhigh),
  `pi.timeoutSec` (default 360, range 10..1800), `pi.launchMode` (`auto`|`node-entry`|`cmd-shim`|`direct`, default `auto`),
  `pi.promptVia` (`stdin`|`arg`, default `stdin`), `pi.extraArgs` (string, default ''), `brand.name` (default 'A Plus Finance'), `backup.keep`.
- Secrets: `setSecret(name, value)` -> if `!safeStorage.isEncryptionAvailable()` throw (NEVER fall back to plaintext). Store `safeStorage.encryptString(value)` buffer.
  `getSecret(name)` decrypts (main process only). `listSecrets()` -> names + masked value (`••••` + last 4 chars, or `••••` when length<8). Plain value never returned over IPC.
  Report `safeStorage.getSelectedStorageBackend?.()` when available (Linux) else 'dpapi' on win32.
- Secret names allowed: /^[a-z0-9_.-]{1,64}$/i. Example slot in UI: `openai.apiKey` (reserved for a future provider; Pi uses its own login).
- Never log secret values.

## 5. Provider registry
`registry.register(provider)`, `registry.get(id)`, `registry.list()`. Provider contract:
`{ id, label, async generate({prompt, topic, settings, signal}) -> {text, model} }`.
- `mock`: returns deterministic text containing the topic, e.g. JSON {"title":"Mock: <topic>","body":"..."} after ~200 ms. model 'mock-1'.
- `pi-cli`: uses `launch.js` + `child_process.spawn` with `{ shell:false, windowsHide:true, stdio:['pipe','pipe','pipe'] }`, cwd = os.tmpdir()
  (so Pi doesn't pick up project context files), utf8 stdout/stderr capture (cap 2 MB each), timeout from settings -> kill (on win32 use
  `taskkill /pid <pid> /T /F` spawned with windowsHide; elsewhere SIGKILL), rejects with Error containing exit code + last 1000 chars of stderr.
  Non-zero exit or empty stdout -> error. If `promptVia==='stdin'` write prompt to stdin then end(); else end() stdin immediately.

### launch.js (pure, unit-tested; inject platform/env/existsSync/execPath)
- `buildPiArgs(cfg, prompt)` -> `['--provider', cfg.provider, '--model', cfg.model, '--thinking', cfg.thinking, '--print', '--no-tools', '--no-extensions', '--no-skills', '--no-context-files', '--no-session', ...splitExtraArgs(cfg.extraArgs)]` and, only when promptVia==='arg', the prompt appended as the last positional arg.
  (Pi 0.73.1 `--help`: `--print, -p` is non-interactive mode, prompt is a positional message, piped stdin is read as the message when stdin is not a TTY.)
- `resolveLaunch({cfg, prompt, platform, env, execPath, existsSync})` -> `{command, args, env, windowsVerbatimArguments, promptVia, strategy}`:
  - expand `%VAR%` in cfg.path on win32 using env (case-insensitive lookup).
  - On win32 when path ends with .cmd/.bat (case-insensitive) and launchMode is auto|node-entry: look for
    `<dir(path)>\node_modules\@mariozechner\pi-coding-agent\dist\cli.js`; if it exists -> strategy `node-entry`: command = execPath (Electron binary), args = [cliJs, ...piArgs],
    env adds `ELECTRON_RUN_AS_NODE=1`. If launchMode is node-entry and not found -> throw clear error.
  - Else for .cmd/.bat on win32 (auto fallback or cmd-shim): strategy `cmd-shim`: command = env.ComSpec || 'cmd.exe', args = ['/d','/s','/c', '"' + [quoteForCmd(path), ...piArgs.map(quoteForCmd)].join(' ') + '"'],
    windowsVerbatimArguments = true, and **promptVia forced to 'stdin'** (cmd.exe cannot carry newlines in arguments; stdin carries any text safely).
  - Else strategy `direct`: command = expanded path, args = piArgs.
  - Use win32 path functions (`path.win32`) when platform==='win32' regardless of host OS so tests run on Linux.
- `quoteForCmd(arg)`: cross-spawn style — escape for CommandLineToArgvW (double backslashes before quotes, wrap in quotes, escape `"` as `\"`), then escape cmd metachars `( ) % ! ^ " < > & |` with `^`. Reject args containing `\r` or `\n` (throw) since they cannot pass through cmd.exe.

## 6. Prompt (src/main/prompt.js)
`buildCopyPrompt({topic, platform, tone, brandName})` returns an English prompt asking for one social post for A Plus Finance (NZ) about the topic.
Business rules to include (from frozen Dashboard V2 review: brand/compliance rules): NZ English; no guaranteed approval, no "lowest rate" or specific rate promises unless given in the topic; no fabricated testimonials/stats; friendly professional tone; end with a short line "General information only — not financial advice. Talk to an adviser about your situation."; return ONLY JSON `{"title": "...", "body": "...", "hashtags": ["..."]}`.
`parseCopyOutput(stdout)`: find the first JSON object in stdout (tolerate ```json fences and surrounding text); if valid -> {title, body (+ "\n\n" + hashtags joined by space if any)}; otherwise {title: topic-based fallback, body: stdout.trim()}.

## 7. Renderer UI (single page, three tabs: 生成 Create / 内容库 Library / 设置 Settings)
Style borrowed from Dashboard V2: clean light admin UI, left sidebar nav with brand "A Plus Operator", navy primary (#1f3a5f), accent teal (#0f9d8a), cards with 8px radius, system font stack incl. "Microsoft YaHei". Labels bilingual Chinese/English short.
- Create: topic input (id `topic`), platform select (Facebook/Instagram/LinkedIn; id `platform`), tone select, button `#generate`. Shows provider/model badge, spinner, errors (`#error`).
  After generation shows editable `#draft-title` input and `#draft-body` textarea, buttons `#save-draft` ("保存到内容库") and `#regenerate`. Save -> content:create status draft, toast `#toast` "已保存".
- Library: search box, list `#library-list` of items (`.library-item` with title, platform, status, updated time). Click opens editor (`#edit-title`, `#edit-body`, status select `#edit-status`, `#save-edit`, `#delete-item` with confirm).
- Settings: AI provider select `#ai-provider` (from ai:providers), Pi fields (`#pi-path`, `#pi-provider`, `#pi-model`, `#pi-thinking`, `#pi-timeout`, `#pi-launch-mode`, `#pi-prompt-via`, `#pi-extra-args`), backup keep `#backup-keep`, `#save-settings`.
  Secrets section: shows encryption status/backend; input `#secret-name` / `#secret-value` (type=password), `#save-secret`, list of saved secrets with masked value and Clear button. Backup section: last backup time, count, folder, `#backup-now`.
- Use textContent (never innerHTML with data).

## 8. electron-builder.yml
appId `nz.aplusfinance.operator`, productName `A Plus Operator`, directories.output `release`, files: src/**, package.json; `asar: true`, `asarUnpack: ["node_modules/better-sqlite3/**"]`,
`npmRebuild: false` (better-sqlite3 13 ships N-API prebuilds incl. prebuilds/win32-x64.node, ABI-stable, no rebuild needed),
`publish: null` (never publish), win: target nsis x64, `signAndEditExecutable: false` (so no wine needed on Linux; exe is unsigned), nsis: oneClick false, perMachine false, allowToChangeInstallationDirectory true, artifactName `APlusOperator-Setup-${version}.${ext}`.
Exclude other platforms' prebuilds is optional.

## 9. Tests
- unit: db (CRUD, migration idempotent), backup (fake clock: due logic, creates file, prune keeps N, backup file is a valid sqlite db containing rows), settings (stub safeStorage that XORs/base64 with a prefix; secret never stored as plaintext in DB bytes; throws when encryption unavailable; masked listing), providers (registry; mock; pi-cli with `test/fixtures/fake-pi.js` via `direct` strategy using process.execPath? -> on Linux set pi.path to a small executable shell-less node script with shebang `#!/usr/bin/env node`, chmod +x in test) covering: success stdout, stdin prompt received (fake echoes stdin back inside JSON), args received, non-zero exit + stderr captured, timeout kill, empty output error), launch (buildPiArgs; resolveLaunch for win32 node-entry / cmd-shim / direct / %APPDATA% expansion; quoteForCmd with quotes, &, |, %, ^, spaces, Chinese text; newline rejection; cmd-shim forces stdin), prompt parse.
- unit tests must run under plain Node (`node --test`) — keep electron imports out of db/backup/settings/providers modules (inject dependencies). better-sqlite3 13 is N-API so the same binary works in Node and Electron.
- e2e (test/e2e/app.e2e.js, plain node script using `require('playwright')._electron`): fresh temp userData via APLUS_USER_DATA_DIR; launch; go Settings, select provider `mock`, save; Create: topic "首次置业 First home buyer tips & KiwiSaver", generate, edit title (append " (edited)"), save; screenshot each screen to docs/evidence/ (01-create-empty.png, 02-generated.png, 03-library.png, 04-settings.png, 05-after-restart-library.png); close; relaunch with same userData; assert library contains the edited title and body; open it and verify. Also assert a backup file exists in userData/backups after first launch. Print a PASS/FAIL summary and exit non-zero on failure. Launch with `args: ['.', '--no-sandbox']` env passing through APLUS_USER_DATA_DIR.
