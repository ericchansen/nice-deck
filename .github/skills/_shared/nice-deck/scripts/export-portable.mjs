import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import {
  basename,
  extname,
  join,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import { findWorkspaceRoot, previewDeck } from "./preview.mjs";
import { validateReview } from "./review.mjs";
import { scanWorkspace } from "./scan.mjs";

const rootFiles = new Set([
  "deck.css",
  "deck.js",
  "sources.json",
  "slide-contracts.json",
  "visual-manifest.json",
]);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function copyIfPresent(source, destination) {
  if (!await exists(source)) return;
  await cp(source, destination, { recursive: true, force: true });
}

function assertDirectFileHtml(source) {
  if (/\/__nice-deck\//.test(source)) {
    throw new Error("master HTML uses preview-only /__nice-deck/ runtime paths; sync and migrate it first");
  }
  if (/<(?:script|link|img)\b[^>]+(?:src|href)\s*=\s*["'](?:https?:|\/\/|\/)/i.test(source)) {
    throw new Error("master HTML contains an absolute, external, or preview-only asset URL");
  }
}

function draftOutputDirectory(path) {
  return path.endsWith(".draft") ? path : `${path}.draft`;
}

export async function exportPortable({ sourcePath, outputDir, draft = false } = {}) {
  if (!sourcePath || !outputDir) throw new Error("sourcePath and outputDir are required");
  const source = await realpath(resolve(sourcePath));
  const root = await findWorkspaceRoot(source);
  const requestedDestination = resolve(outputDir);
  const destination = draft ? draftOutputDirectory(requestedDestination) : requestedDestination;
  let preview;
  let exportRoot = root;
  let exportSource = source;
  try {
    if (!draft) {
      preview = await previewDeck({ sourcePath: source, keepServer: true });
      if (!preview.ok) throw new Error(`preview failed; inspect ${preview.previewFile}`);
      await validateReview({ workspace: root, previewRecord: preview });
      exportRoot = preview.server.root;
      exportSource = join(exportRoot, relative(root, source));
    }
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });

    for (const entry of await readdir(exportRoot, { withFileTypes: true })) {
      const path = join(exportRoot, entry.name);
      if (entry.isDirectory() && ["assets", "data"].includes(entry.name)) {
        await copyIfPresent(path, join(destination, entry.name));
      } else if (
        entry.isFile()
        && (rootFiles.has(entry.name) || extname(entry.name).toLowerCase() === ".js")
      ) {
        await cp(path, join(destination, entry.name), { force: true });
      }
    }

    const outputHtml = join(destination, basename(source));
    const sourceHtml = await readFile(exportSource, "utf8");
    assertDirectFileHtml(sourceHtml);
    await cp(exportSource, outputHtml, { force: true });
    await copyIfPresent(join(exportRoot, "runtime"), join(destination, "runtime"));

    const residual = (await readFile(outputHtml, "utf8")).match(/\/__nice-deck\//g);
    if (residual) throw new Error("portable HTML still contains extension-only runtime paths");
    const findings = await scanWorkspace({
      root: destination,
      sourcePath: outputHtml,
    });
    if (findings.length) {
      throw new Error(`portable package scan failed: ${findings.map(({ name }) => name).join(", ")}`);
    }

    return {
      root: await realpath(destination),
      html: await realpath(outputHtml),
      draft,
    };
  } finally {
    await preview?.server.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const draft = process.argv.includes("--draft");
  const positional = process.argv.slice(2).filter((argument) => argument !== "--draft");
  try {
    const result = await exportPortable({
      sourcePath: positional[0],
      outputDir: positional[1],
      draft,
    });
    console.log(`portable root: ${result.root}`);
    console.log(`portable html: ${result.html}`);
    if (result.draft) console.log("draft: non-deliverable");
  } catch (error) {
    console.error(`portable export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
