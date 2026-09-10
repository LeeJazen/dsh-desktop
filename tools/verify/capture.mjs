/**
 * 自动化验证：启动桌面端（打包产物或开发模式），等到页面稳定后截图并打印诊断。
 *
 * 用法：
 *   node tools/verify/capture.mjs                       # 验证打包产物，截 docs/verify-main.png
 *   node tools/verify/capture.mjs --dev                 # 验证开发模式（electron .）
 *   node tools/verify/capture.mjs --market              # 先点到插件市场再截图
 *   node tools/verify/capture.mjs --out shot.png --delay 15000
 *
 * 说明：Electron 在受限沙箱里无法建立进程间管道，需要在普通用户会话里运行。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);

/** 读取 `--name value` 形式的参数。 */
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

const dev = args.includes("--dev");
const market = args.includes("--market");
const out = resolve(ROOT, option("out", market ? "docs/verify-plugin-market.png" : "docs/verify-desktop.png"));
const delayMs = option("delay", "15000");
const workspace = option("workspace", process.env.USERPROFILE ?? ROOT);

const exe = dev
  ? join(ROOT, "node_modules", "electron", "dist", "electron.exe")
  : join(ROOT, "dist", "DSH Desktop", "DSH Desktop.exe");
if (!existsSync(exe)) {
  console.error(`找不到可执行文件：${exe}\n打包产物请先运行 npm run dist。`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });

const env = {
  ...process.env,
  DSH_DESKTOP_CAPTURE: out,
  DSH_DESKTOP_CAPTURE_DELAY_MS: String(delayMs),
  DSH_DESKTOP_EXIT_AFTER_CAPTURE: "1",
};
if (market) {
  env.DSH_DESKTOP_CAPTURE_SCRIPT = readFileSync(join(ROOT, "tools", "verify", "open-plugin-market.js"), "utf8");
} else {
  // 主界面截图：先关掉 DSH 首次启动的引导弹窗，避免截图被挡住。
  env.DSH_DESKTOP_CAPTURE_SCRIPT = readFileSync(join(ROOT, "tools", "verify", "dismiss-overlays.js"), "utf8");
}

console.log(`启动：${exe}${dev ? " ." : ""}`);
console.log(`截图：${out}`);
console.log(`工作目录（agent workspace）：${workspace}`);

const child = spawn(exe, dev ? [".", "--workspace", workspace] : [], {
  cwd: ROOT,
  env,
  stdio: "ignore",
  windowsHide: false,
});

child.on("exit", (code) => {
  console.log(`桌面端退出，code=${code}`);
  console.log(`截图已保存：${out}`);
  const logFile = join(process.env.APPDATA ?? "", "DSH Desktop", "logs", "dsh-web.log");
  if (existsSync(logFile)) {
    console.log("\n最近日志：");
    for (const line of readFileSync(logFile, "utf8").split(/\r?\n/).slice(-12)) console.log(`  ${line}`);
  }
});
