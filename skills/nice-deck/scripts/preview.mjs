import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { formatFindings, scanSource } from "./scan.mjs";

const scannedExtensions = new Set([".html", ".css"]);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);
const staticExtensions = new Set(mimeTypes.keys());
const assetExtensions = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);

function isWithin(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function isHidden(name) {
  return name.startsWith(".");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureDirectory(path, label, parent) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(path, { recursive: !parent });
    info = await lstat(path);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${path}`);
  }
  const canonical = await realpath(path);
  if (parent && !isWithin(parent, canonical)) {
    throw new Error(`${label} resolves outside output root: ${path}`);
  }
  return canonical;
}

export async function atomicWriteFile(path, content) {
  const directory = dirname(path);
  const name = basename(path);
  const temporary = join(directory, `.${name}-${randomUUID()}.tmp`);
  const backup = join(directory, `.${name}-${randomUUID()}.bak`);
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
  let displaced = false;
  try {
    try {
      const info = await lstat(path);
      if (info.isDirectory() && !info.isSymbolicLink()) {
        throw new Error(`output path must not be a directory: ${path}`);
      }
      await rename(path, backup);
      displaced = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      await rename(temporary, path);
    } catch (error) {
      if (displaced) await rename(backup, path);
      throw error;
    }
    if (displaced) await rm(backup, { force: true });
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function findWorkspaceRoot(sourcePath) {
  const source = await realpath(resolve(sourcePath));
  const fallback = dirname(source);
  let candidate = fallback;

  while (true) {
    if (
      await exists(join(candidate, "brief.md"))
      || await exists(join(candidate, "deck.js"))
    ) {
      return realpath(candidate);
    }
    const parent = dirname(candidate);
    if (parent === candidate) return fallback;
    candidate = parent;
  }
}

async function listStaticFiles(root, source) {
  const files = new Set([source]);

  async function addFile(path, allowedExtensions = staticExtensions) {
    if (!await exists(path)) return;
    const canonical = await realpath(path);
    if (!isWithin(root, canonical)) {
      throw new Error(`${path} resolves outside workspace root ${root}`);
    }
    if (
      (await stat(canonical)).isFile()
      && allowedExtensions.has(extname(canonical).toLowerCase())
    ) {
      files.add(canonical);
    }
  }

  await addFile(join(root, "deck.js"), new Set([".js"]));
  await addFile(join(root, "deck.css"), new Set([".css"]));

  async function visitAssets(directory) {
    if (!await exists(directory)) return;
    const canonical = await realpath(directory);
    if (!isWithin(root, canonical)) {
      throw new Error(`${directory} resolves outside workspace root ${root}`);
    }
    for (const entry of await readdir(canonical, { withFileTypes: true })) {
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(canonical, entry.name);
      if (entry.isDirectory()) await visitAssets(path);
      else if (entry.isFile()) await addFile(path, assetExtensions);
    }
  }

  await visitAssets(join(root, "assets"));
  return [...files].sort();
}

async function readSources(root, files) {
  return Promise.all(files.map(async (file) => ({
    content: await readFile(file),
    file,
    path: relative(root, file),
  })));
}

function hashSources(sources) {
  const hash = createHash("sha256");
  for (const source of sources) {
    const path = Buffer.from(source.path);
    const pathLength = Buffer.alloc(8);
    const contentLength = Buffer.alloc(8);
    pathLength.writeBigUInt64BE(BigInt(path.length));
    contentLength.writeBigUInt64BE(BigInt(source.content.length));
    hash.update(pathLength);
    hash.update(path);
    hash.update(contentLength);
    hash.update(source.content);
  }
  return hash.digest("hex");
}

async function copySnapshot(sources, snapshotRoot) {
  for (const source of sources) {
    const target = join(snapshotRoot, source.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source.content);
  }
}

async function snapshotFiles(snapshotRoot) {
  try {
    const rootInfo = await lstat(snapshotRoot);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  const files = [];
  let valid = true;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        valid = false;
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(snapshotRoot, path));
      else valid = false;
    }
  }
  await visit(snapshotRoot);
  return valid ? files.sort() : null;
}

async function snapshotMatches(snapshotRoot, sources) {
  const actual = await snapshotFiles(snapshotRoot);
  const expected = sources.map(({ path }) => path).sort();
  if (
    !actual
    || actual.length !== expected.length
    || actual.some((path, index) => path !== expected[index])
  ) {
    return false;
  }
  const matches = await Promise.all(sources.map(async (source) => (
    (await readFile(join(snapshotRoot, source.path))).equals(source.content)
  )));
  return matches.every(Boolean);
}

async function ensureSnapshot(renderDirectory, snapshotRoot, sources) {
  if (await snapshotMatches(snapshotRoot, sources)) return;

  const temporaryRoot = join(renderDirectory, `.site-${randomUUID()}.tmp`);
  const backupRoot = join(renderDirectory, `.site-${randomUUID()}.bak`);
  await mkdir(temporaryRoot);
  try {
    await copySnapshot(sources, temporaryRoot);
    if (await snapshotMatches(snapshotRoot, sources)) return;

    let displaced = false;
    try {
      await lstat(snapshotRoot);
      await rename(snapshotRoot, backupRoot);
      displaced = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      await rename(temporaryRoot, snapshotRoot);
    } catch (error) {
      if (displaced) await rename(backupRoot, snapshotRoot);
      throw error;
    }
    if (displaced) await rm(backupRoot, { recursive: true, force: true });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function startStaticServer(root) {
  const absoluteRoot = await realpath(resolve(root));

  const server = createServer(async (request, response) => {
    try {
      const rawPath = request.url.split(/[?#]/, 1)[0];
      const decodedRawPath = decodeURIComponent(rawPath);
      const rawSegments = decodedRawPath.split(/[\\/]/).filter(Boolean);
      if (
        decodedRawPath.includes("\\")
        || rawSegments.some((segment) => segment === ".." || isHidden(segment))
      ) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const segments = pathname.split("/").filter(Boolean);
      if (segments.some(isHidden)) {
        response.writeHead(403).end("forbidden");
        return;
      }

      const lexicalTarget = resolve(absoluteRoot, ...segments);
      if (!isWithin(absoluteRoot, lexicalTarget)) {
        response.writeHead(403).end("forbidden");
        return;
      }

      const target = await realpath(lexicalTarget);
      if (!isWithin(absoluteRoot, target)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      if (!(await stat(target)).isFile()) {
        response.writeHead(404).end("not found");
        return;
      }

      const extension = extname(target).toLowerCase();
      if (!staticExtensions.has(extension)) {
        response.writeHead(403).end("forbidden");
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes.get(extension),
      });
      response.end(await readFile(target));
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.message);
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const { port } = server.address();
  const closed = new Promise((resolveClose) => server.once("close", resolveClose));
  return {
    closed,
    root: absoluteRoot,
    urlFor(file, version = "") {
      const path = relative(absoluteRoot, resolve(file));
      if (path.startsWith("..") || isAbsolute(path)) {
        throw new Error(`${file} is outside preview root ${absoluteRoot}`);
      }
      const encodedPath = path.split(sep).map(encodeURIComponent).join("/");
      return `http://127.0.0.1:${port}/${encodedPath}${version ? `?v=${version}` : ""}`;
    },
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    }),
  };
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

export async function previewDeck({
  sourcePath,
  outDir,
  workspaceRoot,
  keepServer = false,
} = {}) {
  if (!sourcePath) throw new Error("sourcePath is required");

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
  const sourceHash = hashSources(sources);
  const shortHash = sourceHash.slice(0, 12);
  const renderDirectory = await ensureDirectory(
    join(outputRoot, shortHash),
    "render directory",
    outputRoot,
  );
  const snapshotRoot = join(renderDirectory, "site");
  await ensureSnapshot(renderDirectory, snapshotRoot, sources);

  const scan = [];
  for (const scanned of sources.filter(
    ({ file }) => scannedExtensions.has(extname(file).toLowerCase()),
  )) {
    for (const finding of scanSource(scanned.content.toString("utf8"))) {
      scan.push({ file: scanned.path, ...finding });
    }
  }

  const server = await startStaticServer(snapshotRoot);
  const snapshotSource = join(server.root, relative(root, source));
  const url = server.urlFor(snapshotSource, shortHash);
  const browserErrors = [];
  const contrast = [];
  const contrastUnverified = [];
  const screenshots = [];
  let browser;
  let serverTransferred = false;

  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
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
        if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
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

    const slideCount = await page.locator(".slide").count() || 1;
    const runtimeReady = await page.evaluate(() => Boolean(window.__niceDeck));
    if (slideCount > 1 && !runtimeReady) {
      browserErrors.push("runtime: multi-slide decks must load deck.js");
    }

    for (let index = 0; index < slideCount; index += 1) {
      if (runtimeReady) {
        await page.evaluate((slideIndex) => window.__niceDeck.goTo(slideIndex), index);
      }
      await page.evaluate(() => new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }));
      const visibleSlides = await page.locator(".slide:visible").count();
      if (slideCount > 1 && visibleSlides !== 1) {
        browserErrors.push(`visibility: expected 1 slide, found ${visibleSlides}`);
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

    const result = {
      ok: scan.length === 0 && contrast.length === 0 && browserErrors.length === 0,
      source,
      workspaceRoot: root,
      sourceHash,
      url,
      screenshots,
      scan,
      contrast,
      contrastUnverified,
      browserErrors,
    };
    const previewFile = join(outputRoot, "preview.json");
    await atomicWriteFile(previewFile, `${JSON.stringify(result, null, 2)}\n`);

    serverTransferred = keepServer;
    return { ...result, previewFile, ...(keepServer ? { server } : {}) };
  } finally {
    await Promise.all([
      browser?.close() ?? Promise.resolve(),
      serverTransferred ? Promise.resolve() : server.close(),
    ]);
  }
}

function printResult(result) {
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
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error("usage: node preview.mjs <deck.html> [out-dir]");
    process.exit(2);
  }

  try {
    const result = await previewDeck({
      sourcePath,
      outDir: process.argv[3],
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
