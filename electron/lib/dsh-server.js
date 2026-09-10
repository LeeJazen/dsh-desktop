/**
 * 以子进程方式托管 `dsh --profile web`，并把启动时打印的带 token URL 交给窗口。
 *
 * DSH 的 Web UI 只认启动那一刻打印出来的 URL（URL 里带一次性进程 token，
 * 访问后换成签名 cookie），所以桌面端必须监听子进程输出，而不是自己
 * 拼一个 http://127.0.0.1:port。
 */
"use strict";

const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

/** 去掉 ANSI 转义序列，便于把日志原样显示在错误页里。 */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** 就绪超时：首次启动可能要做 profile 初始化，给足时间。 */
const READY_TIMEOUT_MS = 180_000;

class DshServer extends EventEmitter {
  #child = null;
  #buffer = "";
  #readyTimer = null;
  #stopping = false;

  constructor({ nodeBin, cliBin, dshHome, workspace, profile, extraArgs = [], pnpm, onLog }) {
    super();
    this.nodeBin = nodeBin;
    this.cliBin = cliBin;
    this.dshHome = dshHome;
    this.workspace = workspace;
    this.profile = profile ?? "web";
    this.extraArgs = extraArgs;
    this.pnpm = pnpm;
    this.onLog = onLog ?? (() => {});
    this.url = null;
  }

  /** 子进程环境：继承当前环境，注入 DSH_HOME 与桌面端自带的 pnpm。 */
  #environment() {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_NO_ATTACH_CONSOLE;
    env.DSH_HOME = this.dshHome;
    env.DSH_DESKTOP_SHELL = "1";
    if (this.pnpm?.script) {
      env.DSH_PNPM_BIN = this.pnpm.script;
      const binDir = require("node:path").dirname(this.pnpm.script);
      env.PATH = `${binDir};${env.PATH ?? ""}`;
    }
    return env;
  }

  /** 完整命令行，用于诊断展示。 */
  commandLine() {
    return [this.nodeBin, this.cliBin, "--profile", this.profile, "--no-open", "--port", "0", ...this.extraArgs];
  }

  /** 启动子进程；就绪时 emit("ready", url)，退出时 emit("exit", info)。 */
  start() {
    if (this.#child) throw new Error("DSH 子进程已经在运行");
    this.#stopping = false;
    this.url = null;
    this.#buffer = "";

    const argv = [
      this.cliBin,
      "--profile",
      this.profile,
      "--no-open",
      "--port",
      "0",
      ...this.extraArgs,
    ];
    this.emit("log", `$ ${this.nodeBin} ${argv.join(" ")}`);

    let child;
    try {
      child = spawn(this.nodeBin, argv, {
        cwd: this.workspace,
        env: this.#environment(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      this.emit("exit", { code: null, signal: null, error });
      return;
    }

    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#ingest(chunk));
    child.stderr.on("data", (chunk) => this.#ingest(chunk));

    child.on("error", (error) => {
      this.emit("log", `启动失败: ${error.message}`);
      this.#finish(null, null, error);
    });
    child.on("exit", (code, signal) => this.#finish(code, signal, null));

    this.#readyTimer = setTimeout(() => {
      if (this.url) return;
      this.emit("log", `等待 ${Math.round(READY_TIMEOUT_MS / 1000)}s 仍未拿到启动 URL`);
      this.stop();
      this.emit("exit", {
        code: null,
        signal: null,
        error: new Error(`DSH 在 ${Math.round(READY_TIMEOUT_MS / 1000)} 秒内没有打印启动 URL`),
      });
    }, READY_TIMEOUT_MS);
  }

  /** 消费子进程输出：逐行记录日志，并从中提取启动 URL。 */
  #ingest(chunk) {
    this.#buffer += chunk;
    const lines = this.#buffer.split(/\r?\n/);
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) this.#consumeLine(line);
  }

  #consumeLine(rawLine) {
    const line = rawLine.replace(ANSI, "").trimEnd();
    if (line.trim() !== "") this.emit("log", line);
    if (this.url) return;
    const match = /dsh web:\s*(https?:\/\/\S+)/.exec(line);
    if (!match) return;
    this.url = match[1];
    clearTimeout(this.#readyTimer);
    this.#readyTimer = null;
    this.emit("ready", this.url);
  }

  #finish(code, signal, error) {
    clearTimeout(this.#readyTimer);
    this.#readyTimer = null;
    const wasStopping = this.#stopping;
    this.#child = null;
    this.#stopping = false;
    this.emit("exit", { code, signal, error, expected: wasStopping });
  }

  /** 是否还在运行。 */
  get running() {
    return this.#child !== null;
  }

  /**
   * 结束子进程：先 SIGTERM 让它走 DSH 自己的有界关闭流程，超时后强杀。
   * @returns 进程完全退出后 settle 的 promise。
   */
  stop({ graceMs = 6000 } = {}) {
    const child = this.#child;
    if (!child) return Promise.resolve();
    this.#stopping = true;
    return new Promise((resolveDone) => {
      const kill = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // 已经退出
        }
      }, graceMs);
      child.once("exit", () => {
        clearTimeout(kill);
        resolveDone();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(kill);
        resolveDone();
      }
    });
  }
}

module.exports = { DshServer, READY_TIMEOUT_MS };
