import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateOutline, renderOutlineHtml, validateOutline } from "./outline.mjs";

function frame(overrides = {}) {
  return {
    id: "measured-volume",
    title: "Daily token volume",
    shows: "Daily token volume, Jul 1-31 2026, billions of tokens.",
    says: "Volume ranges from one to nine billion tokens a day.",
    modality: "data",
    section: "main",
    dataset: "tokens",
    sourceIds: ["S1"],
    status: "ready",
    ...overrides,
  };
}

function available(overrides = {}) {
  return {
    inventoriedAt: "2026-08-18",
    datasets: [
      {
        id: "tokens",
        name: "fact_tokens_usage_daily",
        location: "Power BI workspace: Unified Data",
        range: "2026-01-01 through 2026-07-31",
        grain: "day",
        dimensions: ["date", "subscription", "model"],
        measures: ["ContextT", "CachedTokens"],
        extracts: ["data/daily-total.csv"],
        scope: "One subscription only.",
      },
    ],
    notAvailable: ["request-level grain"],
    ...overrides,
  };
}

function outline(overrides = {}) {
  return {
    version: 1,
    status: "draft",
    approvedAt: "",
    deck: { title: "Evidence review" },
    available: available(),
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

test("frames are blocked until the data inventory exists", () => {
  const failures = validateOutline(outline({ available: undefined }));
  assert.ok(failures.some((failure) => failure.includes("requires an available block")));
  assert.ok(failures.some((failure) => failure.includes("before the data inventory is recorded")));
});

test("a dataset must record range, grain, dimensions, and scope", () => {
  const failures = validateOutline(outline({
    available: available({
      datasets: [{ id: "tokens", name: "fact_tokens_usage_daily", location: "Unified Data" }],
    }),
  }));
  assert.ok(failures.some((failure) => failure.includes("requires range")));
  assert.ok(failures.some((failure) => failure.includes("requires scope")));
  assert.ok(failures.some((failure) => failure.includes("grain must be one of")));
  assert.ok(failures.some((failure) => failure.includes("requires the dimensions")));
});

test("notAvailable must be recorded even when empty", () => {
  const failures = validateOutline(outline({
    available: available({ notAvailable: undefined }),
  }));
  assert.ok(failures.some((failure) => failure.includes("notAvailable must be an array")));
});

test("a data frame must name a dataset from the inventory", () => {
  const failures = validateOutline(outline({
    frames: [frame({ dataset: "missing-dataset" })],
  }));
  assert.ok(failures.some((failure) => failure.includes("must name a dataset")));
});

test("a monthly frame drawn from a daily table is rejected", () => {
  const failures = validateOutline(outline({
    frames: [frame({ shows: "Monthly token volume, Jan-Jul 2026, billions of tokens." })],
  }));
  assert.ok(failures.some((failure) => (
    failure.includes("shows month data") && failure.includes("provides day grain")
  )));
});

test("a daily frame drawn from a daily table is accepted", () => {
  assert.deepEqual(validateOutline(outline()), []);
});

test("a monthly frame is accepted when the source is monthly", () => {
  const failures = validateOutline(outline({
    available: available({
      datasets: [{
        ...available().datasets[0],
        grain: "month",
      }],
    }),
    frames: [frame({ shows: "Monthly token volume, Jan-Jul 2026, billions of tokens." })],
  }));
  assert.deepEqual(failures, []);
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
  assert.match(html, /Daily token volume/);
  assert.doesNotMatch(html, /#(?![0-9a-f]{0,6}\b)[0-9a-f]{6}\b/i);
});

test("the rendered outline shows the data inventory", () => {
  const html = renderOutlineHtml(outline());
  assert.match(html, /data-frame-kind="inventory"/);
  assert.match(html, /fact_tokens_usage_daily/);
  assert.match(html, /2026-01-01 through 2026-07-31 at day grain/);
  assert.match(html, /Not available: request-level grain/);
});

test("inventory separators are not double-escaped", () => {
  const html = renderOutlineHtml(outline({
    available: available({ notAvailable: ["first gap", "second gap"] }),
  }));
  assert.match(html, /first gap &middot; second gap/);
  assert.doesNotMatch(html, /&amp;middot;/);
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
