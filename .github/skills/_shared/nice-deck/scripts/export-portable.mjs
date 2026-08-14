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
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import { findWorkspaceRoot } from "./preview.mjs";
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

export async function exportPortable({ sourcePath, outputDir } = {}) {
  if (!sourcePath || !outputDir) throw new Error("sourcePath and outputDir are required");
  const source = resolve(sourcePath);
  const root = await findWorkspaceRoot(source);
  const destination = resolve(outputDir);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && entry.name === "assets") {
      await copyIfPresent(path, join(destination, "assets"));
    } else if (
      entry.isFile()
      && (rootFiles.has(entry.name) || extname(entry.name).toLowerCase() === ".js")
    ) {
      await cp(path, join(destination, entry.name), { force: true });
    }
  }

  const outputHtml = join(destination, basename(source));
  const sourceHtml = await readFile(source, "utf8");
  assertDirectFileHtml(sourceHtml);
  await cp(source, outputHtml, { force: true });
  await copyIfPresent(join(root, "runtime"), join(destination, "runtime"));

  const residual = (await readFile(outputHtml, "utf8")).match(/\/__nice-deck\//g);
  if (residual) throw new Error("portable HTML still contains extension-only runtime paths");
  const findings = await scanWorkspace({
    root: destination,
    sourcePath: outputHtml,
  });
  if (findings.length) {
    throw new Error(`portable package scan failed: ${findings.map(({ name }) => name).join(", ")}`);
  }

  return { root: await realpath(destination), html: await realpath(outputHtml) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await exportPortable({
      sourcePath: process.argv[2],
      outputDir: process.argv[3],
    });
    console.log(`portable root: ${result.root}`);
    console.log(`portable html: ${result.html}`);
  } catch (error) {
    console.error(`portable export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
