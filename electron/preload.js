/**
 * 状态页（启动中/出错）用的最小 IPC 桥。
 * DSH 页面本身不需要它，这里只暴露几个安全的方法。
 */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshShell", {
  getState: () => ipcRenderer.invoke("shell:get-state"),
  onState: (callback) => {
    ipcRenderer.on("shell:state", (_event, state) => callback(state));
  },
  retry: () => ipcRenderer.invoke("shell:retry"),
  // 供「插件市场」页面在装完插件后请求重启 DSH 服务。
  restart: () => ipcRenderer.invoke("shell:restart"),
  openLog: () => ipcRenderer.invoke("shell:open-log"),
  openDataDir: () => ipcRenderer.invoke("shell:open-data-dir"),
  openInBrowser: () => ipcRenderer.invoke("shell:open-browser"),
  quit: () => ipcRenderer.invoke("shell:quit"),
});
