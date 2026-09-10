/**
 * 自动化验证脚本（注入到页面里执行）：
 * 设置 → 插件 → 插件市场，搜一个关键词，确认卡片渲染出来。
 *
 * 由 tools/verify/capture.mjs 通过 DSH_DESKTOP_CAPTURE_SCRIPT 注入。
 */
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const log = [];

  const findButton = (texts) =>
    [...document.querySelectorAll("button,[role='button'],[role='tab'],a")].find((node) =>
      texts.includes((node.textContent ?? "").trim().toLowerCase()),
    );

  /** 反复找一个按钮并点击，直到出现或超时。 */
  const clickWhenReady = async (texts, label, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const button = findButton(texts);
      if (button) {
        button.click();
        log.push([label, (button.textContent ?? "").trim()]);
        return true;
      }
      await sleep(250);
    }
    log.push([label, "TIMEOUT"]);
    return false;
  };

  /**
   * 关掉挡路的引导弹窗（内测声明、API Key 引导等）。
   * 这些是 DSH 首次启动时的正常流程，不是本插件的界面。
   */
  const dismissOverlays = async () => {
    const dismissTexts = ["继续", "稍后配置", "知道了", "continue", "later", "skip for now"];
    for (let round = 0; round < 6; round += 1) {
      const button = findButton(dismissTexts);
      if (!button) return;
      button.click();
      log.push(["关闭弹窗", (button.textContent ?? "").trim()]);
      await sleep(500);
    }
  };

  await dismissOverlays();
  await clickWhenReady(["设置", "settings"], "打开设置");
  await dismissOverlays();
  await clickWhenReady(["插件", "plugins"], "插件分区");
  await clickWhenReady(["插件市场", "plugin market"], "插件市场标签");
  await dismissOverlays();

  const mountDeadline = Date.now() + 8000;
  while (Date.now() < mountDeadline && document.querySelector(".pmkRoot") === null) await sleep(250);
  log.push(["市场根节点", document.querySelector(".pmkRoot") !== null]);
  await sleep(600);

  const input = document.querySelector(".pmkSearch input");
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "dsh-tui");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(400);
    const searchButton = findButton(["搜索", "search"]);
    if (searchButton) searchButton.click();
    log.push(["已搜索", true]);
    const resultsDeadline = Date.now() + 20000;
    while (Date.now() < resultsDeadline && document.querySelectorAll(".pmkCard").length < 2) await sleep(300);
  }

  return {
    steps: log,
    cards: document.querySelectorAll(".pmkCard").length,
    text: document.querySelector(".pmkRoot")?.innerText?.replace(/\s+/g, " ").slice(0, 800) ?? "(no .pmkRoot)",
  };
})();
