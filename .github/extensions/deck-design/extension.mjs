import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const toolkitRoot = join(repoRoot, ".github", "skills", "_shared", "nice-deck");
const previewModuleUrl = pathToFileURL(join(toolkitRoot, "scripts", "preview.mjs")).href;
const product = readFileSync(join(repoRoot, "PRODUCT.md"), "utf8");
const foundation = readFileSync(join(toolkitRoot, "references", "foundation.md"), "utf8");
const principles = readFileSync(join(toolkitRoot, "references", "principles.md"), "utf8");
const profile = readFileSync(join(toolkitRoot, "references", "profile.hansen.md"), "utf8");
const supporting = readFileSync(join(toolkitRoot, "references", "supporting.md"), "utf8");
const layout = readFileSync(join(toolkitRoot, "references", "layout.md"), "utf8");

let workspaceRoot = repoRoot;
let activeSource;
let activeRoot;
let activeServer;
let previewModule;
let renderQueue = Promise.resolve();

const prototypeExtensions = new Set([
  ".css",
  ".gif",
  ".html",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);
const mutationTools = new Set(["apply_patch", "create", "edit"]);

function resolvePath(path) {
  return resolve(workspaceRoot, path);
}

function isWithin(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function changedPaths(toolName, toolArgs) {
  const name = toolName?.split(".").at(-1);
  if (!mutationTools.has(name)) return [];
  if (name === "apply_patch" && typeof toolArgs === "string") {
    return [...toolArgs.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)]
      .map((match) => match[1].trim());
  }
  if (!toolArgs || typeof toolArgs !== "object") return [];
  return [toolArgs.path, toolArgs.file, toolArgs.filePath].filter(
    (path) => typeof path === "string",
  );
}

async function getPreviewModule() {
  previewModule ??= await import(previewModuleUrl);
  return previewModule;
}

async function renderNow(htmlPath, outDir) {
  const { previewDeck } = await getPreviewModule();
  const sourcePath = resolvePath(htmlPath);
  const result = await previewDeck({
    sourcePath,
    outDir: outDir ? resolvePath(outDir) : undefined,
    keepServer: true,
  });

  const previousServer = activeServer;
  if (previousServer) {
    try {
      await previousServer.close();
    } catch (error) {
      if (error.code !== "ERR_SERVER_NOT_RUNNING") {
        await result.server.close();
        throw error;
      }
    }
  }

  activeServer = result.server;
  activeSource = sourcePath;
  activeRoot = result.workspaceRoot;
  return result;
}

function render(htmlPath, outDir) {
  const operation = renderQueue.then(() => renderNow(htmlPath, outDir));
  renderQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function resultText(result) {
  return JSON.stringify({
    ok: result.ok,
    sourceHash: result.sourceHash,
    url: result.url,
    screenshots: result.screenshots,
    previewFile: result.previewFile,
    issueCounts: {
      designScan: result.scan.length,
      contrast: result.contrast.length,
      contrastNeedsVisualReview: result.contrastUnverified.length,
      browser: result.browserErrors.length,
      chartLifecycle: result.chartAudit?.length ?? 0,
      layout: result.layoutIssues?.length ?? 0,
    },
    issueCodes: {
      designScan: [...new Set(result.scan.map(({ name }) => name))],
      browser: [...new Set(result.browserErrors.map((error) => error.split(":")[0]))],
      chartLifecycle: [...new Set((result.chartAudit ?? []).map(({ message }) => message))],
      layout: (result.layoutIssues ?? []).map(
        ({ slide, name, message }) => `slide ${slide}: ${name ? `[${name}] ` : ""}${message}`,
      ),
    },
    next: [
      "View every screenshot path with an image-capable tool.",
      "Read previewFile for local diagnostics if an issue count is nonzero.",
      "Fix any visual issue before presenting.",
      "Open or refresh the Browser Canvas to the exact returned URL.",
    ],
  }, null, 2);
}

const session = await joinSession({
  tools: [
    {
      name: "nice_deck_preview",
      description: "Render and scan a nice-deck HTML prototype. Returns fresh screenshot paths, a source hash, and the exact cache-busted URL that must be opened in Browser Canvas. Call after every slide change and view the returned PNGs before presenting.",
      parameters: {
        type: "object",
        properties: {
          htmlPath: {
            type: "string",
            description: "Absolute path, or path relative to the current repo, of the deck HTML file.",
          },
          outDir: {
            type: "string",
            description: "Optional render output directory. Defaults to _renders beside the deck.",
          },
        },
        required: ["htmlPath"],
      },
      handler: async ({ htmlPath, outDir }) => {
        try {
          const result = await render(htmlPath, outDir);
          return {
            textResultForLlm: resultText(result),
            resultType: result.ok ? "success" : "failure",
          };
        } catch (error) {
          return {
            textResultForLlm:
              "nice-deck preview failed. Inspect the local extension log and rerun the preview after fixing the deck.",
            resultType: "failure",
          };
        }
      },
    },
  ],

  hooks: {
    onSessionStart: async (input) => {
      workspaceRoot = input.workingDirectory || repoRoot;
      return {
        additionalContext: [
          "nice-deck repo-local prototyping is active.",
          "For any deck task, follow the product and workflow below.",
          "After editing a slide, use nice_deck_preview, view its exact screenshots, and refresh Browser Canvas to its exact URL before replying.",
          "Agree the content before the look. Produce plain outline frames first and iterate with the user; outline.json must record an approved status before direction work or production begins.",
          "Do not autonomously implement a slide until its primary visual modality is declared in brief.md and visual-manifest.json. Data uses the sanctioned ECharts SVG runtime. Generate no imagery until the outline and the direction are both approved, and only for a slide that no measurement or exact text can carry.",
          "The visible slide carries its title, its evidence with direct labels and units, and a linked citation. Question, answer, claim status, source IDs, and transition are authoring fields. Never print a decision-relevance line, a caveat line, or a why-this-matters strip; those are spoken.",
          "Print no conjecture. Do not state what another observation would show, what a number implies about cause or intent, or what the audience should conclude. Do not convert timing or absence into causal event language. Keep visible prose under 40 words per slide.",
          "Every visible citation is a link: public sources to their canonical HTTPS URL, internal and derived sources to the in-deck supporting slide anchor. Plain-text source names and [S1] markers on a slide are failures.",
          "Supporting material is a plain black-and-white section at the end of the same deck: data, extracts, and methods only, with no art direction, imagery, motion, or narrative.",
          "One slide, one grid. Every visible region is a real data-region element and a child of that grid, dividers sit on grid lines, stacked bands share column tracks, and content regions are never positioned absolutely. A slide is a fixed box with hidden overflow, so preview measures rendered geometry: escaped elements, overlapping text, and boundaries that are close but unequal all block presentation.",
          "Art-direction approval requires paired narrative and data proofs. Render three typography-and-data directions by default, expand only when the user asks, and stop propagation until every proof role is approved or explicitly combined.",
          "Data treatments require direct labels, visible units, a takeaway, and a linked citation. Unexplained legends, dashed reference lines, and silent empty chart regions block presentation.",
          product,
          foundation,
          principles,
          layout,
          supporting,
          profile,
        ].join("\n\n"),
      };
    },

    onPostToolUse: async (input) => {
      workspaceRoot = input.workingDirectory || workspaceRoot;
      const paths = changedPaths(input.toolName, input.toolArgs)
        .map(resolvePath)
        .filter((path) => prototypeExtensions.has(extname(path).toLowerCase()));
      if (!paths.length) return undefined;

      if (!activeSource) {
        return {
          additionalContext:
            "A slide asset changed. Confirm the slide has a declared, compatible primary visual modality, then call nice_deck_preview on the prototype HTML, view every returned screenshot, and open its exact URL in Browser Canvas before presenting.",
        };
      }

      if (!paths.some((path) => isWithin(activeRoot, path))) return undefined;

      try {
        const result = await render(activeSource);
        return {
          additionalContext: [
            "The active deck changed and was automatically re-rendered.",
            resultText(result),
            "Do not present until you have viewed the exact screenshots and refreshed Browser Canvas.",
          ].join("\n\n"),
        };
      } catch (error) {
        return {
          additionalContext:
            "The active deck changed, but automatic preview failed. Inspect the local preview record or extension log, fix the deck, and call nice_deck_preview before presenting.",
        };
      }
    },

    onPostToolUseFailure: async (input) => (
      input.toolName === "nice_deck_preview"
        ? {
            additionalContext:
              "Preview failure blocks presentation. Fix the reported issue and run nice_deck_preview again.",
          }
        : undefined
    ),

    onSessionEnd: async () => {
      await activeServer?.close();
      activeServer = undefined;
    },
  },
});

session.on("tool.execution_complete", (event) => {
  if (event.data.toolName === "nice_deck_preview" && event.data.success) {
    session.log("nice-deck preview is current", { ephemeral: true });
  }
});
