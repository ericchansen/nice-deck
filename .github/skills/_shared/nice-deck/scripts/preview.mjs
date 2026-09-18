import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assessReview } from "./review.mjs";
import { formatFindings, scanSource, scanWorkspace } from "./scan.mjs";
import { proseBudget } from "./text-rules.mjs";
import { atomicWriteFile, ensureDirectory, isWithin } from "../lib/files.mjs";
import { findWorkspaceRoot, listStaticFiles, readSources, hashSources } from "../lib/workspace.mjs";
import { ensureSnapshot } from "../lib/snapshot.mjs";
import { startStaticServer } from "../lib/server.mjs";
import { openPreviewSession } from "../lib/browser-session.mjs";
import { captureSlides, hashScreenshots } from "../lib/capture.mjs";
import { auditDeck } from "../lib/audit.mjs";
import { validateSanctionedRuntime } from "../lib/checks/charts.mjs";

// Historical command-module API remains available to extensions and callers.
export { atomicWriteFile } from "../lib/files.mjs";
export { computeDeckSourceHash, findWorkspaceRoot } from "../lib/workspace.mjs";
export { startStaticServer } from "../lib/server.mjs";

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
  let session;
  let serverTransferred = false;

  try {
    session = await openPreviewSession({ browser: suppliedBrowser, url, browserErrors });
    const options = { slideIds, isOutline, captureMode, renderDirectory, browserErrors };
    const captured = fullAudit
      ? await auditDeck(session.page, options, { budget: proseBudget })
      : await captureSlides(session.page, options);
    const {
      slideCount, deckSlideIds, htmlSlideIds, indices, screenshots, contrast, contrastUnverified,
      chartAudit = [], layoutIssues = [], viewportAudit = [],
    } = captured;
    const screenshotHashes = captured.screenshotHashes ?? await hashScreenshots(screenshots);
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
      session?.close() ?? Promise.resolve(),
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
