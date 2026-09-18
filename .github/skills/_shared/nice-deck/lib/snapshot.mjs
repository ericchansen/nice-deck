import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { exists } from "./files.mjs";

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

export async function ensureSnapshot(renderDirectory, snapshotRoot, sources) {
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
