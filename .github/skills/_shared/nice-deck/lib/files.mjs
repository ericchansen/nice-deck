import { randomUUID } from "node:crypto";
import { access, cp, lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

export function isWithin(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

export function isHidden(name) {
  return name.startsWith(".");
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function ensureDirectory(path, label, parent) {
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

export async function copyIfPresent(source, destination) {
  if (!await exists(source)) return;
  await cp(source, destination, { recursive: true, force: true });
}
