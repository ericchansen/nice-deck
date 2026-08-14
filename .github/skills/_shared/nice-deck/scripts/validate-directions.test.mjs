import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { previewDeck } from "./preview.mjs";
import { syncRuntime } from "./sync-runtime.mjs";
import { validateDirectionMatrix } from "./validate-directions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "nice-deck-directions-"));
const directionsRoot = join(workspace, "directions");
const roles = [
  "figure-heavy",
  "text-heavy",
  "data-heavy",
  "data-heavy-normalization",
  "data-heavy-economics",
];
const content = Object.fromEntries(roles.map((role) => [role, {
  id: `${role}-content`,
  slideId: role,
  question: `What does the ${role} proof ask?`,
  answer: "The frozen answer.",
  evidence: "The frozen evidence.",
  decisionRelevance: "The frozen relevance.",
  caveat: "The frozen caveat.",
  claimStatus: "measured",
  sourceIds: ["S1"],
  modality: "native",
}]));
const typographyInspector = async ({ typeSystem, content: frozenContent, fontAssetUrls }) => ({
  contracts: roles.map((role) => ({
    role,
    question: { text: frozenContent[role].question, visible: true },
    answer: { text: frozenContent[role].answer, visible: true },
    evidence: { text: frozenContent[role].evidence, visible: true },
    decisionRelevance: { text: frozenContent[role].decisionRelevance, visible: true },
    caveat: { text: frozenContent[role].caveat, visible: true },
    claimStatus: frozenContent[role].claimStatus,
    sourceIds: frozenContent[role].sourceIds,
    modality: frozenContent[role].modality,
  })),
  fontFaces: [
    { family: typeSystem.displayFamily, status: "loaded", weight: typeSystem.displayWeight },
    { family: typeSystem.textFamily, status: "loaded", weight: typeSystem.textWeight },
  ],
  fontRules: [
    {
      family: typeSystem.displayFamily,
      sources: [fontAssetUrls[0]],
      weight: typeSystem.displayWeight,
    },
    {
      family: typeSystem.textFamily,
      sources: [fontAssetUrls[0]],
      weight: typeSystem.textWeight,
    },
  ],
  typography: roles.map((role) => ({
    role,
    displayFamily: typeSystem.displayFamily,
    displayWeight: typeSystem.displayWeight,
    textFamily: typeSystem.textFamily,
    textWeight: typeSystem.textWeight,
  })),
});

try {
  await mkdir(directionsRoot);
  const directions = [];
  for (let index = 1; index <= 6; index += 1) {
    const id = `direction-${index}`;
    const folder = join(directionsRoot, id);
    await mkdir(folder);
    const assets = join(folder, "assets", "fonts");
    await mkdir(assets, { recursive: true });
    const displayWeight = String(900 - index * 50);
    const textWeight = String(350 + index * 25);
    const treatmentPath = join(folder, "treatment.html");
    await writeFile(
      treatmentPath,
      `<!doctype html>
      <html><head><style>
        .slide { display: grid; width: 1600px; height: 900px; background: rgb(${248 - index * 4}, ${248 - index * 3}, ${248 - index * 2}); }
        .slide[hidden] { display: none; }
        [data-type-role=display] { font-family: "Display ${index}", sans-serif; font-size: ${42 + index * 4}px; font-weight: ${displayWeight}; }
        [data-type-role=text] { font-family: "Text ${index}", serif; font-weight: ${textWeight}; }
      </style></head>
      <body data-type-system-id="type-${index}">
      ${roles.map((role) => (
        `<section class="slide" data-slide-id="${content[role].slideId}"
          data-visual-modality="native" data-probe-role="${role}"
          data-content-id="${content[role].id}"
          data-claim-status="${content[role].claimStatus}" data-source-ids="S1">
          <h1 data-type-role="display" data-contract-field="question">${content[role].question}</h1>
          <p data-type-role="text" data-contract-field="answer">${content[role].answer}</p>
          <p data-contract-field="evidence">${content[role].evidence}</p>
          <p data-contract-field="decisionRelevance">${content[role].decisionRelevance}</p>
          <p data-contract-field="caveat">${content[role].caveat}</p>
        </section>`
      )).join("\n")}
      <script src="deck.js"></script>
      </body></html>`,
    );
    const font = join(assets, `font-${index}.woff2`);
    await writeFile(font, "fixture font");
    await writeFile(join(folder, "brief.md"), "# Fixture direction\n");
    await cp(join(here, "..", "runtime", "deck.js"), join(folder, "deck.js"));
    await syncRuntime({ workspaceRoot: folder });
    await writeFile(join(folder, "sources.json"), `${JSON.stringify({
      version: 1,
      sources: [{
        id: "S1",
        title: "Fixture source",
        publisher: "Test",
        date: "2026-08-14",
        type: "measured-internal-extract",
        locator: "Fixture",
        confidentiality: "test",
      }],
    }, null, 2)}\n`);
    await writeFile(join(folder, "visual-manifest.json"), `${JSON.stringify({
      version: 1,
      slides: roles.map((role) => ({
        id: content[role].slideId,
        question: content[role].question,
        answer: content[role].answer,
        decisionRelevance: content[role].decisionRelevance,
        claimStatus: content[role].claimStatus,
        sourceIds: content[role].sourceIds,
        modality: "native",
        renderer: "html",
        captureState: "Static fixture.",
        accessibility: "Native fixture text.",
      })),
    }, null, 2)}\n`);
    await writeFile(join(folder, "slide-contracts.json"), `${JSON.stringify({
      version: 1,
      slides: roles.map((role) => ({ role, ...content[role] })),
    }, null, 2)}\n`);
    const preview = await previewDeck({ sourcePath: treatmentPath });
    assert.equal(preview.ok, true, JSON.stringify({
      scan: preview.scan,
      contrast: preview.contrast,
      browserErrors: preview.browserErrors,
      chartAudit: preview.chartAudit,
      runtimeIntegrity: preview.runtimeIntegrity,
    }));
    const screenshots = Object.fromEntries(roles.map((role, roleIndex) => (
      [role, relative(workspace, preview.screenshots[roleIndex])]
    )));
    directions.push({
      id,
      name: `Direction ${index}`,
      physicalScene: `A specific viewing scene ${index}.`,
      voice: ["precise", "tactile", "direct"],
      colorStrategy: "Committed semantic color.",
      typeSystem: {
        id: `type-${index}`,
        displayFamily: `Display ${index}`,
        textFamily: `Text ${index}`,
        displayWeight,
        textWeight,
        scale: `Scale ${index}`,
        headingMeasure: `${8 + index} words`,
        bodyMeasure: `${54 + index * 2} characters`,
        casing: index % 2 ? "sentence case" : "mixed case",
        rhythm: `Rhythm ${index}`,
        specimenSource: `https://beautifulwebtype.com/example-${index}`,
        fontAssets: [{
          path: `directions/${id}/assets/fonts/font-${index}.woff2`,
          license: "SIL Open Font License 1.1",
          sourceUrl: `https://example.com/font-${index}`,
        }],
      },
      composition: "A distinct information hierarchy.",
      graphicMedium: "A specific graphic medium.",
      motion: "One authored transition.",
      slopRisk: "Avoids the topic reflex.",
      treatment: `${id}/treatment.html`,
      probes: roles.map((role) => ({ role, contentId: content[role].id })),
      rendered: {
        sourceHash: preview.sourceHash,
        previewFile: relative(workspace, preview.previewFile),
        screenshots,
        screenshotSha256: Object.fromEntries(roles.map((role, roleIndex) => (
          [role, preview.screenshotHashes[roleIndex]]
        ))),
        inspection: {
          sourceHash: preview.sourceHash,
          inspectedRoles: roles,
          screenshotSha256: Object.fromEntries(roles.map((role, roleIndex) => (
            [role, preview.screenshotHashes[roleIndex]]
          ))),
        },
      },
    });
  }
  const matrix = {
    version: 1,
    content,
    directions,
    feedback: {
      status: "approved",
      selectedDirectionIds: ["direction-1"],
      approvedRoles: roles,
      reactions: directions.map(({ id }) => ({
        directionId: id,
        reaction: `Reaction to ${id}.`,
      })),
    },
  };
  await writeFile(
    join(directionsRoot, "visual-direction-matrix.json"),
    `${JSON.stringify(matrix, null, 2)}\n`,
  );

  assert.deepEqual(await validateDirectionMatrix({ workspaceRoot: workspace }), []);
  assert.deepEqual(await validateDirectionMatrix({
    workspaceRoot: workspace,
    phase: "review",
    typographyInspector,
  }), []);
  assert.deepEqual(await validateDirectionMatrix({
    workspaceRoot: workspace,
    phase: "approved",
    typographyInspector,
  }), []);
  const unloadedFontFailures = await validateDirectionMatrix({
    workspaceRoot: workspace,
    phase: "review",
  });
  assert(unloadedFontFailures.some((failure) => failure.includes("not loaded from @font-face")));

  const combineMatrix = structuredClone(matrix);
  combineMatrix.feedback.status = "combine";
  combineMatrix.feedback.selectedDirectionIds = ["direction-1"];
  await writeFile(
    join(directionsRoot, "visual-direction-matrix.json"),
    `${JSON.stringify(combineMatrix, null, 2)}\n`,
  );
  const combineFailures = await validateDirectionMatrix({
    workspaceRoot: workspace,
    phase: "approved",
    typographyInspector,
  });
  assert(combineFailures.some((failure) => failure.includes("at least two distinct directions")));

  matrix.directions[5].probes[0].contentId = "rewritten-content";
  matrix.feedback.reactions = matrix.feedback.reactions.slice(0, 5);
  const changedContractsPath = join(directionsRoot, "direction-1", "slide-contracts.json");
  const changedContracts = JSON.parse(await readFile(changedContractsPath, "utf8"));
  changedContracts.slides[0].answer = "Rewritten answer.";
  await writeFile(changedContractsPath, `${JSON.stringify(changedContracts, null, 2)}\n`);
  await cp(
    join(workspace, matrix.directions[1].rendered.screenshots["figure-heavy"]),
    join(workspace, matrix.directions[0].rendered.screenshots["figure-heavy"]),
  );
  await writeFile(
    join(directionsRoot, "visual-direction-matrix.json"),
    `${JSON.stringify(matrix, null, 2)}\n`,
  );
  const failures = await validateDirectionMatrix({
    workspaceRoot: workspace,
    phase: "approved",
    typographyInspector,
  });
  assert(failures.some((failure) => failure.includes("must reuse content ID")));
  assert(failures.some((failure) => failure.includes("Feedback reaction")));
  assert(failures.some((failure) => failure.includes("differs from frozen content")));
  assert(failures.some((failure) => failure.includes("sourceHash is stale")));
  assert(failures.some((failure) => failure.includes("screenshot hash")));
  assert(failures.some((failure) => failure.includes("screenshot content is reused")));

  console.log("nice-deck direction-matrix self-test passed");
} finally {
  await rm(workspace, { recursive: true, force: true });
}
