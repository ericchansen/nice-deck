import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { exists } from "./files.mjs";

const lockedFileCodes = new Set(["EACCES", "EBUSY", "EPERM"]);

export async function retryLocked(operation, { attempts = 5, delayMs = 25 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!lockedFileCodes.has(error.code) || attempt >= attempts) throw error;
      await delay(delayMs * attempt);
    }
  }
}

export async function cleanupSnapshots(renderDirectory, currentRoot, retain = 3) {
  const snapshots = await Promise.all(
    (await readdir(renderDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && (entry.name === "site" || entry.name.startsWith("site-")))
      .map(async (entry) => {
        const path = join(renderDirectory, entry.name);
        return { path, modified: (await lstat(path)).mtimeMs };
      }),
  );
  const retained = new Set([
    currentRoot,
    ...snapshots
      .filter(({ path }) => path !== currentRoot)
      .sort((left, right) => right.modified - left.modified)
      .slice(0, Math.max(0, retain - 1))
      .map(({ path }) => path),
  ]);
  for (const { path } of snapshots) {
    if (retained.has(path)) continue;
    try {
      await retryLocked(() => rm(path, { recursive: true, force: true }));
    } catch (error) {
      // A file:// browser may briefly retain an older snapshot; retry it next render.
      if (!lockedFileCodes.has(error.code)) throw error;
    }
  }
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
      await retryLocked(() => rename(snapshotRoot, backupRoot));
      displaced = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      await retryLocked(() => rename(temporaryRoot, snapshotRoot));
    } catch (error) {
      // Another preview process may have published the same immutable snapshot
      // between our final comparison and rename. Treat that as success.
      if (await snapshotMatches(snapshotRoot, sources)) {
        if (displaced) await retryLocked(() => rm(backupRoot, { recursive: true, force: true }));
        return;
      }
      if (displaced && !await exists(snapshotRoot)) {
        await retryLocked(() => rename(backupRoot, snapshotRoot));
      }
      throw error;
    }
    if (displaced) await retryLocked(() => rm(backupRoot, { recursive: true, force: true }));
  } finally {
    await retryLocked(() => rm(temporaryRoot, { recursive: true, force: true }));
  }
}
