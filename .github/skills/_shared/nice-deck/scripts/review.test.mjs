import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessReview,
  initReview,
  requiredReviewRoles,
  validateReview,
} from "./review.mjs";

const root = await mkdtemp(join(tmpdir(), "nice-deck-review-"));

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

try {
  await mkdir(join(root, "_renders"), { recursive: true });
  await mkdir(join(root, "assets"), { recursive: true });
  const screenshot = join(root, "_renders", "slide-01.png");
  const screenshotBytes = Buffer.from("review screenshot");
  await writeFile(screenshot, screenshotBytes);
  const asset = join(root, "assets", "concept.png");
  const assetBytes = Buffer.from("generated asset");
  await writeFile(asset, assetBytes);
  await writeJson(join(root, "visual-manifest.json"), {
    version: 1,
    slides: [
      {
        id: 1,
        generatedAsset: "assets/concept.png",
      },
      {
        id: 2,
        generatedAsset: "assets/concept.png",
      },
    ],
  });
  const preview = {
    ok: true,
    sourceHash: "a".repeat(64),
    screenshots: [screenshot],
    screenshotHashes: [hash(screenshotBytes)],
  };
  const previewPath = join(root, "_renders", "preview.json");
  await writeJson(previewPath, preview);

  const initialized = await initReview({ workspace: root });
  assert.equal(initialized.created, true);
  assert.equal((await assessReview({ workspace: root })).status, "pending");
  const initializedRecord = JSON.parse(await readFile(initialized.reviewPath, "utf8"));
  assert.deepEqual(
    initializedRecord.generatedAssets.map(({ slideId }) => slideId),
    ["1", "2"],
  );

  const record = initializedRecord;
  const screenshotHashes = record.screenshots.map(({ sha256 }) => sha256);
  record.roles = requiredReviewRoles.map((role) => ({
    role,
    verdict: "approve",
    reviewerContext: "screenshot-first",
    reviewedScreenshotHashes: screenshotHashes,
    findings: [],
    reviewedAt: "2026-09-02T00:00:00Z",
  }));
  await writeJson(initialized.reviewPath, record);
  assert.equal((await validateReview({ workspace: root })).status, "approved");

  record.roles[0].verdict = "revise";
  record.roles[0].findings = ["Message is unclear."];
  await writeJson(initialized.reviewPath, record);
  assert.equal((await assessReview({ workspace: root })).status, "rejected");

  record.roles[0].verdict = "approve";
  record.roles[0].findings = [];
  await writeJson(initialized.reviewPath, record);
  await writeFile(asset, "changed asset");
  assert.equal((await assessReview({ workspace: root })).status, "stale");

  await writeFile(asset, assetBytes);
  const stalePreview = {
    ...preview,
    screenshotHashes: ["b".repeat(64)],
  };
  assert.equal((await assessReview({
    workspace: root,
    previewRecord: stalePreview,
  })).status, "stale");
  assert.equal((await assessReview({
    workspace: root,
    previewRecord: {
      ...preview,
      sourceHash: "c".repeat(64),
    },
  })).status, "stale");

  const existing = await initReview({ workspace: root });
  assert.equal(existing.created, false);

  const malformed = JSON.parse(await readFile(initialized.reviewPath, "utf8"));
  malformed.roles[0].findings = {};
  malformed.roles[0].reviewedAt = true;
  await writeJson(initialized.reviewPath, malformed);
  assert.equal((await assessReview({ workspace: root })).status, "rejected");

  await writeFile(join(initialized.reviewPath, "..", "slide-01.png"), "changed screenshot");
  await writeJson(initialized.reviewPath, record);
  assert.equal((await assessReview({ workspace: root })).status, "stale");
} finally {
  await rm(root, { recursive: true, force: true });
}
