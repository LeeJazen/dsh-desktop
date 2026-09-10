/**
 * 启动中 / 出错状态页的共享脚本：渲染主进程推送的状态与日志尾部。
 */
"use strict";

const shell = window.dshShell;

/** 把最近日志渲染到 <pre> 里，并滚到底部。 */
function renderLog(log) {
  const node = document.getElementById("log");
  if (!node) return;
  const lines = Array.isArray(log) ? log : [];
  node.textContent = lines.join("\n");
  node.scrollTop = node.scrollHeight;
}

/** 渲染运行时路径信息（出错的排查关键）。 */
function renderRuntime(runtime) {
  const node = document.getElementById("runtime");
  if (!node) return;
  if (!runtime) {
    node.classList.add("hidden");
    return;
  }
  node.classList.remove("hidden");
  node.textContent = [
    `DSH_HOME   ${runtime.dshHome}`,
    `node       ${runtime.nodeBin ?? "（未找到）"}`,
    `dsh CLI    ${runtime.cli ? `${runtime.cli.binPath}  (${runtime.cli.version ?? "版本未知"})` : "（未找到）"}`,
    `工作目录   ${runtime.workspace}`,
    `已装 profile ${(runtime.profiles ?? []).join(", ") || "（无）"}`,
  ].join("\n");
}

/** 渲染一条状态推送。 */
function render(state) {
  if (!state) return;
  const message = document.getElementById("message");
  if (message && typeof state.message === "string" && state.message !== "") {
    message.textContent = state.message;
  }
  renderRuntime(state.runtime);
  renderLog(state.logTail);
}

if (shell) {
  shell.onState(render);
  shell.getState().then(render);

  const bind = (id, action) => {
    const node = document.getElementById(id);
    if (node) node.addEventListener("click", () => action());
  };
  bind("browser", () => shell.openInBrowser());
  bind("quit", () => shell.quit());
  bind("retry", () => shell.retry());
  bind("open-log", () => shell.openLog());
  bind("open-data", () => shell.openDataDir());
}
