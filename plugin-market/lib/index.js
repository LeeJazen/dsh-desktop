/**
 * 插件市场 —— 宿主半边。
 *
 * 在 `dsh-host-webserver` 上挂一组同源限定的 HTTP 路由，让浏览器半边可以在
 * 当前 profile 里搜索 / 安装 / 卸载 DSH 插件。装在同一个 profile 里的插件
 * 对命令行（`dsh plugin --profile web ...`）和浏览器 UI 是同一份状态，所以
 * 桌面端与网页端天然互通。
 *
 * 实现选择：用普通 HTTP 路由而不是 Typert Remote，因为安装是长任务，需要
 * 流式回传 pnpm 日志；路由只接受 loopback + 同源请求（与 /api 的浏览器信任
 * 栅栏同一套判据），避免被本机上的其他页面驱动安装。
 *
 * @module dsh-plugin-market
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";

/** 本插件的服务名。 */
export const name = "plugin-market";

/**
 * 解析 DSH_HOME。
 *
 * 这里刻意不 import `@deepseek-ai/dsh-home-paths`：本包通过 junction 挂在
 * profile 的 node_modules 下，真实路径不在该 node_modules 树内，任何跨包
 * import 都解析不到。宿主半边因此只依赖 node 内置模块。
 */
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return resolve(fromEnv.trim());
  return join(homedir(), ".dsh");
}

/** 需要的宿主服务：HTTP 服务器与 loader（读已挂载条目）。 */
export const inject = ["webServer", "loader"];

/** 路由前缀。 */
const PREFIX = "/plugin-market";

/** 单次请求体上限，防止意外的大 body。 */
const MAX_BODY_BYTES = 64 * 1024;

/** 搜索超时。 */
const SEARCH_TIMEOUT_MS = 20_000;

// ───────────────────────────── 运行时定位 ─────────────────────────────

/**
 * 当前进程启动的 profile 名：从 argv 里读 `--profile <name>`。
 * DSH 的 launcher 把 profile 放在自己的 flag 里，所以这里一定能读到。
 */
function profileName(argv = process.argv) {
  const index = argv.indexOf("--profile");
  const value = index >= 0 ? argv[index + 1] : undefined;
  return typeof value === "string" && value !== "" ? value : "web";
}

/** 当前 profile 的目录。 */
function profileDir(home = resolveDshHome()) {
  return join(home, "profiles", profileName());
}

/** 读取一个目录下的 package.json（容忍 Windows 编辑器写入的 UTF-8 BOM）。 */
function readManifest(dir) {
  try {
    const text = readFileSync(join(dir, "package.json"), "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 写入 package.json（保留 2 空格缩进，和 pnpm 的风格一致）。 */
function writeManifest(dir, manifest) {
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** 从 profile 目录或共享的 profiles/node_modules 里定位一个包。 */
function locatePackage(packageName, dir, home) {
  const bases = [join(dir, "node_modules"), join(home, "profiles", "node_modules")];
  for (const base of bases) {
    const candidate = join(base, ...packageName.split("/"));
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }
  return null;
}

/** 描述一个已解析的包。 */
function describePackage(packageName, dir, home, loadedNames) {
  const pkg = dir === null ? null : readManifest(dir);
  return {
    name: packageName,
    version: typeof pkg?.version === "string" ? pkg.version : null,
    description: typeof pkg?.description === "string" ? pkg.description : "",
    resolved: dir !== null,
    client: pkg?.dsh?.client?.platform === "web",
    bundle: typeof pkg?.dsh?.bundle?.patch === "string",
    loaded: loadedNames.has(packageName),
  };
}

// ───────────────────────────── pnpm 定位 ─────────────────────────────

/**
 * 解析可用的 pnpm 调用方式。
 *
 * 桌面端会通过 `DSH_PNPM_BIN` 注入它自带的 pnpm；命令行启动时退回 PATH 上的
 * pnpm，再退回 corepack。返回值永远不用 `shell: true`，避免 Windows 上参数
 * 被二次解释。
 * @returns `{ command, prefixArgs, source }`，找不到时返回 null。
 */
function resolvePnpm() {
  const fromEnv = process.env.DSH_PNPM_BIN;
  if (typeof fromEnv === "string" && fromEnv !== "" && existsSync(fromEnv)) {
    return { command: process.execPath, prefixArgs: [resolve(fromEnv)], source: "desktop" };
  }
  const isWindows = process.platform === "win32";
  const pathDirs = (process.env.PATH ?? "").split(isWindows ? ";" : ":");
  for (const dir of pathDirs) {
    if (dir.trim() === "") continue;
    for (const file of isWindows ? ["pnpm.exe", "pnpm.cmd", "pnpm.ps1", "pnpm"] : ["pnpm"]) {
      if (existsSync(join(dir.trim(), file))) {
        return isWindows
          ? { command: "cmd.exe", prefixArgs: ["/d", "/s", "/c", "pnpm"], source: "path" }
          : { command: "pnpm", prefixArgs: [], source: "path" };
      }
    }
  }
  for (const dir of pathDirs) {
    if (dir.trim() === "") continue;
    if (existsSync(join(dir.trim(), isWindows ? "corepack.cmd" : "corepack"))) {
      return isWindows
        ? { command: "cmd.exe", prefixArgs: ["/d", "/s", "/c", "corepack", "pnpm"], source: "corepack" }
        : { command: "corepack", prefixArgs: ["pnpm"], source: "corepack" };
    }
  }
  return null;
}

// ───────────────────────────── profile 清单 ─────────────────────────────

/**
 * 按 `dsh plugin` 的语义把 `dsh.profile.bundles` 与已安装状态对齐。
 *
 * 与 CLI 的实现一致：只有「曾经/现在是 dependencies」的名字才会被移出
 * bundles，随附的内置 bundle（不是依赖）永远不动。
 * @returns 变更后的 bundles 与是否发生了写入。
 */
function reconcileBundles(dir, home, beforeDependencies) {
  const manifest = readManifest(dir);
  if (manifest === null) return { bundles: [], changed: false };
  const dependencies = Object.keys(manifest.dependencies ?? {});
  const dependencySet = new Set(dependencies);
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])];
  let changed = false;

  for (const packageName of dependencies) {
    const located = locatePackage(packageName, dir, home);
    const pkg = located === null ? null : readManifest(located);
    const isBundle = typeof pkg?.dsh?.bundle?.patch === "string";
    if (isBundle && !bundles.includes(packageName)) {
      bundles.push(packageName);
      changed = true;
    }
  }
  for (const packageName of [...bundles]) {
    const wasDependency = beforeDependencies.has(packageName) || dependencySet.has(packageName);
    if (!wasDependency) continue;
    const located = locatePackage(packageName, dir, home);
    const pkg = located === null ? null : readManifest(located);
    const stillBundle = dependencySet.has(packageName) && typeof pkg?.dsh?.bundle?.patch === "string";
    if (!stillBundle) {
      bundles.splice(bundles.indexOf(packageName), 1);
      changed = true;
    }
  }
  if (changed) {
    manifest.dsh = {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles },
    };
    writeManifest(dir, manifest);
  }
  return { bundles, changed };
}

// ───────────────────────────── npm registry ─────────────────────────────

/**
 * 解析要用的 npm registry。
 *
 * 优先级：`DSH_PLUGIN_MARKET_REGISTRY` → 用户 `.npmrc` 里的 `registry=` →
 * 官方 registry。跟着用户的 npmrc 走，国内用户配了镜像就自动用镜像，
 * 海外用户没配就用 npmjs，不需要额外设置。
 */
function registryUrl() {
  const fromEnv = process.env.DSH_PLUGIN_MARKET_REGISTRY;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim().replace(/\/+$/, "");
  const candidates = [join(homedir(), ".npmrc"), join(process.env.APPDATA ?? "", "npm", "etc", "npmrc")];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const match = /^\s*registry\s*=\s*(\S+)\s*$/m.exec(readFileSync(file, "utf8"));
      if (match !== null) return match[1].replace(/\/+$/, "");
    } catch {
      // 换下一个候选
    }
  }
  return "https://registry.npmjs.org";
}

/** 判断一条 registry 结果看起来是不是 DSH 相关包。 */
function looksLikeDshPlugin(pkg) {
  const haystack = [pkg.name, pkg.description, ...(Array.isArray(pkg.keywords) ? pkg.keywords : [])]
    .filter((part) => typeof part === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes("dsh") || haystack.includes("deepseek-harness") || haystack.includes("deepseek harness");
}

/** 在 registry 上搜索插件。 */
async function searchRegistry(query) {
  const text = query.trim() === "" ? "deepseek-harness" : query.trim();
  const url = `${registryUrl()}/-/v1/search?text=${encodeURIComponent(text)}&size=40`;
  const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`registry 返回 ${response.status}`);
  const payload = await response.json();
  const seen = new Set();
  const rows = [];
  for (const object of payload.objects ?? []) {
    const pkg = object?.package ?? {};
    if (typeof pkg.name !== "string" || seen.has(pkg.name)) continue;
    if (!looksLikeDshPlugin(pkg)) continue;
    seen.add(pkg.name);
    rows.push({
      name: pkg.name,
      version: typeof pkg.version === "string" ? pkg.version : "",
      description: typeof pkg.description === "string" ? pkg.description : "",
      date: typeof object?.updated === "string" ? object.updated : "",
      keywords: Array.isArray(pkg.keywords) ? pkg.keywords.slice(0, 6) : [],
      homepage: typeof pkg.links?.npm === "string" ? pkg.links.npm : "",
    });
    if (rows.length >= 30) break;
  }
  return rows;
}

// ───────────────────────────── HTTP 层 ─────────────────────────────

/**
 * 与 `/api` 相同的浏览器信任判据：只信任 loopback Host、非跨站、
 * 且 Origin（若有）与 Host 完全一致。
 */
function isTrustedRequest(request) {
  const host = request.headers.host;
  if (typeof host !== "string" || host === "") return false;
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin !== "" && origin !== "null") {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** 读取并解析 JSON 请求体。 */
function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error("请求体过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(text));
      } catch {
        rejectBody(new Error("请求体不是合法 JSON"));
      }
    });
    request.on("error", rejectBody);
  });
}

/** 发送 JSON 响应。 */
function sendJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  response.end(body);
}

/** 开始一条 NDJSON 进度流。 */
function openStream(response) {
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  return (record) => {
    if (!response.writableEnded) response.write(`${JSON.stringify(record)}\n`);
  };
}

/**
 * 跑一条 pnpm 命令，把输出逐块推进度流。
 * @returns 退出码。
 */
function runPnpm(pnpm, args, cwd, emit) {
  return new Promise((resolveRun) => {
    emit({ type: "log", line: `$ pnpm ${args.join(" ")}` });
    let child;
    try {
      child = spawn(pnpm.command, [...pnpm.prefixArgs, ...args], {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          // 插件安装不弹交互确认，也不在 CI 语义下跳过脚本。
          npm_config_yes: "true",
          CI: "",
        },
      });
    } catch (error) {
      emit({ type: "log", line: `启动 pnpm 失败: ${error.message}` });
      resolveRun(-1);
      return;
    }
    const forward = (chunk) => {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) if (line.trim() !== "") emit({ type: "log", line });
    };
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("error", (error) => {
      emit({ type: "log", line: `pnpm 执行失败: ${error.message}` });
      resolveRun(-1);
    });
    child.on("close", (code) => resolveRun(code ?? -1));
  });
}

// ───────────────────────────── 路由 ─────────────────────────────

/** 组装一份完整的市场快照。 */
function snapshot(context) {
  const home = resolveDshHome();
  const dir = profileDir(home);
  const loadedNames = new Set(context.ctx.loader.entries().map((entry) => entry.options.name));
  const manifest = readManifest(dir) ?? {};
  const dependencies = manifest.dependencies ?? {};
  const installed = Object.keys(dependencies)
    .sort((left, right) => left.localeCompare(right))
    .map((packageName) => ({
      ...describePackage(packageName, locatePackage(packageName, dir, home), home, loadedNames),
      spec: dependencies[packageName],
    }));
  return {
    dshHome: home,
    profile: profileName(),
    profileDir: dir,
    bundles: manifest.dsh?.profile?.bundles ?? [],
    installed,
    pnpm: (() => {
      const pnpm = resolvePnpm();
      return pnpm === null ? { available: false, source: null } : { available: true, source: pnpm.source };
    })(),
    desktop: process.env.DSH_DESKTOP_SHELL === "1",
  };
}

/** 处理一次市场请求。 */
async function handle(context, request, response, pathname, searchParams) {
  if (!isTrustedRequest(request)) {
    sendJson(response, 403, { error: "只接受来自本机同源页面的请求" });
    return;
  }
  const home = resolveDshHome();
  const dir = profileDir(home);

  if (pathname === `${PREFIX}/state` && request.method === "GET") {
    sendJson(response, 200, snapshot(context));
    return;
  }

  if (pathname === `${PREFIX}/search` && request.method === "GET") {
    try {
      const rows = await searchRegistry(searchParams.get("q") ?? "");
      sendJson(response, 200, { registry: registryUrl(), rows });
    } catch (error) {
      sendJson(response, 502, { error: `搜索失败：${error.message}` });
    }
    return;
  }

  if (pathname === `${PREFIX}/install` && request.method === "POST") {
    await mutate(context, request, response, "install");
    return;
  }

  if (pathname === `${PREFIX}/remove` && request.method === "POST") {
    await mutate(context, request, response, "remove");
    return;
  }

  sendJson(response, 404, { error: `未知的市场接口 ${pathname}` });
}

/** 安装或卸载，并把结果以 NDJSON 流回传。 */
async function mutate(context, request, response, action) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }
  const target = action === "install" ? body.spec : body.name;
  if (typeof target !== "string" || target.trim() === "") {
    sendJson(response, 400, { error: action === "install" ? "缺少 spec" : "缺少 name" });
    return;
  }

  const home = resolveDshHome();
  const dir = profileDir(home);
  const pnpm = resolvePnpm();
  const emit = openStream(response);

  if (pnpm === null) {
    emit({ type: "error", message: "找不到 pnpm。桌面端会自带 pnpm；命令行启动请先安装 pnpm 或 corepack。" });
    emit({ type: "done", ok: false });
    response.end();
    return;
  }

  const before = readManifest(dir) ?? {};
  const beforeDependencies = new Set(Object.keys(before.dependencies ?? {}));
  const args = action === "install" ? ["add", target.trim()] : ["remove", target.trim()];
  emit({ type: "start", action, target: target.trim(), cwd: dir, pnpm: pnpm.source });

  const code = await runPnpm(pnpm, args, dir, emit);
  if (code !== 0) {
    emit({ type: "error", message: `pnpm 退出码 ${code}` });
    emit({ type: "done", ok: false });
    response.end();
    return;
  }

  const reconciled = reconcileBundles(dir, home, beforeDependencies);
  const next = snapshot(context);
  emit({
    type: "done",
    ok: true,
    bundles: reconciled.bundles,
    bundleChanged: reconciled.changed,
    installed: next.installed,
  });
  response.end();
}

/**
 * 插件入口。
 * @param ctx - 宿主 Cordis 上下文。
 */
export function apply(ctx) {
  const context = { ctx };
  const route = {
    kind: "prefix",
    path: PREFIX,
    handler: (request, response) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      handle(context, request, response, url.pathname, url.searchParams).catch((error) => {
        try {
          if (!response.headersSent) sendJson(response, 500, { error: String(error?.message ?? error) });
          else response.end();
        } catch {
          // 连接已经断开
        }
      });
    },
  };
  ctx.effect(() => ctx.webServer.register(route), "plugin-market: routes");
}
