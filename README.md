# DSH Desktop

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）包成一个**双击就能运行**的 Windows 桌面端，并额外送一个**插件市场**。

- 桌面端**不复制、不修改** DSH：它启动的是本机已安装的那一份，用同一个 `DSH_HOME`。
- 所以会话历史、设置、API Key、插件与命令行 `dsh web`、浏览器 UI **完全共享同一份数据**。
- 插件市场是真正的 DSH 插件（宿主半边 + 浏览器半边），装进当前 `web` profile，
  桌面端和浏览器里都能看到，装的插件两边都能用。

| 桌面端主界面 | 插件市场 |
|---|---|
| ![桌面端](docs/screenshot-desktop.png) | ![插件市场](docs/screenshot-plugin-market.png) |

启动失败时会显示可直接排查的状态页（含 DSH_HOME / node / dsh CLI / 工作目录与完整日志），
不会只留一个白屏。

---

## 快速开始

**前提：本机已经装好 DSH。**

```powershell
npm i -g @deepseek-ai/dsh
dsh web          # 能跑起来就说明环境 OK（可选）
```

**然后二选一：**

- **用现成产物**：下载 Release 里的 `DSH-Desktop-win32-x64.zip`，解压，双击 `DSH Desktop.exe`。
- **自己构建**：见下面「开发」一节，`npm install && npm run dist`。

想要桌面快捷方式：双击产物目录里的 `创建桌面快捷方式.cmd`。

---

## 别人下载这个仓库，能直接用吗？

**从仓库 clone 出来不能直接用**，原因很实在，先说清楚：

| 问题 | 说明 |
|---|---|
| 仓库里**不含 exe** | `dist/` 被 `.gitignore` 排除；而且 `DSH Desktop.exe` 有 **234 MB**，超过 GitHub 单文件 100 MB 的硬上限，**根本推不上去**。exe 只能走 Release 附件。 |
| 桌面端**不是自包含的** | 它是个"壳"，启动的是本机已装的 DSH。使用者必须自己装 Node.js + `npm i -g @deepseek-ai/dsh`，并配好 API Key。 |
| 平台限定 | 目前只构建 **win32-x64**。 |

所以正确的分发姿势是：

1. 仓库只放**源码**（几百 KB）；
2. `dist/` 通过 **GitHub Release 附件**分发（附件上限 2 GB，够用）；
3. 仓库里已经带了一份 [`.github/workflows/build-desktop.yml`](.github/workflows/build-desktop.yml)：
   打 tag 推送（如 `v0.1.0`）会自动构建并把 zip 挂到 Release 上，也可以手动触发只产出 Artifact。

如果希望使用者"下载就能用、不装任何东西"，需要把 DSH 运行时（`~/.dsh/profiles/node_modules`，500 MB+）
也塞进产物，体积会到 1 GB 量级，而且 DSH 有按 Node ABI 编译的原生模块（sharp / node-pty 等），
跨机器复制容易出问题——**不推荐**。让使用者 `npm i -g @deepseek-ai/dsh` 是干净得多的做法。

**首次启动桌面端会自动做的事**（全新机器上也验证过）：

1. 发现 `$DSH_HOME/profiles/web` 不存在 → 调用 `dsh --profile web --dump-default-config`
   把 profile 初始化出来（只组装、不起服务器、不联网）；
2. 把自带的插件市场装进这个 profile；
3. 启动 `dsh --profile web --no-open --port 0`，解析它打印的带 token URL，加载进窗口。

---

## 数据与插件是怎么互通的

桌面端只是换了个壳，**没有第二个数据目录**：

| 内容 | 位置 | 桌面端 / 命令行 / 浏览器 |
|---|---|---|
| 会话历史 | `~/.dsh/sessions` | 同一份 |
| 设置 | `~/.dsh/settings.yaml` | 同一份 |
| API Key | `~/.dsh/.credentials.yaml` | 同一份 |
| 插件 | `~/.dsh/profiles/web` | 同一份 |
| 附件 | `~/.dsh/attachments` | 同一份 |

桌面端固定使用 `--profile web`，也就是你平时 `dsh web` 用的那个 profile。所以：

- 浏览器 UI 里装的插件，桌面端重启后就有；
- 桌面端插件市场里装的插件，浏览器 UI 里也有；
- 命令行 `dsh plugin --profile web add <包>` 装的插件，两边同样共享。

> 桌面端会**自己拉起一个 DSH 服务进程**（随机本机端口，URL 带一次性 token）。
> 同时开着 `dsh web` 会有两个进程读写同一个 `DSH_HOME`——数据是同一份，但没必要同时开两个。

---

## 插件市场

打开路径：**设置 → 插件 → 插件市场**（或菜单 `DSH → 打开插件市场`，快捷键 `Ctrl+Shift+P`）。

- **已安装插件**：当前 profile 的插件依赖，显示版本、是否已加载，可一键卸载。
- **社区插件**：直接在 npm 上搜索 DSH 相关包（结果按 DSH 关键词过滤），一键安装。
- 安装时实时显示 pnpm 输出；装完提示**需要重启 DSH**，点「立即重启」即可。
- 安装走的是和 `dsh plugin --profile web add` 完全一样的机制：写 profile 的
  `package.json` 依赖 + 同步 `dsh.profile.bundles`。

**pnpm 从哪来**：桌面端自带一份 pnpm（`resources/app/node_modules/pnpm`），启动 DSH 时通过
`DSH_PNPM_BIN` 注入并加进子进程 `PATH`，所以 `dsh plugin` 也能直接用。用 `dsh web` 启动的
浏览器版本会退回 PATH 上的 `pnpm`，再退回 `corepack pnpm`。

**搜索用哪个 registry**：`DSH_PLUGIN_MARKET_REGISTRY` → 用户 `~/.npmrc` 的 `registry=` →
官方 npmjs。国内用户配了镜像就自动用镜像，不需要额外设置。

---

## 菜单

| 菜单项 | 作用 |
|---|---|
| DSH → 打开插件市场 | 自动跳到「设置 → 插件 → 插件市场」 |
| DSH → 重新加载界面 | 刷新页面 |
| DSH → 在浏览器中打开 | 用系统浏览器打开当前实例的 URL |
| DSH → 重启 DSH 服务 | 装完插件后让它生效 |
| DSH → 选择工作目录… | 改 agent 的 workspace 根目录（默认用户主目录） |
| DSH → 打开日志文件 | 启动失败时看这里 |
| DSH → 打开 DSH 数据目录 | 打开 `~/.dsh` |
| DSH → 重新安装插件市场插件 | 插件市场丢失或损坏时修复 |
| DSH → 移除插件市场插件 | 从 profile 里干净移除本插件 |
| 视图 → 开发者工具 | 排查界面问题时用 |

桌面端自身状态放在 `%APPDATA%\DSH Desktop\desktop-state.json`，
日志在 `%APPDATA%\DSH Desktop\logs\dsh-web.log`（超过 2MB 轮转一次）。

---

## 常见问题

**提示「找不到已安装的 @deepseek-ai/dsh」**
桌面端只复用本机已有的 DSH，不会自己去装。执行 `npm i -g @deepseek-ai/dsh` 后重试。
装在非常规位置时，可用 `DSH_CLI` 指向它的 `lib/bin.js`，用 `DSH_NODE_BIN` 指定 `node.exe`。

**插件市场里显示「未找到 pnpm」**
用桌面端启动不会出现（自带 pnpm）。用 `dsh web` 起的浏览器版本需要装 pnpm（`npm i -g pnpm`）
或启用 corepack（`corepack enable pnpm`）。

**装了插件但界面没变**
插件是 DSH 启动时按 profile 组装进 loader 的，装完需要重启：
菜单 **DSH → 重启 DSH 服务**，然后按提示刷新。

**想彻底还原**
菜单 **DSH → 移除插件市场插件**，或手动删除：

- `~/.dsh/profiles/web/cordis.patch.yml` 里 `# ── 插件市场` 那一段
- `~/.dsh/profiles/web/package.json` 里的 `dsh-plugin-market` 依赖
- `~/.dsh/profiles/web/node_modules/dsh-plugin-market`
- `~/.dsh/plugins/dsh-plugin-market`

改动前桌面端都留了 `*.dsh-desktop-backup` 备份，可以直接改名还原。
桌面端本体删掉 `dist/DSH Desktop` 整个文件夹即可，不影响 DSH 数据。

---

## 开发

### 先把代码弄下来

下面这些是给**想自己构建或改代码**的人看的。只是想用的话不用往下看——
去本仓库的 Releases 页面下载 `DSH-Desktop-win32-x64.zip`，解压双击即可。

```powershell
git clone https://github.com/LeeJazen/dsh-desktop.git
cd dsh-desktop
```

### 每条命令到底干什么

> 这些命令里**只有 `npm install` 会联网**，而且它下载的是 Electron 这类**依赖包**，
> 不是本项目。本项目是上面 `git clone` 那一步拿到的。

| 命令 | 联网下载 | 做什么 | 要预先装 DSH |
|---|---|---|---|
| `npm install` | ✅ Electron（约 150 MB）、resedit、pnpm | 装进 `node_modules/`（约 420 MB） | 否 |
| `npm run icon` | ❌ | 用 DSH 自带的 sharp 重新生成 `build/icon.ico` | **是** |
| `npm start` | ❌ | 开发模式直接跑桌面端 | **是** |
| `npm run dist` | ❌ | 打包出 `dist\DSH Desktop` | 否 |
| `npm run shortcut` | ❌ | 在桌面创建快捷方式 | 否 |

**只想拿到 exe、不改代码**——两条就够：

```powershell
npm install
npm run dist
```

**要改代码、想边改边看效果**：

```powershell
npm install
npm start
```

Electron 下载慢的话，先设镜像再装：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

自带自动化验证工具（启动桌面端 → 等页面稳定 → 截图 + dump 诊断）：

```powershell
node tools/verify/capture.mjs --market      # 打开插件市场并截图
node tools/verify/capture.mjs               # 主界面截图
node tools/verify/capture.mjs --dev         # 验证开发模式
node tools/verify/capture.mjs --out shot.png --delay 15000
```

> Electron 需要建立进程间命名管道，必须在普通用户会话里运行；
> 在被严格沙箱化的终端里会以 `EPERM` 直接失败。

调试用环境变量：

| 变量 | 作用 |
|---|---|
| `DSH_DESKTOP_NO_PROVISION=1` | 启动时不把插件市场装进 profile |
| `DSH_DESKTOP_USER_DATA=<dir>` | 改桌面端自身状态目录（便携模式 / 测试） |
| `DSH_DESKTOP_CAPTURE=<png>` | 验证钩子：等页面稳定后截图并退出 |
| `DSH_DESKTOP_CAPTURE_SCRIPT=<js>` | 截图前先执行一段页面脚本 |
| `DSH_CLI` / `DSH_NODE_BIN` | 手动指定 DSH 入口 / node.exe |

## 目录结构

```
.
├─ electron/                  桌面端主进程
│   ├─ main.js                窗口、菜单、子进程管理、启动 URL 捕获、状态页
│   ├─ preload.js             只给状态页用的最小 IPC 桥
│   ├─ loading.html / error.html / status.css / status.js
│   └─ lib/
│       ├─ locate.js          定位 node / dsh CLI / pnpm / DSH_HOME
│       ├─ dsh-server.js      托管 `dsh --profile web` 子进程并解析启动 URL
│       └─ provision.js       把插件市场幂等装进 profile（含备份与指纹同步）
├─ plugin-market/             「插件市场」DSH 插件（宿主 + 浏览器两半，无构建步骤）
├─ tools/
│   ├─ make-icon.mjs          生成 build/icon.ico
│   ├─ build-app.mjs          打包绿色版（拷 Electron 运行时 + resedit 写图标/版本）
│   ├─ create-shortcut.ps1    创建桌面快捷方式
│   └─ verify/                自动化验证工具与注入脚本
├─ build/icon.ico             应用图标
├─ docs/                      截图
└─ .github/workflows/         CI：构建并发布 Release 附件
```

---

## 实现要点

- **为什么必须抓启动 URL**：DSH Web UI 每个进程都会生成一次性 token，只有启动时打印的
  那行 `dsh web: http://127.0.0.1:<port>/?token=...` 能换到签名 cookie。桌面端因此监听子进程
  输出、解析这行 URL 再加载进窗口，而不是自己拼地址。
- **为什么用系统的 node**：DSH 依赖按 Node ABI 编译的原生模块（sharp / node-pty 等），
  Electron 自带的 Node ABI 不兼容，所以子进程用真正的 `node.exe`。
- **插件市场的 RPC**：用 `dsh-host-webserver` 上的同源 HTTP 路由（`/plugin-market/*`），
  而不是 Typert Remote —— 安装是长任务，需要流式回传 pnpm 日志。路由只接受
  loopback + 同源请求（与 `/api` 的浏览器信任栅栏同一套判据）。
- **插件分发方式**：源码放 `~/.dsh/plugins/dsh-plugin-market`，在 profile 的 `node_modules`
  下挂 junction（与 DSH 自己的 hoisted 布局一致），再往 `cordis.patch.yml` 插一行 loader entry。
  按内容指纹判断是否需要重写，改代码不改版本号也能同步。
- **打包不用 electron-builder / packager**：electron-builder 需要 NSIS / winCodeSign 工具链；
  `@electron/packager` 每次都要联网校验运行时压缩包（网络一抖就卡住）。现在直接拷
  `node_modules/electron/dist`，用 `resedit` 写图标与版本信息，几十行搞定且离线可重复。

## 已知限制

- 只构建 **win32-x64**；换平台需要准备对应 Electron 运行时并调整 `tools/build-app.mjs`。
- 安装/卸载插件后**需要重启 DSH 服务**才生效（profile 的 bundle 列表是启动时读的）。
- 社区搜索依赖 npm registry，离线时只有「已安装」可用。
- 首次启动若 DSH 正在做 profile 初始化，可能要等十几秒；超过 3 分钟会报错并给出日志。

## 许可

[MIT](LICENSE)。应用图标里的鲸鱼标志取自 DeepSeek Harness 官方前端自带的 favicon.svg（MIT），
仅用于标识这是一个 DSH 桌面外壳，**不代表 DeepSeek 官方发布**。
打包产物内含 Electron 运行时，其许可证全文见产物目录下的 `LICENSE` 与 `LICENSES.chromium.html`。
