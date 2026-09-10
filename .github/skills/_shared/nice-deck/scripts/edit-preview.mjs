import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

// Source scans and large embedded bundles can block the event loop for seconds.
// Keep both the authoring API and its save coordinator outside that work.
export function startPreviewWorker(options, onError = () => {}) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: options,
    execArgv: process.execArgv.filter((arg, index, args) => (
      !arg.startsWith("--input-type") && args[index - 1] !== "--input-type"
    )),
  });
  let published = false;
  let closing = false;
  const exited = new Promise((accept) => worker.once("exit", accept));
  return new Promise((accept, reject) => {
    worker.once("error", (failure) => {
      if (published) onError(failure);
      else reject(failure);
    });
    worker.once("exit", (code) => {
      if (!published) reject(new Error(`Preview worker exited before returning a render (${code}).`));
      else if (!closing && code !== 0) onError(new Error(`Preview worker exited unexpectedly (${code}).`));
    });
    worker.on("message", (message) => {
      if (message.type === "error") {
        reject(new Error(message.message));
      } else if (message.type === "ready") {
        published = true;
        accept({
          ...message.result,
          server: {
            root: message.root,
            close: async () => {
              closing = true;
              if (worker.threadId !== -1) worker.postMessage({ type: "close" });
              await exited;
            },
          },
        });
      }
    });
  });
}

if (!isMainThread) {
  let server;
  let browser;
  try {
    const { previewDeck } = await import("./preview.mjs");
    if (workerData.browserChannel) {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ channel: workerData.browserChannel });
    }
    const result = await previewDeck({
      sourcePath: workerData.sourcePath, outDir: workerData.outDir,
      keepServer: true, ...(browser ? { browser } : {}),
    });
    server = result.server;
    if (browser) {
      await browser.close();
      browser = undefined;
    }
    const { server: unused, ...record } = result;
    let stopping = false;
    parentPort.on("message", async (message) => {
      if (message.type !== "close" || stopping) return;
      stopping = true;
      try {
        await server.close();
      } finally {
        parentPort.close();
      }
    });
    parentPort.postMessage({ type: "ready", result: record, root: server.root });
  } catch (failure) {
    parentPort.postMessage({ type: "error", message: failure.message });
    try {
      await browser?.close();
      await server?.close();
    } finally {
      parentPort.close();
    }
  }
}
