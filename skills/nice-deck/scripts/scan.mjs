import { createHash } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourceRules = [
  {
    name: "gradient-text",
    pattern: /background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text/i,
    message: "Gradient text is banned. Use solid color, weight, or size.",
  },
  {
    name: "side-stripe",
    pattern: /border-(?:left|right)\s*:\s*(?:[2-9]|\d\d)\s*px/i,
    message: "Use a full border, background tint, icon, or no accent.",
  },
  {
    name: "numbered-eyebrow",
    pattern: /class=["'][^"']*(?:kicker|eyebrow)[^"']*["']|>\s*0[1-9]\s*(?:&nbsp;|\s|\/|·)/i,
    message: "Drop repeated eyebrow scaffolding unless the number carries order.",
  },
  {
    name: "cream-token",
    pattern: /--(?:paper|cream|sand|linen|ivory|parchment|bone|flour|wheat|biscuit)\b/i,
    message: "Warm-paper defaults are banned. Choose color from the deck brief.",
  },
  {
    name: "glass-default",
    pattern: /backdrop-filter\s*:\s*blur/i,
    message: "Decorative glassmorphism is banned.",
  },
  {
    name: "manual-primary-visual",
    pattern: /class=["'][^"']*(?:growth-bar|scenario-channel|flow-gate|capacity-flow|decision-flow|econ-bar)[^"']*["']/i,
    message: "Primary bars, rails, gates, and flow diagrams must use ECharts or generated imagery.",
  },
];
const modalities = new Set(["data", "conceptual", "hybrid", "native"]);
const claimStatuses = new Set([
  "measured",
  "derived",
  "public assumption",
  "historical assumption",
  "illustrative scenario",
]);
const sourceTypes = new Set([
  "public-url",
  "measured-internal-extract",
  "workbook",
  "derived-calculation",
  "historical-evidence",
]);
const privatePatterns = [
  {
    name: "private-guid",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  },
  {
    name: "private-path",
    pattern: /\b[A-Z]:\\(?:Users|repos|src|workspaces)\\/i,
  },
  {
    name: "private-token",
    pattern: /\b(?:Bearer\s+[A-Za-z0-9._-]{16,}|AZURE_(?:OPENAI|SUBSCRIPTION|TENANT)_[A-Z_]+)\b/i,
  },
  {
    name: "private-url",
    pattern: /https?:\/\/[^\s"'<>]*(?:\.corp\.|internal|msx|dev\.azure\.com)[^\s"'<>]*/i,
  },
];

function finding(name, message, sample = "") {
  return { name, message, sample };
}

function isWithin(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
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

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export function scanSource(source) {
  const findings = [];

  if (/\/__nice-deck\//i.test(source)) {
    findings.push(finding(
      "preview-only-runtime-path",
      "Deck sources must use relative workspace runtime/ assets; /__nice-deck/ is preview-only.",
    ));
  }
  if (/<(?:script|link|img)\b[^>]+(?:src|href)\s*=\s*["'](?:https?:|\/\/|\/)/i.test(source)) {
    findings.push(finding(
      "nonportable-asset-url",
      "Deck assets must use relative URLs so the master opens directly from file://.",
    ));
  }

  for (const rule of sourceRules) {
    const match = source.match(rule.pattern);
    if (match) findings.push(finding(rule.name, rule.message, match[0].trim().slice(0, 80)));
  }

  for (const rule of privatePatterns) {
    const match = source.match(rule.pattern);
    if (match) {
      findings.push(finding(
        rule.name,
        "Customer-facing deck sources must not expose private identifiers, paths, tokens, or internal URLs.",
        match[0].slice(0, 80),
      ));
    }
  }

  if (
    /@keyframes|transition\s*:|animation\s*:/i.test(source)
    && !/prefers-reduced-motion/i.test(source)
  ) {
    findings.push(finding(
      "no-reduced-motion",
      "Animation requires a prefers-reduced-motion alternative.",
    ));
  }

  return findings;
}

function slideDeclarations(source) {
  return [...source.matchAll(/(<section\b[^>]*class=["'][^"']*\bslide\b[^"']*["'][^>]*>)([\s\S]*?)<\/section>/gi)]
    .map(([, tag, body]) => ({
      id: tag.match(/\bdata-slide-id=["']([^"']+)["']/i)?.[1],
      modality: tag.match(/\bdata-visual-modality=["']([^"']+)["']/i)?.[1],
      body,
      tag,
    }));
}

async function loadJson(path, label, findings) {
  if (!await exists(path)) {
    findings.push(finding(`${label}-missing`, `Every deck workspace requires ${label}.json.`));
    return null;
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    findings.push(finding(`${label}-invalid`, `${label}.json is invalid: ${error.message}`));
    return null;
  }
}

function validateSources(sourcesDocument, findings) {
  if (sourcesDocument?.version !== 1 || !Array.isArray(sourcesDocument.sources)) {
    findings.push(finding(
      "sources-invalid",
      "sources.json must use version 1 and contain a sources array.",
    ));
    return new Map();
  }
  const sources = new Map();
  for (const source of sourcesDocument.sources) {
    if (
      !/^S\d+$/.test(source.id ?? "")
      || !source.title
      || !source.publisher
      || !/^\d{4}-\d{2}-\d{2}$/.test(source.date ?? "")
      || !sourceTypes.has(source.type)
      || !source.locator
      || !source.confidentiality
    ) {
      findings.push(finding(
        "source-incomplete",
        `Source ${source.id ?? "(missing id)"} is missing required traceability fields.`,
      ));
      continue;
    }
    if (sources.has(source.id)) {
      findings.push(finding("source-duplicate", `Source ID ${source.id} is duplicated.`));
    }
    if (source.type === "public-url") {
      try {
        const url = new URL(source.url);
        if (url.protocol !== "https:") throw new Error("not HTTPS");
      } catch {
        findings.push(finding(
          "public-source-url",
          `Public source ${source.id} requires a valid HTTPS URL.`,
        ));
      }
    } else if (source.url) {
      findings.push(finding(
        "nonpublic-source-url",
        `Non-public source ${source.id} must use a safe locator instead of a URL.`,
      ));
    }
    sources.set(source.id, source);
  }
  return sources;
}

async function validateGeneratedAsset(root, entry, findings) {
  const assetReference = entry.generatedAsset;
  const provenanceReference = entry.provenance;
  if (!assetReference || !provenanceReference) {
    findings.push(finding(
      "generated-provenance-missing",
      `Slide ${entry.id} requires generatedAsset and provenance paths.`,
    ));
    return;
  }

  const asset = resolve(root, assetReference);
  const provenance = resolve(root, provenanceReference);
  if (!isWithin(root, asset) || !isWithin(root, provenance)) {
    findings.push(finding(
      "generated-provenance-outside-workspace",
      `Slide ${entry.id} generated assets must stay inside the workspace.`,
    ));
    return;
  }
  if (!await exists(asset) || !await exists(provenance)) {
    findings.push(finding(
      "generated-provenance-missing",
      `Slide ${entry.id} generated asset or provenance sidecar is missing.`,
    ));
    return;
  }

  let metadata;
  try {
    metadata = JSON.parse(await readFile(provenance, "utf8"));
  } catch (error) {
    findings.push(finding(
      "generated-provenance-invalid",
      `Slide ${entry.id} provenance is not valid JSON: ${error.message}`,
    ));
    return;
  }

  const actualHash = await sha256(asset);
  if (metadata.outputSha256 !== actualHash) {
    findings.push(finding(
      "generated-provenance-hash",
      `Slide ${entry.id} generated asset hash does not match its provenance sidecar.`,
    ));
  }
  if (!metadata.prompt || !metadata.model || !metadata.generatedAt || !metadata.visualRole) {
    findings.push(finding(
      "generated-provenance-incomplete",
      `Slide ${entry.id} provenance is missing prompt, model, generatedAt, or visualRole.`,
    ));
  }
}

export async function scanWorkspace({ root, sourcePath, source } = {}) {
  const workspaceRoot = await realpath(resolve(root ?? dirname(sourcePath)));
  const htmlPath = await realpath(resolve(sourcePath));
  const html = source ?? await readFile(htmlPath, "utf8");
  const findings = scanSource(html);
  const manifestPath = join(workspaceRoot, "visual-manifest.json");
  const sourcesPath = join(workspaceRoot, "sources.json");

  const manifest = await loadJson(manifestPath, "visual-manifest", findings);
  const sourcesDocument = await loadJson(sourcesPath, "sources", findings);
  if (!manifest || !sourcesDocument) return findings;
  const sources = validateSources(sourcesDocument, findings);

  if (manifest.version !== 1 || !Array.isArray(manifest.slides)) {
    findings.push(finding(
      "visual-manifest-invalid",
      "Visual manifest must use version 1 and contain a slides array.",
    ));
    return findings;
  }

  const declarations = slideDeclarations(html);
  const manifestById = new Map(manifest.slides.map((entry) => [String(entry.id), entry]));
  if (declarations.length !== manifest.slides.length) {
    findings.push(finding(
      "visual-manifest-count",
      `Manifest declares ${manifest.slides.length} slides, but HTML contains ${declarations.length}.`,
    ));
  }

  for (const declaration of declarations) {
    if (!declaration.id || !declaration.modality) {
      findings.push(finding(
        "primary-visual-undeclared",
        "Every .slide needs data-slide-id and data-visual-modality.",
        declaration.tag,
      ));
      continue;
    }
    const entry = manifestById.get(declaration.id);
    if (!entry) {
      findings.push(finding(
        "visual-manifest-slide-missing",
        `Slide ${declaration.id} is absent from visual-manifest.json.`,
      ));
      continue;
    }
    if (entry.modality !== declaration.modality || !modalities.has(entry.modality)) {
      findings.push(finding(
        "visual-modality-conflict",
        `Slide ${declaration.id} has a missing, invalid, or conflicting modality.`,
      ));
    }
  }

  for (const entry of manifest.slides) {
    const id = String(entry.id ?? "");
    if (!id || !modalities.has(entry.modality)) {
      findings.push(finding(
        "visual-manifest-invalid",
        "Every manifest slide needs an id and valid modality.",
      ));
      continue;
    }
    if (!entry.captureState || !entry.accessibility) {
      findings.push(finding(
        "visual-manifest-incomplete",
        `Slide ${id} requires captureState and accessibility summaries.`,
      ));
    }
    if (
      !entry.question
      || !entry.answer
      || !entry.decisionRelevance
      || !claimStatuses.has(entry.claimStatus)
      || !Array.isArray(entry.sourceIds)
      || entry.sourceIds.length === 0
    ) {
      findings.push(finding(
        "slide-contract-incomplete",
        `Slide ${id} requires question, answer, decisionRelevance, claimStatus, and sourceIds.`,
      ));
    }
    for (const sourceId of entry.sourceIds ?? []) {
      if (!sources.has(sourceId)) {
        findings.push(finding(
          "unresolved-source",
          `Slide ${id} references missing source ID ${sourceId}.`,
        ));
      }
    }
    if (entry.modality === "data") {
      if (
        entry.renderer !== "echarts-svg"
        || !entry.chartSelector
        || !entry.sourceSummary
        || !entry.units
        || !entry.visibleTakeaway
        || !entry.chartArchetype
      ) {
        findings.push(finding(
          "data-visual-invalid",
          `Slide ${id} data visuals require echarts-svg, chartSelector, sourceSummary, units, visibleTakeaway, and chartArchetype.`,
        ));
      } else {
        const rawSelector = entry.chartSelector.startsWith("#")
          ? entry.chartSelector.slice(1)
          : entry.chartSelector;
        const selector = rawSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`(?:id=["']${selector}["']|data-chart-id=["']${selector}["'])`).test(html)) {
          findings.push(finding(
            "data-chart-missing",
            `Slide ${id} chart selector ${entry.chartSelector} is not present in the HTML.`,
          ));
        }
      }
      const declaration = declarations.find((item) => item.id === id);
      const chartTag = declaration?.body.match(
        /<[^>]+(?:data-chart|data-echart)[^>]*>/i,
      )?.[0] ?? "";
      if (
        !/\bdata-chart-units=["'][^"']+["']/i.test(chartTag)
        || !/\bdata-visible-takeaway=["'][^"']+["']/i.test(chartTag)
        || !/\bdata-decision-relevance=["'][^"']+["']/i.test(chartTag)
        || !/\bdata-claim-status=["'][^"']+["']/i.test(chartTag)
        || !/\bdata-direct-labels=["']true["']/i.test(chartTag)
      ) {
        findings.push(finding(
          "chart-contract-missing",
          `Slide ${id} chart container requires units, visible takeaway, decision relevance, claim status, and direct-label declarations.`,
        ));
      }
      const visibleIds = new Set(
        [...(declaration?.body ?? "").matchAll(/\[S\d+\]/g)].map((match) => match[0].slice(1, -1)),
      );
      if (!(entry.sourceIds ?? []).some((sourceId) => visibleIds.has(sourceId))) {
        findings.push(finding(
          "visible-citation-missing",
          `Data slide ${id} requires a visible [S#] citation matching its manifest sourceIds.`,
        ));
      }
    }
    if (entry.modality === "conceptual" || entry.modality === "hybrid") {
      await validateGeneratedAsset(workspaceRoot, entry, findings);
    }
  }

  return findings;
}

export async function scanFile(file) {
  const path = resolve(file);
  if (extname(path).toLowerCase() === ".html") {
    return scanWorkspace({ root: dirname(path), sourcePath: path });
  }
  return scanSource(await readFile(path, "utf8"));
}

export function formatFindings(findings) {
  if (!findings.length) return "clean - no deterministic design issues";
  return findings
    .map((item) => (
      `${item.file ? `${item.file}: ` : ""}[${item.name}] ${item.message}`
      + `${item.sample ? ` (${item.sample})` : ""}`
    ))
    .join("\n");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scan.mjs <file.html|file.css>");
    process.exit(2);
  }

  try {
    const findings = await scanFile(file);
    const output = formatFindings(findings);
    (findings.length ? console.error : console.log)(output);
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(`cannot scan ${file}: ${error.message}`);
    process.exitCode = 2;
  }
}
