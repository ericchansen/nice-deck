import { chromium } from "playwright";

// This policy belongs to preview only. PDF link collection and direction
// typography inspection deliberately retain their distinct routing and waits.
export async function openPreviewSession({ browser: suppliedBrowser, url, browserErrors }) {
  let browser = suppliedBrowser;
  let context;
  const ownsBrowser = !suppliedBrowser;
  const close = () => ownsBrowser
    ? (browser?.close() ?? Promise.resolve())
    : (context?.close() ?? Promise.resolve());
  try {
    browser ??= await chromium.launch();
    context = await browser.newContext({
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      serviceWorkers: "block",
      viewport: { width: 1600, height: 900 },
    });
    await context.routeWebSocket(/.*/, (webSocket) => {
      browserErrors.push("websocket: blocked outbound connection");
      return webSocket.close({ code: 1008, reason: "offline preview" });
    });
    const previewOrigin = new URL(url).origin;
    await context.route("**/*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (
        ["data:", "blob:"].includes(requestUrl.protocol)
        || requestUrl.origin === previewOrigin
      ) {
        return route.continue();
      }
      browserErrors.push(`request: ${requestUrl} - blocked outbound connection`);
      return route.abort("blockedbyclient");
    });

    const observedPages = new WeakSet();
    const observePage = (observedPage) => {
      if (observedPages.has(observedPage)) return;
      observedPages.add(observedPage);
      observedPage.on("console", (message) => {
        if (message.type() !== "error") return;
        const location = message.location();
        const source = location.url
          ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})`
          : "";
        browserErrors.push(`console: ${message.text()}${source}`);
      });
      observedPage.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
      observedPage.on("websocket", (webSocket) => {
        browserErrors.push(`websocket: ${webSocket.url()}`);
      });
      observedPage.on("requestfailed", (request) => {
        browserErrors.push(`request: ${request.url()} - ${request.failure()?.errorText ?? "failed"}`);
      });
      observedPage.on("response", (response) => {
        if (response.status() >= 400) {
          browserErrors.push(`http ${response.status()}: ${response.url()}`);
        }
      });
    };
    context.on("page", observePage);
    const page = await context.newPage();
    observePage(page);

    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts?.ready);
    await page.evaluate(() => window.__niceDeck?.whenSettled?.());

    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}
