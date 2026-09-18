import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { assessReview } from "./review.mjs";
import { formatFindings, scanSource, scanWorkspace } from "./scan.mjs";
import { proseBudget } from "./text-rules.mjs";
import { measureRegions, previewLayoutFindings, previewViewportFindings, viewportMatrix } from "../lib/checks/layout.mjs";
import { atomicWriteFile, ensureDirectory, isWithin } from "../lib/files.mjs";
import { findWorkspaceRoot, listStaticFiles, readSources, hashSources } from "../lib/workspace.mjs";
import { ensureSnapshot } from "../lib/snapshot.mjs";
import { startStaticServer } from "../lib/server.mjs";

// Historical command-module API remains available to extensions and callers.
export { atomicWriteFile } from "../lib/files.mjs";
export { computeDeckSourceHash, findWorkspaceRoot } from "../lib/workspace.mjs";
export { startStaticServer } from "../lib/server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sanctionedRuntimeRoot = resolve(here, "..", "runtime");
const sanctionedRuntimeFiles = [
  "echarts.min.js",
  "charts.js",
];
const sanctionedRuntimeManifest = "chart-runtime.manifest.json";

async function validateSanctionedRuntime(sources, { required = true } = {}) {
  if (!required) return [];
  const manifest = JSON.parse(
    await readFile(join(sanctionedRuntimeRoot, sanctionedRuntimeManifest), "utf8"),
  );
  const findings = [];
  for (const name of sanctionedRuntimeFiles) {
    const source = sources.find(
      ({ path }) => path === join("runtime", ...name.split("/")),
    );
    const expected = manifest.files?.[name]?.sha256;
    const actual = source ? createHash("sha256").update(source.content).digest("hex") : null;
    if (!expected || actual !== expected) {
      findings.push({
        file: name,
        message: "Sanctioned chart runtime hash does not match chart-runtime.manifest.json.",
      });
    }
  }
  return findings;
}

async function auditLayout(page, slideIndex) {
  return page.evaluate(measureRegions, { index: slideIndex, budget: proseBudget });
}

async function auditContrast(page, slideIndex) {
  return page.evaluate((index) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const parseColor = (value) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "rgba(0, 0, 0, 0)";
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map(
        (channel, channelIndex) => (channelIndex === 3 ? channel / 255 : channel),
      );
    };
    const over = (foreground, background) => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (!alpha) return [0, 0, 0, 0];
      return [
        ...[0, 1, 2].map((channel) => (
          (foreground[channel] * foreground[3]
            + background[channel] * background[3] * (1 - foreground[3])) / alpha
        )),
        alpha,
      ];
    };
    const luminance = (color) => {
      const linear = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const ratio = (first, second) => {
      const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const directText = (element) => [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .filter(Boolean)
      .join(" ");
    const effectiveBackground = (element) => {
      const chain = [];
      let current = element;
      let hasImage = false;
      while (current instanceof Element) {
        chain.unshift(current);
        const style = getComputedStyle(current);
        if (style.backgroundImage !== "none") hasImage = true;
        current = current.parentElement;
      }

      let background = [255, 255, 255, 1];
      for (const node of chain) {
        const color = parseColor(getComputedStyle(node).backgroundColor);
        if (color) background = over(color, background);
      }
      return { background, hasImage };
    };

    const failures = [];
    const unverified = [];

    for (const element of document.body.querySelectorAll("*")) {
      const text = directText(element);
      if (!text) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity) === 0
        || rect.width === 0
        || rect.height === 0
      ) {
        continue;
      }

      const foreground = parseColor(style.color);
      if (!foreground) continue;
      const { background, hasImage } = effectiveBackground(element);
      let cumulativeOpacity = 1;
      let hasFilter = false;
      let effectNode = element;
      while (effectNode instanceof Element) {
        const effectStyle = getComputedStyle(effectNode);
        cumulativeOpacity *= Number(effectStyle.opacity);
        if (effectStyle.filter !== "none") hasFilter = true;
        effectNode = effectNode.parentElement;
      }
      if (hasImage || cumulativeOpacity < 0.999 || hasFilter) {
        unverified.push({
          slide: index + 1,
          reason: hasImage
            ? "background-image"
            : cumulativeOpacity < 0.999
              ? "opacity"
              : "filter",
          text: text.slice(0, 80),
        });
        continue;
      }

      const renderedForeground = over(foreground, background);
      const contrast = ratio(renderedForeground, background);
      const fontSize = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;

      if (contrast < required) {
        failures.push({
          slide: index + 1,
          text: text.slice(0, 80),
          foreground: style.color,
          background: `rgb(${background.slice(0, 3).map(Math.round).join(", ")})`,
          ratio: Number(contrast.toFixed(2)),
          required,
        });
      }
    }

    return { failures, unverified };
  }, slideIndex);
}

async function auditViewport(page, viewport, slideIndex) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForFunction(
    ({ width, height }) => {
      const geometry = window.__niceDeck?.geometry?.();
      return geometry
        && Math.abs(geometry.viewportWidth - width) < 1
        && Math.abs(geometry.viewportHeight - height) < 1;
    },
    { width: viewport.width, height: viewport.height },
  );
  await page.evaluate(async () => {
    await window.__niceDeck?.whenSettled?.();
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
  await page.evaluate((index) => window.__niceDeck?.goTo(index), slideIndex);
  await page.evaluate(() => window.__niceDeck?.whenSettled?.());
  return previewViewportFindings(page, viewport, slideIndex);
}

export async function previewDeck({
  sourcePath,
  outDir,
  workspaceRoot,
  keepServer = false,
  captureMode = true,
  mode = "feedback",
  slideIds,
  browser: suppliedBrowser,
} = {}) {
  if (!sourcePath) throw new Error("sourcePath is required");
  if (!["feedback", "audit"].includes(mode)) throw new Error("mode must be feedback or audit");
  if (slideIds !== undefined && (
    !Array.isArray(slideIds) || !slideIds.length
    || slideIds.some((id) => typeof id !== "string" || !id.trim())
    || new Set(slideIds).size !== slideIds.length
  )) throw new Error("slideIds must be a non-empty array of unique slide IDs");
  if (mode === "audit" && slideIds !== undefined) {
    throw new Error("audit cannot be combined with slideIds");
  }
  const fullAudit = mode === "audit";

  const source = await realpath(resolve(sourcePath));
  if (extname(source).toLowerCase() !== ".html") {
    throw new Error("sourcePath must be an HTML file");
  }

  const root = workspaceRoot
    ? await realpath(resolve(workspaceRoot))
    : await findWorkspaceRoot(source);
  if (!isWithin(root, source)) {
    throw new Error(`${source} is outside workspace root ${root}`);
  }

  const outputRoot = await ensureDirectory(
    resolve(outDir ?? join(root, "_renders")),
    "output root",
  );
  const files = await listStaticFiles(root, source);
  const sources = await readSources(root, files);
  const isOutline = /<html\b[^>]*\bdata-deck-kind=["']outline["']/i.test(
    sources.find(({ file }) => file === source)?.content.toString("utf8") ?? "",
  );
  const runtimeIntegrity = await validateSanctionedRuntime(sources, { required: !isOutline });
  const sourceHash = hashSources(sources);
  const shortHash = sourceHash.slice(0, 12);
  const renderDirectory = await ensureDirectory(
    join(outputRoot, fullAudit ? shortHash : `${shortHash}-feedback-${slideIds
      ? createHash("sha256").update(JSON.stringify(slideIds)).digest("hex").slice(0, 12)
      : "all"}`),
    "render directory",
    outputRoot,
  );
  const snapshotRoot = join(renderDirectory, "site");
  await ensureSnapshot(renderDirectory, snapshotRoot, sources);

  const sourceRecord = sources.find(({ file }) => file === source);
  const cssSources = sources.filter(
    ({ file }) => extname(file).toLowerCase() === ".css",
  );
  const scan = fullAudit ? await scanWorkspace({
    root,
    sourcePath: source,
    source: sourceRecord.content.toString("utf8"),
    styles: cssSources.map(({ content }) => content.toString("utf8")).join("\n"),
  }) : [];
  for (const scanned of fullAudit ? cssSources : []) {
    for (const finding of scanSource(scanned.content.toString("utf8"))) {
      scan.push({ file: scanned.path, ...finding });
    }
  }

  const server = await startStaticServer(snapshotRoot);
  const snapshotSource = join(server.root, relative(root, source));
  const url = `${server.urlFor(snapshotSource, shortHash)}${captureMode ? "&capture=1" : ""}`;
  const browserErrors = [];
  const chartAudit = [];
  const layoutIssues = [];
  const contrast = [];
  const contrastUnverified = [];
  const screenshots = [];
  let browser = suppliedBrowser;
  let context;
  const ownsBrowser = !suppliedBrowser;
  let serverTransferred = false;

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

    const slideCount = await page.locator(".slide").count() || 1;
    const deckSlideIds = await page.locator(".slide").evaluateAll((slides) => (
      slides.map((slide) => slide.dataset.slideId || slide.id || null)
    ));
    const htmlSlideIds = await page.locator(".slide").evaluateAll((slides) => (
      slides.map((slide) => slide.id)
    ));
    const indices = slideIds === undefined
      ? Array.from({ length: slideCount }, (_, index) => index)
      : slideIds.map((id) => {
        const matches = deckSlideIds.flatMap((value, index) => (
          value === id || htmlSlideIds[index] === id ? [index] : []
        ));
        if (matches.length !== 1) throw new Error(`slide ID must match exactly one slide: ${id}`);
        return matches[0];
      }).sort((a, b) => a - b);
    if (new Set(indices).size !== indices.length) {
      throw new Error("slideIds must select unique slides, not multiple aliases of the same slide");
    }
    const runtimeReady = await page.evaluate(() => Boolean(window.__niceDeck));
    const fixedCanvasReady = await page.evaluate(() => (
      typeof window.__niceDeck?.geometry === "function"
      && typeof window.__niceDeck?.whenSettled === "function"
    ));
    if (!isOutline && !fixedCanvasReady) {
      browserErrors.push("runtime: decks must load the current fixed-canvas runtime/deck.js");
    }
    const chartCount = await page.locator("[data-echart], [data-chart]").count();
    if (slideCount > 1 && !runtimeReady) {
      browserErrors.push("runtime: multi-slide decks must load deck.js");
    }
    if (chartCount) {
      const chartRuntimeReady = await page.evaluate(() => Boolean(window.niceDeckCharts));
      if (!chartRuntimeReady) {
        browserErrors.push("charts: chart elements require the sanctioned nice-deck ECharts runtime");
      }
    }

    for (const index of indices) {
      if (runtimeReady) {
        await page.evaluate((slideIndex) => window.__niceDeck.goTo(slideIndex), index);
        await page.evaluate(() => window.__niceDeck.whenSettled?.());
      }
      // A slide revealed for the first time can start loading a font it is the
      // first to use. Measuring before that resolves yields fallback metrics.
      await page.evaluate(() => document.fonts?.ready);
      if (chartCount) {
        try {
          await page.evaluate(async () => {
            await window.niceDeckCharts.resize();
            const visibleCharts = [...document.querySelectorAll(
              ".slide:not([hidden]) [data-chart], .slide:not([hidden]) [data-echart]",
            )];
            const deadline = performance.now() + 5000;
            while (
              visibleCharts.some((element) => element.dataset.chartReady !== "true")
              && performance.now() < deadline
            ) {
              await new Promise((resolveWait) => setTimeout(resolveWait, 25));
            }
            if (visibleCharts.some((element) => element.dataset.chartReady !== "true")) {
              throw new Error("visible chart readiness timed out after 5000ms");
            }
          });
        } catch (error) {
          browserErrors.push(`charts: readiness failed on slide ${index + 1}: ${error.message}`);
        }
      }
      if (chartCount && captureMode) {
        try {
          await page.evaluate(() => window.niceDeckCharts.prepareVisible());
        } catch (error) {
          browserErrors.push(`charts: reset failed on slide ${index + 1}: ${error.message}`);
        }
      }
      await page.evaluate(() => new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }));
      const visibleSlides = await page.locator(".slide:visible").count();
      if (slideCount > 1 && visibleSlides !== 1) {
        browserErrors.push(`visibility: expected 1 slide, found ${visibleSlides}`);
      }
      const unreadyCharts = await page.locator(
        `.slide:visible [data-echart]:not([data-chart-ready="true"]), `
        + `.slide:visible [data-chart]:not([data-chart-ready="true"])`,
      ).count();
      if (unreadyCharts) {
        browserErrors.push(
          `charts: slide ${index + 1} has ${unreadyCharts} chart(s) without data-chart-ready="true"`,
        );
      }
      if (fullAudit) {
      const interactiveAudit = await page.evaluate((slideIndex) => {
        const slide = document.querySelector(".slide:not([hidden])") ?? document.querySelector(".slide");
        const findings = [];
        for (const element of slide?.querySelectorAll("[data-chart], [data-echart]") ?? []) {
          const rect = element.getBoundingClientRect();
          const svg = element.querySelector("svg");
          const marks = svg?.querySelectorAll("path, rect, circle, polygon").length ?? 0;
          if (rect.width <= 0 || rect.height <= 0) findings.push("container has zero dimensions");
          if (!svg || svg.getBoundingClientRect().width <= 0 || svg.getBoundingClientRect().height <= 0) {
            findings.push("SVG is missing or zero-dimensional");
          }
          if (marks === 0) findings.push("SVG has no visible marks");
          if (!element.dataset.visibleTakeaway) findings.push("visible takeaway metadata is missing");
          if (!slide.querySelector("[data-citation]")) findings.push("visible citation is missing");
          if (element.dataset.chartError === "true") findings.push("runtime error state is visible");
        }
        return findings.map((message) => ({ slide: slideIndex + 1, message }));
      }, index);
      chartAudit.push(...interactiveAudit);

      const layoutFindings = await previewLayoutFindings(page, index);
      layoutIssues.push(...layoutFindings);
      layoutIssues.push(...await auditLayout(page, index));
      }

      const audit = await auditContrast(page, index);
      contrast.push(...audit.failures);
      contrastUnverified.push(...audit.unverified);

      const screenshot = join(
        renderDirectory,
        `slide-${String(index + 1).padStart(2, "0")}.png`,
      );
      await atomicWriteFile(screenshot, await page.screenshot());
      screenshots.push(screenshot);
    }

    if (fullAudit && !captureMode && slideCount > 1 && runtimeReady) {
      for (let index = slideCount - 1; index >= 0; index -= 1) {
        await page.evaluate((slideIndex) => window.__niceDeck.goTo(slideIndex), index);
        await page.evaluate(() => window.niceDeckCharts?.resize());
        await page.evaluate(() => new Promise((resolveFrame) => {
          requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
        }));
        const returnIssues = await page.evaluate((slideIndex) => {
          const slide = document.querySelector(".slide:not([hidden])");
          return [...(slide?.querySelectorAll("[data-chart], [data-echart]") ?? [])]
            .filter((element) => {
              const rect = element.querySelector("svg")?.getBoundingClientRect();
              return !rect || rect.width <= 0 || rect.height <= 0;
            })
            .map(() => ({ slide: slideIndex + 1, message: "chart failed after return navigation" }));
        }, index);
        chartAudit.push(...returnIssues);
      }
    }

    const screenshotHashes = await Promise.all(screenshots.map(async (screenshot) => (
      createHash("sha256").update(await readFile(screenshot)).digest("hex")
    )));
    const viewportAudit = [];
    if (fullAudit && fixedCanvasReady) {
      for (const viewport of viewportMatrix) {
        for (let index = 0; index < slideCount; index += 1) {
          viewportAudit.push(...await auditViewport(page, viewport, index));
          viewportAudit.push(...(await auditLayout(page, index)).map((finding) => ({
            viewport: viewport.name,
            slide: index + 1,
            message: finding.message,
          })));
        }
      }
      for (const width of [1400, 1100, 800, 520]) {
        for (let index = 0; index < slideCount; index += 1) {
          viewportAudit.push(...await auditViewport(page, {
            width,
            height: 900,
            name: `live-resize-${width}`,
          }, index));
        }
      }
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.evaluate(() => window.__niceDeck.whenSettled?.());
    } else if (fullAudit && runtimeReady) {
      viewportAudit.push({
        viewport: "runtime",
        slide: 1,
        message: "fixed-canvas runtime geometry is unavailable",
      });
    }
    const result = {
      mode,
      scope: slideIds === undefined ? "full-deck" : "selected",
      slideIds: indices.map((index) => deckSlideIds[index] ?? null),
      slideNumbers: indices.map((index) => index + 1),
      totalSlides: slideCount,
      slideCount,
      capturedSlideCount: screenshots.length,
      auditComplete: fullAudit,
      skippedChecks: fullAudit ? [] : ["workspace-scan", "layout", "chart-lifecycle", "viewport-matrix", "review"],
      ok: scan.length === 0
        && contrast.length === 0
        && browserErrors.length === 0
        && chartAudit.length === 0
        && layoutIssues.length === 0
        && runtimeIntegrity.length === 0
        && viewportAudit.length === 0,
      source,
      workspaceRoot: root,
      sourceHash,
      url: slideIds === undefined ? url : `${url}#${encodeURIComponent(htmlSlideIds[indices[0]] || String(indices[0] + 1))}`,
      screenshots,
      screenshotHashes,
      scan,
      contrast,
      contrastUnverified,
      browserErrors,
      chartAudit,
      layoutIssues,
      runtimeIntegrity,
      viewportAudit,
    };
    result.review = isOutline || !fullAudit
      ? { status: "not-required", path: null, requiredRoles: [], findings: [] }
      : await assessReview({ workspace: root, previewRecord: result });
    const previewFile = fullAudit
      ? join(outputRoot, "preview.json")
      : join(renderDirectory, "feedback-preview.json");
    await atomicWriteFile(previewFile, `${JSON.stringify(result, null, 2)}\n`);

    serverTransferred = keepServer;
    return { ...result, previewFile, ...(keepServer ? { server } : {}) };
  } finally {
    await Promise.all([
      ownsBrowser
        ? (browser?.close() ?? Promise.resolve())
        : (context?.close() ?? Promise.resolve()),
      serverTransferred ? Promise.resolve() : server.close(),
    ]);
  }
}

function printResult(result) {
  console.log(`mode: ${result.mode}; scope: ${result.scope}; captured: ${result.capturedSlideCount}/${result.slideCount}`);
  console.log(`source hash: ${result.sourceHash}`);
  console.log(`url: ${result.url}`);
  for (const screenshot of result.screenshots) console.log(`render: ${screenshot}`);
  console.log(`preview: ${result.previewFile}`);

  if (result.scan.length) {
    console.error("\ndesign scan:");
    console.error(formatFindings(result.scan));
  }
  if (result.contrast.length) {
    console.error("\ncontrast:");
    for (const failure of result.contrast) {
      console.error(`- slide ${failure.slide}: ${failure.ratio}:1, needs ${failure.required}:1 - ${failure.text}`);
    }
  }
  if (result.browserErrors.length) {
    console.error("\nbrowser errors:");
    for (const error of result.browserErrors) console.error(`- ${error}`);
  }
  if (result.layoutIssues?.length) {
    console.error("\nlayout:");
    for (const issue of result.layoutIssues) {
      console.error(`- slide ${issue.slide}: ${issue.name ? `[${issue.name}] ` : ""}${issue.message}`);
    }
  }
  if (result.viewportAudit?.length) {
    console.error("\nviewport scaling:");
    for (const issue of result.viewportAudit) {
      console.error(`- ${issue.viewport}, slide ${issue.slide}: ${issue.message}`);
    }
  }
  if (result.review?.status && !["approved", "not-required"].includes(result.review.status)) {
    console.log(`\nreview: ${result.review.status} - ${result.review.path}`);
  }
  if (result.runtimeIntegrity.length) {
    console.error("\nchart runtime integrity:");
    for (const failure of result.runtimeIntegrity) {
      console.error(`- ${failure.file}: ${failure.message}`);
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  let mode = "feedback";
  let slideIds;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--audit") mode = "audit";
    else if (args[index] === "--mode") {
      mode = args[++index];
      if (!mode) throw new Error("--mode requires feedback or audit");
    }
    else if (["--slide-ids", "--slides"].includes(args[index])) slideIds = (args[++index] ?? "").split(",");
    else if (args[index].startsWith("--")) throw new Error(`Unknown option: ${args[index]}`);
    else positional.push(args[index]);
  }
  const sourcePath = positional[0];
  if (!sourcePath) {
    console.error("usage: node preview.mjs <deck.html> [out-dir] [--audit | --mode feedback|audit] [--slides id,id]");
    process.exit(2);
  }

  try {
    const result = await previewDeck({
      sourcePath,
      outDir: positional[1],
      mode,
      slideIds,
      keepServer: true,
    });
    printResult(result);
    process.exitCode = result.ok ? 0 : 1;
    console.log("press Ctrl+C to stop preview");
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      result.server.close().catch((error) => {
        console.error(`preview shutdown failed: ${error.message}`);
        process.exitCode = 2;
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await result.server.closed;
  } catch (error) {
    console.error(`preview failed: ${error.message}`);
    process.exitCode = 2;
  }
}
