/**
 * 打包绿色免安装版：`dist/DSH Desktop/DSH Desktop.exe`
 *
 * 不用 electron-builder（需要 NSIS / winCodeSign 工具链），也不用
 * @electron/packager（它每次都要联网校验运行时压缩包，网络一抖就卡死）。
 * 这里只做四件事：拷 Electron 运行时、改名 exe、摆好 resources/app、
 * 用 resedit 把图标与版本信息写进 exe。
 *
 * 全程记录「当前阶段」，出错时直接指出是哪一步挂的、路径是什么、环境长什么样，
 * 免得在 CI 上只看到一句 "Process completed with exit code 1"。
 *
 * 用法：node tools/build-app.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 当前正在做的阶段，出错时用来定位。 */
let phase = "启动";

/** 打印一行进度。 */
function step(message) {
  phase = message;
  console.log(`• ${message}`);
}

/** 列出目录内容（诊断用，最多 12 项）。 */
function peek(dir) {
  try {
    const names = readdirSync(dir).slice(0, 12);
    return names.length > 0 ? names.join(", ") : "(空目录)";
  } catch (error) {
    return `(读不到：${error.code ?? error.message})`;
  }
}

/** 打印环境自检信息，出问题时这几行就是关键线索。 */
function reportEnvironment() {
  console.log("── 环境自检 ─────────────────────────────");
  console.log(`  node        ${process.version}  ${process.platform}/${process.arch}`);
  console.log(`  仓库根      ${ROOT}`);
  console.log(`  工作目录    ${process.cwd()}`);
  console.log(`  可用内存    ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB (rss)`);
  for (const entry of ["package.json", "build/icon.ico", "electron/main.js", "plugin-market/package.json"]) {
    console.log(`  ${existsSync(join(ROOT, entry)) ? "有  " : "缺失"} ${entry}`);
  }
  for (const entry of ["node_modules", "node_modules/electron", "node_modules/electron/dist", "node_modules/pnpm", "node_modules/resedit"]) {
    const full = join(ROOT, entry);
    console.log(`  ${existsSync(full) ? "有  " : "缺失"} ${entry}`);
  }
  console.log("─────────────────────────────────────────");
}

/**
 * 用 resedit 把图标与版本信息写进 exe；失败不阻断打包。
 * @param exePath - 目标 exe。
 * @param appVersion - package.json 里的版本号，写进 exe 的文件属性。
 */
async function patchExecutable(exePath, appVersion) {
  const iconPath = join(ROOT, "build", "icon.ico");
  if (!existsSync(iconPath)) {
    console.warn("  警告：build/icon.ico 不存在，跳过图标写入（可先运行 npm run icon）");
    return;
  }
  let resedit;
  try {
    resedit = await import("resedit");
  } catch (error) {
    console.warn(`  警告：缺少 resedit，跳过图标写入（${error.message}）`);
    return;
  }
  const { NtExecutable, NtExecutableResource, Resource, Data } = resedit;
  console.log(`  读取 exe（${(statSync(exePath).size / 1048576).toFixed(1)} MB）…`);
  const executable = NtExecutable.from(readFileSync(exePath), { ignoreCert: true });
  const resources = NtExecutableResource.from(executable);

  const iconFile = Data.IconFile.from(readFileSync(iconPath));
  Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    1033,
    iconFile.icons.map((icon) => icon.data),
  );

  // 版本号只在 package.json 里维护一份，这里解析成 Windows 要求的四段式。
  const versionParts = String(appVersion ?? "0.0.0")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  const [major = 0, minor = 0, patch = 0] = versionParts;
  const versionInfo = Resource.VersionInfo.createEmpty();
  versionInfo.setFileVersion(major, minor, patch, 0);
  versionInfo.setProductVersion(major, minor, patch, 0);
  versionInfo.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: "DSH Desktop",
      FileDescription: "DeepSeek Harness 桌面端",
      CompanyName: "DSH Desktop",
      LegalCopyright: "MIT License",
      OriginalFilename: "DSH Desktop.exe",
      InternalName: "dsh-desktop",
    },
  );
  // 先丢掉 Electron 自带的版本资源（RT_VERSION = 16），否则文件属性里会留着 "Electron"。
  for (let index = resources.entries.length - 1; index >= 0; index -= 1) {
    if (resources.entries[index].type === 16) resources.entries.splice(index, 1);
  }
  versionInfo.outputToResourceEntries(resources.entries);

  resources.outputResource(executable);
  console.log("  重新生成 exe…");
  writeFileSync(exePath, Buffer.from(executable.generate()));
}

/** 统计目录体积。 */
function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else total += statSync(full).size;
  }
  return total;
}

/** 打包主流程。 */
async function main() {
  reportEnvironment();

  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const appName = manifest.productName ?? manifest.name;
  const electronDist = join(ROOT, "node_modules", "electron", "dist");
  const out = join(ROOT, "dist", appName);
  const exe = join(out, `${appName}.exe`);

  step("检查 Electron 运行时");
  if (!existsSync(electronDist)) {
    // electron 44 没有 postinstall，npm install 之后 dist 本来就是空的，
    // 这里兜底跑一次它自带的安装脚本，避免「clone 下来就打包失败」。
    console.log("  node_modules/electron/dist 缺失，调用 tools/ensure-electron.mjs 补下载…");
    const ensured = spawnSync(process.execPath, [join(ROOT, "tools", "ensure-electron.mjs")], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    if (ensured.error !== undefined) {
      throw new Error(`运行 Electron 安装脚本失败：${ensured.error.message}`);
    }
  }
  if (!existsSync(electronDist)) {
    throw new Error(`找不到 Electron 运行时目录：${electronDist}\n  node_modules/electron 内容：${peek(join(ROOT, "node_modules", "electron"))}\n  请先执行 npm install`);
  }
  console.log(`  内容：${peek(electronDist)}`);

  step(`清理 ${out}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  step("复制 Electron 运行时");
  cpSync(electronDist, out, { recursive: true });

  step("重命名 electron.exe");
  const sourceExe = join(out, "electron.exe");
  if (!existsSync(sourceExe)) {
    throw new Error(`复制后找不到 ${sourceExe}\n  产物目录内容：${peek(out)}`);
  }
  renameSync(sourceExe, exe);
  // Electron 的默认 app 壳不再需要，留着只会让人困惑。
  rmSync(join(out, "resources", "default_app.asar"), { force: true });

  step("摆放 resources/app");
  const appDir = join(out, "resources", "app");
  mkdirSync(appDir, { recursive: true });
  for (const entry of ["electron", "build", "plugin-market"]) {
    if (!existsSync(join(ROOT, entry))) throw new Error(`缺少应用目录：${entry}`);
    cpSync(join(ROOT, entry), join(appDir, entry), { recursive: true });
  }
  // 只保留运行需要的最小清单：没有 dependencies，pnpm 是随包分发的工具而不是 require 目标。
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify(
      {
        name: manifest.name,
        productName: appName,
        version: manifest.version,
        private: true,
        description: manifest.description,
        main: manifest.main,
        type: "commonjs",
      },
      null,
      2,
    )}\n`,
  );

  step("随包分发 pnpm（插件市场安装插件用）");
  const pnpmSource = join(ROOT, "node_modules", "pnpm");
  if (existsSync(pnpmSource)) {
    cpSync(pnpmSource, join(appDir, "node_modules", "pnpm"), { recursive: true });
  } else {
    console.warn("  警告：没找到 node_modules/pnpm，插件市场的安装功能会依赖 PATH 上的 pnpm");
  }

  step("写入 exe 图标与版本信息");
  try {
    await patchExecutable(exe, manifest.version);
  } catch (error) {
    console.warn(`  警告：写入 exe 资源失败（不影响运行）：${error.message}`);
    console.warn(String(error.stack ?? "").split("\n").slice(0, 4).join("\n"));
  }

  step("写入使用说明与快捷方式脚本");
  writeFileSync(
    join(out, "使用说明.txt"),
    [
      "DSH Desktop（绿色免安装版）",
      "",
      "1. 双击本目录下的“DSH Desktop.exe”即可启动。",
      "2. 桌面端复用本机已安装的 DSH：会话、设置、凭据、插件都在 %USERPROFILE%\\.dsh 下，",
      "   与命令行 `dsh web` 和浏览器 UI 完全共享同一份数据。",
      "3. 如果还没装 DSH，先执行：npm i -g @deepseek-ai/dsh",
      "4. 双击“创建桌面快捷方式.cmd”可以在桌面生成带图标的快捷方式。",
      "5. 插件市场在「设置 → 插件 → 插件市场」，装好的插件浏览器端也能看到。",
      "6. 整个文件夹可以直接拷到别处或 U 盘；删掉即卸载，DSH 数据不受影响。",
      "",
      "常用菜单：",
      "  DSH → 打开插件市场        直接跳到插件市场标签页",
      "  DSH → 重启 DSH 服务       装完插件后让它生效",
      "  DSH → 选择工作目录…       改 agent 的 workspace 根目录",
      "  DSH → 打开日志文件        启动失败时看这里",
      "",
    ].join("\r\n"),
    "utf8",
  );

  // 注意：这里必须用 %~dp0 而不是 $PSScriptRoot —— 通过 -Command 调用时后者为空。
  writeFileSync(
    join(out, "创建桌面快捷方式.cmd"),
    [
      "@echo off",
      "chcp 65001 >nul",
      "setlocal",
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "$dir = \'%~dp0\'; $exe = Join-Path $dir \'DSH Desktop.exe\'; if (-not (Test-Path $exe)) { Write-Host \'找不到 DSH Desktop.exe\'; exit 1 }; $lnk = Join-Path ([Environment]::GetFolderPath(\'Desktop\')) \'DSH Desktop.lnk\'; $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath = $exe; $s.WorkingDirectory = $dir; $s.IconLocation = $exe; $s.Description = \'DeepSeek Harness 桌面端\'; $s.Save(); Write-Host (\'已创建桌面快捷方式: \' + $lnk)"',
      "pause",
      "",
    ].join("\r\n"),
    "utf8",
  );

  step("统计产物体积");
  console.log(`\n打包完成：${out}`);
  console.log(`可执行文件：${exe}`);
  console.log(`产物体积：${(directorySize(out) / 1024 / 1024).toFixed(0)} MB`);
}

try {
  await main();
} catch (error) {
  console.error(`\n✗ 打包失败，阶段：「${phase}」`);
  console.error(error?.stack ?? String(error));
  process.exit(1);
}
