import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateOutline, renderOutlineHtml, validateOutline } from "./outline.mjs";

function frame(overrides = {}) {
  return {
    id: "measured-volume",
    title: "Measured monthly token volume",
    shows: "Monthly token volume, Jan-Jul 2026, billions of tokens.",
    says: "Volume tripled between January and July.",
    modality: "data",
    section: "main",
    sourceIds: ["S1"],
    status: "ready",
    ...overrides,
  };
}

function outline(overrides = {}) {
  return {
    version: 1,
    status: "draft",
    approvedAt: "",
    deck: { title: "Evidence review" },
    frames: [frame()],
    openEvidence: [],
    ...overrides,
  };
}

async function workspace() {
  return mkdtemp(join(tmpdir(), "nice-deck-outline-"));
}

test("a complete draft outline validates", () => {
  assert.deepEqual(validateOutline(outline()), []);
});

test("frames require a kebab-case unique id", () => {
  const failures = validateOutline(outline({
    frames: [frame({ id: "Measured Volume" }), frame()],
  }));
  assert.ok(failures.some((failure) => failure.includes("kebab-case id")));
});

test("conjecture in a frame fails validation", () => {
  const failures = validateOutline(outline({
    frames: [frame({ says: "One month cannot distinguish evaluation from migration." })],
  }));
  assert.ok(failures.some((failure) => failure.includes("conjecture")));
});

test("says must be one sentence", () => {
  const failures = validateOutline(outline({
    frames: [frame({ says: "Volume tripled. A second month would be needed." })],
  }));
  assert.ok(failures.some((failure) => failure.includes("one sentence")));
});

test("main frames may not follow supporting frames", () => {
  const failures = validateOutline(outline({
    frames: [
      frame({ id: "extract", section: "supporting" }),
      frame({ id: "headline" }),
    ],
  }));
  assert.ok(failures.some((failure) => failure.includes("supporting frames come last")));
});

test("approval requires status, date, and ready frames", () => {
  const failures = validateOutline(
    outline({ frames: [frame({ status: "needs-evidence" })] }),
    { phase: "approved" },
  );
  assert.ok(failures.some((failure) => failure.includes('status must be "approved"')));
  assert.ok(failures.some((failure) => failure.includes("approvedAt")));
  assert.ok(failures.some((failure) => failure.includes("openEvidence")));
});

test("approval passes when open evidence is recorded", () => {
  const failures = validateOutline(
    outline({
      status: "approved",
      approvedAt: "2026-01-31",
      frames: [frame({ status: "needs-evidence" })],
      openEvidence: ["measured-volume"],
    }),
    { phase: "approved" },
  );
  assert.deepEqual(failures, []);
});

test("rendered frames are plain and carry stable ids", () => {
  const html = renderOutlineHtml(outline());
  assert.match(html, /data-deck-kind="outline"/);
  assert.match(html, /id="measured-volume"/);
  assert.match(html, /Measured monthly token volume/);
  assert.doesNotMatch(html, /#(?![0-9a-f]{0,6}\b)[0-9a-f]{6}\b/i);
});

test("generate writes outline.html and the navigation runtime", async () => {
  const root = await workspace();
  await writeFile(join(root, "outline.json"), JSON.stringify(outline()), "utf8");
  const result = await generateOutline(root);
  assert.equal(result.ok, true);
  assert.match(await readFile(join(root, "outline.html"), "utf8"), /class="slide"/);
  assert.match(await readFile(join(root, "deck.js"), "utf8"), /__niceDeck/);
});

test("generate refuses an invalid outline", async () => {
  const root = await workspace();
  await writeFile(
    join(root, "outline.json"),
    JSON.stringify(outline({ frames: [frame({ title: "" })] })),
    "utf8",
  );
  const result = await generateOutline(root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("requires title")));
});
