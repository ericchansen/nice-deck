import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function resultText(result) {
  return JSON.stringify({
    ok: result.ok,
    mode: result.mode,
    slideIds: result.slideIds,
    slideNumbers: result.slideNumbers,
    totalSlides: result.totalSlides,
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
    next: [
      "Inspect the returned screenshots yourself and show the changed content at the exact returned URL.",
      result.mode === "audit"
        ? "Read previewFile for audit findings. Independent review is optional."
        : "Feedback capture only, not a full audit. Do not run review agents or unrelated validations.",
    ],
  }, null, 2);
}

export function createDeckDesignExtension({ repoRoot, loadPreview } = {}) {
  const toolkitRoot = join(repoRoot, ".github", "skills", "_shared", "nice-deck");
  const previewModuleUrl = pathToFileURL(join(toolkitRoot, "scripts", "preview.mjs")).href;
  const feedback = readFileSync(join(toolkitRoot, "references", "feedback.md"), "utf8");
  let workspaceRoot = repoRoot;
  let activeServer;
  let previewModule;
  let renderQueue = Promise.resolve();

  async function renderNow({ htmlPath, outDir, mode = "feedback", slideIds }) {
    previewModule ??= await (loadPreview ? loadPreview() : import(previewModuleUrl));
    const result = await previewModule.previewDeck({
      sourcePath: resolve(workspaceRoot, htmlPath),
      outDir: outDir ? resolve(workspaceRoot, outDir) : undefined,
      mode,
      slideIds,
      keepServer: true,
    });
    if (activeServer) {
      try {
        await activeServer.close();
      } catch (error) {
        if (error.code !== "ERR_SERVER_NOT_RUNNING") {
          await result.server.close();
          throw error;
        }
      }
    }
    activeServer = result.server;
    return result;
  }

  function render(args) {
    const operation = renderQueue.then(() => renderNow(args));
    // A failed request must not poison later explicit preview requests.
    renderQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    tools: [{
      name: "nice_deck_preview",
      description: "Preview a completed edit batch. Default feedback mode captures only slideIds when supplied, without full-deck audits. Inspect those screenshots and open the returned URL. Use mode audit only for a requested full audit.",
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
          mode: {
            type: "string",
            enum: ["feedback", "audit"],
            default: "feedback",
            description: "Feedback renders once without exhaustive checks. Audit explicitly checks the whole deck.",
          },
          slideIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
            uniqueItems: true,
            description: "Changed slide IDs to capture in feedback mode. Omit to capture all. Cannot be combined with audit.",
          },
        },
        required: ["htmlPath"],
      },
      handler: async (args) => {
        try {
          const result = await render(args);
          return {
            textResultForLlm: resultText(result),
            resultType: result.ok ? "success" : "failure",
          };
        } catch (error) {
          return {
            textResultForLlm: `nice-deck preview failed: ${error.message}`,
            resultType: "failure",
          };
        }
      },
    }],
    hooks: {
      onSessionStart: async (input) => {
        workspaceRoot = input.workingDirectory || repoRoot;
        return {
          additionalContext: [
            "nice-deck is active. Use the matching deck skill for new decks or explicit audits.",
            "For existing-deck feedback, follow the fast path below instead of full-deck checklists.",
            feedback,
          ].join("\n\n"),
        };
      },
      onSessionEnd: async () => {
        await renderQueue;
        await activeServer?.close();
      },
    },
  };
}
