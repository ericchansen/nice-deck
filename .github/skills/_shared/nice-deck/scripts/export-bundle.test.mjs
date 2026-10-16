import assert from "node:assert/strict";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { exportBundle, publishDirectory } from "./export-bundle.mjs";
import { workspaceFixture } from "./test-support/workspace.mjs";

test("bundle export writes and verifies every delivery format", async (t) => {
  const { workspace, probe } = await workspaceFixture(t);
  await writeFile(join(workspace, "SLIDE-COPY.md"), "# Slide copy\n");
  const result = await exportBundle({
    sourcePath: probe,
    outputDir: join(workspace, "delivery-bundle"),
  });

  await Promise.all([
    access(result.pdf),
    access(result.web),
    access(result.zip),
    access(result.source),
    access(result.slideCopy),
    access(result.hashes),
    access(result.manifest),
  ]);
  assert((await readFile(result.pdf)).subarray(0, 5).equals(Buffer.from("%PDF-")));
  assert((await readFile(result.zip)).subarray(0, 2).equals(Buffer.from("PK")));
  assert.equal(await readFile(result.source, "utf8"), await readFile(probe, "utf8"));
  assert.equal(await readFile(result.slideCopy, "utf8"), "# Slide copy\n");

  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.pages, 3);
  assert.match(manifest.sourceHash, /^[0-9a-f]{64}$/);
  assert(manifest.artifacts.some(({ type }) => type === "pdf"));
  assert(manifest.artifacts.some(({ type }) => type === "web-file"));
  assert(manifest.artifacts.some(({ type }) => type === "web-zip"));
  assert(manifest.artifacts.every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256)));
  assert.equal((await readFile(result.hashes, "utf8")).trim().split("\n").length,
    manifest.artifacts.length);
});

test("bundle export rejects slide-copy names reserved for required artifacts", async (t) => {
  const { workspace, probe } = await workspaceFixture(t);
  const collision = join(workspace, "probe.pdf");
  await writeFile(collision, "not slide copy");
  await assert.rejects(
    exportBundle({
      sourcePath: probe,
      outputDir: join(workspace, "delivery-bundle"),
      slideCopyPath: collision,
    }),
    /conflicts with a reserved bundle artifact: probe\.pdf/,
  );
});

test("failed bundle replacement preserves the previously published destination", async (t) => {
  const { workspace } = await workspaceFixture(t);
  const output = join(workspace, "delivery-bundle");
  const replacement = join(workspace, "replacement");
  await mkdir(output);
  await mkdir(replacement);
  await writeFile(join(output, "existing.txt"), "keep me");
  await writeFile(join(replacement, "new.txt"), "replace me");
  await assert.rejects(
    publishDirectory(replacement, output, {
      move: async (source, destination) => {
        if (source === replacement && destination === output) {
          const error = new Error("publish failed");
          error.code = "EPERM";
          throw error;
        }
        return rename(source, destination);
      },
    }),
    /publish failed/,
  );
  assert.equal(await readFile(join(output, "existing.txt"), "utf8"), "keep me");
});
