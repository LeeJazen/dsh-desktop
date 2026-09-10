/**
 * 自动化验证脚本（注入到页面里执行）：关掉 DSH 首次启动的引导弹窗，
 * 让主界面截图保持干净。由 tools/verify/capture.mjs --plain 使用。
 */
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const log = [];
  const dismissTexts = ["继续", "稍后配置", "知道了", "continue", "later", "skip for now"];

  for (let round = 0; round < 6; round += 1) {
    const button = [...document.querySelectorAll("button,[role='button'],a")].find((node) =>
      dismissTexts.includes((node.textContent ?? "").trim().toLowerCase()),
    );
    if (!button) break;
    button.click();
    log.push((button.textContent ?? "").trim());
    await sleep(600);
  }
  await sleep(800);
  return { dismissed: log, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 300) };
})();
