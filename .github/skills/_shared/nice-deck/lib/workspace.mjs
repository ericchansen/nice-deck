import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { exists, isHidden, isWithin } from "./files.mjs";
import { staticExtensions } from "./static-policy.mjs";

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

async function previewFiles(root, source) {
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

  async function visitAssets(directory, allowedExtensions = staticExtensions) {
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

export async function readSources(root, files) {
  const sources = await Promise.all(files.map(async (file) => ({
    content: await readFile(file),
    file,
    path: relative(root, file),
  })));
  return sources.sort((first, second) => first.path.localeCompare(second.path));
}

export function hashSources(sources) {
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

const deliveryRootFiles = new Set([
  "deck.css", "deck.js", "sources.json", "slide-contracts.json", "visual-manifest.json",
]);

// Preview inventories individual allowlisted, contained files for byte identity.
// Delivery inventories copy operations: draft directories intentionally include
// hidden/unsupported files and retain cp's existing symlink behavior. Non-draft
// callers MUST supply the captured snapshot root, never the live workspace.
export async function workspaceInventory(root, source, { policy = "preview" } = {}) {
  if (policy === "preview") {
    return (await previewFiles(root, source)).map((file) => ({
      file, path: relative(root, file), recursive: false, role: "input",
    }));
  }
  if (policy !== "delivery") throw new Error(`unknown inventory policy: ${policy}`);
  const entries = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && ["assets", "data"].includes(entry.name)) {
      entries.push({ file: join(root, entry.name), path: entry.name, recursive: true, role: "input" });
    } else if (entry.isFile()
      && (deliveryRootFiles.has(entry.name) || extname(entry.name).toLowerCase() === ".js")) {
      entries.push({ file: join(root, entry.name), path: entry.name, recursive: false, role: "input" });
    }
  }
  // Runtime remains an optional late copy, after the HTML direct-file check.
  entries.push({ file: join(root, "runtime"), path: "runtime", recursive: true, role: "runtime" });
  return entries;
}

export async function listStaticFiles(root, source) {
  return (await workspaceInventory(root, source)).map(({ file }) => file);
}
