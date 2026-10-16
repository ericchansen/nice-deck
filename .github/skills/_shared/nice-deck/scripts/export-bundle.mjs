import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import yazl from "yazl";
import { exists, isWithin } from "../lib/files.mjs";
import { retryLocked } from "../lib/snapshot.mjs";
import { computeDeckSourceHash, findWorkspaceRoot } from "../lib/workspace.mjs";
import { exportDeck } from "./export-pdf.mjs";
import { exportPortable } from "./export-portable.mjs";

const { ZipFile } = yazl;

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function filesUnder(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`bundle cannot contain a symbolic link or special file: ${path}`);
    }
  }
  await visit(root);
  return files.sort();
}

async function zipDirectory(source, output) {
  const zip = new ZipFile();
  const files = await filesUnder(source);
  await new Promise((resolveZip, rejectZip) => {
    const stream = createWriteStream(output, { flags: "wx" });
    stream.on("close", resolveZip);
    stream.on("error", rejectZip);
    zip.outputStream.on("error", rejectZip);
    zip.outputStream.pipe(stream);
    for (const file of files) {
      zip.addFile(file, join(basename(source), relative(source, file)).replaceAll("\\", "/"));
    }
    zip.end();
  });
}

async function artifact(path, root, type) {
  return {
    type,
    path: relative(root, path).replaceAll("\\", "/"),
    bytes: (await stat(path)).size,
    sha256: await sha256(path),
  };
}

export async function publishDirectory(source, destination, { move = rename } = {}) {
  const backup = join(dirname(destination), `.${basename(destination)}-${randomUUID()}.bak`);
  let displaced = false;
  try {
    if (await exists(destination)) {
      await retryLocked(() => move(destination, backup));
      displaced = true;
    }
    try {
      await retryLocked(() => move(source, destination));
    } catch (error) {
      if (displaced && !await exists(destination)) {
        await retryLocked(() => move(backup, destination));
      }
      throw error;
    }
    if (displaced) await retryLocked(() => rm(backup, { recursive: true, force: true }));
  } catch (error) {
    if (displaced && !await exists(destination) && await exists(backup)) {
      await retryLocked(() => move(backup, destination));
    }
    throw error;
  }
}

export async function exportBundle({
  sourcePath,
  outputDir,
  slideCopyPath,
  requireReview = false,
} = {}) {
  if (!sourcePath) throw new Error("sourcePath is required");
  const source = await realpath(resolve(sourcePath));
  const workspace = await findWorkspaceRoot(source);
  const name = basename(source, extname(source));
  const requestedDestination = resolve(outputDir ?? join(dirname(source), `${name}-bundle`));
  if (isWithin(requestedDestination, source)) {
    throw new Error("outputDir cannot contain the source workspace");
  }

  await mkdir(dirname(requestedDestination), { recursive: true });
  const destination = join(
    dirname(requestedDestination),
    `.${basename(requestedDestination)}-${randomUUID()}.tmp`,
  );
  await mkdir(destination, { recursive: false });
  try {
    const pdfPath = join(destination, `${name}.pdf`);
    const webPath = join(destination, `${name}-web`);
    const zipPath = join(destination, `${name}-web.zip`);
    const sourceCopyPath = join(destination, basename(source));
    const hashesPath = join(destination, "SHA256SUMS.txt");
    const manifestPath = join(destination, "bundle-manifest.json");
    const detectedSlideCopy = slideCopyPath
      ? await realpath(resolve(slideCopyPath))
      : join(workspace, "SLIDE-COPY.md");
    const slideCopy = await exists(detectedSlideCopy) ? detectedSlideCopy : null;
    if (slideCopy && !isWithin(workspace, slideCopy)) {
      throw new Error("slideCopyPath must be inside the deck workspace");
    }
    const slideCopyName = slideCopy ? basename(slideCopy) : null;
    const reservedNames = new Set([
      basename(pdfPath),
      basename(webPath),
      basename(zipPath),
      basename(sourceCopyPath),
      basename(hashesPath),
      basename(manifestPath),
    ].map((value) => value.toLowerCase()));
    if (slideCopyName && reservedNames.has(slideCopyName.toLowerCase())) {
      throw new Error(`slide-copy filename conflicts with a reserved bundle artifact: ${slideCopyName}`);
    }

    const pdf = await exportDeck({ sourcePath: source, outputPath: pdfPath, requireReview });
    const portable = await exportPortable({
      sourcePath: source,
      outputDir: webPath,
      requireReview,
    });
    await cp(source, sourceCopyPath);
    const slideCopyOutput = slideCopy ? join(destination, basename(slideCopy)) : null;
    if (slideCopy) await cp(slideCopy, slideCopyOutput);
    await zipDirectory(webPath, zipPath);

    const artifacts = [
      await artifact(pdfPath, destination, "pdf"),
      await artifact(zipPath, destination, "web-zip"),
      await artifact(sourceCopyPath, destination, "source-html"),
      ...(slideCopyOutput ? [await artifact(slideCopyOutput, destination, "slide-copy")] : []),
      ...await Promise.all((await filesUnder(webPath))
        .map((path) => artifact(path, destination, "web-file"))),
    ].sort((left, right) => left.path.localeCompare(right.path));
    await writeFile(
      hashesPath,
      `${artifacts.map(({ sha256: hash, path }) => `${hash}  ${path}`).join("\n")}\n`,
    );
    await writeFile(manifestPath, `${JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      source: relative(workspace, source).replaceAll("\\", "/"),
      sourceHash: await computeDeckSourceHash({ sourcePath: source, workspaceRoot: workspace }),
      pages: pdf.pages,
      links: pdf.links,
      warnings: portable.warnings,
      artifacts,
    }, null, 2)}\n`);

    for (const item of artifacts) {
      const path = join(destination, item.path);
      if (await sha256(path) !== item.sha256) throw new Error(`bundle verification failed: ${item.path}`);
    }
    if (!(await readFile(pdfPath)).subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("bundle verification failed: invalid PDF");
    }
    if (!(await readFile(zipPath)).subarray(0, 2).equals(Buffer.from("PK"))) {
      throw new Error("bundle verification failed: invalid ZIP");
    }

    await publishDirectory(destination, requestedDestination);
    return {
      root: await realpath(requestedDestination),
      pdf: join(requestedDestination, basename(pdfPath)),
      web: join(requestedDestination, basename(webPath)),
      zip: join(requestedDestination, basename(zipPath)),
      source: join(requestedDestination, basename(sourceCopyPath)),
      slideCopy: slideCopyOutput
        ? join(requestedDestination, basename(slideCopyOutput))
        : null,
      hashes: join(requestedDestination, basename(hashesPath)),
      manifest: join(requestedDestination, basename(manifestPath)),
      warnings: portable.warnings,
    };
  } catch (error) {
    await retryLocked(() => rm(destination, { recursive: true, force: true }));
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const positional = [];
  let slideCopyPath;
  let requireReview = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--require-review") requireReview = true;
    else if (args[index] === "--slide-copy") {
      slideCopyPath = args[++index];
      if (!slideCopyPath) throw new Error("--slide-copy requires a path");
    } else if (args[index].startsWith("--")) {
      throw new Error(`Unknown option: ${args[index]}`);
    } else positional.push(args[index]);
  }
  if (!positional[0]) {
    console.error("usage: node export-bundle.mjs <deck.html> [output-dir] [--slide-copy path] [--require-review]");
    process.exit(2);
  }

  try {
    const result = await exportBundle({
      sourcePath: positional[0],
      outputDir: positional[1],
      slideCopyPath,
      requireReview,
    });
    console.log(`bundle: ${result.root}`);
    console.log(`manifest: ${result.manifest}`);
    console.log(`hashes: ${result.hashes}`);
    if (result.warnings.length) {
      console.log(`allowed presentation findings: ${result.warnings.map(({ name }) => name).join(", ")}`);
    }
  } catch (error) {
    console.error(`bundle export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
