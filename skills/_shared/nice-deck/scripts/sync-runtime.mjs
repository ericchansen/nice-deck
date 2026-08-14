import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const canonicalRoot = resolve(here, "..", "runtime");
const manifestName = "chart-runtime.manifest.json";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export async function syncRuntime({ workspaceRoot } = {}) {
  if (!workspaceRoot) throw new Error("workspaceRoot is required");
  const destination = resolve(workspaceRoot, "runtime");
  const manifestPath = join(canonicalRoot, manifestName);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const files = Object.keys(manifest.files ?? {});
  if (!files.length) throw new Error("chart-runtime.manifest.json contains no sanctioned files");

  for (const name of files) {
    const source = join(canonicalRoot, ...name.split("/"));
    if (!await exists(source)) throw new Error(`sanctioned runtime file is missing: ${name}`);
    const actual = sha256(await readFile(source));
    if (actual !== manifest.files[name].sha256) {
      throw new Error(`canonical runtime hash mismatch for ${name}`);
    }
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const name of files) {
    const source = join(canonicalRoot, ...name.split("/"));
    const target = join(destination, ...name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  }
  await cp(manifestPath, join(destination, manifestName));

  for (const name of files) {
    const target = join(destination, ...name.split("/"));
    const actual = sha256(await readFile(target));
    if (actual !== manifest.files[name].sha256) {
      throw new Error(`workspace runtime hash mismatch for ${name}`);
    }
  }
  return { destination, files, echartsVersion: manifest.echartsVersion };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await syncRuntime({ workspaceRoot: process.argv[2] });
    console.log(`runtime synced: ${result.destination}`);
    console.log(`echarts: ${result.echartsVersion}`);
    console.log(`files: ${result.files.join(", ")}`);
  } catch (error) {
    console.error(`runtime sync failed: ${error.message}`);
    process.exitCode = 1;
  }
}
