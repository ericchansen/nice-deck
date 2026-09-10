import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeckDesignExtension } from "./definition.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function fixture() {
  const calls = [];
  const closed = [];
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
          const number = calls.length;
          return {
            ok: true, mode: args.mode, slideIds: args.slideIds ?? ["first", "second"],
            slideNumbers: args.slideIds ? [2] : [1, 2], totalSlides: 2,
            sourceHash: "a".repeat(64), url: `http://127.0.0.1:${4000 + number}/deck.html?v=a`,
            screenshots: ["slide-02.png"], previewFile: "feedback-preview.json",
            scan: [], contrast: [], contrastUnverified: [], browserErrors: [],
            server: { close: async () => closed.push(number) },
          };
        },
      };
    },
  });
  return { extension, calls, closed, fail: error => { failure = error; }, loads: () => loads };
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

test("one explicit preview forwards only the requested scope and keeps its server", async () => {
  const { extension, calls, closed } = fixture();
  const workingDirectory = join(repoRoot, "example-workspace");
  await extension.hooks.onSessionStart({ workingDirectory });
  const result = await extension.tools[0].handler({ htmlPath: "deck.html", slideIds: ["second"] });
  assert.equal(result.resultType, "success");
  assert.deepEqual(calls, [{
    sourcePath: join(workingDirectory, "deck.html"), outDir: undefined,
    mode: "feedback", slideIds: ["second"], keepServer: true,
  }]);
  const output = JSON.parse(result.textResultForLlm);
  assert.equal(output.mode, "feedback");
  assert.deepEqual(output.slideIds, ["second"]);
  assert.deepEqual(output.slideNumbers, [2]);
  assert.equal(output.totalSlides, 2);
  assert.match(output.next.join(" "), /not a full audit/);
  assert.deepEqual(closed, []);
  await extension.hooks.onSessionEnd();
  assert.deepEqual(closed, [1]);
});

test("audit is explicit; a new preview closes only the previous server", async () => {
  const { extension, calls, closed, loads } = fixture();
  await extension.tools[0].handler({ htmlPath: "deck.html" });
  await extension.tools[0].handler({ htmlPath: "deck.html", mode: "audit", outDir: "audit" });
  assert.equal(calls[1].mode, "audit");
  assert.equal(calls[1].outDir, join(repoRoot, "audit"));
  assert.equal(loads(), 1);
  assert.deepEqual(closed, [1]);
  await extension.hooks.onSessionEnd();
  assert.deepEqual(closed, [1, 2]);
});

test("failed previews surface their cause, keep the prior server, and allow retry", async () => {
  const state = fixture();
  await state.extension.tools[0].handler({ htmlPath: "deck.html" });
  state.fail(new Error("Unknown slide ID: missing"));
  const failed = await state.extension.tools[0].handler({ htmlPath: "deck.html", slideIds: ["missing"] });
  assert.equal(failed.resultType, "failure");
  assert.match(failed.textResultForLlm, /Unknown slide ID: missing/);
  assert.deepEqual(state.closed, []);
  state.fail(undefined);
  const retry = await state.extension.tools[0].handler({ htmlPath: "deck.html", slideIds: ["second"] });
  assert.equal(retry.resultType, "success");
  assert.deepEqual(state.closed, [1]);
  await state.extension.hooks.onSessionEnd();
  assert.deepEqual(state.closed, [1, 3]);
});
