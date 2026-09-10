/**
 * 把随桌面端分发的「插件市场」插件装进当前 DSH 的 web profile。
 *
 * 桌面端不改动 DSH 本身，只做三件可逆的小事：
 *   1. 把插件源码放到 `$DSH_HOME/plugins/dsh-plugin-market`；
 *   2. 在 profile 的 node_modules 下挂一个 junction，让 loader 能解析到这个包；
 *   3. 在 profile 的 package.json 里登记依赖，并在 cordis.patch.yml 里插入一行 loader entry。
 *
 * 这样装的插件与 `dsh plugin --profile web add ...` 装的是同一份状态：
 * 浏览器 UI、命令行和桌面端看到的是同一个 profile。
 */
"use strict";

const { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, symlinkSync, readlinkSync } = require("node:fs");
const { join, resolve, dirname } = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

/** 插件包名（loader 行与 client bundle id 都用它）。 */
const PACKAGE_NAME = "dsh-plugin-market";

/** 依赖里登记的相对路径（相对 profile 目录）。 */
const DEPENDENCY_SPEC = "link:../../plugins/dsh-plugin-market";

/** 插件在 DSH_HOME 下的落地目录。 */
const PLUGIN_DIR_NAME = join("plugins", PACKAGE_NAME);

/** cordis.patch.yml 缺失时使用的表头（与 DSH 随附模板一致）。 */
const DEFAULT_PATCH_HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
`;

/** 读取 JSON，失败返回 null（容忍 UTF-8 BOM）。 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/** 需要时先留一份备份，之后永不覆盖备份。 */
function backupOnce(file) {
  const backup = `${file}.dsh-desktop-backup`;
  try {
    if (existsSync(file) && !existsSync(backup)) writeFileSync(backup, readFileSync(file));
  } catch {
    // 备份失败不阻断安装
  }
}

/**
 * 计算插件源码的内容指纹。
 *
 * 只用版本号判断「是否需要重新同步」不够：开发期改代码不一定改版本，
 * 用户升级桌面端时也可能出现同版本不同内容。指纹落在安装目录里的
 * `.dsh-desktop-fingerprint`，与源码不一致就整份覆盖。
 * @returns 十六进制摘要。
 */
function fingerprint(sourceDir) {
  const hash = createHash("sha256");
  for (const relative of ["package.json", join("lib", "index.js"), join("lib", "client.js")]) {
    try {
      hash.update(relative);
      hash.update(readFileSync(join(sourceDir, relative)));
    } catch {
      hash.update(`${relative}:missing`);
    }
  }
  return hash.digest("hex");
}

/**
 * 把 `sourceDir` 同步到 `$DSH_HOME/plugins/dsh-plugin-market`。
 * 指纹一致时不动，避免每次启动都重写。
 * @returns 是否发生了写入。
 */
function syncSource(sourceDir, pluginDir) {
  const marker = join(pluginDir, ".dsh-desktop-fingerprint");
  const wanted = fingerprint(sourceDir);
  try {
    if (readFileSync(marker, "utf8").trim() === wanted && existsSync(join(pluginDir, "lib", "index.js"))) return false;
  } catch {
    // 没有指纹就重新同步
  }
  mkdirSync(dirname(pluginDir), { recursive: true });
  rmSync(pluginDir, { recursive: true, force: true });
  cpSync(sourceDir, pluginDir, { recursive: true });
  writeFileSync(marker, `${wanted}\n`);
  return true;
}

/**
 * 保证 profile 的 node_modules 下有指向插件目录的链接。
 * Windows 上用 junction（不需要管理员权限），失败时退回复制。
 * @returns 是否发生了写入。
 */
function syncLink(pluginDir, profileDir) {
  const nodeModules = join(profileDir, "node_modules");
  const linkPath = join(nodeModules, PACKAGE_NAME);
  try {
    if (existsSync(linkPath) || lstatSync(linkPath, { throwIfNoEntry: false }) !== undefined) {
      const stat = lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        try {
          const target = resolve(dirname(linkPath), readlinkSync(linkPath));
          if (target.toLowerCase() === resolve(pluginDir).toLowerCase()) return false;
        } catch {
          // 读不到链接目标就重建
        }
      }
      rmSync(linkPath, { recursive: true, force: true });
    }
  } catch {
    // 继续重建
  }
  mkdirSync(nodeModules, { recursive: true });
  try {
    symlinkSync(pluginDir, linkPath, "junction");
    return true;
  } catch {
    cpSync(pluginDir, linkPath, { recursive: true });
    return true;
  }
}

/**
 * 在 profile 的 package.json 里登记依赖。
 * @returns 是否发生了写入。
 */
function syncDependency(profileDir) {
  const manifestPath = join(profileDir, "package.json");
  const manifest = readJson(manifestPath);
  if (manifest === null) return false;
  const dependencies = { ...(manifest.dependencies ?? {}) };
  if (dependencies[PACKAGE_NAME] === DEPENDENCY_SPEC) return false;
  dependencies[PACKAGE_NAME] = DEPENDENCY_SPEC;
  backupOnce(manifestPath);
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, dependencies }, null, 2)}\n`);
  return true;
}

/**
 * 在 profile 的 cordis.patch.yml 里插入一行 loader entry。
 *
 * 这里做的是文本级插入而不是 YAML 往返：用户层可能含 `!!js` 标签，
 * 任何解析再序列化都可能改变语义。文件为空数组时替换 `[]`，否则追加。
 * @returns 是否发生了写入。
 */
function syncPatch(profileDir) {
  const patchPath = join(profileDir, "cordis.patch.yml");
  let text = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : `${DEFAULT_PATCH_HEADER}[]\n`;
  if (text.includes(`name: ${PACKAGE_NAME}`) || text.includes(`name: '${PACKAGE_NAME}'`) || text.includes(`name: "${PACKAGE_NAME}"`)) {
    return false;
  }
  const block = [
    "# ── 插件市场：由 DSH Desktop 自动写入；删掉本段与 profile 依赖即可卸载 ──",
    "- insert:",
    "    - id: plugin-market",
    `      name: ${PACKAGE_NAME}`,
    "",
  ].join("\n");
  const stripped = text.replace(/^\s*#.*$/gm, "").trim();
  const next = stripped === "[]" ? text.replace(/\[\s*\]/, block.trimEnd()) : `${text.replace(/\s*$/, "")}\n${block}`;
  backupOnce(patchPath);
  writeFileSync(patchPath, next.endsWith("\n") ? next : `${next}\n`);
  return true;
}

/**
 * 保证 profile 已经初始化。
 *
 * 全新机器上 `$DSH_HOME/profiles/web` 还不存在，而预装必须在 DSH 启动**之前**
 * 完成（否则第一次启动看不到插件市场，要启动第二次才有）。这里先让 DSH 自己把
 * profile 落盘：`--dump-default-config` 只做组装与初始化，不起服务器、不联网。
 * @returns profile 目录，以及是否可用。
 */
function ensureProfile({ nodeBin, cliBin, home, profile, log }) {
  const profileDir = join(home, "profiles", profile);
  if (existsSync(join(profileDir, "package.json"))) return { profileDir, ready: true };
  if (typeof nodeBin !== "string" || typeof cliBin !== "string") {
    log(`profile ${profile} 尚未初始化，且缺少 node/dsh 路径，无法预初始化`);
    return { profileDir, ready: false };
  }
  log(`profile ${profile} 尚未初始化，先用 dsh 初始化…`);
  try {
    const result = spawnSync(nodeBin, [cliBin, "--profile", profile, "--dump-default-config"], {
      env: { ...process.env, DSH_HOME: home },
      stdio: "ignore",
      windowsHide: true,
      timeout: 180_000,
    });
    if (result.error !== undefined) log(`初始化 profile 失败：${result.error.message}`);
  } catch (error) {
    log(`初始化 profile 抛错：${error.message}`);
  }
  const ready = existsSync(join(profileDir, "package.json"));
  if (!ready) log(`profile ${profile} 初始化后仍不可用，跳过插件市场预装`);
  return { profileDir, ready };
}

/**
 * 幂等地把插件市场插件装进指定 profile。
 * @param options - `{ home, profile, sourceDir, nodeBin, cliBin, log }`。
 * @returns `{ changed, pluginDir, profileDir }`。
 */
function provisionPluginMarket({ home, profile = "web", sourceDir, nodeBin, cliBin, log = () => {} }) {
  const pluginDir = join(home, PLUGIN_DIR_NAME);
  if (!existsSync(sourceDir)) {
    log(`未找到随附的插件市场源码：${sourceDir}`);
    return { changed: false, pluginDir, profileDir: join(home, "profiles", profile), skipped: true };
  }
  const { profileDir, ready } = ensureProfile({ nodeBin, cliBin, home, profile, log });
  if (!ready) return { changed: false, pluginDir, profileDir, skipped: true };

  const changes = [];
  if (syncSource(sourceDir, pluginDir)) changes.push("源码");
  if (syncLink(pluginDir, profileDir)) changes.push("链接");
  if (syncDependency(profileDir)) changes.push("依赖");
  if (syncPatch(profileDir)) changes.push("patch");
  if (changes.length > 0) log(`插件市场已就绪（更新：${changes.join("/")}）`);
  return { changed: changes.length > 0, pluginDir, profileDir, skipped: false };
}

/**
 * 反向清理：删掉 patch 行、依赖与链接（保留 DSH_HOME/plugins 下的源码）。
 * @returns 是否发生了写入。
 */
function unprovisionPluginMarket({ home, profile = "web", log = () => {} }) {
  const profileDir = join(home, "profiles", profile);
  let changed = false;

  const manifestPath = join(profileDir, "package.json");
  const manifest = readJson(manifestPath);
  if (manifest !== null && manifest.dependencies && PACKAGE_NAME in manifest.dependencies) {
    const dependencies = { ...manifest.dependencies };
    delete dependencies[PACKAGE_NAME];
    backupOnce(manifestPath);
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, dependencies }, null, 2)}\n`);
    changed = true;
  }

  const patchPath = join(profileDir, "cordis.patch.yml");
  if (existsSync(patchPath)) {
    const text = readFileSync(patchPath, "utf8");
    const next = text.replace(
      /# ── 插件市场[\s\S]*?name: "?dsh-plugin-market"?\n?/,
      "",
    );
    if (next !== text) {
      backupOnce(patchPath);
      writeFileSync(patchPath, next.replace(/\[\s*\]\s*$/, "[]\n"));
      changed = true;
    }
  }

  const linkPath = join(profileDir, "node_modules", PACKAGE_NAME);
  try {
    if (lstatSync(linkPath, { throwIfNoEntry: false }) !== undefined) {
      rmSync(linkPath, { recursive: true, force: true });
      changed = true;
    }
  } catch {
    // 忽略
  }
  if (changed) log("插件市场已从 profile 移除（需要重启 DSH 生效）");
  return changed;
}

module.exports = { provisionPluginMarket, unprovisionPluginMarket, PACKAGE_NAME, DEPENDENCY_SPEC };
