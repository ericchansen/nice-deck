import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { exportPortable } from "./export-portable.mjs";
import { previewDeck, startStaticServer } from "./preview.mjs";
import { scanSource, scanWorkspace } from "./scan.mjs";
import { syncRuntime } from "./sync-runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "nice-deck-test-"));
let liveServer;

const sources = {
  version: 1,
  sources: [
    {
      id: "S1",
      title: "Fixture extract",
      publisher: "Test",
      date: "2026-08-12",
      type: "measured-internal-extract",
      locator: "Fixture values",
      confidentiality: "test",
    },
    {
      id: "S2",
      title: "Fixture documentation",
      publisher: "Test",
      date: "2026-08-12",
      type: "public-url",
      url: "https://example.com/source",
      locator: "Fixture method",
      confidentiality: "public",
    },
  ],
};

const contract = (id, overrides = {}) => ({
  id,
  question: "What does the fixture show?",
  answer: "The fixture has a supported answer.",
  decisionRelevance: "The fixture changes the capacity decision.",
  claimStatus: "measured",
  sourceIds: ["S1"],
  captureState: "Authored default state.",
  accessibility: "Native text remains visible.",
  modality: "native",
  renderer: "html",
  ...overrides,
});

const nativeDocument = (content) => `<!doctype html>
<html><head><link rel="stylesheet" href="deck.css"></head><body>
  <section class="slide" data-slide-id="01" data-visual-modality="native">
    <h1>${content}</h1>
  </section>
  <section class="slide" data-slide-id="02" data-visual-modality="native">
    <h1>Second</h1>
  </section>
  <script src="deck.js"></script>
</body></html>`;

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function configure(manifest) {
  await writeJson(join(workspace, "sources.json"), sources);
  await writeJson(join(workspace, "visual-manifest.json"), {
    version: 1,
    slides: manifest,
  });
}

try {
  await writeFile(join(workspace, "brief.md"), "# Test deck\n");
  await cp(join(here, "..", "runtime", "deck.js"), join(workspace, "deck.js"));
  await syncRuntime({ workspaceRoot: workspace });
  await writeFile(join(workspace, "deck.css"), `
    :root { --bg: #fff; --ink: #111; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); }
    .slide { display: grid; width: 100vw; height: 100vh; place-items: center; }
    .chart { width: 900px; height: 500px; }
    .nice-deck-chart-error { padding: 30px; background: #fff0f0; color: #8a001f; }
  `);
  await configure([contract("01"), contract("02")]);

  const probe = join(workspace, "probe.html");
  await writeFile(probe, nativeDocument("First"));
  const first = await previewDeck({ sourcePath: probe, keepServer: true });
  liveServer = first.server;
  assert.equal(first.ok, true);
  assert.equal(first.workspaceRoot, await realpath(workspace));
  assert.equal(first.screenshots.length, 2);
  assert.match(first.sourceHash, /^[0-9a-f]{64}$/);
  await Promise.all(first.screenshots.map((file) => access(file)));
  assert.equal((await fetch(new URL("/.env", first.url))).status, 403);
  assert.equal((await fetch(new URL("/runtime/echarts.min.js", first.url))).status, 200);
  assert.equal((await fetch(new URL("/runtime/charts.js", first.url))).status, 200);
  assert.equal((await fetch(new URL("/__nice-deck/echarts.min.js", first.url))).status, 410);
  assert.equal((await fetch(new URL("/runtime/arbitrary.js", first.url))).status, 404);
  await liveServer.close();
  liveServer = undefined;

  assert(scanSource("p { background-clip: text; }").some(
    ({ name }) => name === "gradient-text",
  ));
  assert(scanSource("artifact 98f5264e-7cca-47f6-88ed-cfa5cc14a02a").some(
    ({ name }) => name === "private-guid",
  ));

  const badManifest = join(workspace, "bad.html");
  await writeFile(
    badManifest,
    '<section class="slide" data-slide-id="01" data-visual-modality="native"></section>',
  );
  await configure([{ ...contract("01"), sourceIds: ["S99"] }]);
  assert((await scanWorkspace({ root: workspace, sourcePath: badManifest })).some(
    ({ name }) => name === "unresolved-source",
  ));
  await configure([contract("01"), contract("02")]);

  const assets = join(workspace, "assets");
  await mkdir(assets);
  const generatedAsset = join(assets, "concept.png");
  const generatedBytes = Buffer.from("generated fixture");
  await writeFile(generatedAsset, generatedBytes);
  await writeJson(`${generatedAsset}.provenance.json`, {
    prompt: "A text-free conceptual fixture.",
    model: "fixture-model",
    size: "1536x1024",
    quality: "draft",
    outputSha256: createHash("sha256").update(generatedBytes).digest("hex"),
    generatedAt: "2026-08-12T00:00:00Z",
    intendedSlide: "01",
    visualRole: "Conceptual fixture",
  });
  const conceptualPath = join(workspace, "conceptual.html");
  await writeFile(
    conceptualPath,
    '<section class="slide" data-slide-id="01" data-visual-modality="conceptual"></section>',
  );
  await configure([contract("01", {
    modality: "conceptual",
    renderer: "generated-image",
    generatedAsset: "assets/concept.png",
    provenance: "assets/concept.png.provenance.json",
  })]);
  assert.equal((await scanWorkspace({
    root: workspace,
    sourcePath: conceptualPath,
  })).length, 0);
  await writeFile(generatedAsset, "tampered");
  assert((await scanWorkspace({ root: workspace, sourcePath: conceptualPath })).some(
    ({ name }) => name === "generated-provenance-hash",
  ));
  await writeFile(generatedAsset, generatedBytes);

  const chartPath = join(workspace, "chart.html");
  await writeFile(chartPath, `<!doctype html>
  <html><head>
    <link rel="stylesheet" href="deck.css">
  </head><body>
    <section class="slide" data-slide-id="01" data-visual-modality="native">
      <h1>Question first</h1>
    </section>
    <section class="slide" data-slide-id="02" data-visual-modality="data">
      <h1>Deterministic chart</h1>
      <div id="fixture-chart" class="chart" data-chart
        data-chart-units="requests"
        data-visible-takeaway="March reaches 42"
        data-decision-relevance="Peak shape changes capacity"
        data-claim-status="measured"
        data-direct-labels="true"></div>
      <p>Visible takeaway: March reaches 42.</p>
      <footer data-citation>[S1] Fixture extract, 2026-08-12</footer>
    </section>
    <script src="runtime/echarts.min.js"></script>
    <script src="runtime/charts.js"></script>
    <script src="deck.js"></script>
    <script>
      const option = niceDeckCharts.archetypes.comparison({
        categories: ["Jan", "Feb", "Mar"],
        values: [20, 30, 42],
        valueFormatter: (value) => String(value),
      });
      niceDeckCharts.create(document.getElementById("fixture-chart"), option, {
        units: "requests",
        takeaway: "March reaches 42",
        decisionRelevance: "Peak shape changes capacity",
        claimStatus: "measured",
        archetype: "comparison",
      }).catch(() => {});
    </script>
  </body></html>`);
  await configure([
    contract("01"),
    contract("02", {
      modality: "data",
      renderer: "echarts-svg",
      chartSelector: "#fixture-chart",
      sourceSummary: "Fixture values 20, 30, and 42.",
      units: "requests",
      visibleTakeaway: "March reaches 42.",
      chartArchetype: "comparison",
    }),
  ]);

  const chartFirst = await previewDeck({ sourcePath: chartPath });
  const chartSecond = await previewDeck({ sourcePath: chartPath });
  assert.equal(chartFirst.ok, true);
  assert.equal(chartSecond.ok, true);
  assert.equal(
    createHash("sha256").update(await readFile(chartFirst.screenshots[1])).digest("hex"),
    createHash("sha256").update(await readFile(chartSecond.screenshots[1])).digest("hex"),
  );

  const directBrowser = await chromium.launch();
  const directPage = await directBrowser.newPage({ viewport: { width: 1600, height: 900 } });
  await directPage.goto(pathToFileURL(chartPath).href, { waitUntil: "networkidle" });
  await directPage.keyboard.press("ArrowRight");
  await directPage.waitForFunction(() => (
    document.querySelector("[data-chart]")?.dataset.chartReady === "true"
  ));
  const directState = await directPage.evaluate(() => {
    const chart = document.querySelector("[data-chart]");
    const svg = chart?.querySelector("svg");
    const rect = svg?.getBoundingClientRect();
    return {
      height: rect?.height ?? 0,
      labels: document.body.innerText.includes("March"),
      marks: svg?.querySelectorAll("path,rect,circle").length ?? 0,
      width: rect?.width ?? 0,
    };
  });
  assert(directState.width > 0 && directState.height > 0 && directState.marks > 0);
  assert.equal(directState.labels, true);
  await directBrowser.close();

  const interactive = await previewDeck({ sourcePath: chartPath, captureMode: false });
  assert.equal(interactive.ok, true);
  assert.deepEqual(interactive.chartAudit, []);

  const portableRoot = join(workspace, "portable");
  const portable = await exportPortable({ sourcePath: chartPath, outputDir: portableRoot });
  assert.doesNotMatch(await readFile(portable.html, "utf8"), /\/__nice-deck\//);
  const staticServer = await startStaticServer(portable.root);
  liveServer = staticServer;
  let browser = await chromium.launch();
  let page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(staticServer.urlFor(portable.html), { waitUntil: "networkidle" });
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => (
    document.querySelector("[data-chart]")?.dataset.chartReady === "true"
  ));
  const portableState = await page.evaluate(() => {
    const svg = document.querySelector("[data-chart] svg");
    const rect = svg?.getBoundingClientRect();
    return {
      height: rect?.height ?? 0,
      marks: svg?.querySelectorAll("path,rect,circle").length ?? 0,
      width: rect?.width ?? 0,
    };
  });
  assert(portableState.width > 0 && portableState.height > 0 && portableState.marks > 0);
  await browser.close();
  await staticServer.close();
  liveServer = undefined;

  await rm(join(portable.root, "runtime", "echarts.min.js"));
  const failureServer = await startStaticServer(portable.root);
  liveServer = failureServer;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(failureServer.urlFor(portable.html), { waitUntil: "networkidle" });
  await page.keyboard.press("ArrowRight");
  await page.waitForSelector(".nice-deck-chart-error");
  assert.match(await page.locator(".nice-deck-chart-error").innerText(), /Chart unavailable/);
  await browser.close();
  await failureServer.close();
  liveServer = undefined;

  const missingCitation = (await readFile(chartPath, "utf8"))
    .replace('<footer data-citation>[S1] Fixture extract, 2026-08-12</footer>', "");
  await writeFile(chartPath, missingCitation);
  assert((await scanWorkspace({ root: workspace, sourcePath: chartPath })).some(
    ({ name }) => name === "visible-citation-missing",
  ));

  console.log("nice-deck preview self-test passed");
} finally {
  await liveServer?.close();
  await rm(workspace, { recursive: true, force: true });
}
