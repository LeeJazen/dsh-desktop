/**
 * 确保 Electron 运行时已下载到 `node_modules/electron/dist`。
 *
 * 背景：electron 44 的 package.json 里**没有 postinstall**（只声明了一个
 * `install-electron` bin），所以 `npm install` / `npm ci` 装完依赖后
 * `node_modules/electron/dist` 是空的，必须显式跑一次它自带的 `install.js`。
 * 少了这一步，`npm run dist` 会直接失败。
 *
 * 这个脚本同时挂在 package.json 的 postinstall 上，并被 tools/build-app.mjs
 * 在 dist 缺失时兜底调用。
 *
 * 用法：node tools/ensure-electron.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronDir = join(ROOT, "node_modules", "electron");
const distDir = join(electronDir, "dist");
const installer = join(electronDir, "install.js");

/** 读取已解压运行时的版本号（失败返回 null）。 */
function installedVersion() {
  try {
    return readFileSync(join(distDir, "version"), "utf8").trim();
  } catch {
    return null;
  }
}

if (existsSync(distDir)) {
  console.log(`Electron 运行时已就位${installedVersion() === null ? "" : `（${installedVersion()}）`}`);
  process.exit(0);
}

if (!existsSync(installer)) {
  console.error(`找不到 ${installer}。请先执行 npm install。`);
  process.exit(1);
}

console.log("Electron 运行时缺失，开始下载（约 150 MB，只需一次）…");
console.log("下载慢的话可以先设置镜像：");
console.log('  PowerShell:  $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"');
console.log("  bash:        export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/");

const result = spawnSync(process.execPath, [installer], { cwd: ROOT, stdio: "inherit", env: process.env });

if (result.error !== undefined) {
  console.error(`\n✗ 执行 Electron 安装脚本失败：${result.error.message}`);
  process.exit(1);
}
if (!existsSync(distDir)) {
  console.error(`\n✗ 安装脚本退出码 ${result.status}，但 ${distDir} 仍未生成。`);
  console.error("  多半是下载失败（网络/代理）。设置 ELECTRON_MIRROR 后重试。");
  process.exit(1);
}

console.log(`\nElectron 运行时已就绪${installedVersion() === null ? "" : `（${installedVersion()}）`}`);
