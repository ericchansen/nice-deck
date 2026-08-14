import { createHash } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { computeDeckSourceHash } from "./preview.mjs";

const requiredRoles = ["figure-heavy", "text-heavy", "data-heavy"];
const modalities = new Set(["data", "conceptual", "hybrid", "native"]);
const approvalStatuses = new Set(["approved", "combine"]);

function isWithin(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
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

function requireString(value, label, failures) {
  if (typeof value !== "string" || !value.trim()) failures.push(`${label} is required.`);
}

function duplicateValues(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => seen.has(value) || !seen.add(value)))];
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function faceSupportsWeight(faceWeight, declaredWeight) {
  const values = String(faceWeight).match(/\d+/g)?.map(Number) ?? [];
  const weight = Number(declaredWeight);
  if (!Number.isFinite(weight) || values.length === 0) return false;
  if (values.length === 1) return values[0] === weight;
  return weight >= values[0] && weight <= values[1];
}

async function isPng(path) {
  const signature = (await readFile(path)).subarray(0, 8);
  return signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function validateDirectionMatrix({
  workspaceRoot,
  phase = "draft",
  typographyInspector,
} = {}) {
  if (!workspaceRoot) throw new Error("workspaceRoot is required");
  if (!["draft", "review", "approved"].includes(phase)) {
    throw new Error(`unsupported direction-matrix phase: ${phase}`);
  }

  const workspace = await realpath(resolve(workspaceRoot));
  const directionsRoot = resolve(workspace, "directions");
  const matrixPath = resolve(directionsRoot, "visual-direction-matrix.json");
  const failures = [];
  if (!await exists(matrixPath)) {
    return ["directions/visual-direction-matrix.json is required."];
  }

  let matrix;
  try {
    matrix = JSON.parse(await readFile(matrixPath, "utf8"));
  } catch (error) {
    return [`visual-direction-matrix.json is invalid: ${error.message}`];
  }

  if (matrix.version !== 1) failures.push("Direction matrix version must be 1.");
  const content = matrix.content ?? {};
  const declaredRoles = Object.keys(content);
  const additionalRoles = declaredRoles.filter((role) => !requiredRoles.includes(role));
  for (const role of additionalRoles) {
    if (!/^data-heavy-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(role)) {
      failures.push(`Additional content role ${role} must use the data-heavy-<chart-purpose> naming convention.`);
    }
  }
  const roles = [
    ...requiredRoles,
    ...additionalRoles.filter((role) => !requiredRoles.includes(role)),
  ];
  for (const role of roles) {
    const probe = content[role];
    if (!probe) {
      failures.push(`Content contract ${role} is required.`);
      continue;
    }
    for (const field of [
      "id",
      "slideId",
      "question",
      "answer",
      "evidence",
      "decisionRelevance",
      "caveat",
      "claimStatus",
    ]) {
      requireString(probe[field], `Content ${role}.${field}`, failures);
    }
    if (!modalities.has(probe.modality)) {
      failures.push(`Content ${role}.modality must be data, conceptual, hybrid, or native.`);
    }
    if (!Array.isArray(probe.sourceIds) || probe.sourceIds.length === 0) {
      failures.push(`Content ${role}.sourceIds must contain at least one source ID.`);
    }
  }

  const directions = Array.isArray(matrix.directions) ? matrix.directions : [];
  if (directions.length !== 6) failures.push(`Exactly 6 directions are required; found ${directions.length}.`);
  for (const duplicate of duplicateValues(directions.map(({ id }) => id))) {
    failures.push(`Direction ID ${duplicate} is duplicated.`);
  }
  for (const duplicate of duplicateValues(directions.map(({ name }) => name))) {
    failures.push(`Direction name ${duplicate} is duplicated.`);
  }
  for (const duplicate of duplicateValues(directions.map(({ treatment }) => treatment))) {
    failures.push(`Treatment path ${duplicate} is reused.`);
  }
  const typeFingerprints = new Map();
  const typeDimensions = [];
  const screenshotHashes = [];
  const renderedTypeSystems = [];
  const browser = (phase === "review" || phase === "approved") && !typographyInspector
    ? await chromium.launch()
    : null;

  try {
    for (const direction of directions) {
      const label = `Direction ${direction.id ?? "(missing id)"}`;
      let treatmentPath;
    for (const field of [
      "id",
      "name",
      "physicalScene",
      "colorStrategy",
      "composition",
      "graphicMedium",
      "motion",
      "slopRisk",
      "treatment",
    ]) {
      requireString(direction[field], `${label}.${field}`, failures);
    }
    if (!Array.isArray(direction.voice) || direction.voice.length !== 3) {
      failures.push(`${label}.voice must contain exactly 3 concrete words.`);
    }
    const typeSystem = direction.typeSystem ?? {};
    for (const field of [
      "id",
      "displayFamily",
      "textFamily",
      "displayWeight",
      "textWeight",
      "scale",
      "headingMeasure",
      "bodyMeasure",
      "casing",
      "rhythm",
      "specimenSource",
    ]) {
      requireString(typeSystem[field], `${label}.typeSystem.${field}`, failures);
    }
    const typeDimension = [
      typeSystem.displayFamily,
      typeSystem.textFamily,
      typeSystem.displayWeight,
      typeSystem.textWeight,
      typeSystem.scale,
      typeSystem.headingMeasure,
      typeSystem.bodyMeasure,
      typeSystem.casing,
      typeSystem.rhythm,
    ].map((value) => String(value ?? "").trim().toLowerCase());
    const typeFingerprint = typeDimension.join("|");
    if (typeFingerprints.has(typeFingerprint)) {
      failures.push(`${label}.typeSystem duplicates ${typeFingerprints.get(typeFingerprint)}.`);
    } else {
      typeFingerprints.set(typeFingerprint, label);
    }
    typeDimensions.push({ label, values: typeDimension });
    if (!Array.isArray(typeSystem.fontAssets) || typeSystem.fontAssets.length === 0) {
      failures.push(`${label}.typeSystem.fontAssets must declare locally packaged fonts.`);
    }
    const fontAssetUrls = [];
    for (const asset of typeSystem.fontAssets ?? []) {
      requireString(asset.path, `${label}.typeSystem.fontAssets.path`, failures);
      requireString(asset.license, `${label}.typeSystem.fontAssets.license`, failures);
      requireString(asset.sourceUrl, `${label}.typeSystem.fontAssets.sourceUrl`, failures);
      if ((phase === "review" || phase === "approved") && typeof asset.path === "string") {
        const fontPath = resolve(workspace, asset.path);
        if (!isWithin(workspace, fontPath) || !await exists(fontPath)) {
          failures.push(`${label} font asset must resolve inside the workspace: ${asset.path}.`);
        } else {
          fontAssetUrls.push(pathToFileURL(await realpath(fontPath)).href);
        }
      }
    }

    const probes = Array.isArray(direction.probes) ? direction.probes : [];
    const probeRoles = probes.map(({ role }) => role);
    if (
      probes.length !== roles.length
      || roles.some((role) => !probeRoles.includes(role))
      || duplicateValues(probeRoles).length
    ) {
      failures.push(`${label}.probes must contain each probe role exactly once.`);
    }
    for (const probe of probes) {
      if (!roles.includes(probe.role)) continue;
      if (probe.contentId !== content[probe.role]?.id) {
        failures.push(`${label} ${probe.role} must reuse content ID ${content[probe.role]?.id}.`);
      }
    }

    if (typeof direction.treatment === "string" && direction.treatment.trim()) {
      treatmentPath = resolve(directionsRoot, direction.treatment);
      if (!isWithin(directionsRoot, treatmentPath)) {
        failures.push(`${label}.treatment must stay inside directions/.`);
      } else if ((phase === "review" || phase === "approved") && !await exists(treatmentPath)) {
        failures.push(`${label}.treatment does not exist: ${direction.treatment}.`);
      } else if (await exists(treatmentPath)) {
        const treatment = await readFile(treatmentPath, "utf8");
        if (
          typeof typeSystem.id === "string"
          && !new RegExp(`\\bdata-type-system-id=["']${typeSystem.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(treatment)
        ) {
          failures.push(`${label}.treatment must declare data-type-system-id="${typeSystem.id}".`);
        }
        const attribute = (tag, name) => tag.match(
          new RegExp(`\\b${name}=["']([^"']+)["']`, "i"),
        )?.[1];
        const declarations = [...treatment.matchAll(/<section\b[^>]*>/gi)]
          .map(([tag]) => ({ tag, className: attribute(tag, "class") ?? "" }))
          .filter(({ className }) => className.split(/\s+/).includes("slide"))
          .map(({ tag }) => ({
            role: attribute(tag, "data-probe-role"),
            contentId: attribute(tag, "data-content-id"),
          }));
        if (declarations.length !== roles.length) {
          failures.push(`${label}.treatment must contain exactly ${roles.length} slides.`);
        }
        for (const role of roles) {
          const matches = declarations.filter((entry) => entry.role === role);
          if (matches.length !== 1 || matches[0].contentId !== content[role]?.id) {
            failures.push(`${label}.treatment must declare one ${role} slide with the frozen content ID.`);
          }
        }

        if (phase === "review" || phase === "approved") {
          for (const requiredFile of ["brief.md", "visual-manifest.json", "sources.json"]) {
            if (!await exists(resolve(dirname(treatmentPath), requiredFile))) {
              failures.push(`${label} requires treatment-local ${requiredFile}.`);
            }
          }
          const contractPath = resolve(dirname(treatmentPath), "slide-contracts.json");
          if (!await exists(contractPath)) {
            failures.push(`${label} requires treatment-local slide-contracts.json.`);
          } else {
            let contractDocument;
            try {
              contractDocument = JSON.parse(await readFile(contractPath, "utf8"));
            } catch (error) {
              failures.push(`${label} slide-contracts.json is invalid: ${error.message}`);
            }
            const contracts = Array.isArray(contractDocument?.slides)
              ? contractDocument.slides
              : [];
            if (contracts.length !== roles.length) {
              failures.push(`${label} must declare exactly ${roles.length} slide contracts.`);
            }
            for (const role of roles) {
              const contract = contracts.find((entry) => entry.role === role);
              if (!contract) {
                failures.push(`${label} lacks a ${role} slide contract.`);
                continue;
              }
              for (const field of [
                "id",
                "slideId",
                "question",
                "answer",
                "evidence",
                "decisionRelevance",
                "caveat",
                "claimStatus",
                "sourceIds",
                "modality",
              ]) {
                if (!sameValue(contract[field], content[role]?.[field])) {
                  failures.push(`${label} ${role}.${field} differs from frozen content.`);
                }
              }
            }
          }

          const inspection = typographyInspector
            ? await typographyInspector({
              treatmentPath,
              typeSystem,
              roles,
              content,
              fontAssetUrls,
            })
            : await (async () => {
              const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
              try {
                await page.route(/^https?:/i, (route) => route.abort());
                await page.goto(pathToFileURL(treatmentPath).href, { waitUntil: "networkidle" });
                await page.evaluate(() => document.fonts?.ready);
                const fontData = await page.evaluate(() => ({
                  fontFaces: [...document.fonts].map((face) => ({
                    family: face.family,
                    status: face.status,
                    weight: face.weight,
                  })),
                  fontRules: [...document.styleSheets].flatMap((sheet) => {
                    try {
                      return [...sheet.cssRules]
                        .filter((rule) => rule.type === CSSRule.FONT_FACE_RULE)
                        .map((rule) => ({
                          family: rule.style.getPropertyValue("font-family"),
                          sources: [...rule.style.getPropertyValue("src").matchAll(
                            /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
                          )].map(([, source]) => new URL(
                            source,
                            sheet.href ?? document.baseURI,
                          ).href),
                          weight: rule.style.getPropertyValue("font-weight") || "400",
                        }));
                    } catch {
                      return [];
                    }
                  }),
                }));
                const slideData = [];
                for (let index = 0; index < roles.length; index += 1) {
                  slideData.push(await page.evaluate(async (slideIndex) => {
                    window.__niceDeck?.goTo(slideIndex);
                    await new Promise((resolveFrame) => {
                      requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
                    });
                    const slide = document.querySelector(".slide:not([hidden])");
                    const field = (name) => {
                      const element = slide?.querySelector(`[data-contract-field="${name}"]`);
                      if (!element) return { text: "", visible: false };
                      const style = getComputedStyle(element);
                      const rect = element.getBoundingClientRect();
                      const slideRect = slide.getBoundingClientRect();
                      const visibleWidth = Math.min(rect.right, slideRect.right, innerWidth)
                        - Math.max(rect.left, slideRect.left, 0);
                      const visibleHeight = Math.min(rect.bottom, slideRect.bottom, innerHeight)
                        - Math.max(rect.top, slideRect.top, 0);
                      const visible = rect.width > 0
                        && rect.height > 0
                        && visibleWidth > 0
                        && visibleHeight > 0
                        && style.display !== "none"
                        && style.visibility !== "hidden"
                        && Number.parseFloat(style.opacity) > 0
                        && (!element.checkVisibility || element.checkVisibility({
                          checkOpacity: true,
                          checkVisibilityCSS: true,
                        }));
                      return {
                        text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
                        visible,
                      };
                    };
                    const display = slide?.querySelector("[data-type-role=display]");
                    const text = slide?.querySelector("[data-type-role=text]");
                    const typography = (() => {
                      if (!display || !text) return null;
                      const displayStyle = getComputedStyle(display);
                      const textStyle = getComputedStyle(text);
                      return {
                        role: slide.dataset.probeRole,
                        displayFamily: displayStyle.fontFamily,
                        displayWeight: displayStyle.fontWeight,
                        textFamily: textStyle.fontFamily,
                        textWeight: textStyle.fontWeight,
                      };
                    })();
                    return {
                    contract: {
                      role: slide?.dataset.probeRole,
                      question: field("question"),
                      answer: field("answer"),
                      evidence: field("evidence"),
                      decisionRelevance: field("decisionRelevance"),
                      caveat: field("caveat"),
                      claimStatus: slide?.dataset.claimStatus,
                      sourceIds: (slide?.dataset.sourceIds ?? "").split(/[\s,]+/).filter(Boolean),
                      modality: slide?.dataset.visualModality,
                    },
                    typography,
                    };
                  }, index));
                }
                return {
                  ...fontData,
                  contracts: slideData.map(({ contract }) => contract),
                  typography: slideData.map(({ typography }) => typography),
                };
              } finally {
                await page.close();
              }
            })();
          const typography = inspection.typography ?? [];
          const fontFaces = inspection.fontFaces ?? [];
          const fontRules = inspection.fontRules ?? [];
          const normalizeFamily = (value) => String(value).replaceAll(/["']/g, "").toLowerCase();
          const primaryFamily = (value) => normalizeFamily(String(value).split(",")[0].trim());
          for (const [family, weight, role] of [
            [typeSystem.displayFamily, typeSystem.displayWeight, "display"],
            [typeSystem.textFamily, typeSystem.textWeight, "text"],
          ]) {
            const loaded = fontFaces.some((face) => (
              face.status === "loaded"
              && normalizeFamily(face.family) === normalizeFamily(family)
              && faceSupportsWeight(face.weight, weight)
            ));
            if (!loaded) failures.push(`${label} ${role} font family and weight are not loaded from @font-face.`);
            const localRule = fontRules.some((rule) => (
              normalizeFamily(rule.family) === normalizeFamily(family)
              && faceSupportsWeight(rule.weight, weight)
              && fontAssetUrls.some((assetUrl) => rule.sources?.includes(assetUrl))
            ));
            if (!localRule) failures.push(`${label} ${role} @font-face must resolve to a declared local font asset.`);
          }
            if (typography.length !== roles.length || typography.some((entry) => !entry)) {
              failures.push(`${label} must expose display and text specimens on all ${roles.length} slides.`);
            } else {
              for (const entry of typography) {
                if (primaryFamily(entry.displayFamily) !== normalizeFamily(typeSystem.displayFamily)) {
                  failures.push(`${label} ${entry.role} does not render the declared display family.`);
                }
                if (primaryFamily(entry.textFamily) !== normalizeFamily(typeSystem.textFamily)) {
                  failures.push(`${label} ${entry.role} does not render the declared text family.`);
                }
                if (entry.displayWeight !== typeSystem.displayWeight) {
                  failures.push(`${label} ${entry.role} does not render the declared display weight.`);
                }
                if (entry.textWeight !== typeSystem.textWeight) {
                  failures.push(`${label} ${entry.role} does not render the declared text weight.`);
                }
              }
              renderedTypeSystems.push({
                label,
                fingerprint: typography
                  .map(({ displayFamily, displayWeight, textFamily, textWeight }) => (
                    [displayFamily, displayWeight, textFamily, textWeight].join("|").toLowerCase()
                  ))
                  .join("||"),
              });
            }
          const renderedContracts = inspection.contracts ?? [];
          for (const role of roles) {
            const renderedContract = renderedContracts.find((entry) => entry.role === role);
            if (!renderedContract) {
              failures.push(`${label} ${role} lacks visible frozen contract fields.`);
              continue;
            }
            for (const field of [
              "question",
              "answer",
              "evidence",
              "decisionRelevance",
              "caveat",
            ]) {
              if (renderedContract[field]?.visible !== true) {
                failures.push(`${label} ${role} ${field} must be visibly rendered.`);
              }
              if (
                normalizeText(renderedContract[field]?.text)
                !== normalizeText(content[role]?.[field])
              ) {
                failures.push(`${label} ${role} visible ${field} differs from frozen content.`);
              }
            }
            for (const field of ["claimStatus", "sourceIds", "modality"]) {
              if (!sameValue(renderedContract[field], content[role]?.[field])) {
                failures.push(`${label} ${role} rendered ${field} differs from frozen content.`);
              }
            }
          }
        }
      }
    }

    if (phase === "review" || phase === "approved") {
      if (!treatmentPath || !await exists(treatmentPath)) continue;
      const currentSourceHash = await computeDeckSourceHash({ sourcePath: treatmentPath });
      if (direction.rendered?.sourceHash !== currentSourceHash) {
        failures.push(`${label}.rendered.sourceHash is stale or does not match the treatment.`);
      }
      const previewFile = direction.rendered?.previewFile;
      requireString(previewFile, `${label}.rendered.previewFile`, failures);
      let preview;
      if (typeof previewFile === "string" && previewFile.trim()) {
        const previewPath = resolve(workspace, previewFile);
        if (!isWithin(workspace, previewPath) || !await exists(previewPath)) {
          failures.push(`${label}.rendered.previewFile must resolve inside the workspace.`);
        } else {
          try {
            preview = JSON.parse(await readFile(previewPath, "utf8"));
          } catch (error) {
            failures.push(`${label} preview record is invalid: ${error.message}`);
          }
        }
      }
      if (
        preview
        && (
          preview.ok !== true
          || preview.sourceHash !== currentSourceHash
          || !preview.source
          || await realpath(preview.source) !== await realpath(treatmentPath)
          || ["scan", "contrast", "browserErrors", "chartAudit", "runtimeIntegrity"]
            .some((field) => !Array.isArray(preview[field]) || preview[field].length > 0)
        )
      ) {
        failures.push(`${label} preview record is not a clean current render.`);
      }
      if (!/^[0-9a-f]{64}$/.test(direction.rendered?.sourceHash ?? "")) {
        failures.push(`${label}.rendered.sourceHash must be a full preview hash.`);
      }
      for (const role of roles) {
        const screenshot = direction.rendered?.screenshots?.[role];
        requireString(screenshot, `${label}.rendered.screenshots.${role}`, failures);
        if (typeof screenshot === "string" && screenshot.trim()) {
          const screenshotPath = resolve(workspace, screenshot);
          if (!isWithin(workspace, screenshotPath) || !await exists(screenshotPath)) {
            failures.push(`${label} ${role} screenshot must resolve inside the workspace.`);
          } else if (!await isPng(screenshotPath)) {
            failures.push(`${label} ${role} screenshot must be a PNG.`);
          } else {
            const actualHash = await sha256(screenshotPath);
            screenshotHashes.push(actualHash);
            if (direction.rendered?.screenshotSha256?.[role] !== actualHash) {
              failures.push(`${label} ${role} screenshot hash does not match the rendered record.`);
            }
            if (direction.rendered?.inspection?.screenshotSha256?.[role] !== actualHash) {
              failures.push(`${label} ${role} screenshot hash does not match the inspection record.`);
            }
          }
        }
      }
      const declaredScreenshots = await Promise.all(roles.map(async (role) => {
        const path = resolve(workspace, direction.rendered?.screenshots?.[role] ?? "");
        return await exists(path) ? realpath(path) : path;
      }));
      const previewScreenshots = await Promise.all((preview?.screenshots ?? []).map(async (path) => (
        await exists(path) ? realpath(path) : resolve(path)
      )));
      if (
        preview
        && (
          previewScreenshots.length !== roles.length
          || previewScreenshots.some((path, index) => path !== declaredScreenshots[index])
          || !Array.isArray(preview.screenshotHashes)
          || preview.screenshotHashes.length !== roles.length
          || preview.screenshotHashes.some(
            (hash, index) => hash !== direction.rendered?.screenshotSha256?.[roles[index]],
          )
        )
      ) {
        failures.push(`${label} screenshots do not match its preview record in role order.`);
      }
      if (
        direction.rendered?.inspection?.sourceHash !== currentSourceHash
        || !roles.every((role) => direction.rendered?.inspection?.inspectedRoles?.includes(role))
      ) {
        failures.push(`${label} requires visual inspection of all ${roles.length} current screenshots.`);
      }
    }
  }
  } finally {
    await browser?.close();
  }

  for (let left = 0; left < typeDimensions.length; left += 1) {
    for (let right = left + 1; right < typeDimensions.length; right += 1) {
      const differences = typeDimensions[left].values.reduce(
        (count, value, index) => count + Number(value !== typeDimensions[right].values[index]),
        0,
      );
      if (differences < 4) {
        failures.push(`${typeDimensions[left].label} and ${typeDimensions[right].label} type systems differ in fewer than 4 dimensions.`);
      }
    }
  }
  for (const duplicate of duplicateValues(renderedTypeSystems.map(({ fingerprint }) => fingerprint))) {
    const labels = renderedTypeSystems
      .filter(({ fingerprint }) => fingerprint === duplicate)
      .map(({ label }) => label)
      .join(" and ");
    failures.push(`${labels} render the same family and weight system.`);
  }
  for (const duplicate of duplicateValues(screenshotHashes)) {
    failures.push(`Rendered screenshot content is reused: ${duplicate}.`);
  }

  if (phase === "approved") {
    const feedback = matrix.feedback ?? {};
    if (!approvalStatuses.has(feedback.status)) {
      failures.push("Feedback status must be approved or combine before propagation.");
    }
    const selectedIds = Array.isArray(feedback.selectedDirectionIds)
      ? feedback.selectedDirectionIds
      : [];
    const uniqueSelectedIds = [...new Set(selectedIds)];
    if (selectedIds.length === 0) failures.push("Feedback must select at least one direction.");
    if (uniqueSelectedIds.length !== selectedIds.length) {
      failures.push("Feedback selectedDirectionIds must not contain duplicates.");
    }
    if (feedback.status === "approved" && selectedIds.length !== 1) {
      failures.push("Approved feedback selects exactly one direction; use combine for multiple directions.");
    }
    if (feedback.status === "combine" && uniqueSelectedIds.length < 2) {
      failures.push("Combined feedback must select at least two distinct directions.");
    }
    for (const id of selectedIds) {
      if (!directions.some((direction) => direction.id === id)) {
        failures.push(`Feedback selects unknown direction ${id}.`);
      }
    }
    if (
      !Array.isArray(feedback.approvedRoles)
      || roles.some((role) => !feedback.approvedRoles.includes(role))
    ) {
      failures.push("Feedback must approve figure-heavy, text-heavy, and data-heavy proofs.");
    }
    const reactions = Array.isArray(feedback.reactions) ? feedback.reactions : [];
    for (const direction of directions) {
      const reaction = reactions.find(({ directionId }) => directionId === direction.id);
      requireString(reaction?.reaction, `Feedback reaction for ${direction.id}`, failures);
    }
  }

  return failures;
}

export function formatDirectionFailures(failures) {
  return failures.length
    ? failures.map((failure) => `- ${failure}`).join("\n")
    : "direction matrix valid";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const workspaceRoot = process.argv[2];
  const phase = process.argv.includes("--approved")
    ? "approved"
    : process.argv.includes("--review")
      ? "review"
      : "draft";
  if (!workspaceRoot) {
    console.error("usage: node validate-directions.mjs <workspace> [--review|--approved]");
    process.exit(2);
  }
  try {
    const failures = await validateDirectionMatrix({ workspaceRoot, phase });
    (failures.length ? console.error : console.log)(formatDirectionFailures(failures));
    process.exitCode = failures.length ? 1 : 0;
  } catch (error) {
    console.error(`cannot validate direction matrix: ${error.message}`);
    process.exitCode = 2;
  }
}
