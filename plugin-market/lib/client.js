/**
 * 插件市场 —— 浏览器半边。
 *
 * 在「设置 → 插件」分区里加一个「插件市场」标签页：浏览官方插件清单、
 * 搜索社区插件、一键安装/卸载，并显示 pnpm 的实时日志。所有数据都来自
 * 宿主半边的同源 HTTP 路由 `/plugin-market/*`，因此桌面端与网页端共用。
 *
 * 这个文件是浏览器 bundle：经典脚本 + `window.__ModuleLoader__.load`，
 * 由 dsh-client-modules 服务到 /plugins/...，不需要构建步骤。
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-market",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");
    let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    // ─────────────────────────── 样式 ───────────────────────────
    const css = `
.pmkRoot{display:flex;flex-direction:column;gap:16px;width:100%;min-width:0}
.pmkBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pmkSearch{position:relative;display:flex;align-items:center;gap:8px;flex:1;min-width:220px}
.pmkSearch input{width:100%;height:34px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:9px;padding:0 12px;font:inherit;font-size:13px;outline:none}
.pmkSearch input:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.pmkHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.pmkNotice{display:flex;align-items:center;gap:10px;justify-content:space-between;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);border-radius:10px;padding:8px 12px;font-size:12.5px;line-height:18px}
.pmkSection{display:flex;flex-direction:column;gap:8px}
.pmkSectionTitle{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px}
.pmkList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.pmkCard{background:var(--dsw-alias-bg-layer-3);border-radius:12px;box-shadow:var(--dsw-elevation-stroke);padding:10px 12px;display:flex;align-items:flex-start;gap:12px;min-width:0}
.pmkCardMain{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.pmkName{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all}
.pmkDesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);word-break:break-word}
.pmkMeta{font-size:11.5px;color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-tertiary))}
.pmkTags{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.pmkActions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.pmkLog{margin:0;max-height:220px;overflow:auto;background:#0f1015;border:1px solid var(--dsw-alias-border-l4);border-radius:10px;padding:10px 12px;font-family:Consolas,"Cascadia Mono",monospace;font-size:11.5px;line-height:1.5;color:#b9c0cf;white-space:pre-wrap;word-break:break-all}
.pmkEmpty{font-size:12.5px;color:var(--dsw-alias-label-tertiary);padding:4px 0}
`;
    const tagId = "dsh-plugin-market/market.css";
    if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin-market";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ─────────────────────────── 本地化 ───────────────────────────
    const NS = "settings.pluginMarket";
    const zh = {
      tab: "插件市场",
      installed: "已安装插件",
      installedEmpty: "当前 profile 还没有安装任何插件。",
      browse: "社区插件",
      search: "搜索 npm 上的 DSH 插件…",
      searchAction: "搜索",
      searching: "正在搜索…",
      searchEmpty: "没有匹配的插件。",
      searchHint: "搜索的是 npm 上的公开包，结果已按 DSH 关键词过滤。",
      install: "安装",
      uninstall: "卸载",
      installing: "安装中…",
      removing: "卸载中…",
      official: "官方",
      clientSide: "带界面",
      hostSide: "宿主",
      loaded: "已加载",
      notResolved: "未解析",
      profile: "profile",
      pnpmMissing: "未找到 pnpm，安装/卸载不可用。",
      pnpmFrom: "pnpm 来源",
      restartTitle: "需要重启 DSH 才能加载新插件。",
      restart: "立即重启",
      restartManual: "请重启 DSH（桌面端菜单：DSH → 重启 DSH 服务）。",
      close: "收起日志",
      logs: "pnpm 输出",
      stateFailed: "读取插件状态失败。",
      retry: "重试",
      failed: "失败",
      done: "完成",
      hintOpen: "打开：设置 → 插件 → 插件市场",
    };
    const en = {
      tab: "Plugin market",
      installed: "Installed plugins",
      installedEmpty: "This profile has no plugins installed yet.",
      browse: "Community plugins",
      search: "Search DSH plugins on npm…",
      searchAction: "Search",
      searching: "Searching…",
      searchEmpty: "No matching plugins.",
      searchHint: "Searches public npm packages, filtered to DSH-related results.",
      install: "Install",
      uninstall: "Remove",
      installing: "Installing…",
      removing: "Removing…",
      official: "Official",
      clientSide: "UI",
      hostSide: "Host",
      loaded: "Loaded",
      notResolved: "Unresolved",
      profile: "profile",
      pnpmMissing: "pnpm not found; install and remove are unavailable.",
      pnpmFrom: "pnpm source",
      restartTitle: "Restart DSH to load the new plugin.",
      restart: "Restart now",
      restartManual: "Restart DSH (desktop menu: DSH → Restart DSH service).",
      close: "Hide log",
      logs: "pnpm output",
      stateFailed: "Could not read plugin state.",
      retry: "Retry",
      failed: "Failed",
      done: "Done",
      hintOpen: "Open: Settings → Plugins → Plugin market",
    };

    // ─────────────────────────── 宿主调用 ───────────────────────────
    const ENDPOINT = "/plugin-market";

    /** 读一份市场快照。 */
    async function fetchState() {
      const response = await fetch(`${ENDPOINT}/state`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`state ${response.status}`);
      return response.json();
    }

    /** 搜索社区插件。 */
    async function fetchSearch(query) {
      const response = await fetch(`${ENDPOINT}/search?q=${encodeURIComponent(query)}`, { credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `search ${response.status}`);
      }
      const payload = await response.json();
      return payload.rows ?? [];
    }

    /**
     * 调用安装/卸载，边收 NDJSON 边回调。
     * @param action - `install` 或 `remove`。
     * @param body - 请求体。
     * @param onEvent - 每条进度记录的回调。
     */
    async function mutate(action, body, onEvent) {
      const response = await fetch(`${ENDPOINT}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok || response.body === null) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `${action} ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim() === "") continue;
          try {
            onEvent(JSON.parse(line));
          } catch {
            onEvent({ type: "log", line });
          }
        }
      }
    }

    /** 桌面端外壳提供的额外能力（网页端没有）。 */
    function desktopShell() {
      return typeof window !== "undefined" && window.dshShell ? window.dshShell : null;
    }

    // ─────────────────────── 桌面端「打开插件市场」联动 ───────────────────────
    /**
     * 尽力把界面切到「设置 → 插件 → 插件市场」。
     * DOM 结构属于官方 shell，这里只按可见文案匹配，失败就静默放弃。
     */
    function revealMarketTab() {
      const desired = new Set(["设置", "settings"]);
      const intermediate = new Set(["插件", "plugins"]);
      const final = new Set(["插件市场", "plugin market"]);
      const clickByText = (texts) => {
        const nodes = document.querySelectorAll("button,[role='button'],[role='tab'],a,li,span,div");
        for (const node of nodes) {
          const label = (node.textContent ?? "").trim().toLowerCase();
          if (label !== "" && texts.has(label) && typeof node.click === "function") {
            node.click();
            return true;
          }
        }
        return false;
      };
      const steps = [desired, intermediate, final];
      let index = 0;
      const tick = () => {
        if (index >= steps.length) return;
        const ok = clickByText(steps[index]);
        index += 1;
        setTimeout(tick, ok ? 260 : 400);
      };
      tick();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("dsh-desktop:open-plugin-market", (event) => {
        event.preventDefault();
        revealMarketTab();
      });
    }

    // ─────────────────────────── 组件 ───────────────────────────

    /** 一张插件卡片。 */
    function PluginRow({ row, t, busy, action, onAction, installedRow }) {
      const tags = [];
      if (row.name.startsWith("@deepseek-ai/")) tags.push({ key: "official", tone: "info", label: t("official") });
      if (typeof row.client === "boolean" && row.client) tags.push({ key: "client", tone: "neutral", label: t("clientSide") });
      if (typeof row.bundle === "boolean" && row.bundle) tags.push({ key: "host", tone: "neutral", label: t("hostSide") });
      if (installedRow && row.loaded) tags.push({ key: "loaded", tone: "success", label: t("loaded") });
      if (installedRow && !row.resolved) tags.push({ key: "unresolved", tone: "danger", label: t("notResolved") });

      return react_jsx_runtime.jsxs("li", {
        className: "pmkCard",
        children: [
          react_jsx_runtime.jsxs("div", {
            className: "pmkCardMain",
            children: [
              react_jsx_runtime.jsx("span", { className: "pmkName", children: row.name }),
              row.description ? react_jsx_runtime.jsx("span", { className: "pmkDesc", children: row.description }) : null,
              react_jsx_runtime.jsxs("span", {
                className: "pmkMeta",
                children: [
                  row.version ? `v${row.version}` : "",
                  row.spec ? ` · ${row.spec}` : "",
                  row.date ? ` · ${String(row.date).slice(0, 10)}` : "",
                ].filter(Boolean).join(""),
              }),
              tags.length > 0
                ? react_jsx_runtime.jsx("span", {
                    className: "pmkTags",
                    children: tags.map((tag) =>
                      react_jsx_runtime.jsx(primitives.Tag, { tone: tag.tone, children: tag.label }, tag.key),
                    ),
                  })
                : null,
            ],
          }),
          react_jsx_runtime.jsx("div", {
            className: "pmkActions",
            children: react_jsx_runtime.jsx(primitives.Button, {
              variant: installedRow ? "outline" : "primary",
              size: "sm",
              disabled: busy,
              onClick: () => onAction(row),
              children: action,
            }),
          }),
        ],
      });
    }

    /** 市场标签页。 */
    function PluginMarketSettingsTab({ api, t }) {
      const [state, setState] = react.useState({ status: "loading" });
      const [query, setQuery] = react.useState("");
      const [results, setResults] = react.useState({ status: "idle", rows: [], error: null });
      const [job, setJob] = react.useState(null);
      const [showLog, setShowLog] = react.useState(false);
      const [generation, setGeneration] = react.useState(0);
      const [needsRestart, setNeedsRestart] = react.useState(false);

      const refresh = react.useCallback(() => {
        let current = true;
        setState({ status: "loading" });
        api
          .state()
          .then((snapshot) => {
            if (current) setState({ status: "ready", snapshot });
          })
          .catch((error) => {
            if (current) setState({ status: "error", error: String(error.message ?? error) });
          });
        return () => {
          current = false;
        };
      }, [api]);

      react.useEffect(refresh, [refresh, generation]);

      const runSearch = react.useCallback(() => {
        setResults({ status: "searching", rows: [], error: null });
        api
          .search(query)
          .then((rows) => setResults({ status: "ready", rows, error: null }))
          .catch((error) => setResults({ status: "error", rows: [], error: String(error.message ?? error) }));
      }, [api, query]);

      const run = react.useCallback(
        (action, body, label) => {
          setJob({ action, target: label, logs: [], status: "running" });
          setShowLog(true);
          mutate(action, body, (event) => {
            if (event.type === "log") {
              setJob((current) => (current === null ? current : { ...current, logs: [...current.logs, event.line] }));
            }
            if (event.type === "error") {
              setJob((current) => (current === null ? current : { ...current, logs: [...current.logs, event.message] }));
            }
          })
            .then(() => {
              setJob((current) => (current === null ? current : { ...current, status: "done" }));
              setNeedsRestart(true);
              setGeneration((value) => value + 1);
            })
            .catch((error) => {
              setJob((current) =>
                current === null ? current : { ...current, status: "failed", logs: [...current.logs, String(error.message ?? error)] },
              );
            });
        },
        [],
      );

      const snapshot = state.status === "ready" ? state.snapshot : null;
      const installedNames = new Set((snapshot?.installed ?? []).map((row) => row.name));
      const busy = job !== null && job.status === "running";

      const restart = () => {
        const shell = desktopShell();
        if (shell && typeof shell.restart === "function") shell.restart();
        setNeedsRestart(false);
      };

      return react_jsx_runtime.jsxs("div", {
        className: "pmkRoot",
        children: [
          snapshot
            ? react_jsx_runtime.jsxs("div", {
                className: "pmkHint",
                children: [
                  `${t("profile")}: ${snapshot.profile} · ${snapshot.profileDir}`,
                  snapshot.pnpm.available ? ` · ${t("pnpmFrom")}: ${snapshot.pnpm.source}` : ` · ${t("pnpmMissing")}`,
                ].join(""),
              })
            : null,

          needsRestart
            ? react_jsx_runtime.jsxs("div", {
                className: "pmkNotice",
                children: [
                  react_jsx_runtime.jsx("span", { children: t("restartTitle") }),
                  desktopShell() && typeof desktopShell().restart === "function"
                    ? react_jsx_runtime.jsx(primitives.Button, { variant: "primary", size: "sm", onClick: restart, children: t("restart") })
                    : react_jsx_runtime.jsx("span", { className: "pmkMeta", children: t("restartManual") }),
                ],
              })
            : null,

          state.status === "error"
            ? react_jsx_runtime.jsxs("div", {
                className: "pmkSection",
                children: [
                  react_jsx_runtime.jsx("span", { className: "pmkEmpty", children: `${t("stateFailed")} ${state.error ?? ""}` }),
                  react_jsx_runtime.jsx(primitives.Button, {
                    variant: "outline",
                    size: "sm",
                    onClick: () => setGeneration((value) => value + 1),
                    children: t("retry"),
                  }),
                ],
              })
            : null,

          // 已安装
          react_jsx_runtime.jsxs("div", {
            className: "pmkSection",
            children: [
              react_jsx_runtime.jsxs("span", {
                className: "pmkSectionTitle",
                children: [t("installed"), snapshot ? ` (${snapshot.installed.length})` : ""],
              }),
              snapshot === null
                ? react_jsx_runtime.jsx("span", { className: "pmkEmpty", children: t("searching") })
                : snapshot.installed.length === 0
                  ? react_jsx_runtime.jsx("span", { className: "pmkEmpty", children: t("installedEmpty") })
                  : react_jsx_runtime.jsx("ul", {
                      className: "pmkList",
                      children: snapshot.installed.map((row) =>
                        react_jsx_runtime.jsx(
                          PluginRow,
                          {
                            row,
                            t,
                            installedRow: true,
                            busy,
                            action: busy ? t("removing") : t("uninstall"),
                            onAction: (target) => run("remove", { name: target.name }, target.name),
                          },
                          row.name,
                        ),
                      ),
                    }),
            ],
          }),

          // 社区搜索
          react_jsx_runtime.jsxs("div", {
            className: "pmkSection",
            children: [
              react_jsx_runtime.jsxs("span", { className: "pmkSectionTitle", children: [t("browse")] }),
              react_jsx_runtime.jsxs("div", {
                className: "pmkBar",
                children: [
                  react_jsx_runtime.jsxs("label", {
                    className: "pmkSearch",
                    children: [
                      react_jsx_runtime.jsx(primitives.IconSearchOutline16, { "aria-hidden": "true" }),
                      react_jsx_runtime.jsx("input", {
                        type: "search",
                        value: query,
                        placeholder: t("search"),
                        "aria-label": t("search"),
                        onChange: (event) => setQuery(event.currentTarget.value),
                        onKeyDown: (event) => {
                          if (event.key === "Enter") runSearch();
                        },
                      }),
                    ],
                  }),
                  react_jsx_runtime.jsx(primitives.Button, {
                    variant: "outline",
                    size: "sm",
                    disabled: results.status === "searching",
                    onClick: runSearch,
                    children: t("searchAction"),
                  }),
                ],
              }),
              react_jsx_runtime.jsx("span", { className: "pmkHint", children: t("searchHint") }),
              results.status === "searching" ? react_jsx_runtime.jsx("span", { className: "pmkEmpty", children: t("searching") }) : null,
              results.status === "error"
                ? react_jsx_runtime.jsx("span", { className: "pmkEmpty", children: `${t("failed")}: ${results.error}` })
                : null,
              results.status === "ready" && results.rows.length === 0
                ? react_jsx_runtime.jsx("span", { className: "pmkEmpty", children: t("searchEmpty") })
                : null,
              results.rows.length > 0
                ? react_jsx_runtime.jsx("ul", {
                    className: "pmkList",
                    children: results.rows.map((row) =>
                      react_jsx_runtime.jsx(
                        PluginRow,
                        {
                          row: { ...row, ...(installedNames.has(row.name) ? { installed: true } : {}) },
                          t,
                          installedRow: installedNames.has(row.name),
                          busy,
                          action: installedNames.has(row.name) ? t("uninstall") : busy ? t("installing") : t("install"),
                          onAction: (target) =>
                            installedNames.has(target.name)
                              ? run("remove", { name: target.name }, target.name)
                              : run("install", { spec: target.name }, target.name),
                        },
                        row.name,
                      ),
                    ),
                  })
                : null,
            ],
          }),

          // 进度日志
          job !== null
            ? react_jsx_runtime.jsxs("div", {
                className: "pmkSection",
                children: [
                  react_jsx_runtime.jsxs("span", {
                    className: "pmkSectionTitle",
                    children: [
                      `${t("logs")} · ${job.target} · `,
                      job.status === "running" ? t("installing") : job.status === "done" ? t("done") : t("failed"),
                      " ",
                      react_jsx_runtime.jsx(primitives.Button, {
                        variant: "ghost",
                        size: "sm",
                        onClick: () => setShowLog((value) => !value),
                        children: showLog ? t("close") : t("logs"),
                      }),
                    ],
                  }),
                  showLog ? react_jsx_runtime.jsx("pre", { className: "pmkLog", children: job.logs.join("\n") }) : null,
                ],
              })
            : null,
        ],
      });
    }

    // ─────────────────────────── 插件体 ───────────────────────────
    /** 需要的客户端服务：slot 注册表与本地化。 */
    const inject = ["slots", "locale"];

    /**
     * 注册「插件市场」标签页。
     * @param ctx - 客户端 Cordis 上下文。
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "plugin-market: dictionaries");
      const t = ctx.locale.bind(NS);
      const api = { state: fetchState, search: fetchSearch };
      ctx.slots.inject("settings.plugins.tab", () =>
        ctx.slots.register(
          {
            name: "settings.plugins.tab",
            id: "market",
            order: 50,
            label: () => t("tab"),
            locale: NS,
            inject: () => ({ api }),
          },
          PluginMarketSettingsTab,
        ),
      );
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
