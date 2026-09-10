/**
 * DSH Desktop 主进程。
 *
 * 职责：定位本机 DSH → 以子进程启动 `dsh --profile web` → 捕获它打印的
 * 带 token 的 URL → 在原生窗口里加载该 URL。窗口只是浏览器 UI 的壳，
 * 所有数据仍然在同一个 DSH_HOME 里，因此与命令行/浏览器用法完全互通。
 */
"use strict";

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");
const { existsSync, mkdirSync, appendFileSync, statSync, renameSync, writeFileSync, readFileSync } = require("node:fs");
const { join, dirname } = require("node:path");
const os = require("node:os");

const { DshServer } = require("./lib/dsh-server.js");
const { resolveDshHome, resolveNodeBin, resolveDshCli, resolvePnpm, listProfiles } = require("./lib/locate.js");
const { provisionPluginMarket, unprovisionPluginMarket } = require("./lib/provision.js");

/** 启动后置为 true，避免 before-quit 递归。 */
let quitting = false;
/** 当前 DSH 子进程。 */
let server = null;
/** 主窗口。 */
let win = null;
/** 界面状态，状态页通过 IPC 读取。 */
let shellState = { phase: "starting", message: "正在启动 DSH…", logTail: [] };
/** 最近的日志行（给状态页展示）。 */
const logTail = [];
/** 日志文件句柄路径。 */
let logFile = null;

const PRODUCT = "DSH Desktop";

// 允许把桌面端自身的状态目录挪到别处（便携模式 / 自动化测试用）。
if (process.env.DSH_DESKTOP_USER_DATA) {
  try {
    app.setPath("userData", process.env.DSH_DESKTOP_USER_DATA);
  } catch {
    // 保持默认
  }
}

/** 状态文件路径：窗口位置、最近的工作目录等纯桌面端 UI 状态。 */
function statePath() {
  return join(app.getPath("userData"), "desktop-state.json");
}

/** 读取桌面端状态。 */
function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

/** 写入桌面端状态。 */
function writeState(patch) {
  try {
    mkdirSync(dirname(statePath()), { recursive: true });
    writeFileSync(statePath(), JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch {
    // 状态写不进去不影响使用
  }
}

/** 命令行覆盖：`DSH Desktop.exe --workspace <dir>` 指定本次的工作目录。 */
function cliWorkspace() {
  const index = process.argv.indexOf("--workspace");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** 默认工作目录：DSH 用它作为 workspace 根；优先命令行，其次上次选择，否则用户主目录。 */
function currentWorkspace() {
  const fromArgv = cliWorkspace();
  if (fromArgv !== null) return fromArgv;
  const saved = readState().workspace;
  if (typeof saved === "string" && saved !== "" && existsSync(saved)) return saved;
  return os.homedir();
}

/** 追加一行日志到内存环形缓冲与磁盘日志文件。 */
function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  logTail.push(line);
  while (logTail.length > 400) logTail.shift();
  if (logFile) {
    try {
      if (existsSync(logFile) && statSync(logFile).size > 2 * 1024 * 1024) {
        renameSync(logFile, `${logFile}.1`);
      }
      appendFileSync(logFile, `${stamped}\n`);
    } catch {
      // 日志失败不影响主流程
    }
  }
}

/** 推送界面状态到状态页。 */
function setState(patch) {
  shellState = { ...shellState, ...patch, logTail: logTail.slice(-200) };
  if (win && !win.isDestroyed()) win.webContents.send("shell:state", shellState);
}

/** 应用资源根目录（开发时是仓库根，打包后是 resources/app）。 */
function appRoot() {
  return app.isPackaged ? join(process.resourcesPath, "app") : join(__dirname, "..");
}

/** 桌面端运行时快照，用于状态页与「关于」。 */
function runtimeInfo() {
  const dshHome = resolveDshHome();
  const nodeBin = resolveNodeBin();
  const cli = resolveDshCli(dshHome);
  const pnpm = resolvePnpm(process.resourcesPath);
  return { dshHome, nodeBin, cli, pnpm, profiles: listProfiles(dshHome), workspace: currentWorkspace() };
}

/** 打开本地状态页（启动中/出错时显示）。 */
function loadLocalPage(name) {
  if (!win || win.isDestroyed()) return;
  const file = join(__dirname, name);
  win.loadFile(file).catch((error) => {
    if (error && /ERR_ABORTED/.test(error.message)) return; // 被后一次导航取代
    log(`加载状态页失败: ${error.message}`);
  });
}

/** 采集页面自述的诊断信息（自动化验证用，注入到页面里执行）。 */
const PROBE = `(() => {
  const text = (document.body && document.body.innerText ? document.body.innerText : "").replace(/\\s+/g, " ").slice(0, 600);
  return {
    href: location.href.replace(/token=[^&]+/, "token=***"),
    title: document.title,
    boot: typeof window.__DSH_BOOT__ === "object",
    nodes: document.querySelectorAll("*").length,
    text,
  };
})()`;

/**
 * 自动化验证钩子：页面稳定后截图并输出诊断。只在设置
 * DSH_DESKTOP_CAPTURE 时启用，正常使用不会触发。
 */
function scheduleCapture() {
  const target = process.env.DSH_DESKTOP_CAPTURE;
  const delayMs = Number(process.env.DSH_DESKTOP_CAPTURE_DELAY_MS ?? 9000);
  setTimeout(async () => {
    if (!win || win.isDestroyed()) return;
    try {
      const script = process.env.DSH_DESKTOP_CAPTURE_SCRIPT;
      if (script) {
        const scriptResult = await win.webContents.executeJavaScript(script, true);
        log(`CAPTURE script: ${JSON.stringify(scriptResult)}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
      }
      const probe = await win.webContents.executeJavaScript(PROBE, true);
      log(`CAPTURE probe: ${JSON.stringify(probe)}`);
      // 被其他窗口盖住时 Chromium 不合成新帧，capturePage 会抛 UnknownVizError。
      // 截图前先把窗口提到最前（只在这个验证钩子里做，正常使用不动窗口层级）。
      if (win.isMinimized()) win.restore();
      win.show();
      win.moveTop();
      win.focus();
      win.setAlwaysOnTop(true);
      await new Promise((resolveWait) => setTimeout(resolveWait, 800));
      const image = await win.webContents.capturePage();
      win.setAlwaysOnTop(false);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, image.toPNG());
      log(`CAPTURE saved: ${target}`);
    } catch (error) {
      log(`CAPTURE failed: ${error.message}`);
    } finally {
      if (process.env.DSH_DESKTOP_EXIT_AFTER_CAPTURE) setTimeout(() => app.quit(), 500);
    }
  }, delayMs);
}

/**
 * 组装启动参数并拉起 DSH。
 * @returns 运行时快照中缺失的依赖错误信息，缺失时返回 null。
 */
function startServer() {
  const info = runtimeInfo();
  const problems = [];
  if (!info.nodeBin) problems.push("找不到 node.exe（请安装 Node.js，或设置 DSH_NODE_BIN）");
  if (!info.cli) problems.push(`在 ${info.dshHome} 与全局 npm 目录里都找不到已安装的 @deepseek-ai/dsh`);
  if (problems.length > 0) {
    setState({ phase: "error", message: problems.join("\n"), runtime: info });
    loadLocalPage("error.html");
    return false;
  }

  log(`DSH_HOME  = ${info.dshHome}`);
  log(`node      = ${info.nodeBin}`);
  log(`dsh CLI   = ${info.cli.binPath} (${info.cli.version ?? "版本未知"})`);
  log(`workspace = ${info.workspace}`);
  log(`pnpm      = ${info.pnpm ? info.pnpm.script : "未找到（插件市场安装功能会不可用）"}`);

  server = new DshServer({
    nodeBin: info.nodeBin,
    cliBin: info.cli.binPath,
    dshHome: info.dshHome,
    workspace: info.workspace,
    profile: "web",
    pnpm: info.pnpm,
    onLog: log,
  });
  server.on("log", log);
  server.on("ready", (url) => {
    log(`DSH Web UI: ${url.replace(/token=[^&]+/, "token=***")}`);
    setState({ phase: "ready", message: "已就绪", url });
    if (win && !win.isDestroyed()) {
      win.loadURL(url).catch((error) => {
        log(`加载 DSH 页面失败: ${error.message}`);
        setState({ phase: "error", message: `加载 DSH 页面失败：${error.message}` });
        loadLocalPage("error.html");
      });
    }
  });
  server.on("exit", ({ code, signal, error, expected }) => {
    server = null;
    if (quitting || expected) return;
    const reason = error ? error.message : `DSH 进程已退出（code=${code ?? "null"} signal=${signal ?? "null"}）`;
    log(reason);
    setState({ phase: "error", message: reason });
    loadLocalPage("error.html");
  });

  setState({ phase: "starting", message: "正在启动 DSH…", runtime: info });

  // 启动前把「插件市场」装进当前 profile：写入的是与 `dsh plugin` 相同的状态，
  // 所以桌面端、浏览器 UI 和命令行看到的是同一份插件。
  if (process.env.DSH_DESKTOP_NO_PROVISION === "1") {
    log("已按 DSH_DESKTOP_NO_PROVISION=1 跳过插件市场预装");
  } else {
    try {
      provisionPluginMarket({
        home: info.dshHome,
        profile: "web",
        sourceDir: join(appRoot(), "plugin-market"),
        nodeBin: info.nodeBin,
        cliBin: info.cli?.binPath,
        log,
      });
    } catch (error) {
      log(`预装插件市场失败（不影响 DSH 启动）: ${error.message}`);
    }
  }

  loadLocalPage("loading.html");
  server.start();
  return true;
}

/** 停止当前 DSH 子进程。 */
async function stopServer() {
  const current = server;
  server = null;
  if (current) await current.stop();
}

/** 重启 DSH 服务。 */
async function restartServer() {
  setState({ phase: "starting", message: "正在重启 DSH…" });
  loadLocalPage("loading.html");
  await stopServer();
  setTimeout(() => startServer(), 300);
}

/** 创建主窗口。 */
function createWindow() {
  const saved = readState().windowBounds ?? {};
  win = new BrowserWindow({
    width: saved.width ?? 1280,
    height: saved.height ?? 860,
    x: saved.x,
    y: saved.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#17181c",
    title: PRODUCT,
    icon: join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 窗口被遮挡时不要节流：DSH 的流式回答与 WebSocket 在后台也要保持活跃。
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    setState({});
  });

  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    writeState({ windowBounds: win.getNormalBounds() });
  };
  win.on("resize", remember);
  win.on("move", remember);

  win.on("closed", () => {
    win = null;
  });

  // 把页面里的报错写进日志，方便排查 UI 问题。
  // Electron 44 起 console-message 只传一个事件对象；声明多个形参会触发弃用告警。
  win.webContents.on("console-message", (event) => {
    const level = event?.level;
    const isError = level === "error" || level === "warning";
    if (isError) log(`[page:${level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    log(`渲染进程退出: ${details.reason} (exitCode=${details.exitCode})`);
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    if (code === -3) return; // 用户主动中断
    log(`页面加载失败 ${code} ${description} ${url}`);
  });

  // 外部链接（http/https 到别的站点）交给系统浏览器，别在应用窗口里乱跳。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(url);
      if (!isLocal) {
        shell.openExternal(url).catch(() => {});
        return { action: "deny" };
      }
    }
    return { action: "allow" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (win && win.webContents.getURL().startsWith("file://")) return;
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(url)) return;
    if (/^https?:/i.test(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  // 让页面拿到和普通 Chrome 一致的 UA，避免站点/前端做 UA 嗅探时走偏。
  const chromeVersion = process.versions.chrome;
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  win.webContents.setUserAgent(ua);

  return win;
}

/** 应用菜单。 */
function buildMenu() {
  const runtime = runtimeInfo();
  const template = [
    {
      label: "DSH",
      submenu: [
        { label: "重新加载界面", accelerator: "CmdOrCtrl+R", click: () => win?.webContents.reload() },
        {
          label: "在浏览器中打开",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => {
            if (server?.url) shell.openExternal(server.url).catch(() => {});
          },
        },
        { type: "separator" },
        {
          label: "打开插件市场",
          accelerator: "CmdOrCtrl+Shift+P",
          click: async () => {
            if (!win || win.isDestroyed()) return;
            try {
              // 插件市场的浏览器半边监听这个事件；它调用 preventDefault 表示「已处理」。
              const handled = await win.webContents.executeJavaScript(
                "!window.dispatchEvent(new CustomEvent('dsh-desktop:open-plugin-market', { cancelable: true }))",
                true,
              );
              if (!handled) log("插件市场入口未响应（插件可能尚未启用或尚未安装）");
            } catch (error) {
              log(`打开插件市场失败: ${error.message}`);
            }
          },
        },
        { label: "重启 DSH 服务", click: () => void restartServer() },
        { type: "separator" },
        {
          label: "选择工作目录…",
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              title: "选择 DSH 的工作目录（workspace 根目录）",
              defaultPath: runtime.workspace,
              properties: ["openDirectory", "createDirectory"],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            writeState({ workspace: result.filePaths[0] });
            log(`工作目录改为 ${result.filePaths[0]}，重启 DSH 生效`);
            void restartServer();
          },
        },
        { type: "separator" },
        { label: "打开日志文件", click: () => logFile && shell.openPath(logFile) },
        { label: "打开 DSH 数据目录", click: () => shell.openPath(runtime.dshHome) },
        { label: "打开桌面端数据目录", click: () => shell.openPath(app.getPath("userData")) },
        { type: "separator" },
        {
          label: "重新安装插件市场插件",
          click: () => {
            try {
              provisionPluginMarket({
                home: runtime.dshHome,
                profile: "web",
                sourceDir: join(appRoot(), "plugin-market"),
                nodeBin: runtime.nodeBin,
                cliBin: runtime.cli?.binPath,
                log,
              });
              log("已重新同步插件市场插件，重启 DSH 服务后生效");
            } catch (error) {
              log(`重新安装插件市场失败: ${error.message}`);
            }
            void restartServer();
          },
        },
        {
          label: "移除插件市场插件",
          click: async () => {
            const answer = await dialog.showMessageBox(win, {
              type: "warning",
              title: "移除插件市场插件",
              message: "确定要把「插件市场」从 web profile 里移除吗？",
              detail: "只会删掉本插件在 profile 里的依赖、loader entry 与链接；DSH 本身和其他插件不受影响。",
              buttons: ["移除", "取消"],
              defaultId: 1,
              cancelId: 1,
            });
            if (answer.response !== 0) return;
            unprovisionPluginMarket({ home: runtime.dshHome, profile: "web", log });
            void restartServer();
          },
        },
        { type: "separator" },
        { label: "退出", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "重做", accelerator: "CmdOrCtrl+Y", role: "redo" },
        { type: "separator" },
        { label: "剪切", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "复制", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "粘贴", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "全选", accelerator: "CmdOrCtrl+A", role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "放大", accelerator: "CmdOrCtrl+Plus", role: "zoomIn" },
        { label: "缩小", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { label: "实际大小", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { type: "separator" },
        { label: "全屏", accelerator: "F11", role: "togglefullscreen" },
        { label: "开发者工具", accelerator: "CmdOrCtrl+Shift+I", role: "toggleDevTools" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: `关于 ${PRODUCT}`,
          click: () => {
            const cli = runtime.cli;
            void dialog.showMessageBox(win, {
              type: "info",
              title: `关于 ${PRODUCT}`,
              message: `${PRODUCT} ${app.getVersion()}`,
              detail: [
                `DSH 版本：${cli?.version ?? "未知"}`,
                `DSH 安装位置：${cli?.binPath ?? "未找到"}`,
                `DSH_HOME：${runtime.dshHome}`,
                `工作目录：${runtime.workspace}`,
                `profile：web`,
                `可用 profile：${runtime.profiles.join(", ") || "（无）"}`,
                "",
                "桌面端复用本机已安装的 DSH，会话与插件与命令行完全共享。",
              ].join("\n"),
              buttons: ["好"],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** 注册状态页用到的 IPC。 */
function registerIpc() {
  ipcMain.handle("shell:get-state", () => shellState);
  ipcMain.handle("shell:retry", () => {
    void restartServer();
    return true;
  });
  ipcMain.handle("shell:open-log", () => logFile && shell.openPath(logFile));
  ipcMain.handle("shell:open-data-dir", () => shell.openPath(resolveDshHome()));
  ipcMain.handle("shell:open-browser", () => {
    if (server?.url) shell.openExternal(server.url).catch(() => {});
  });
  ipcMain.handle("shell:quit", () => app.quit());
  ipcMain.handle("shell:restart", () => {
    void restartServer();
    return true;
  });
}

/** 初始化日志文件。 */
function initLog() {
  try {
    const dir = join(app.getPath("userData"), "logs");
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "dsh-web.log");
  } catch {
    logFile = null;
  }
}

// 单实例：第二次双击只把已有窗口拉到前台。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    initLog();
    log(`${PRODUCT} ${app.getVersion()} 启动`);
    log(`Electron ${process.versions.electron} / Chrome ${process.versions.chrome} / Node ${process.versions.node}`);
    registerIpc();
    createWindow();
    buildMenu();
    startServer();
    // 自动化验证钩子与是否启动成功无关：失败状态页也要能截图。
    if (process.env.DSH_DESKTOP_CAPTURE) scheduleCapture();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      startServer();
    }
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    log("正在退出，关闭 DSH 子进程…");
    stopServer().then(() => app.exit(0));
  });
}
