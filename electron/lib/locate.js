/**
 * 定位本机的 DSH 运行时：node、dsh CLI、DSH_HOME、随桌面端分发的 pnpm。
 *
 * 桌面端**不打包也不复制** DSH 本身：它启动的是本机已安装的同一份 DSH
 * （同一个 DSH_HOME、同一个 web profile），因此会话、设置、凭据、插件
 * 与命令行/浏览器用法完全互通。
 */
"use strict";

const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { join, dirname, isAbsolute, resolve } = require("node:path");
const os = require("node:os");

/** 读取一个包的版本号，失败返回 null。 */
function packageVersion(manifestPath) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * 解析 DSH_HOME：显式环境变量优先，否则用 ~/.dsh
 * （与 @deepseek-ai/dsh-home-paths 的默认值一致）。
 */
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return resolve(fromEnv.trim());
  return join(os.homedir(), ".dsh");
}

/**
 * 解析用来运行 DSH 的 node 可执行文件。
 *
 * 必须是**真正的 node**，不能用 Electron 自带的 Node：DSH 依赖按 Node ABI
 * 编译的原生模块（sharp / node-pty / koffi 等），Electron 的 ABI 不兼容。
 */
function resolveNodeBin() {
  const candidates = [];
  if (process.env.DSH_NODE_BIN) candidates.push(process.env.DSH_NODE_BIN);
  for (const dir of (process.env.PATH ?? "").split(";")) {
    if (dir.trim() !== "") candidates.push(join(dir.trim(), "node.exe"));
  }
  candidates.push(
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe",
    "C:\\node\\node.exe",
    join(os.homedir(), "scoop", "apps", "nodejs", "current", "node.exe"),
    "/usr/local/bin/node",
    "/usr/bin/node",
  );
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return resolve(candidate);
    } catch {
      // 忽略非法路径
    }
  }
  return null;
}

/**
 * 解析 dsh CLI 的 lib/bin.js。
 *
 * 只认本机已安装的 DSH：npm 全局目录、DSH_HOME/profiles 的 hoisted
 * node_modules，以及若干常见全局前缀。
 */
function resolveDshCli(dshHome = resolveDshHome()) {
  const candidates = [];
  if (process.env.DSH_CLI) candidates.push(process.env.DSH_CLI);
  for (const dir of (process.env.PATH ?? "").split(";")) {
    if (dir.trim() !== "") {
      candidates.push(join(dir.trim(), "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"));
    }
  }
  const prefixes = [
    join(os.homedir(), "node_global", "node_modules"),
    join(process.env.APPDATA ?? "", "npm", "node_modules"),
    "C:\\Program Files\\nodejs\\node_modules",
    join(dshHome, "profiles", "node_modules"),
    join(dshHome, "profiles", "web", "node_modules"),
  ];
  for (const prefix of prefixes) {
    if (prefix && isAbsolute(prefix)) {
      candidates.push(join(prefix, "@deepseek-ai", "dsh", "lib", "bin.js"));
    }
  }
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) {
        return {
          binPath: resolve(candidate),
          version: packageVersion(join(dirname(candidate), "..", "package.json")),
        };
      }
    } catch {
      // 忽略
    }
  }
  return null;
}

/**
 * 找到可用于安装插件的 pnpm。
 *
 * 优先级：显式 DSH_PNPM_BIN → 桌面端自带的 pnpm → PATH 上的 pnpm。
 * 返回 `{ command, args }` 前缀，调用方在后面追加 pnpm 的参数。
 */
function resolvePnpm(resourcesPath) {
  const candidates = [];
  if (process.env.DSH_PNPM_BIN) candidates.push(process.env.DSH_PNPM_BIN);
  if (resourcesPath) {
    candidates.push(join(resourcesPath, "app", "node_modules", "pnpm", "bin", "pnpm.cjs"));
    candidates.push(join(resourcesPath, "pnpm", "bin", "pnpm.cjs"));
  }
  // 本文件在 electron/lib/ 下，仓库根的 node_modules 要往上两级。
  candidates.push(join(__dirname, "..", "..", "node_modules", "pnpm", "bin", "pnpm.cjs"));
  // 打包后 app 目录的 node_modules 与 binaries 同级。
  candidates.push(join(process.resourcesPath ?? "", "app", "node_modules", "pnpm", "bin", "pnpm.cjs"));
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return { script: resolve(candidate) };
    } catch {
      // 忽略
    }
  }
  return null;
}

/** pnpm 自带 bin 目录（放进子进程 PATH，让 `dsh plugin` 也能直接用）。 */
function pnpmBinDir(pnpm) {
  return pnpm ? dirname(pnpm.script) : null;
}

/** 列出 DSH_HOME 下已存在的 profile 名字（用于诊断展示）。 */
function listProfiles(dshHome) {
  try {
    return readdirSync(join(dshHome, "profiles"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

module.exports = {
  resolveDshHome,
  resolveNodeBin,
  resolveDshCli,
  resolvePnpm,
  pnpmBinDir,
  listProfiles,
  packageVersion,
};
