import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import {
  atomicWriteFile, computeDeckSourceHash, findWorkspaceRoot, previewDeck, startStaticServer,
} from "./preview.mjs";
import { exportPortable } from "./export-portable.mjs";
import { launchTestBrowser } from "./test-support/browser.mjs";
import { nativeDocument, workspaceFixture } from "./test-support/workspace.mjs";

async function put(root, path, bytes) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return target;
}

test("source identity preserves UTF-8 paths, native separators, byte lengths and framing", async (t) => {
  const { workspace } = await workspaceFixture(t, { native: false });
  // Fixed compatibility vectors computed independently using uint64 big-endian
  // path-byte length + UTF-8 path + content-byte length + unmodified bytes.
  // Do not derive the expected hash from the implementation under test.
  const selected = [
    ["assets/café.svg", "é\r\n"],
    ["data/values.csv", "Date,Value\n2026-07-01,42\n"],
    ["deck.css", "a{}\r\n"],
    ["deck.js", Buffer.from([0, 255, 13, 10])],
    ["nested/deck.html", "<h1>Résumé</h1>\n"],
  ];
  // Deliberately create in reverse order: identity is not insertion order.
  for (const [path, bytes] of [...selected].reverse()) await put(workspace, path, bytes);
  const sourcePath = join(workspace, "nested/deck.html");
  const expected = sep === "\\"
    ? "7494315590a419db2836b0388cdfaed9f162dfa7a20e9354c05acf75e173531c"
    : "30bb443334ec5b24c4cb8bf573f518cf00ebcee4c29eb11dabf359841006c4ae";
  assert.equal(await findWorkspaceRoot(sourcePath), workspace);
  assert.equal(await computeDeckSourceHash({ sourcePath }), expected);
  for (const path of [
    "brief.md", "other.html", "other.css", "notes.json", "UPPER.JS",
    "assets/ignored.bin", "assets/.hidden.svg", "assets/.hidden/nested.svg",
    "_renders/old.png",
  ]) await put(workspace, path, "not selected");
  assert.equal(await computeDeckSourceHash({ sourcePath }), expected);
  await put(workspace, "data/values.csv", "Date,Value\r\n2026-07-01,42\r\n");
  assert.notEqual(await computeDeckSourceHash({ sourcePath }), expected);
  await assert.rejects(computeDeckSourceHash(), /sourcePath is required/);
  const other = await workspaceFixture(t, { native: false });
  await assert.rejects(
    computeDeckSourceHash({ sourcePath, workspaceRoot: other.workspace }),
    /outside workspace root/,
  );
});

test("workspace discovery uses the nearest marker and otherwise the source directory", async (t) => {
  const { workspace } = await workspaceFixture(t, { native: false });
  const source = await put(workspace, "nested/deeper/probe.html", "<h1>Fixture</h1>");
  assert.equal(await findWorkspaceRoot(source), dirname(source));
  await put(workspace, "brief.md", "# Fixture");
  assert.equal(await findWorkspaceRoot(source), workspace);
  await put(workspace, "nested/deck.js", "// nearer marker");
  assert.equal(await findWorkspaceRoot(source), join(workspace, "nested"));
});

test("atomic replacement preserves directory targets and leaves no temporary files", async (t) => {
  const { workspace } = await workspaceFixture(t, { native: false });
  const path = join(workspace, "result.json");
  await atomicWriteFile(path, "first");
  assert.equal(await readFile(path, "utf8"), "first");
  await atomicWriteFile(path, "replacement");
  assert.equal(await readFile(path, "utf8"), "replacement");
  await mkdir(join(workspace, "directory"));
  await assert.rejects(atomicWriteFile(join(workspace, "directory"), "no"), /must not be a directory/);
  assert.deepEqual((await readdir(workspace)).sort(), ["directory", "result.json"]);
});

test("server return shape, loopback URL encoding, MIME, cache and restrictions remain compatible", async (t) => {
  const { workspace, track } = await workspaceFixture(t, { native: false });
  const source = await put(workspace, "nested/a space-é.html", "<h1>Fixture</h1>");
  await put(workspace, "data.tsv", "A\tB\n");
  await put(workspace, "secret.bin", "not served");
  await put(workspace, ".hidden.html", "not served");
  const server = track(await startStaticServer(workspace));
  assert.deepEqual(Object.keys(server).sort(), ["close", "closed", "root", "urlFor"]);
  assert.equal(server.root, workspace);
  const url = server.urlFor(source, "abc123");
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/nested\/a%20space-%C3%A9\.html\?v=abc123$/);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(await response.text(), "<h1>Fixture</h1>");
  const tsv = await fetch(new URL("/data.tsv", url));
  assert.equal(tsv.headers.get("content-type"), "text/tab-separated-values; charset=utf-8");
  for (const [path, status] of [
    ["/secret.bin", 403], ["/.hidden.html", 403], ["/%2ehidden.html", 403],
    ["/nested%5ca%20space.html", 403], ["/missing.html", 404], ["/nested", 404],
    ["/__nice-deck/echarts.min.js", 410],
  ]) assert.equal((await fetch(new URL(path, url))).status, status, path);
  assert.throws(() => server.urlFor(join(workspace, "../outside.html")), /outside preview root/);
  await server.close();
  await server.closed;
});

test("snapshots keep captured bytes and repair missing, modified and extra files", async (t) => {
  const { workspace, probe, track } = await workspaceFixture(t);
  const browser = track(await launchTestBrowser());
  const first = await previewDeck({ sourcePath: probe, browser, keepServer: true });
  track(first.server);
  const original = await readFile(probe, "utf8");
  await writeFile(probe, nativeDocument("Changed live source"));
  assert.equal(await (await fetch(first.url)).text(), original);
  await writeFile(probe, original);
  await first.server.close();
  await writeFile(join(first.server.root, "probe.html"), "corrupt snapshot");
  await rm(join(first.server.root, "data/extract.csv"));
  await put(first.server.root, "assets/unexpected.png", "extra snapshot file");
  const repaired = await previewDeck({ sourcePath: probe, browser, keepServer: true });
  track(repaired.server);
  assert.equal(repaired.sourceHash, first.sourceHash);
  assert.equal(repaired.server.root, first.server.root);
  assert.equal(await readFile(join(repaired.server.root, "probe.html"), "utf8"), original);
  assert.equal(await readFile(join(repaired.server.root, "data/extract.csv"), "utf8"),
    await readFile(join(workspace, "data/extract.csv"), "utf8"));
  await assert.rejects(readFile(join(repaired.server.root, "assets/unexpected.png")), { code: "ENOENT" });
  assert(!(await readdir(dirname(repaired.server.root))).some((name) => name.endsWith(".tmp") || name.endsWith(".bak")));
});

test("draft portable assets are deliberately broader than captured delivery inputs", async (t) => {
  const { workspace, probe, track } = await workspaceFixture(t);
  const browser = track(await launchTestBrowser());
  const broad = ["assets/opaque.bin", "assets/.hidden.txt", "data/notes.txt", "runtime/opaque.bin", "UPPER.JS"];
  const selected = ["helper.js", "assets/live/extra.html", "runtime/extra.js"];
  const ignored = ["root.txt", "other.css", "notes.json", "other.html"];
  for (const path of [...broad, ...selected, ...ignored]) await put(workspace, path, "// fixture");
  const snapshot = await previewDeck({ sourcePath: probe, browser, keepServer: true });
  track(snapshot.server);
  for (const path of broad) {
    await assert.rejects(readFile(join(snapshot.server.root, path)), { code: "ENOENT" }, path);
  }
  for (const path of selected) assert.equal(await readFile(join(snapshot.server.root, path), "utf8"), "// fixture");
  const draft = await exportPortable({ sourcePath: probe, outputDir: join(workspace, "delivery"), draft: true });
  assert.equal(draft.draft, true);
  assert.match(draft.root, /delivery\.draft$/);
  for (const path of [...broad, ...selected]) assert.equal(await readFile(join(draft.root, path), "utf8"), "// fixture");
  for (const path of ignored) await assert.rejects(readFile(join(draft.root, path)), { code: "ENOENT" }, path);
  const ordinary = await exportPortable({ sourcePath: probe, outputDir: join(workspace, "ordinary") });
  for (const path of broad) await assert.rejects(readFile(join(ordinary.root, path)), { code: "ENOENT" }, path);
  for (const path of selected) assert.equal(await readFile(join(ordinary.root, path), "utf8"), "// fixture");
});

test("nested portable source retains legacy basename flattening and unchanged relative links", async (t) => {
  const { workspace, track } = await workspaceFixture(t);
  const original = nativeDocument("Nested").replace('href="deck.css"', 'href="../deck.css"')
    .replace('src="deck.js"', 'src="../deck.js"');
  const sourcePath = await put(workspace, "nested/treatment.html", original);
  const browser = track(await launchTestBrowser());
  const snapshot = await previewDeck({ sourcePath, browser, keepServer: true });
  track(snapshot.server);
  assert.equal(snapshot.ok, true);
  assert.equal(await readFile(join(snapshot.server.root, "nested/treatment.html"), "utf8"), original);
  for (const draft of [true, false]) {
    const portable = await exportPortable({ sourcePath, outputDir: join(workspace, `nested-delivery-${draft}`), draft });
    assert.equal(portable.html, join(portable.root, "treatment.html"));
    assert.equal(await readFile(portable.html, "utf8"), original);
    await assert.rejects(readFile(join(portable.root, "nested/treatment.html")), { code: "ENOENT" });
    // Characterization, not a fix: flattening leaves ../ references unchanged.
    assert.match(await readFile(portable.html, "utf8"), /href="\.\.\/deck\.css"/);
  }
});

test("ordinary portable export reads captured bytes rather than live mutations during rendering", async (t) => {
  const { workspace, probe } = await workspaceFixture(t);
  const original = await readFile(probe, "utf8");
  const launch = chromium.launch;
  let launches = 0;
  chromium.launch = async (options) => {
    launches++;
    await writeFile(probe, nativeDocument("Live mutation must not ship"));
    await put(workspace, "data/extract.csv", "changed during rendering");
    await put(workspace, "assets/late.png", "not captured");
    return launch.call(chromium, options);
  };
  let portable;
  try {
    portable = await exportPortable({ sourcePath: probe, outputDir: join(workspace, "captured") });
  } finally {
    chromium.launch = launch;
  }
  assert.equal(launches, 1);
  assert.equal(await readFile(portable.html, "utf8"), original);
  assert.equal(await readFile(join(portable.root, "data/extract.csv"), "utf8"), "Date,Value\n2026-07-01,42\n");
  await assert.rejects(readFile(join(portable.root, "assets/late.png")), { code: "ENOENT" });
  assert.match(await readFile(probe, "utf8"), /Live mutation must not ship/);
});
