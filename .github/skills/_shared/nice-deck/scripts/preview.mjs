import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  access,
  lstat,
  mkdir,
  copyFile,
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { assessReview } from "./review.mjs";
import { formatFindings, scanSource, scanWorkspace } from "./scan.mjs";
import { proseBudget } from "./text-rules.mjs";

const scannedExtensions = new Set([".html", ".css"]);
const here = dirname(fileURLToPath(import.meta.url));
const sanctionedRuntimeRoot = resolve(here, "..", "runtime");
const sanctionedRuntimeFiles = [
  "echarts.min.js",
  "charts.js",
];
const sanctionedRuntimeManifest = "chart-runtime.manifest.json";
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".tsv", "text/tab-separated-values; charset=utf-8"],
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
const viewportMatrix = [
  { width: 1600, height: 900, name: "canonical" },
  { width: 1280, height: 720, name: "scaled-16-9" },
  { width: 640, height: 360, name: "small-16-9" },
  { width: 1600, height: 600, name: "wide-short" },
  { width: 700, height: 900, name: "narrow-tall" },
  { width: 520, height: 900, name: "side-panel" },
];

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
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js") && entry.name !== "deck.js") {
      await addFile(join(root, entry.name), new Set([".js"]));
    }
  }
  await addFile(join(root, "visual-manifest.json"), new Set([".json"]));
  await addFile(join(root, "sources.json"), new Set([".json"]));
  await addFile(join(root, "slide-contracts.json"), new Set([".json"]));

  async function visitAssets(directory, allowedExtensions = assetExtensions) {
    if (!await exists(directory)) return;
    const canonical = await realpath(directory);
    if (!isWithin(root, canonical)) {
      throw new Error(`${directory} resolves outside workspace root ${root}`);
    }
    for (const entry of await readdir(canonical, { withFileTypes: true })) {
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(canonical, entry.name);
      if (entry.isDirectory()) await visitAssets(path, allowedExtensions);
      else if (entry.isFile()) await addFile(path, allowedExtensions);
    }
  }

  await visitAssets(join(root, "assets"), staticExtensions);
  await visitAssets(join(root, "data"), staticExtensions);
  await visitAssets(join(root, "runtime"), staticExtensions);
  return [...files].sort();
}

async function readSources(root, files) {
  const sources = await Promise.all(files.map(async (file) => ({
    content: await readFile(file),
    file,
    path: relative(root, file),
  })));
  return sources.sort((first, second) => first.path.localeCompare(second.path));
}

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

export async function computeDeckSourceHash({ sourcePath, workspaceRoot } = {}) {
  if (!sourcePath) throw new Error("sourcePath is required");
  const source = await realpath(resolve(sourcePath));
  const root = workspaceRoot
    ? await realpath(resolve(workspaceRoot))
    : await findWorkspaceRoot(source);
  if (!isWithin(root, source)) {
    throw new Error(`${source} is outside workspace root ${root}`);
  }
  const files = await listStaticFiles(root, source);
  return hashSources(await readSources(root, files));
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
      // Another preview process may have published the same immutable snapshot
      // between our final comparison and rename. Treat that as success.
      if (await snapshotMatches(snapshotRoot, sources)) {
        if (displaced) await rm(backupRoot, { recursive: true, force: true });
        return;
      }
      if (displaced && !await exists(snapshotRoot)) await rename(backupRoot, snapshotRoot);
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
      if (pathname.startsWith("/__nice-deck/")) {
        response.writeHead(410, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Preview-only runtime path retired. Use a relative workspace runtime/ path.");
        return;
      }
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

async function auditLayout(page, slideIndex) {
  return page.evaluate(({ index, budget }) => {
    if (document.documentElement.dataset.deckKind === "outline") return [];
    const slide = document.querySelector(".slide:not([hidden])")
      ?? document.querySelector(".slide");
    if (!slide) return [];

    const findings = [];
    const scale = window.__niceDeck?.geometry?.().scale ?? 1;
    const add = (name, message) => findings.push({ slide: index + 1, name, message });
    const round = (value) => Math.round(value * 100) / 100;
    const label = (element) => (
      element.dataset?.region
      || (typeof element.className === "string" ? element.className : "")
      || element.tagName.toLowerCase()
    );

    const regions = [...slide.querySelectorAll("[data-region]")]
      .filter((element) => !element.hasAttribute("data-grid-exception"))
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        label: label(element),
      }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);

    // Boundaries that almost line up read as a defect. Fix the grid, not the offset.
    for (const edge of ["left", "right"]) {
      for (let first = 0; first < regions.length; first += 1) {
        for (let second = first + 1; second < regions.length; second += 1) {
          const a = regions[first];
          const b = regions[second];
          const vertical = a.rect.bottom <= b.rect.top + scale || b.rect.bottom <= a.rect.top + scale;
          if (!vertical) continue;
          const delta = Math.abs(a.rect[edge] - b.rect[edge]);
          if (delta > scale && delta <= 12 * scale) {
            add(
              "region-misaligned",
              `${a.label} and ${b.label} ${edge} edges differ by ${round(delta)}px; share one grid or declare data-grid-exception`,
            );
          }
        }
      }
    }

    for (const element of slide.querySelectorAll("*")) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.hasAttribute("data-grid-exception")) continue;
      // Chart runtimes position their own internals; the rule is about authored
      // regions. data-bleed is the declared full-bleed escape from layout.md.
      if (element.closest("[data-chart], [data-echart], svg, pre, code, [data-bleed]")) continue;
      const style = getComputedStyle(element);
      if (style.position !== "absolute" && style.position !== "fixed") continue;
      const rect = element.getBoundingClientRect();
      // Visually hidden helpers (sr-only and friends) are absolute by design.
      if (rect.width * rect.height <= 16) continue;
      const text = element.textContent?.trim() ?? "";
      if (text.length < 12) continue;
      add(
        "absolute-region",
        `${label(element)} is positioned ${style.position}; content regions belong to the slide grid`,
      );
    }

    const citations = [...slide.querySelectorAll("[data-citation]")];
    for (const citation of citations) {
      if (!citation.textContent?.trim()) continue;
      const links = [...citation.querySelectorAll("a[href]")];
      if (!links.length) {
        add("citation-not-linked", "citation prints a source without a link");
        continue;
      }
      for (const link of links) {
        const href = link.getAttribute("href") ?? "";
        if (href.startsWith("#")) {
          const target = href.slice(1);
          if (/^\d+$/.test(target)) {
            add("citation-index-anchor", `citation links to slide index ${href}; use the supporting slide's stable id`);
          } else if (!document.getElementById(target)) {
            add("citation-broken-anchor", `citation links to ${href}, which is not a slide in this deck`);
          }
        } else if (!/^https:\/\//i.test(href)) {
          add("citation-broken-anchor", `citation link ${href.slice(0, 60)} is neither an in-deck anchor nor HTTPS`);
        }
      }
    }

    if (slide.dataset.section !== "supporting") {
      const clone = slide.cloneNode(true);
      for (const removed of clone.querySelectorAll(
        "h1, h2, h3, h4, h5, h6, svg, table, pre, code, figcaption, [data-citation], [data-chart], [data-echart]",
      )) {
        removed.remove();
      }
      const words = (clone.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
      if (words > budget) {
        add(
          "slide-text-budget",
          `${words} words of prose exceed the ${budget}-word budget; cut it, chart it, or move it to a supporting slide`,
        );
      }
    }

    return findings;
  }, { index: slideIndex, budget: proseBudget });
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
  return page.evaluate(({ expected, index }) => {
    const geometry = window.__niceDeck?.geometry?.();
    const slide = document.querySelector(".slide:not([hidden])") ?? document.querySelector(".slide");
    if (!geometry || !slide) {
      return [{
        viewport: expected.name,
        slide: index + 1,
        message: "fixed-canvas runtime geometry is unavailable",
      }];
    }
    const findings = [];
    const tolerance = 1.5;
    const expectedScale = Math.min(
      expected.width / geometry.designWidth,
      expected.height / geometry.designHeight,
    );
    const rect = slide.getBoundingClientRect();
    const expectedWidth = geometry.designWidth * expectedScale;
    const expectedHeight = geometry.designHeight * expectedScale;
    if (Math.abs(geometry.scale - expectedScale) > 0.002) {
      findings.push(`scale ${geometry.scale} does not match ${expectedScale}`);
    }
    if (
      Math.abs(rect.width - expectedWidth) > tolerance
      || Math.abs(rect.height - expectedHeight) > tolerance
    ) {
      findings.push(`slide is ${rect.width}x${rect.height}, expected ${expectedWidth}x${expectedHeight}`);
    }
    if (
      Math.abs(rect.left - (expected.width - expectedWidth) / 2) > tolerance
      || Math.abs(rect.top - (expected.height - expectedHeight) / 2) > tolerance
    ) {
      findings.push(
        `slide is not centered: ${rect.left},${rect.top}; expected `
        + `${(expected.width - expectedWidth) / 2},${(expected.height - expectedHeight) / 2}`,
      );
    }
    if (document.documentElement.dataset.niceDeckSettled !== "true") {
      findings.push("runtime scaling did not settle");
    }
    if (
      document.documentElement.scrollWidth > expected.width + 1
      || document.documentElement.scrollHeight > expected.height + 1
    ) {
      findings.push("viewport has unexpected scrolling");
    }
    return findings.map((message) => ({
      viewport: expected.name,
      slide: index + 1,
      message,
    }));
  }, { expected: viewport, index: slideIndex });
}

export async function previewDeck({
  sourcePath,
  outDir,
  workspaceRoot,
  keepServer = false,
  captureMode = true,
  browser: suppliedBrowser,
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
  const isOutline = /<html\b[^>]*\bdata-deck-kind=["']outline["']/i.test(
    sources.find(({ file }) => file === source)?.content.toString("utf8") ?? "",
  );
  const runtimeIntegrity = await validateSanctionedRuntime(sources, { required: !isOutline });
  const sourceHash = hashSources(sources);
  const shortHash = sourceHash.slice(0, 12);
  const renderDirectory = await ensureDirectory(
    join(outputRoot, shortHash),
    "render directory",
    outputRoot,
  );
  const snapshotRoot = join(renderDirectory, "site");
  await ensureSnapshot(renderDirectory, snapshotRoot, sources);

  const sourceRecord = sources.find(({ file }) => file === source);
  const cssSources = sources.filter(
    ({ file }) => extname(file).toLowerCase() === ".css",
  );
  const scan = await scanWorkspace({
    root,
    sourcePath: source,
    source: sourceRecord.content.toString("utf8"),
    styles: cssSources.map(({ content }) => content.toString("utf8")).join("\n"),
  });
  for (const scanned of cssSources) {
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

    for (let index = 0; index < slideCount; index += 1) {
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

      const layoutFindings = await page.evaluate((slideIndex) => {
        const slide = document.querySelector(".slide:not([hidden])") ?? document.querySelector(".slide");
        if (!slide) return [];
        const style = getComputedStyle(slide);
        const slideRect = slide.getBoundingClientRect();
        const scale = window.__niceDeck?.geometry?.().scale ?? 1;
        const box = {
          left: slideRect.left + Number.parseFloat(style.paddingLeft) * scale,
          right: slideRect.right - Number.parseFloat(style.paddingRight) * scale,
          top: slideRect.top + Number.parseFloat(style.paddingTop) * scale,
          bottom: slideRect.bottom - Number.parseFloat(style.paddingBottom) * scale,
        };
        // charts and preformatted blocks manage their own internal geometry
        const exempt = (element) => element.closest("[data-chart], [data-echart], svg, pre, code");
        // A full-bleed background is allowed to escape the padding box, but it
        // has to say so. Overlap checking still applies to it.
        const bleeds = (element) => element.closest("[data-bleed]");
        const label = (element) => {
          const cls = (element.className || "").toString().trim().split(/\s+/)[0];
          const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
          return `${element.tagName.toLowerCase()}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
        };
        const findings = [];

        for (const element of slide.querySelectorAll("*")) {
          if (exempt(element) || bleeds(element)) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          const escapes = [];
          if (rect.right > box.right + scale) escapes.push(`right by ${Math.round(rect.right - box.right)}px`);
          if (rect.left < box.left - scale) escapes.push(`left by ${Math.round(box.left - rect.left)}px`);
          if (rect.bottom > box.bottom + scale) escapes.push(`bottom by ${Math.round(rect.bottom - box.bottom)}px`);
          if (rect.top < box.top - scale) escapes.push(`top by ${Math.round(box.top - rect.top)}px`);
          if (escapes.length) findings.push(`overflows the slide ${escapes.join(" and ")}: ${label(element)}`);
        }

        // Any element that renders its own text, regardless of tag. A hard-coded
        // tag list silently misses small, em, figcaption and text-bearing divs.
        const ownsText = (element) => [...element.childNodes]
          .some((node) => node.nodeType === 3 && node.textContent.trim());
        const texts = [...slide.querySelectorAll("*")]
          .filter((element) => !exempt(element) && ownsText(element));
        // Per-line boxes, not the bounding rect. An inline element that wraps
        // has a bounding rect spanning every line it touches, which would
        // falsely "overlap" anything else on those lines. Measuring once per
        // element also keeps getClientRects out of the O(n^2) inner loop.
        const measured = texts
          .map((element) => ({
            element,
            boxes: [...element.getClientRects()].filter((line) => line.width > 2 && line.height > 2),
          }))
          .filter((entry) => entry.boxes.length);
        for (let a = 0; a < measured.length; a += 1) {
          for (let b = a + 1; b < measured.length; b += 1) {
            if (measured[a].element.contains(measured[b].element)
              || measured[b].element.contains(measured[a].element)) continue;
            let worst = null;
            for (const first of measured[a].boxes) {
              for (const second of measured[b].boxes) {
                const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
                const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
                if (
                  width > 2 * scale
                  && height > 2 * scale
                  && (!worst || width * height > worst.width * worst.height)
                ) {
                  worst = { width, height };
                }
              }
            }
            if (worst) {
              findings.push(`text overlaps by ${Math.round(worst.width)}x${Math.round(worst.height)}px: ${label(measured[a].element)} over ${label(measured[b].element)}`);
            }
          }
        }
        return [...new Set(findings)].slice(0, 12).map((message) => ({ slide: slideIndex + 1, message }));
      }, index);
      layoutIssues.push(...layoutFindings);
      layoutIssues.push(...await auditLayout(page, index));

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

    if (!captureMode && slideCount > 1 && runtimeReady) {
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
    if (fixedCanvasReady) {
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
    } else if (runtimeReady) {
      viewportAudit.push({
        viewport: "runtime",
        slide: 1,
        message: "fixed-canvas runtime geometry is unavailable",
      });
    }
    const result = {
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
      url,
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
    result.review = isOutline
      ? { status: "not-required", path: null, requiredRoles: [], findings: [] }
      : await assessReview({ workspace: root, previewRecord: result });
    const previewFile = join(outputRoot, "preview.json");
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
