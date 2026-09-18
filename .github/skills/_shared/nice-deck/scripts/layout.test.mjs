import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import {
  measureLayout,
  measureRegions,
  measureViewport,
  previewLayoutFindings,
  previewViewportFindings,
  standaloneLayoutReport,
  standaloneViewportFindings,
  viewportMatrix,
} from "../lib/checks/layout.mjs";
import { previewDeck, startStaticServer } from "./preview.mjs";
import { launchTestBrowser } from "./test-support/browser.mjs";
import { proseBudget } from "./text-rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
let browser;
before(async () => { browser = await launchTestBrowser(); });
after(async () => { await browser?.close(); });

// The standalone command deliberately retains its weaker resize waits. Its
// whenSettled call can precede ResizeObserver delivery, even on the old code.
// Give CLI fixtures a deterministic runtime readiness contract so these tests
// isolate extraction/formatting/stress behavior, not that pre-existing race.
// Real, unmodified runtime resize behavior is covered separately below.
const settledResizeFixture = `<script>
  const runtimeSettle = window.__niceDeck.whenSettled;
  window.__niceDeck.whenSettled = async () => {
    while (window.__niceDeck.geometry().viewportWidth !== innerWidth
      || window.__niceDeck.geometry().viewportHeight !== innerHeight) {
      await new Promise(requestAnimationFrame);
    }
    await runtimeSettle();
  };
</script>`;

async function pageFixture(t, body, css = "") {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.setContent(`<!doctype html><style>
    * { box-sizing: border-box; }
    body { margin: 0; }
    .slide { position: relative; width: 1600px; height: 900px; padding: 40px; }
    ${css}
  </style><section class="slide" data-slide-id="fixture">${body}</section>`);
  return page;
}

async function workspaceFixture(t, body, { width = 1600, height = 900, css = "", script = "" } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nice-deck-layout-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(here, "../runtime/deck.js"), join(root, "deck.js"));
  const sourcePath = join(root, "deck.html");
  await writeFile(sourcePath, `<!doctype html>
    <html data-deck-width="${width}" data-deck-height="${height}">
    <head><style>
      * { box-sizing: border-box; }
      body { margin: 0; color: #000; background: #fff; font: 24px Arial; }
      .slide { position: relative; padding: 40px; }
      ${css}
    </style></head><body>
    <section class="slide" data-slide-id="fixture" data-visual-modality="native">${body}</section>
    <script src="deck.js"></script>${script}</body></html>`);
  const server = await startStaticServer(root);
  t.after(() => server.close());
  return { root, sourcePath, url: server.urlFor(sourcePath) };
}

async function runLayout(url, stress = 1) {
  // Exercise the real command in a child process (including its exit status and
  // waits) without changing production Chromium defaults. Launch via the common
  // test seam before patching Chromium, avoiding recursion inside the seam.
  const script = `
    import { chromium } from "playwright";
    import { launchTestBrowser } from ${JSON.stringify(pathToFileURL(join(here, "test-support/browser.mjs")).href)};
    const browser = await launchTestBrowser();
    chromium.launch = async () => browser;
    process.argv = [process.execPath, ${JSON.stringify(join(here, "layout-test.mjs"))},
      ${JSON.stringify(url)}, ${JSON.stringify(String(stress))}];
    await import(${JSON.stringify(pathToFileURL(join(here, "layout-test.mjs")).href)});
  `;
  try {
    const result = await exec(process.execPath, ["--input-type=module", "-e", script], {
      cwd: join(here, ".."), timeout: 60000,
    });
    return { ...result, code: 0 };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("shared overflow probe preserves preview's combined cap and standalone formatting", async (t) => {
  const page = await pageFixture(t,
    Array.from({ length: 14 }, (_, i) => `<div class="escape-${i}" style="position:absolute;left:1550px;top:${50 + i * 30}px;width:30px;height:10px"></div>`).join("")
    + '<small class="first">first</small><em class="second">second</em>',
    "small, em { position: absolute; left: 100px; top: 600px; width: 100px; height: 30px; }");
  const standalone = await standaloneLayoutReport(page);
  const preview = await previewLayoutFindings(page, 2);
  assert.equal(standalone.overflow.length, 14);
  assert.equal(standalone.overlaps.length, 1);
  assert.equal(standalone.overflow[0], "right 20px :: div.escape-0");
  assert.equal(standalone.overlaps[0], '100x30px :: small.first "first" over em.second "second"');
  assert.equal(preview.length, 12);
  assert.deepEqual(preview[0], { slide: 3, message: "overflows the slide right by 20px: div.escape-0" });
  assert(!preview.some(({ message }) => message.startsWith("text overlaps")));
  await page.locator('[class^="escape-"]').evaluateAll((elements) => elements.forEach((element) => element.remove()));
  assert.deepEqual(await previewLayoutFindings(page, 2), [{
    slide: 3, message: 'text overlaps by 100x30px: small.first "first" over em.second "second"',
  }]);
});

test("overflow deduplication, edge ordering, no-slide and numeric padding policies remain distinct", async (t) => {
  const page = await pageFixture(t, '<div class="all"></div><div class="all"></div>',
    ".all { position: absolute; left: 0; top: 0; width: 1600px; height: 900px; }");
  assert.deepEqual((await standaloneLayoutReport(page)).overflow, [
    "right 40px, left 40px, bottom 40px, top 40px :: div.all",
  ]);
  assert.deepEqual(await previewLayoutFindings(page, 0), [{
    slide: 1, message: "overflows the slide right by 40px and left by 40px and bottom by 40px and top by 40px: div.all",
  }]);
  // Real computed padding is numeric; characterize the legacy fallback with an
  // explicit browser stub rather than silently erasing the caller difference.
  await page.evaluate(() => {
    const original = window.getComputedStyle;
    window.getComputedStyle = (element) => element.matches(".slide")
      ? { paddingLeft: "invalid", paddingRight: "invalid", paddingTop: "invalid", paddingBottom: "invalid" }
      : original(element);
    document.querySelector(".all").style.width = "1700px";
  });
  assert.equal((await measureWith(page, false)).overflow.length, 0);
  assert.equal((await measureWith(page, true)).overflow.length, 1);
  await page.locator(".slide").evaluate((slide) => slide.remove());
  assert.deepEqual(await previewLayoutFindings(page, 0), []);
  assert.deepEqual(await standaloneLayoutReport(page), {
    id: "", overflow: ["no .slide element found"], overlaps: [],
  });
});

function measureWith(page, paddingFallback) {
  return page.evaluate(measureLayout, { paddingFallback });
}

test("wrapping inline siblings and ancestor text do not create false overlaps", async (t) => {
  const page = await pageFixture(t,
    '<p>Parent <em>emphasized words that wrap across several lines </em><small>followed by smaller words across lines</small></p>',
    "p { width: 190px; font: 24px/40px monospace; } small { font-size: inherit; }");
  assert((await page.locator("em").evaluate((element) => element.getClientRects().length)) > 1);
  assert.deepEqual((await standaloneLayoutReport(page)).overlaps, []);
  assert.deepEqual(await previewLayoutFindings(page, 0), []);
});

test("chart, SVG and preformatted internals are exempt; bleed only exempts overflow", async (t) => {
  const page = await pageFixture(t, `
    <div data-chart><small>chart text</small></div>
    <div data-echart><em>echart text</em></div>
    <svg><text>svg text</text></svg><pre><span>pre text</span></pre><code>code text</code>
    <div data-bleed><small class="bleed">bleed text</small></div>
    <figcaption class="caption">caption text</figcaption>`,
  `[data-chart], [data-echart], svg, pre, code, [data-bleed] {
    position: absolute; left: 0; top: 0; width: 1700px; height: 1000px;
  }
  .bleed, .caption { position: absolute; left: 50px; top: 50px; width: 100px; height: 30px; margin: 0; }`);
  const report = await standaloneLayoutReport(page);
  assert.deepEqual(report.overflow, []);
  assert.deepEqual(report.overlaps, ['100x30px :: small.bleed "bleed text" over figcaption.caption "caption text"']);
});

test("overflow and overlap tolerances scale with the canvas, excluding tiny boxes", async (t) => {
  const page = await pageFixture(t, `
    <div class="at-edge"></div><div class="past-edge"></div><div class="tiny"></div>
    <small class="first">one</small><small class="second">two</small>`,
  `.slide { transform: scale(.5); transform-origin: top left; }
   .at-edge, .past-edge, .tiny { position: absolute; top: 100px; width: 10px; height: 10px; }
   .at-edge { left: 1551px; } .past-edge { left: 1552px; }
   .tiny { left: 1800px; width: 3px; }
   small { position: absolute; top: 200px; width: 100px; height: 30px; }
   .first { left: 100px; } .second { left: 198px; }`);
  await page.evaluate(() => { window.__niceDeck = { geometry: () => ({ scale: .5 }) }; });
  assert.deepEqual((await standaloneLayoutReport(page)).overflow, ["right 1px :: div.past-edge"]);
  assert.deepEqual((await standaloneLayoutReport(page)).overlaps, []);
  await page.locator(".second").evaluate((element) => { element.style.left = "197px"; });
  assert.equal((await standaloneLayoutReport(page)).overlaps.length, 1);
});

test("region/citation policies preserve messages, exceptions, supporting and outline handling", async (t) => {
  const page = await pageFixture(t, `
    <div data-region="first"></div><div data-region="second"></div>
    <div data-region="ignored" data-grid-exception></div>
    <div class="absolute">Absolute authored content</div>
    <div data-bleed class="exempt">Bleed authored content</div>
    <div data-chart class="exempt">Chart authored content</div>
    <div class="sr-only">Accessible helper content</div>
    <footer data-citation>Not linked</footer>
    <footer data-citation><a href="#2">Index</a><a href="#missing">Missing</a><a href="http://example.com">Insecure</a>
    <a href="#support">Supporting</a><a href="HTTPS://example.com">Valid</a></footer>
    <p>${"prose ".repeat(proseBudget + 1)}</p>
    <h1>${"title ".repeat(100)}</h1><div id="support"></div>`,
  `[data-region] { width: 100px; height: 20px; }
   [data-region="second"] { margin-left: 5px; }
   [data-region="ignored"] { margin-left: 7px; }
   .absolute, .exempt { position: absolute; top: 400px; width: 300px; height: 30px; }
   .sr-only { position: absolute; width: 1px; height: 1px; }`);
  const findings = await page.evaluate(measureRegions, { index: 4, budget: proseBudget });
  assert.deepEqual(findings.filter(({ name }) => name === "region-misaligned").map(({ message }) => message), [
    "first and second left edges differ by 5px; share one grid or declare data-grid-exception",
    "first and second right edges differ by 5px; share one grid or declare data-grid-exception",
  ]);
  assert.deepEqual(findings.filter(({ name }) => name === "absolute-region"), [{
    slide: 5, name: "absolute-region",
    message: "absolute is positioned absolute; content regions belong to the slide grid",
  }]);
  assert.deepEqual(findings.filter(({ name }) => name.startsWith("citation-")).map(({ message }) => message), [
    "citation prints a source without a link",
    "citation links to slide index #2; use the supporting slide's stable id",
    "citation links to #missing, which is not a slide in this deck",
    "citation link http://example.com is neither an in-deck anchor nor HTTPS",
  ]);
  assert(findings.some(({ name }) => name === "slide-text-budget"));
  await page.locator(".slide").evaluate((slide) => { slide.dataset.section = "supporting"; });
  assert(!(await page.evaluate(measureRegions, { index: 0, budget: proseBudget }))
    .some(({ name }) => name === "slide-text-budget"));
  await page.evaluate(() => { document.documentElement.dataset.deckKind = "outline"; });
  assert.deepEqual(await page.evaluate(measureRegions, { index: 0, budget: proseBudget }), []);
});

test("viewport adapters preserve tolerances, failure wording and preview-only settle check", async (t) => {
  const page = await pageFixture(t, "");
  const viewport = { width: 1600, height: 900, name: "canonical" };
  assert.deepEqual(await previewViewportFindings(page, viewport, 1), [{
    viewport: "canonical", slide: 2, message: "fixed-canvas runtime geometry is unavailable",
  }]);
  await page.evaluate(() => {
    window.__niceDeck = { geometry: () => ({ designWidth: 1600, designHeight: 900, scale: 1.001 }) };
    document.querySelector(".slide").style.width = "1601px";
  });
  assert.deepEqual(await standaloneViewportFindings(page, 1600, 900), []);
  assert.deepEqual(await previewViewportFindings(page, viewport, 0), [{
    viewport: "canonical", slide: 1, message: "runtime scaling did not settle",
  }]);
  await page.evaluate(() => {
    window.__niceDeck.geometry = () => ({ designWidth: 1600, designHeight: 900, scale: 1.01 });
    const slide = document.querySelector(".slide");
    slide.style.width = "1602px";
    slide.style.left = "2px";
  });
  assert.deepEqual(await standaloneViewportFindings(page, 1600, 900), [
    "incorrect scale", "incorrect rendered size", "canvas is not centered", "unexpected scrollbars",
  ]);
  assert.deepEqual((await previewViewportFindings(page, viewport, 0)).map(({ message }) => message), [
    "scale 1.01 does not match 1",
    "slide is 1602x900, expected 1600x900",
    "slide is not centered: 2,0; expected 0,0",
    "runtime scaling did not settle",
    "viewport has unexpected scrolling",
  ]);
  assert.deepEqual(await page.evaluate(measureViewport, {
    width: 1600, height: 900, tolerance: 5, scaleTolerance: .02, scrollTolerance: 5,
  }), []);
});

test("real runtime custom canvas passes all shared viewports and preview audit", async (t) => {
  const fixture = await workspaceFixture(t, "<h1>Custom canvas</h1>", { width: 1920, height: 1080 });
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(fixture.url);
  assert.deepEqual(viewportMatrix.map(({ width, height }) => [width, height]), [
    [1600, 900], [1280, 720], [640, 360], [1600, 600], [700, 900], [520, 900],
  ]);
  for (const viewport of viewportMatrix) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForFunction(({ width, height }) => {
      const geometry = window.__niceDeck.geometry();
      return geometry.viewportWidth === width && geometry.viewportHeight === height;
    }, viewport);
    await page.evaluate(() => window.__niceDeck.whenSettled());
    assert.deepEqual(await previewViewportFindings(page, viewport, 0), []);
    assert.deepEqual(await standaloneViewportFindings(page, viewport.width, viewport.height), []);
    assert.deepEqual(await previewLayoutFindings(page, 0), []);
  }
  const result = await previewDeck({
    sourcePath: fixture.sourcePath, workspaceRoot: fixture.root, browser, mode: "audit",
  });
  assert.deepEqual(result.layoutIssues, []);
  assert.deepEqual(result.viewportAudit, []);
});

test("preview audit actually runs both overflow and region/citation adapters", async (t) => {
  const fixture = await workspaceFixture(t,
    '<div class="escape">Authored content outside padding</div><footer data-citation>Unlinked source</footer>',
    { css: ".escape { position: absolute; left: 1580px; top: 300px; width: 100px; height: 50px; }" });
  const result = await previewDeck({
    sourcePath: fixture.sourcePath, workspaceRoot: fixture.root, browser, mode: "audit",
  });
  assert(result.layoutIssues.some(({ message }) => message.startsWith("overflows the slide right by 120px")));
  assert(result.layoutIssues.some(({ name }) => name === "absolute-region"));
  assert(result.layoutIssues.some(({ name }) => name === "citation-not-linked"));
  assert(result.viewportAudit.some(({ message }) => message === "citation prints a source without a link"));
});

test("standalone command keeps six-per-category caps and does not add region/citation checks", async (t) => {
  const passing = await workspaceFixture(t, '<footer data-citation>Unlinked source</footer>', {
    script: settledResizeFixture,
  });
  const pass = await runLayout(passing.url);
  assert.equal(pass.code, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout, /ok   1 fixture/);
  assert.equal((pass.stdout.match(/ok   viewport/g) ?? []).length, 6);
  assert.match(pass.stdout, /PASS at stress=1: no overflow, text overlap, or viewport scaling failures/);
  const failing = await workspaceFixture(t,
    Array.from({ length: 14 }, (_, index) => `<div class="escape-${index}" style="position:absolute;left:1580px;top:${100 + index * 20}px;width:100px;height:10px"></div>`).join("")
    + Array.from({ length: 5 }, (_, index) => `<small class="overlap-${index}" style="position:absolute;left:100px;top:600px;width:100px;height:30px">text ${index}</small>`).join(""),
    { script: settledResizeFixture });
  const fail = await runLayout(failing.url);
  assert.equal(fail.code, 1, fail.stdout + fail.stderr);
  assert.equal((fail.stdout.match(/   overflow:/g) ?? []).length, 6);
  assert.equal((fail.stdout.match(/   overlap :/g) ?? []).length, 6);
  assert.match(fail.stdout, /1 slide or viewport checks fail at stress=1/);
});

test("standalone stress preserves nested markup and inflates each target once", async (t) => {
  const fixture = await workspaceFixture(t,
    '<h1 data-contract-field="answer"><em>Nested words</em> <a href="#source">source</a></h1>',
    {
      css: "h1 { width: max-content; font: 40px monospace; margin: 0; }",
      script: settledResizeFixture + `<script>
        const target = document.querySelector("h1");
        // Relay the assertion into command-visible failure if stress destroys
        // nested markup or repeats inflation; no test-only production hooks.
        addEventListener("nice-deck:resize", () => {
          if (!target.dataset.stressed) return;
          const extra = Math.round("Nested words source".length * 4);
          const expected = "Nested words source" + " " + "wider ".repeat(Math.ceil(extra / 6));
          if (!target.querySelector("em") || !target.querySelector('a[href="#source"]')
            || target.textContent !== expected) {
            window.__niceDeck.geometry = () => ({ designWidth: 1600, designHeight: 900, scale: -1 });
          }
        });
      </script>`,
    });
  const pass = await runLayout(fixture.url, 1);
  assert.equal(pass.code, 0, pass.stdout + pass.stderr);
  const stress = await runLayout(fixture.url, 5);
  assert.equal(stress.code, 1, stress.stdout + stress.stderr);
  assert.match(stress.stdout, /overflow: right \d+px :: h1/);
  assert.match(stress.stdout, /1 slide or viewport checks fail at stress=5/);
  assert.doesNotMatch(stress.stdout, /FAIL viewport/);
});
