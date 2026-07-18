import assert from "node:assert/strict";
import {
  access,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportDeck } from "./export-pdf.mjs";
import { previewDeck } from "./preview.mjs";
import { scanSource } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "nice-deck-test-"));
const directions = join(workspace, "directions");
let liveServer;

function rawStatus(base, path) {
  const url = new URL(base);
  return new Promise((resolveStatus, reject) => {
    const requestHandle = request({
      hostname: url.hostname,
      method: "GET",
      path,
      port: url.port,
    }, (response) => {
      response.resume();
      response.once("end", () => resolveStatus(response.statusCode));
    });
    requestHandle.once("error", reject);
    requestHandle.end();
  });
}

const document = (content, style = "") => `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../deck.css">
    <style>${style}</style>
  </head>
  <body>
    <section class="slide" style="display: flex">
      <h1>${content}</h1>
      <a href="https://example.com">Source</a>
      <a href="./local.html">Local</a>
    </section>
    <section class="slide"><h1>Second</h1></section>
    <script src="../deck.js"></script>
    <script>
      if (getComputedStyle(document.querySelector(".slide")).display !== "flex") {
        console.error("authored display was not preserved");
      }
    </script>
  </body>
</html>`;

try {
  await mkdir(directions);
  await writeFile(join(workspace, "brief.md"), "# Test deck\n");
  await writeFile(join(workspace, "credentials.json"), "{\"secret\":\"do not serve\"}\n");
  await cp(join(here, "..", "runtime", "deck.js"), join(workspace, "deck.js"));
  await writeFile(join(workspace, "deck.css"), `
    :root { --bg: #ffffff; --ink: #111111; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); }
    .slide { display: grid; width: 100vw; height: 100vh; place-items: center; }
  `);

  const probe = join(directions, "probe.html");
  await writeFile(probe, document("First"));

  const first = await previewDeck({ sourcePath: probe, keepServer: true });
  liveServer = first.server;
  assert.equal(first.ok, true);
  assert.equal(first.workspaceRoot, await realpath(workspace));
  assert.equal(first.screenshots.length, 2);
  assert.match(first.sourceHash, /^[0-9a-f]{64}$/);
  await access(first.previewFile);
  await Promise.all(first.screenshots.map((file) => access(file)));

  const record = JSON.parse(await readFile(first.previewFile, "utf8"));
  assert.equal(record.sourceHash, first.sourceHash);
  assert.equal(record.screenshots.length, 2);

  await writeFile(probe, document("Changed"));
  const immutableHtml = await (await fetch(first.url)).text();
  assert.match(immutableHtml, />First</);
  assert.doesNotMatch(immutableHtml, />Changed</);
  assert.equal((await fetch(new URL("/.env", first.url))).status, 403);
  assert.equal(await rawStatus(first.url, "/%2e%2e/deck.js"), 403);
  assert.equal(await rawStatus(first.url, "/.hidden/../deck.js"), 403);
  assert.equal((await fetch(new URL("/credentials.json", first.url))).status, 404);
  assert.equal((await fetch(new URL("/deck.js%5Cnode_modules", first.url))).status, 403);
  await liveServer.close();
  liveServer = undefined;

  const second = await previewDeck({
    sourcePath: probe,
    outDir: join(workspace, "custom-output"),
  });
  assert.notEqual(second.sourceHash, first.sourceHash);
  const repeated = await previewDeck({ sourcePath: probe });
  assert.equal(repeated.sourceHash, second.sourceHash);
  const linkedOutput = join(workspace, "linked-output");
  const linkedTarget = join(workspace, "linked-target");
  await Promise.all([mkdir(linkedOutput), mkdir(linkedTarget)]);
  await symlink(
    linkedTarget,
    join(linkedOutput, repeated.sourceHash.slice(0, 12)),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    previewDeck({ sourcePath: probe, outDir: linkedOutput }),
    /render directory must be a real directory/,
  );
  const repeatedSnapshot = join(
    dirname(repeated.screenshots[0]),
    "site",
    "directions",
    "probe.html",
  );
  await writeFile(repeatedSnapshot, document("Corrupt"));
  const screenshotTarget = join(workspace, "screenshot-target.png");
  const previewTarget = join(workspace, "preview-target.json");
  await Promise.all([
    writeFile(screenshotTarget, "screenshot sentinel"),
    writeFile(previewTarget, "preview sentinel"),
    rm(repeated.screenshots[0]),
    rm(repeated.previewFile),
  ]);
  await Promise.all([
    link(screenshotTarget, repeated.screenshots[0]),
    link(previewTarget, repeated.previewFile),
  ]);
  const repaired = await previewDeck({ sourcePath: probe, keepServer: true });
  liveServer = repaired.server;
  const repairedHtml = await (await fetch(repaired.url)).text();
  assert.match(repairedHtml, />Changed</);
  assert.doesNotMatch(repairedHtml, />Corrupt</);
  assert.equal(await readFile(screenshotTarget, "utf8"), "screenshot sentinel");
  assert.equal(await readFile(previewTarget, "utf8"), "preview sentinel");
  await liveServer.close();
  liveServer = undefined;

  const findings = scanSource("p { background-clip: text; }");
  assert(findings.some(({ name }) => name === "gradient-text"));

  const pdfPath = join(workspace, "deck.pdf");
  const exported = await exportDeck({ sourcePath: probe, outputPath: pdfPath });
  const pdf = await readFile(pdfPath);
  const pdfText = pdf.toString("latin1");
  assert.equal(exported.pages, 2);
  assert.equal(exported.links, 1);
  assert.deepEqual(exported.skippedLinks, ["./local.html"]);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert(pdf.length > 1000);
  assert.equal(pdfText.match(/\/Type\s*\/Page\b/g)?.length, 2);
  assert.match(pdfText, /https:\/\/example\.com/);
  assert.doesNotMatch(pdfText, /\.\/local\.html/);

  const contrastPath = join(directions, "contrast.html");
  await writeFile(
    contrastPath,
    document("Invisible", "body { background: oklch(1 0 0); color: oklch(1 0 0); }"),
  );
  const contrast = await previewDeck({ sourcePath: contrastPath });
  assert.equal(contrast.ok, false);
  assert(contrast.contrast.some((failure) => failure.text.includes("Invisible")));

  const opacityPath = join(directions, "opacity.html");
  await writeFile(
    opacityPath,
    document("Faint", "body { background: #000; color: #fff; opacity: .1; }"),
  );
  const opacity = await previewDeck({ sourcePath: opacityPath });
  assert(opacity.contrastUnverified.some(
    (finding) => finding.reason === "opacity" && finding.text.includes("Faint"),
  ));

  const filterPath = join(directions, "filter.html");
  await writeFile(
    filterPath,
    document("Filtered", ".slide { filter: opacity(.1); }"),
  );
  const filter = await previewDeck({ sourcePath: filterPath });
  assert(filter.contrastUnverified.some(
    (finding) => finding.reason === "filter" && finding.text.includes("Filtered"),
  ));

  const remotePath = join(directions, "remote.html");
  await writeFile(
    remotePath,
    `${document("Offline")}<script src="https://example.com/remote.js"></script>
    <script>new WebSocket("wss://example.com/socket")</script>`,
  );
  const remote = await previewDeck({ sourcePath: remotePath });
  assert.equal(remote.ok, false);
  assert(remote.browserErrors.some((error) => error.startsWith("request:")));
  assert(remote.browserErrors.some((error) => error.startsWith("websocket:")));

  const popupPath = join(directions, "popup.html");
  await writeFile(
    popupPath,
    `${document("Popup")}<script>window.open("https://example.com/popup")</script>`,
  );
  const popup = await previewDeck({ sourcePath: popupPath });
  assert.equal(popup.ok, false);
  assert(popup.browserErrors.some(
    (error) => error.startsWith("request:") && error.includes("/popup"),
  ));

  const brokenPath = join(directions, "broken.html");
  await writeFile(
    brokenPath,
    `${document("Broken")}<script>console.error("expected")</script>`,
  );
  const broken = await previewDeck({ sourcePath: brokenPath });
  assert.equal(broken.ok, false);
  assert(broken.browserErrors.some((error) => error.includes("expected")));

  console.log("nice-deck preview self-test passed");
} finally {
  await liveServer?.close();
  await rm(workspace, { recursive: true, force: true });
}
