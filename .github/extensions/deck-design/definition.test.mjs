import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeckDesignExtension } from "./definition.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function fixture() {
  const calls = [];
  let failure;
  let loads = 0;
  const extension = createDeckDesignExtension({
    repoRoot,
    loadPreview: async () => {
      loads++;
      return {
        previewDeck: async (args) => {
          calls.push(args);
          if (failure) throw failure;
          return {
            ok: true, mode: args.mode, slideIds: args.slideIds ?? ["first", "second"],
            slideNumbers: args.slideIds ? [2] : [1, 2], totalSlides: 2,
            sourceHash: "a".repeat(64), url: "file:///preview/deck.html?v=a",
            screenshots: ["slide-02.png"], previewFile: "feedback-preview.json",
            scan: [], contrast: [], contrastUnverified: [], browserErrors: [],
          };
        },
      };
    },
  });
  return { extension, calls, fail: error => { failure = error; }, loads: () => loads };
}

test("file writes have no automatic render hook or hidden audit", async () => {
  const { extension, calls, loads } = fixture();
  assert.deepEqual(Object.keys(extension.hooks).sort(), ["onSessionEnd", "onSessionStart"]);
  const context = await extension.hooks.onSessionStart({ workingDirectory: repoRoot });
  assert.match(context.additionalContext, /No automatic renders/);
  assert.match(context.additionalContext, /No review subagents/);
  assert(context.additionalContext.length < 6000, "Do not inject the entire reference library into every session.");
  assert.equal(calls.length, 0);
  assert.equal(loads(), 0);
});

test("one explicit preview forwards only the requested scope and leaves no server running", async () => {
  const { extension, calls } = fixture();
  const workingDirectory = join(repoRoot, "example-workspace");
  await extension.hooks.onSessionStart({ workingDirectory });
  const result = await extension.tools[0].handler({ htmlPath: "deck.html", slideIds: ["second"] });
  assert.equal(result.resultType, "success");
  assert.deepEqual(calls, [{
    sourcePath: join(workingDirectory, "deck.html"), outDir: undefined,
    mode: "feedback", slideIds: ["second"], keepServer: false,
  }]);
  const output = JSON.parse(result.textResultForLlm);
  assert.equal(output.mode, "feedback");
  assert.deepEqual(output.slideIds, ["second"]);
  assert.deepEqual(output.slideNumbers, [2]);
  assert.equal(output.totalSlides, 2);
  assert.match(output.url, /^file:/);
  assert.match(output.next.join(" "), /not a full audit/);
  await extension.hooks.onSessionEnd();
});

test("audit is explicit and reuses the loaded preview module", async () => {
  const { extension, calls, loads } = fixture();
  await extension.tools[0].handler({ htmlPath: "deck.html" });
  await extension.tools[0].handler({ htmlPath: "deck.html", mode: "audit", outDir: "audit" });
  assert.equal(calls[1].mode, "audit");
  assert.equal(calls[1].outDir, join(repoRoot, "audit"));
  assert.equal(loads(), 1);
  await extension.hooks.onSessionEnd();
});

test("failed previews surface their cause and allow retry", async () => {
  const state = fixture();
  await state.extension.tools[0].handler({ htmlPath: "deck.html" });
  state.fail(new Error("Unknown slide ID: missing"));
  const failed = await state.extension.tools[0].handler({ htmlPath: "deck.html", slideIds: ["missing"] });
  assert.equal(failed.resultType, "failure");
  assert.match(failed.textResultForLlm, /Unknown slide ID: missing/);
  state.fail(undefined);
  const retry = await state.extension.tools[0].handler({ htmlPath: "deck.html", slideIds: ["second"] });
  assert.equal(retry.resultType, "success");
  await state.extension.hooks.onSessionEnd();
});
