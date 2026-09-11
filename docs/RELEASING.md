# 发布说明

这份文档面向**维护者**：怎么把 DSH Desktop 发出去、版本怎么改、CI 是怎么工作的。
使用者只需要看 [README.zh-CN.md](../README.zh-CN.md)（英文版：[README.md](../README.md)）。

> 这份文档目前只有中文，且**没有从 README 链接过来**——需要时直接看 `docs/` 目录里的这个文件。

## 为什么仓库里没有 exe

打包产物约 **387 MB**，其中 `DSH Desktop.exe` 单个就有 **234 MB**，
超过 GitHub **单文件 100 MB** 的硬限制，普通 push 会被直接拒绝。

所以：

- `dist/` 在 `.gitignore` 里，**仓库只放源码**（约 340 KB）；
- 可运行的产物通过 **GitHub Release 附件**分发（附件上限 2 GB）；
- 使用者从 Releases 页面下载 zip，而不是 clone 仓库。

## 发布一个新版本

### 1. 改版本号

只需要改一处：`package.json` 的 `version`。它会同时决定

- 打包产物 `resources/app/package.json` 里的版本（应用「关于」对话框读的就是它），
- 写进 exe 文件属性的文件/产品版本（`tools/build-app.mjs` 会解析这个值）。

### 2. 本地验证（可选但推荐）

```powershell
npm install
npm run dist
node tools/verify/capture.mjs --market
```

会启动刚打好的产物、打开插件市场并截图，用来确认没打包坏。

### 3. 提交并打 tag

```powershell
git add -A
git commit -F 消息.txt        # 中文提交信息走文件，PowerShell 直接传 -m 会乱码
git push
git tag v0.1.0
git push origin v0.1.0
```

推 tag 之后，[`.github/workflows/build-desktop.yml`](../.github/workflows/build-desktop.yml) 会自动：

1. `npm ci` 安装依赖（含 Electron 运行时）；
2. `npm run dist` 打出绿色版；
3. 压成 `DSH-Desktop-win32-x64.zip`；
4. 作为附件挂到同名 Release 上（`generate_release_notes: true`）。

整个过程约 5～10 分钟。想只产出 Artifact 不建 Release，去 Actions 页面手动触发
`workflow_dispatch` 即可。

### 4. 检查

Actions 跑完后到 Releases 页面确认附件在、大小正常（约 300 MB 上下），
然后下载解压、双击试一次。

## CI 注意事项

- `npm ci` 需要 `package-lock.json` 与 `package.json` 完全同步。改了依赖记得本地跑一次
  `npm install` 更新 lockfile 再提交，否则 CI 会直接失败。
- 工作流只跑 `windows-latest`。要出别的平台，需要改 `tools/build-app.mjs` 的平台参数并
  准备对应的 Electron 运行时。
- Release 步骤用的是 `softprops/action-gh-release`，需要 `permissions: contents: write`
  （工作流里已经声明）。

## 关于「完全自包含」的取舍

目前的设计是**依赖本机已装的 DSH**，使用者要自己 `npm i -g @deepseek-ai/dsh`。
如果想让产物真正做到「下载解压就能用、什么都不装」，需要额外打包：

| 组件 | 体积 | 说明 |
|---|---|---|
| 自带 `node.exe` | 88 MB | DSH 依赖按 Node ABI 编译的原生模块，不能用 Electron 自带的 Node |
| 全局 dsh 安装树 | 213 MB | 含 189 个依赖目录与原生二进制 |
| 现有产物 | 387 MB | Electron 运行时 + 应用代码 + 随包 pnpm |
| **合计** | **约 690 MB** | 压缩后估计 300 MB 上下 |

好消息是 **`~/.dsh/profiles/node_modules` 不需要打包**——那整棵树都是 junction，
真正的文件在全局安装里，而 DSH 每次启动都会跑 `healProfilesModuleFallback`
按当前实际安装位置重建这些链接（全新 `DSH_HOME` 能自己长出来，已验证）。

原生模块方面，sharp / koffi / node-pty 都是 prebuild（`sharp-win32-x64`、`koffi-win32-x64`、
`prebuilds/win32-x64/*.node`），不是安装时现编译，所以只要自带同版本的 `node.exe`，
ABI 就是对得上的。

**没做这件事的原因**：690 MB 的产物体积、杀软扫描变慢，而且只能在有 Node 的机器上验证，
无法确信在真正干净的 Windows 上不出问题。如果以后要做，改动集中在
`electron/lib/locate.js`（优先使用自带 node/dsh）、`tools/build-app.mjs`（多拷两棵树）
和首次启动逻辑。
