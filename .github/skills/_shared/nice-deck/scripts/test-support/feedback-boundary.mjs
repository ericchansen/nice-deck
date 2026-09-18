import assert from "node:assert/strict";
import { register } from "node:module";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

register("./no-audit-loader.mjs", import.meta.url);
const { previewDeck } = await import("../preview.mjs");
const { auditDeck } = await import("../../lib/audit.mjs");
const { assessReview } = await import("../review.mjs");
const { scanWorkspace, scanSource } = await import("../scan.mjs");
// Positive controls prove the traps are installed, not just unused imports.
for (const operation of [auditDeck, assessReview, scanWorkspace, scanSource]) {
  assert.throws(() => operation(), /forbidden feedback operation/);
}

const root = await mkdtemp(join(tmpdir(), "nice-deck-feedback-boundary-"));
try {
  await cp(new URL("../../runtime/", import.meta.url), join(root, "runtime"), { recursive: true });
  const sourcePath = join(root, "deck.html");
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>body { margin:0; background:white; color:black }
    .slide { padding:80px; background:white; color:black }</style></head><body>
    <section class="slide" id="first"><h1>First fixture</h1></section>
    <section class="slide" id="second"><h1>Second fixture</h1></section>
    <script src="runtime/deck.js"></script></body></html>`;
  await writeFile(sourcePath, html);
  await writeFile(join(root, "brief.md"), "Synthetic boundary fixture");
  for (const slideIds of [undefined, ["second"]]) {
    const preview = await previewDeck({ sourcePath, slideIds });
    assert.equal(preview.ok, true);
    assert.equal(preview.auditComplete, false);
    assert.equal(preview.capturedSlideCount, slideIds ? 1 : 2);
    assert.equal(preview.review.status, "not-required");
    assert.equal(JSON.parse(await readFile(preview.previewFile, "utf8")).mode, "feedback");
  }
  await writeFile(sourcePath, html.replace("Second fixture", '<span style="color:#fff">Low contrast</span>'));
  const contrast = await previewDeck({ sourcePath, slideIds: ["second"] });
  assert.equal(contrast.ok, false);
  assert.ok(contrast.contrast.length > 0, "feedback must still measure contrast");
  console.log("feedback completed with all audit/review operations trapped");
} finally {
  await rm(root, { recursive: true, force: true });
}
