**English** | [中文](README.zh-CN.md)

# DSH Desktop

A Windows desktop shell for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): **double-click to run**, with a built-in plugin marketplace.

![DSH Desktop main window](docs/screenshot-desktop.png)

## Features

- **Double-click to run** — no terminal needed; native window, menu bar and icon.
- **One data directory, shared with the CLI and the browser UI** — the app neither copies nor modifies DSH: it launches the DSH already installed on your machine against the same `DSH_HOME`. Chat history, settings, API keys and plugins are all shared, so you can pick up a conversation anywhere.
- **Built-in plugin marketplace** — search, install and remove DSH plugins from Settings. Everything you install is visible from both the desktop app and the browser UI.
- **Failures are visible** — if startup fails you get a status page listing DSH_HOME, the node and dsh paths, the working directory and the full log, instead of a blank white window.
- **Portable** — the whole folder can be copied to another drive or a USB stick. Delete it to uninstall; your DSH data is untouched.

## Requirements

DSH Desktop is a shell: it launches the **DSH installed on your machine**. So you need:

| Requirement | Notes |
|---|---|
| Windows | 10 / 11 (x64) |
| [Node.js](https://nodejs.org/) | 20 or newer. **Building from source** needs 22.12+ — see [that section](#build-from-source) |
| DeepSeek Harness | `npm i -g @deepseek-ai/dsh` |
| DeepSeek API key | Configured in the UI on first launch |

You can verify DSH itself works before installing anything:

```powershell
npm i -g @deepseek-ai/dsh
dsh web
```

If the DSH web UI opens, your environment is fine. Close it again.

## Install

### Option 1: download a build (recommended)

1. Download `DSH-Desktop-win32-x64.zip` from the **Releases** page;
2. Extract it anywhere, for example `D:\DSH Desktop`;
3. Double-click `DSH Desktop.exe`;
4. For a desktop shortcut, double-click `创建桌面快捷方式.cmd` ("create desktop shortcut") in the same folder.

On first launch you will see "Starting DSH…" for a few seconds, then the DSH UI. If this is a brand-new environment (no DSH config directory yet), the app initialises the profile for you — that step is local only and does not touch the network.

### Option 2: build from source

See [Build from source](#build-from-source) below.

## Usage

### Plugin marketplace

**Settings → Plugins → Plugin market** (or the menu `DSH → Open plugin market`, or `Ctrl+Shift+P`).

![Plugin marketplace](docs/screenshot-plugin-market.png)

- **Installed plugins** — lists the current profile's plugin dependencies with their versions and whether they are loaded, plus one-click removal;
- **Community plugins** — searches npm for DSH-related packages (results are filtered by DSH keywords), with one-click install;
- pnpm output is streamed live while installing; when it finishes you are asked to restart — click "Restart now".

Installs use exactly the same mechanism as `dsh plugin --profile web add <package>`: they write the profile's `package.json` dependency and reconcile `dsh.profile.bundles`. So plugins installed from the command line show up here, and vice versa.

### Menu

| Menu item | What it does |
|---|---|
| DSH → Open plugin market | Jumps to Settings → Plugins → Plugin market |
| DSH → Reload UI | Refreshes the page |
| DSH → Open in browser | Opens the current instance in your default browser |
| DSH → Restart DSH service | Makes newly installed plugins take effect |
| DSH → Choose working directory… | Changes the agent's workspace root (defaults to your home directory) |
| DSH → Open log file | First place to look when startup fails |
| DSH → Open DSH data directory | Opens `~/.dsh` |
| DSH → Reinstall plugin market plugin | Repairs a missing or broken marketplace |
| DSH → Remove plugin market plugin | Cleanly removes this plugin from the profile |
| View → Developer tools | For debugging the UI |

### Where the data lives

The app has no data directory of its own — everything is under DSH's `~/.dsh`:

| Content | Location |
|---|---|
| Chat history | `~/.dsh/sessions` |
| Settings | `~/.dsh/settings.yaml` |
| API key | `~/.dsh/.credentials.yaml` |
| Plugins | `~/.dsh/profiles/web` |
| Attachments | `~/.dsh/attachments` |

The app itself only remembers the window position and the last working directory, kept in `%APPDATA%\DSH Desktop\desktop-state.json`; logs are in `logs\dsh-web.log` next to it (rotated past 2 MB).

> The app spawns its own DSH server process on a random loopback port, with a one-time token in its URL.
> If you also have `dsh web` running, two processes will read and write the same `DSH_HOME` — the data is
> still a single copy, but there is no reason to run both.

## Troubleshooting

**"No installed @deepseek-ai/dsh found"**
DSH Desktop only reuses an existing DSH installation; it never installs one itself. Run `npm i -g @deepseek-ai/dsh` and retry. If DSH lives somewhere unusual, point `DSH_CLI` at its `lib/bin.js` and `DSH_NODE_BIN` at your `node.exe`.

**The marketplace says "pnpm not found"**
This does not happen when launched from the desktop app (it bundles pnpm). The browser-only version started with `dsh web` needs pnpm on `PATH` (`npm i -g pnpm`) or corepack (`corepack enable pnpm`).

**I installed a plugin but nothing changed**
Plugins are composed into DSH's loader at startup, so a restart is required: menu **DSH → Restart DSH service**, then refresh as prompted.

**Removing the marketplace completely**
Use the menu **DSH → Remove plugin market plugin**, or delete these manually:

- the `# ── 插件市场` block in `~/.dsh/profiles/web/cordis.patch.yml`;
- the `dsh-plugin-market` dependency in `~/.dsh/profiles/web/package.json`;
- `~/.dsh/profiles/web/node_modules/dsh-plugin-market`;
- `~/.dsh/plugins/dsh-plugin-market`.

Every modification leaves a `*.dsh-desktop-backup` copy you can rename back. To remove the app itself, delete the whole `dist/DSH Desktop` folder — your DSH data is unaffected.

## Build from source

If you only want to use it, skip this section — downloading the zip from Releases is easier. The rest is for people who want to build it themselves or change the code.

### Full walkthrough (copy & paste)

Open PowerShell and paste the whole block. **If all you want is the exe, this is everything:**

```powershell
# 1) Check the environment (building needs Node >= 22.12)
node -v
git --version

# 2) Get the code
git clone https://github.com/LeeJazen/dsh-desktop.git
cd dsh-desktop

# 3) Install dependencies (downloads the Electron runtime, ~150 MB)
#    In China, set the mirror first — it is much faster:
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install

# 4) Build
npm run dist

# 5) Check the output; optionally create a desktop shortcut
dir "dist\DSH Desktop\DSH Desktop.exe"
npm run shortcut
```

When it finishes, `dist\DSH Desktop\` holds a portable build you can double-click.

> You can delete the mirror line in step 3 — it still works, just much slower (or it times out) on some networks.

**Changing the code?** Replace step 4 with dev mode:

```powershell
npm start
```

The sections below explain what each command does, what it needs, and how to diagnose failures.

### 1. Check the environment

| Item | Requirement | Notes |
|---|---|---|
| Windows | 10 / 11 (x64) | Only this platform is built today |
| **Node.js** | **>= 22.12** | A hard requirement of Electron 44 (its `package.json` declares `engines.node >= 22.12.0`). Check with `node -v`. Note this is stricter than running a downloaded build, where Node 20 is enough |
| Git | Any recent version | Used to fetch the code; you can also download a ZIP, see the next step |
| DeepSeek Harness | `npm i -g @deepseek-ai/dsh` | Only needed for `npm start` (dev mode); a plain `npm run dist` does not need it |
| Disk space | **~1 GB free** | ~420 MB dependencies + ~390 MB build output + ~150 MB Electron download cache |

### 2. Get the code

```powershell
git clone https://github.com/LeeJazen/dsh-desktop.git
cd dsh-desktop
```

Without Git, click **Code → Download ZIP** on the repository page and extract it — same result.

### 3. Install dependencies

```powershell
npm install
```

This does two things:

1. Downloads the **dependency packages** `electron`, `resedit` and `pnpm` from npm;
2. Runs the `postinstall` hook, which downloads the **Electron runtime (~150 MB)** and extracts it to `node_modules/electron/dist`.

Afterwards `node_modules/` is about 420 MB. How long it takes depends mostly on your download speed (a few minutes up to ~15 minutes is normal).

**What you will see** (excerpt):

```
> dsh-desktop@0.1.1 postinstall
> node tools/ensure-electron.mjs

Electron runtime is missing, downloading it now (~150 MB, one time only)…
Electron runtime is ready (44.3.0)
added 173 packages in 9s
```

> **Note**: this step does **not** download this project's code — that came from `git clone` above.
> `npm install` only installs dependencies.

If downloading Electron is slow or times out, set the mirror first:

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

If the download was interrupted, or `node_modules/electron/dist` is empty, fetch it separately:

```powershell
node tools/ensure-electron.mjs
```

### 4. Build

```powershell
npm run dist
```

The build script (`tools/build-app.mjs`) runs the phases below and **prints every one of them**, so a failure tells you exactly where it stopped:

```
── 环境自检 ─────────────────────────────
  node        v24.16.0  win32/x64
  仓库根      D:\dsh-desktop
  有   package.json
  有   build/icon.ico
  有   electron/main.js
  有   plugin-market/package.json
  有   node_modules / node_modules/electron / node_modules/electron/dist
  有   node_modules/pnpm / node_modules/resedit
─────────────────────────────────────────
• 检查 Electron 运行时
• 清理 dist\DSH Desktop
• 复制 Electron 运行时
• 重命名 electron.exe
• 摆放 resources/app
• 随包分发 pnpm（插件市场安装插件用）
• 写入 exe 图标与版本信息
• 写入使用说明与快捷方式脚本
• 统计产物体积

打包完成：D:\dsh-desktop\dist\DSH Desktop
可执行文件：D:\dsh-desktop\dist\DSH Desktop\DSH Desktop.exe
产物体积：387 MB
```

The script prints its progress in Chinese, one line per phase. In order those lines mean: environment check → checking the Electron runtime → cleaning the output directory → copying the runtime → renaming the exe → laying out `resources/app` → bundling pnpm (used by the marketplace) → writing the exe icon and version info → writing the bundled readme and shortcut script → measuring the output.

The result is in `dist\DSH Desktop\`; double-click `DSH Desktop.exe` to run it (the first launch shows "Starting DSH…" for a few seconds).

To produce a zip you can hand out (the same file the Releases page serves):

```powershell
Compress-Archive -Path "dist\DSH Desktop" -DestinationPath "DSH-Desktop-win32-x64.zip"
```

### 5. Changing the code: dev mode

```powershell
npm start
```

This starts the app in dev mode; restart it to pick up changes under `electron/`.
The app's own state and logs live in `%APPDATA%\DSH Desktop\` (log: `logs\dsh-web.log`).

`plugin-market/lib/client.js` (the marketplace's browser half) is a special case: it is a hand-written
`window.__ModuleLoader__.load` bundle with no build step, but changes only take effect after **restarting the DSH service and refreshing the page**.

### Command reference

| Command | Downloads | What it does | Needs DSH installed |
|---|---|---|---|
| `npm install` | Electron (~150 MB), resedit, pnpm | Installs into `node_modules/` (~420 MB) | No |
| `npm run dist` | — | Builds `dist\DSH Desktop` | No |
| `npm start` | — | Runs the app in dev mode | **Yes** |
| `npm run icon` | — | Regenerates `build/icon.ico` using the sharp bundled with DSH | **Yes** |
| `npm run shortcut` | — | Creates a desktop shortcut | No |

**Just want the exe?** Two commands are enough:

```powershell
npm install
npm run dist
```

> CI uses `npm ci` (installs strictly from `package-lock.json`, deleting `node_modules` first).
> `npm install` is fine for everyday work. If you change dependencies, commit the updated
> `package-lock.json` too, or CI will fail.

### Build troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm install` hangs downloading Electron, or times out | Set `ELECTRON_MIRROR` and retry (step 3). Alternatively install on a machine with good connectivity, then copy the whole folder over |
| Build fails with a `检查 Electron 运行时` ("checking the Electron runtime") phase | The Electron runtime never downloaded. Fetch it manually with `node tools/ensure-electron.mjs`, then run `npm run dist` again |
| Any build error mentioning a phase | The script prints the failing phase together with an environment check — read those lines to locate it |
| `npm start` shows the "DSH failed to start" status page | The app could not find a local DSH. Run `npm i -g @deepseek-ai/dsh`; if it lives in an unusual place, point `DSH_CLI` at its `lib/bin.js` and `DSH_NODE_BIN` at `node.exe` |
| `npm run icon` cannot find sharp | That command borrows sharp from DSH, so DSH must be installed. `build/icon.ico` is committed, so you never need it unless you are changing the icon |
| `EPERM` or named-pipe errors at startup | Electron needs inter-process named pipes; do not run it inside a strictly sandboxed terminal (some security suites and restricted containers block this) |
| Antivirus flags the build, or it is very slow | The output is ~390 MB with thousands of files, so real-time scanning slows it down noticeably |

### Verifying a build

The repository ships a screenshot and diagnostic helper that launches the app, waits for the page to settle, takes a screenshot and prints the app's most recent log lines:

```powershell
node tools/verify/capture.mjs --market      # open the plugin marketplace and screenshot it
node tools/verify/capture.mjs               # screenshot the main window
node tools/verify/capture.mjs --dev         # verify dev mode (uses the electron in node_modules)
node tools/verify/capture.mjs --out shot.png --delay 15000   # custom output path and delay
```

### Debug environment variables

| Variable | Effect |
|---|---|
| `ELECTRON_MIRROR` | Alternative download source for the Electron runtime (npmmirror is recommended in China) |
| `DSH_DESKTOP_NO_PROVISION=1` | Do not install the plugin marketplace into the profile at startup |
| `DSH_DESKTOP_USER_DATA=<dir>` | Move the app's own state directory (portable mode / testing) |
| `DSH_DESKTOP_CAPTURE=<png>` | Verification hook: screenshot once the page settles, then exit |
| `DSH_DESKTOP_CAPTURE_SCRIPT=<js>` | A page script to run before that screenshot |
| `DSH_CLI` / `DSH_NODE_BIN` | Point at a specific DSH entry point / `node.exe` |

## Repository layout

```
.
├─ electron/                  Desktop main process
│   ├─ main.js                Window, menu, child process, startup URL capture, status pages
│   ├─ preload.js             Minimal IPC bridge, used only by the status pages
│   ├─ loading.html / error.html / status.css / status.js
│   └─ lib/
│       ├─ locate.js          Finds node / dsh CLI / pnpm / DSH_HOME
│       ├─ dsh-server.js      Hosts `dsh --profile web` and parses the startup URL
│       └─ provision.js       Idempotently installs the marketplace into the profile (backups + fingerprint sync)
├─ plugin-market/             The "plugin marketplace" DSH plugin (host + browser halves, no build step)
├─ tools/
│   ├─ make-icon.mjs          Generates build/icon.ico
│   ├─ ensure-electron.mjs    Downloads the Electron runtime when it is missing
│   ├─ build-app.mjs          Builds the portable bundle (copies the runtime, writes icon/version with resedit)
│   ├─ create-shortcut.ps1    Creates a desktop shortcut
│   └─ verify/                Automated verification helper and injected page scripts
├─ build/icon.ico             Application icon
├─ docs/                      Screenshots and release notes
└─ .github/workflows/         CI: build and attach the release asset
```

## Implementation notes

- **Why the startup URL has to be captured**: every DSH web process generates a one-time token, and only the line it prints at startup — `dsh web: http://127.0.0.1:<port>/?token=...` — can be exchanged for a signed cookie. The app therefore watches the child process output, parses that URL and loads it, rather than constructing an address itself.
- **Why the system node is used**: DSH depends on native modules compiled against the Node ABI (sharp, node-pty, …). Electron ships a different ABI, so the child process runs the real `node.exe`.
- **How the marketplace talks to the host**: over same-origin HTTP routes on `dsh-host-webserver` (`/plugin-market/*`) rather than Typert Remote — installs are long-running and need streamed pnpm output. Those routes accept only loopback, same-origin requests, using the same checks as the `/api` browser-trust fence.
- **How the plugin is distributed**: sources live in `~/.dsh/plugins/dsh-plugin-market`, a junction is created under the profile's `node_modules` (matching DSH's own hoisted layout), and one loader entry is inserted into `cordis.patch.yml`. Rewrites are decided by a content fingerprint, so editing code without bumping the version still syncs.
- **Why not electron-builder or @electron/packager**: electron-builder needs the NSIS / winCodeSign toolchain, and `@electron/packager` verifies the runtime archive over the network on every run, hanging when the network hiccups. The current approach copies `node_modules/electron/dist` directly and uses `resedit` to write the icon and version info — a few dozen lines, offline and repeatable.

## Known limitations

- Only **win32-x64** is built; other platforms need their own Electron runtime and a tweak to `tools/build-app.mjs`.
- After installing or removing a plugin you must **restart the DSH service** (the profile's bundle list is read at startup).
- Community plugin search needs the npm registry; offline, only the installed list is available.
- On first launch, if DSH is initialising its profile, startup can take tens of seconds; past three minutes the app reports an error together with the log.

## License

[MIT](LICENSE). The whale mark in the app icon comes from the `favicon.svg` shipped with the DeepSeek Harness frontend (MIT) and is used only to indicate that this is a DSH desktop shell — it is **not an official DeepSeek release**.
The build bundles the Electron runtime; its full license texts are in `LICENSE` and `LICENSES.chromium.html` inside the output folder.
