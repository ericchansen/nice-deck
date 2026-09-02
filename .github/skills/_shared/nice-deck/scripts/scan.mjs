import { createHash } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { conjecturePattern, countWords, proseBudget } from "./text-rules.mjs";

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
  {
    name: "printed-reasoning",
    pattern: /class=["'][^"']*(?:decision-relevance|why-this-matters|so-what|caveat|uncertainty|contract-strip)[^"']*["']/i,
    message: "Decision relevance and caveats are spoken, not printed. Move them to speaker notes.",
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

// Mirrors the rendered audit's exemptions so the static and rendered checks
// cannot disagree: the slide root itself, visually hidden helpers, declared
// full-bleed layers, and elements that manage their own geometry.
function exemptFromAbsoluteRule(selector) {
  if (/\bdata-bleed\b|\bsr-only\b|\bdata-grid-exception\b/i.test(selector)) return true;
  if (/(?:^|,)\s*(?:pre|code)\b/i.test(selector)) return true;
  return selector
    .split(",")
    .some((part) => /(?:^|\s)\.slide(?:\[[^\]]*\]|[:.][\w-]+)*\s*$/i.test(part.trim()));
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

  for (const block of source.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const [, selector, body] = block;
    if (!/position\s*:\s*absolute/i.test(body)) continue;
    if (!/grid-template-columns|display\s*:\s*(?:grid|flex)/i.test(body)) continue;
    // The rule is about content regions. The slide root establishes the
    // positioning context, and layout.md rule 2 exempts visually hidden
    // helpers and declared full-bleed layers; the rendered audit skips the
    // same set, so the two checks must agree.
    if (exemptFromAbsoluteRule(selector)) continue;
    findings.push(finding(
      "absolute-region",
      "Content regions must be children of the slide grid. An absolutely positioned band cannot align with the rows above it.",
      selector.trim().slice(0, 80),
    ));
    break;
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

function stripTags(markup) {
  return markup
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Prose the audience reads, excluding the title, direct labels, values, and
// the citation strip. Those are measured by their own rules.
function slideProse(body) {
  return stripTags(
    body
      .replace(/<h[1-6]\b[\s\S]*?<\/h[1-6]>/gi, " ")
      .replace(/<(footer|aside)\b[^>]*data-citation[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*\bdata-citation\b[^>]*>[\s\S]*?<\/[a-z]+>/gi, " ")
      .replace(/<(table|figcaption|code|pre)\b[\s\S]*?<\/\1>/gi, " "),
  );
}

function gridTracks(styles, slideBody) {
  const classes = new Set(
    [...slideBody.matchAll(/class=["']([^"']+)["']/g)]
      .flatMap(([, value]) => value.split(/\s+/))
      .filter(Boolean),
  );
  const tracks = new Map();
  for (const block of styles.replace(/\/\*[\s\S]*?\*\//g, " ").matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const [, selector, declarations] = block;
    const columns = declarations.match(/grid-template-columns\s*:\s*([^;]+)/i)?.[1]?.trim();
    if (!columns) continue;
    if (/\bdata-grid-exception\b/.test(selector)) continue;
    const selectorClasses = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map(([, name]) => name);
    if (!selectorClasses.length || !selectorClasses.every((name) => classes.has(name))) continue;
    tracks.set(selector.trim(), columns.replace(/\s+/g, " "));
  }
  return tracks;
}

function slideDeclarations(source) {
  return [...source.matchAll(/(<section\b[^>]*class=["'][^"']*\bslide\b[^"']*["'][^>]*>)([\s\S]*?)<\/section>/gi)]
    .map(([, tag, body]) => ({
      id: tag.match(/\bdata-slide-id=["']([^"']+)["']/i)?.[1]
        ?? tag.match(/\bid=["']([^"']+)["']/i)?.[1],
      modality: tag.match(/\bdata-visual-modality=["']([^"']+)["']/i)?.[1],
      section: tag.match(/\bdata-section=["']([^"']+)["']/i)?.[1] ?? "main",
      anchor: tag.match(/\bid=["']([^"']+)["']/i)?.[1],
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
    } else if (!source.deckAnchor) {
      findings.push(finding(
        "internal-source-anchor",
        `Source ${source.id} requires a deckAnchor naming the supporting slide that shows it.`,
      ));
    }
    sources.set(source.id, source);
  }
  return sources;
}

function linkTargets(sources) {
  const urls = new Set();
  for (const source of sources.values()) {
    if (source.url) urls.add(source.url.replace(/\/$/, ""));
  }
  return { urls };
}

function validateCitations(declarations, sources, findings) {
  const slideAnchors = new Set(
    declarations.map(({ anchor }) => anchor).filter(Boolean),
  );
  const supportingAnchors = new Set(
    declarations
      .filter(({ section }) => section === "supporting")
      .map(({ anchor }) => anchor)
      .filter(Boolean),
  );
  const { urls } = linkTargets(sources);

  // A declared anchor is only useful if it lands on a supporting slide that
  // actually exists in this deck.
  for (const source of sources.values()) {
    if (!source.deckAnchor) continue;
    const anchor = source.deckAnchor.replace(/^#/, "");
    if (supportingAnchors.has(anchor)) continue;
    findings.push(finding(
      "internal-source-anchor",
      slideAnchors.has(anchor)
        ? `Source ${source.id} deckAnchor #${anchor} is a main slide. Point it at the supporting slide that shows the evidence.`
        : `Source ${source.id} deckAnchor #${anchor} does not resolve to a supporting slide in this deck.`,
    ));
  }

  for (const declaration of declarations) {
    const citations = [...declaration.body.matchAll(
      /<([a-z]+)\b[^>]*\bdata-citation\b[^>]*>([\s\S]*?)<\/\1>/gi,
    )];
    if (!citations.length) continue;

    for (const [, , inner] of citations) {
      if (!stripTags(inner)) continue;
      const links = [...inner.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(([, href]) => href);
      if (!links.length) {
        findings.push(finding(
          "citation-not-linked",
          `Slide ${declaration.id ?? "(unidentified)"} prints a citation without a link. Link public sources to their canonical URL and internal sources to their supporting slide.`,
          stripTags(inner).slice(0, 80),
        ));
        continue;
      }
      for (const href of links) {
        if (href.startsWith("#")) {
          const target = href.slice(1);
          if (/^\d+$/.test(target)) {
            findings.push(finding(
              "citation-index-anchor",
              `Slide ${declaration.id ?? "(unidentified)"} cites slide index ${href}. Link the supporting slide's stable id so the citation survives reordering.`,
            ));
          } else if (!slideAnchors.has(target)) {
            findings.push(finding(
              "citation-unresolved",
              `Slide ${declaration.id ?? "(unidentified)"} cites #${target}, which is not a slide in this deck.`,
            ));
          } else if (declaration.section !== "supporting" && !supportingAnchors.has(target)) {
            // A supporting slide may link back to the main slide it supports;
            // a main slide citing another main slide is not evidence.
            findings.push(finding(
              "citation-target-not-supporting",
              `Slide ${declaration.id ?? "(unidentified)"} cites #${target}, which is a main slide. Internal citations point at the supporting slide that shows the extract or method.`,
            ));
          }
          continue;
        }
        if (!/^https:\/\//i.test(href)) {
          findings.push(finding(
            "citation-unresolved",
            `Slide ${declaration.id ?? "(unidentified)"} citation link ${href.slice(0, 60)} is neither an in-deck anchor nor an HTTPS URL.`,
          ));
          continue;
        }
        if (urls.size && !urls.has(href.replace(/\/$/, ""))) {
          findings.push(finding(
            "citation-unresolved",
            `Slide ${declaration.id ?? "(unidentified)"} citation link ${href.slice(0, 60)} does not match any public source in sources.json.`,
          ));
        }
      }
    }
  }
}

function validateSlideText(declarations, findings) {
  for (const declaration of declarations) {
    if (declaration.section === "supporting") continue;
    const prose = slideProse(declaration.body);
    const visibleText = stripTags(declaration.body);
    const conjecture = prose.match(conjecturePattern)?.[0];
    if (conjecture) {
      findings.push(finding(
        "slide-conjecture",
        `Slide ${declaration.id ?? "(unidentified)"} states conjecture. Interpretation is spoken, not printed.`,
        conjecture,
      ));
    }
    const sourceId = visibleText.match(/\[S\d+\]/);
    if (sourceId) {
      findings.push(finding(
        "visible-source-id",
        `Slide ${declaration.id ?? "(unidentified)"} prints an authoring source ID. Link the citation instead.`,
        sourceId[0],
      ));
    }
    const words = countWords(prose);
    if (words > proseBudget) {
      findings.push(finding(
        "slide-text-budget",
        `Slide ${declaration.id ?? "(unidentified)"} shows ${words} words of prose; the budget is ${proseBudget}. Cut it, chart it, or move it to a supporting slide.`,
      ));
    }
  }
}

function validateSupporting(declarations, styles, findings) {
  for (const declaration of declarations.filter(({ section }) => section === "supporting")) {
    if (!declaration.anchor) {
      findings.push(finding(
        "supporting-anchor-missing",
        `Supporting slide ${declaration.id ?? "(unidentified)"} requires an id so citations can link to it.`,
      ));
    }
    if (/<img\b|background-image\s*:/i.test(declaration.body)) {
      findings.push(finding(
        "supporting-imagery",
        `Supporting slide ${declaration.id ?? declaration.anchor} must contain data, not imagery.`,
      ));
    }
    const saturated = declaration.body.match(
      /(?:color|background(?:-color)?)\s*:\s*(?:#(?![0-9a-f]{0,8}$)|rgb|hsl)[^;"']*/i,
    );
    if (saturated) {
      findings.push(finding(
        "supporting-color",
        `Supporting slide ${declaration.id ?? declaration.anchor} is black and white only.`,
        saturated[0].slice(0, 60),
      ));
    }
  }
  if (
    declarations.some(({ section }) => section === "supporting")
    && /\[data-section=["']supporting["'][^{]*\{[^}]*(?:animation|transition)\s*:/i.test(styles)
  ) {
    findings.push(finding(
      "supporting-motion",
      "The supporting section is static. Remove animation and transition from supporting slides.",
    ));
  }
  const mainAfterSupporting = declarations
    .findIndex(({ section }) => section === "supporting");
  if (
    mainAfterSupporting >= 0
    && declarations.slice(mainAfterSupporting).some(({ section }) => section !== "supporting")
  ) {
    findings.push(finding(
      "supporting-order",
      "Supporting slides are the last slides in the deck.",
    ));
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlAttribute(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: "\"",
  };
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|(amp|apos|gt|lt|quot));/gi,
    (match, decimal, hexadecimal, entity) => {
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      return named[entity.toLowerCase()] ?? match;
    },
  );
}

function openingTags(source, tagName) {
  const tags = [];
  const start = new RegExp(`<${tagName}\\b`, "gi");
  for (const match of source.matchAll(start)) {
    let quote = null;
    for (let index = match.index; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === "\"" || character === "'") {
        quote = character;
      } else if (character === ">") {
        tags.push(source.slice(match.index, index + 1));
        break;
      }
    }
  }
  return tags;
}

function validateImageText(entry, metadata, slideHtml, findings) {
  const configured = entry.imageText ?? { mode: "none" };
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
    findings.push(finding(
      "generated-image-text-invalid",
      `Slide ${entry.id} imageText must be an object.`,
    ));
    return;
  }
  const mode = configured.mode ?? "none";
  if (!["none", "integrated"].includes(mode)) {
    findings.push(finding(
      "generated-image-text-invalid",
      `Slide ${entry.id} imageText.mode must be none or integrated.`,
    ));
    return;
  }

  const metadataMode = metadata.imageTextMode ?? "none";
  if (metadataMode !== mode) {
    findings.push(finding(
      "generated-image-text-mismatch",
      `Slide ${entry.id} image-text mode does not match its provenance sidecar.`,
    ));
  }
  if (mode === "none") return;

  const bakedText = configured.bakedText;
  const bakedTextValid = (
    !Array.isArray(bakedText)
    ? false
    : bakedText.length > 0
      && bakedText.every((value) => typeof value === "string" && value.trim())
  );
  if (!bakedTextValid) {
    findings.push(finding(
      "generated-image-text-invalid",
      `Slide ${entry.id} integrated image text requires a non-empty bakedText array.`,
    ));
  }
  const accessibleDescriptionValid = (
    typeof configured.accessibleDescription === "string"
    && configured.accessibleDescription.trim()
  );
  if (!accessibleDescriptionValid) {
    findings.push(finding(
      "generated-image-text-accessibility",
      `Slide ${entry.id} integrated image text requires an accessibleDescription.`,
    ));
  }
  if (configured.forbidExtraText !== true) {
    findings.push(finding(
      "generated-image-text-invalid",
      `Slide ${entry.id} integrated image text must set forbidExtraText to true.`,
    ));
  }
  if (
    bakedTextValid && bakedText.some((value) => (
      /https?:\/\/|www\.|\[[A-Z]\d+\]/i.test(value)
    ))
  ) {
    findings.push(finding(
      "generated-image-text-citation",
      `Slide ${entry.id} keeps citations, URLs, and source IDs outside generated pixels.`,
    ));
  }
  if (
    JSON.stringify(metadata.bakedText ?? []) !== JSON.stringify(bakedTextValid ? bakedText : [])
    || metadata.forbidExtraText !== configured.forbidExtraText
    || metadata.accessibleDescription !== configured.accessibleDescription
  ) {
    findings.push(finding(
      "generated-image-text-mismatch",
      `Slide ${entry.id} image-text contract does not match its provenance sidecar.`,
    ));
  }

  const normalizedAsset = String(entry.generatedAsset).replaceAll("\\", "/");
  const imageTag = openingTags(slideHtml, "img")
    .find((tag) => new RegExp(
      `\\bsrc\\s*=\\s*["']${escapeRegExp(normalizedAsset)}["']`,
      "i",
    ).test(tag.replaceAll("\\", "/")));
  const altMatch = imageTag?.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const alt = decodeHtmlAttribute(altMatch?.[1] ?? altMatch?.[2] ?? "");
  if (
    !alt
    || (
      accessibleDescriptionValid
      && alt.replace(/\s+/g, " ").trim()
        !== configured.accessibleDescription.replace(/\s+/g, " ").trim()
    )
  ) {
    findings.push(finding(
      "generated-image-text-accessibility",
      `Slide ${entry.id} generated image alt text must match accessibleDescription.`,
    ));
  }
}

async function validateGeneratedAsset(root, entry, slideHtml, findings) {
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
  validateImageText(entry, metadata, slideHtml, findings);
}

export async function scanWorkspace({ root, sourcePath, source, styles = "" } = {}) {
  const workspaceRoot = await realpath(resolve(root ?? dirname(sourcePath)));
  const htmlPath = await realpath(resolve(sourcePath));
  const html = source ?? await readFile(htmlPath, "utf8");
  const findings = scanSource(html);

  // outline.html is generated, deliberately unstyled, and has no deck contract.
  if (/<html\b[^>]*\bdata-deck-kind=["']outline["']/i.test(html)) return findings;

  const allStyles = [
    styles,
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(([, css]) => css),
  ].join("\n");
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

  validateCitations(declarations, sources, findings);
  validateSlideText(declarations, findings);
  validateSupporting(declarations, allStyles, findings);

  for (const declaration of declarations) {
    const tracks = gridTracks(allStyles, declaration.body);
    const distinct = new Set(tracks.values());
    if (distinct.size > 1) {
      findings.push(finding(
        "grid-track-mismatch",
        `Slide ${declaration.id ?? "(unidentified)"} stacks bands on ${distinct.size} different column track sets, so their boundaries cannot align. Share one grid or mark a deliberate exception with data-grid-exception.`,
        [...tracks.keys()].join(", ").slice(0, 80),
      ));
    }
    if (tracks.size > 1 && !/\bdata-region\b/.test(declaration.body)) {
      findings.push(finding(
        "region-undeclared",
        `Slide ${declaration.id ?? "(unidentified)"} builds multiple bands without data-region elements, so the render cannot measure whether their boundaries align.`,
      ));
    }
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
    // Every slide that carries evidence shows where it came from, whatever its
    // modality. A divider or title slide opts out explicitly in the markup.
    const slide = declarations.find((item) => item.id === id);
    if (
      slide
      && !/\bdata-citation-exempt\b/i.test(slide.tag)
      && !/\bdata-citation(?![\w-])/i.test(slide.body)
    ) {
      findings.push(finding(
        "visible-citation-missing",
        `Slide ${id} requires a linked citation. Mark a divider or title slide data-citation-exempt if it carries no evidence.`,
      ));
    }
    if (
      !entry.question
      || !entry.answer
      || !claimStatuses.has(entry.claimStatus)
      || !Array.isArray(entry.sourceIds)
      || entry.sourceIds.length === 0
    ) {
      findings.push(finding(
        "slide-contract-incomplete",
        `Slide ${id} requires question, answer, claimStatus, and sourceIds.`,
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
        || !/\bdata-claim-status=["'][^"']+["']/i.test(chartTag)
        || !/\bdata-direct-labels=["']true["']/i.test(chartTag)
      ) {
        findings.push(finding(
          "chart-contract-missing",
          `Slide ${id} chart container requires units, visible takeaway, claim status, and direct-label declarations.`,
        ));
      }
    }
    if (entry.modality === "conceptual" || entry.modality === "hybrid") {
      const declaration = declarations.find((item) => item.id === id);
      await validateGeneratedAsset(workspaceRoot, entry, declaration?.body ?? "", findings);
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
