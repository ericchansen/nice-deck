import { copyFile, readFile, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findConjecture, sentenceCount } from "./text-rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDeck = resolve(here, "..", "runtime", "deck.js");

const modalities = new Set(["data", "conceptual", "hybrid", "native"]);
const sections = new Set(["main", "supporting"]);
const frameStatuses = new Set(["draft", "needs-evidence", "ready"]);

// Finer grain sorts lower. A frame may never present a coarser period than its
// dataset provides without saying why: the finer series is already available.
const grainRank = new Map([
  ["request", 0],
  ["minute", 1],
  ["hour", 2],
  ["day", 3],
  ["week", 4],
  ["month", 5],
  ["quarter", 6],
  ["year", 7],
  ["snapshot", 8],
]);
const framePeriods = [
  [/\b(?:per[- ]request|request[- ]level|by request)\b/i, "request"],
  [/\b(?:per[- ]minute|minute[- ]level|by minute|rpm)\b/i, "minute"],
  [/\b(?:hourly|per[- ]hour|by hour)\b/i, "hour"],
  [/\b(?:daily|per[- ]day|by day)\b/i, "day"],
  [/\b(?:weekly|per[- ]week|by week)\b/i, "week"],
  [/\b(?:monthly|per[- ]month|by month)\b/i, "month"],
  [/\b(?:quarterly|per[- ]quarter|by quarter)\b/i, "quarter"],
  [/\b(?:yearly|annual|per[- ]year|by year)\b/i, "year"],
];

function framePeriod(text) {
  for (const [pattern, grain] of framePeriods) {
    if (pattern.test(String(text ?? ""))) return grain;
  }
  return null;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

export async function readOutline(workspaceRoot) {
  const path = join(resolve(workspaceRoot), "outline.json");
  if (!await exists(path)) throw new Error(`${path} is required`);
  return { path, outline: JSON.parse(await readFile(path, "utf8")) };
}

// The data inventory answers "what can we actually query?" before any frame
// claims what a slide shows. Writing frames first is how invented content and
// understated grain get in.
function validateInventory(outline, failures) {
  const available = outline?.available;
  const datasets = new Map();

  if (!available || typeof available !== "object") {
    failures.push("outline.json requires an available block recording the data inventory.");
    return datasets;
  }
  if (!Array.isArray(available.notAvailable)) {
    failures.push("available.notAvailable must be an array; record what you looked for and could not get.");
  }

  const entries = Array.isArray(available.datasets) ? available.datasets : [];
  if (!entries.length) {
    failures.push("available.datasets must record at least one dataset you can actually query.");
    return datasets;
  }

  for (const [index, dataset] of entries.entries()) {
    const label = `Dataset ${index + 1}${dataset?.id ? ` (${dataset.id})` : ""}`;
    for (const field of ["id", "name", "location", "range", "grain", "scope"]) {
      if (typeof dataset?.[field] !== "string" || !dataset[field].trim()) {
        failures.push(`${label} requires ${field}.`);
      }
    }
    if (!grainRank.has(dataset?.grain)) {
      failures.push(
        `${label} grain must be one of: ${[...grainRank.keys()].join(", ")}. `
        + "Record the finest grain the source actually provides.",
      );
    }
    if (!Array.isArray(dataset?.dimensions) || !dataset.dimensions.length) {
      failures.push(`${label} requires the dimensions you can group by.`);
    }
    if (!Array.isArray(dataset?.extracts)) {
      failures.push(`${label} extracts must be an array of files already pulled, even if empty.`);
    }
    if (typeof dataset?.id === "string" && dataset.id.trim()) {
      if (datasets.has(dataset.id)) failures.push(`${label} id is duplicated.`);
      else datasets.set(dataset.id, dataset);
    }
  }

  return datasets;
}

export function validateOutline(outline, { phase = "draft" } = {}) {
  const failures = [];
  if (outline?.version !== 1) failures.push("outline.json version must be 1.");

  const datasets = validateInventory(outline, failures);
  const frames = Array.isArray(outline?.frames) ? outline.frames : [];
  if (!frames.length) failures.push("outline.json requires at least one frame.");
  if (!datasets.size && frames.length) {
    failures.push(
      "Frames may not be written before the data inventory is recorded. "
      + "Fill available.datasets first: what you can query, over what range, at what grain.",
    );
  }

  const seen = new Set();
  let sawSupporting = false;
  for (const [index, frame] of frames.entries()) {
    const label = `Frame ${index + 1}${frame?.id ? ` (${frame.id})` : ""}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frame?.id ?? "")) {
      failures.push(`${label} requires a lowercase kebab-case id.`);
    } else if (seen.has(frame.id)) {
      failures.push(`${label} id is duplicated.`);
    } else {
      seen.add(frame.id);
    }

    for (const field of ["title", "shows", "says"]) {
      if (typeof frame?.[field] !== "string" || !frame[field].trim()) {
        failures.push(`${label} requires ${field}.`);
      } else if (/[\r\n]/.test(frame[field])) {
        failures.push(`${label} ${field} must be a single line.`);
      }
    }
    if (sentenceCount(frame?.says) > 1) {
      failures.push(`${label} says must be one sentence; split it into two frames.`);
    }
    if (!modalities.has(frame?.modality)) {
      failures.push(`${label} modality must be data, conceptual, hybrid, or native.`);
    }
    if (!sections.has(frame?.section)) {
      failures.push(`${label} section must be main or supporting.`);
    }
    if (!Array.isArray(frame?.sourceIds)) {
      failures.push(`${label} sourceIds must be an array.`);
    }
    if (!frameStatuses.has(frame?.status)) {
      failures.push(`${label} status must be draft, needs-evidence, or ready.`);
    }

    for (const field of ["title", "shows", "says"]) {
      const conjecture = findConjecture(frame?.[field]);
      if (conjecture) {
        failures.push(`${label} ${field} states conjecture ("${conjecture}"). Leave interpretation to the speaker.`);
      }
    }

    if (datasets.size && (frame?.modality === "data" || frame?.modality === "hybrid")) {
      const dataset = datasets.get(frame?.dataset);
      if (!dataset) {
        failures.push(
          `${label} is a ${frame.modality} frame and must name a dataset from available.datasets.`,
        );
      } else {
        const period = framePeriod(frame?.shows);
        const frameGrain = grainRank.get(period);
        const sourceGrain = grainRank.get(dataset.grain);
        if (
          period
          && Number.isInteger(frameGrain)
          && Number.isInteger(sourceGrain)
          && frameGrain > sourceGrain
        ) {
          failures.push(
            `${label} shows ${period} data, but ${dataset.id} provides ${dataset.grain} grain. `
            + "Use the finer series or state why the coarser one is the point.",
          );
        }
      }
    }

    if (frame?.section === "supporting") sawSupporting = true;
    else if (sawSupporting) {
      failures.push(`${label} is a main frame after a supporting frame; supporting frames come last.`);
    }
  }

  if (phase === "approved") {
    if (outline?.status !== "approved") {
      failures.push('outline.json status must be "approved" before direction work begins.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(outline?.approvedAt ?? "")) {
      failures.push("outline.json approvedAt must be an ISO date.");
    }
    const open = new Set(Array.isArray(outline?.openEvidence) ? outline.openEvidence : []);
    for (const frame of frames) {
      if (frame?.status !== "ready" && !open.has(frame?.id)) {
        failures.push(`Frame ${frame?.id} is not ready and is not recorded in openEvidence.`);
      }
    }
  }

  return failures;
}

export function renderOutlineHtml(outline) {
  const frames = outline.frames ?? [];
  const deck = outline.deck ?? {};
  const available = outline.available ?? {};
  const datasets = Array.isArray(available.datasets) ? available.datasets : [];
  const notAvailable = Array.isArray(available.notAvailable) ? available.notAvailable : [];
  const title = deck.title || "Deck outline";
  const cover = [
    '<section class="slide" data-frame-kind="cover">',
    '  <div class="frame">',
    `    <p class="meta">Outline &middot; ${escapeHtml(outline.status ?? "draft")} &middot; ${frames.length} frames</p>`,
    `    <h1>${escapeHtml(title)}</h1>`,
    deck.argument ? `    <p class="says">${escapeHtml(deck.argument)}</p>` : "",
    deck.audience ? `    <p class="meta">Audience: ${escapeHtml(deck.audience)}</p>` : "",
    "  </div>",
    "</section>",
  ].filter(Boolean).join("\n");

  const inventory = [
    '<section class="slide" data-frame-kind="inventory">',
    '  <div class="frame">',
    '    <p class="meta">What we can actually query</p>',
    "    <h1>Data inventory</h1>",
    ...datasets.map((dataset) => [
      '    <p class="shows">',
      `      <span>${escapeHtml(dataset.id ?? "")}</span>`,
      `      ${escapeHtml(dataset.name ?? "")} &middot; ${escapeHtml(dataset.location ?? "")}<br>`,
      `      ${escapeHtml(dataset.range ?? "")} at ${escapeHtml(dataset.grain ?? "")} grain<br>`,
      `      by ${escapeHtml((dataset.dimensions ?? []).join(", "))}<br>`,
      `      scope: ${escapeHtml(dataset.scope ?? "")}`,
      dataset.extracts?.length
        ? `      <br>pulled: ${escapeHtml(dataset.extracts.join(", "))}`
        : "",
      "    </p>",
    ].filter(Boolean).join("\n")),
    notAvailable.length
      ? `    <p class="meta">Not available: ${notAvailable.map((item) => escapeHtml(item)).join(" &middot; ")}</p>`
      : '    <p class="meta">Nothing recorded as unavailable.</p>',
    "  </div>",
    "</section>",
  ].join("\n");

  const slides = frames.map((frame, index) => [
    `<section class="slide" id="${escapeHtml(frame.id)}" data-frame-section="${escapeHtml(frame.section)}">`,
    '  <div class="frame">',
    `    <p class="meta">${index + 1} / ${frames.length} &middot; ${escapeHtml(frame.section)} &middot; ${escapeHtml(frame.modality)} &middot; ${escapeHtml(frame.status)}</p>`,
    `    <h1>${escapeHtml(frame.title)}</h1>`,
    `    <p class="shows"><span>Shows</span>${escapeHtml(frame.shows)}</p>`,
    `    <p class="says"><span>Says</span>${escapeHtml(frame.says)}</p>`,
    `    <p class="meta">${frame.dataset ? `Data: ${escapeHtml(frame.dataset)} &middot; ` : ""}${frame.sourceIds?.length ? `Sources: ${escapeHtml(frame.sourceIds.join(", "))}` : "Sources: none recorded"}</p>`,
    "  </div>",
    "</section>",
  ].join("\n")).join("\n");

  return `<!doctype html>
<html lang="en" data-deck-kind="outline">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - outline</title>
<style>
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; }
  body {
    overflow: hidden;
    background: #ffffff;
    color: #111111;
    font-family: ui-sans-serif, "Segoe UI", system-ui, sans-serif;
  }
  h1, p { margin: 0; }
  .slide {
    display: grid;
    place-items: center;
    width: 100vw;
    height: 100vh;
    min-height: 720px;
    padding: 64px;
  }
  .slide[hidden] { display: none !important; }
  .frame {
    display: grid;
    gap: 22px;
    max-width: 60ch;
    text-align: center;
  }
  h1 { font-size: 40px; font-weight: 700; line-height: 1.15; }
  .shows, .says { font-size: 22px; line-height: 1.4; }
  .shows span, .says span {
    display: block;
    margin-bottom: 6px;
    color: #5a5a5a;
    font-size: 13px;
    text-transform: uppercase;
  }
  .says { color: #3a3a3a; }
  .meta { color: #5a5a5a; font-size: 14px; }
  [data-frame-kind="inventory"] .frame { max-width: 96ch; text-align: left; gap: 14px; }
  [data-frame-kind="inventory"] h1 { text-align: center; }
  [data-frame-kind="inventory"] .shows { font-size: 16px; line-height: 1.45; }
  [data-frame-kind="inventory"] .meta { text-align: center; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      transition-duration: 0.001ms !important;
    }
  }
</style>
</head>
<body>
${cover}
${inventory}
${slides}
<script src="deck.js"></script>
</body>
</html>
`;
}

export async function generateOutline(workspaceRoot) {
  const root = resolve(workspaceRoot);
  const { outline } = await readOutline(root);
  const failures = validateOutline(outline);
  if (failures.length) return { ok: false, failures };

  const htmlPath = join(root, "outline.html");
  await writeFile(htmlPath, renderOutlineHtml(outline), "utf8");

  const deckPath = join(root, "deck.js");
  if (!await exists(deckPath)) await copyFile(runtimeDeck, deckPath);

  return { ok: true, failures: [], htmlPath, frameCount: outline.frames?.length ?? 0 };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const validateOnly = args.includes("--validate");
  const approved = args.includes("--approved");
  const workspaceRoot = args.find((value) => !value.startsWith("--"));
  if (!workspaceRoot) {
    console.error("usage: node outline.mjs <workspace> [--validate] [--approved]");
    process.exit(2);
  }

  try {
    if (validateOnly || approved) {
      const { outline } = await readOutline(workspaceRoot);
      const failures = validateOutline(outline, { phase: approved ? "approved" : "draft" });
      if (failures.length) {
        console.error(failures.map((failure) => `- ${failure}`).join("\n"));
        process.exitCode = 1;
      } else {
        console.log(`outline ok: ${outline.frames.length} frames, status ${outline.status}`);
      }
    } else {
      const result = await generateOutline(workspaceRoot);
      if (!result.ok) {
        console.error(result.failures.map((failure) => `- ${failure}`).join("\n"));
        process.exitCode = 1;
      } else {
        console.log(`wrote ${result.htmlPath} (${result.frameCount} frames)`);
        console.log("render it with nice_deck_preview and view every screenshot");
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
