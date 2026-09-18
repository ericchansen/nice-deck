import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncRuntime } from "../sync-runtime.mjs";

export const runtimeDirectory = fileURLToPath(new URL("../../runtime/", import.meta.url));
export const sources = {
  version: 1,
  sources: [
    {
      id: "S1", title: "Fixture extract", publisher: "Test", date: "2026-08-12",
      type: "measured-internal-extract", locator: "Fixture values",
      deckAnchor: "fixture-extract", confidentiality: "test",
    },
    {
      id: "S2", title: "Fixture documentation", publisher: "Test", date: "2026-08-12",
      type: "public-url", url: "https://example.com/source",
      locator: "Fixture method", confidentiality: "public",
    },
  ],
};

export const contract = (id, overrides = {}) => ({
  id,
  question: "What does the fixture show?",
  answer: "The fixture has a supported answer.",
  claimStatus: "measured",
  sourceIds: ["S1"],
  captureState: "Authored default state.",
  accessibility: "Native text remains visible.",
  modality: "native",
  renderer: "html",
  ...overrides,
});

export const citation = '<footer data-citation>Source: <a href="#fixture-extract">Fixture extract</a></footer>';

export const nativeDocument = (content) => `<!doctype html>
<html><head><link rel="stylesheet" href="deck.css"></head><body>
  <section class="slide" data-slide-id="01" data-visual-modality="native">
    <h1>${content}</h1>
    ${citation}
  </section>
  <section class="slide" data-slide-id="02" data-visual-modality="native">
    <h1>Second</h1>
    ${citation}
  </section>
  <section class="slide" id="fixture-extract" data-slide-id="03"
    data-visual-modality="native" data-section="supporting">
    <h1>Fixture extract</h1>
    <footer data-citation>Extract of record. Method: <a href="https://example.com/source">Fixture documentation</a></footer>
  </section>
  <script src="deck.js"></script>
</body></html>`;

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Register cleanup immediately, including when fixture construction fails.
// Each named scenario gets a new workspace, not a reset of another test's state.
export async function workspaceFixture(t, { native = true } = {}) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "nice-deck-test-")));
  const resources = [];
  t.after(async () => {
    try {
      const failures = [];
      for (const resource of resources.reverse()) {
        try { await resource.close(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Fixture resource cleanup failed");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
  const track = (resource) => {
    // A scenario may close a server/page early; cleanup must not close it twice.
    const close = resource.close.bind(resource);
    let closing;
    resource.close = () => (closing ??= close());
    resources.push(resource);
    return resource;
  };
  const configure = async (manifest) => {
    await writeJson(join(workspace, "sources.json"), sources);
    await writeJson(join(workspace, "visual-manifest.json"), { version: 1, slides: manifest });
  };
  if (native) {
    await writeFile(join(workspace, "brief.md"), "# Test deck\n");
    await cp(join(runtimeDirectory, "deck.js"), join(workspace, "deck.js"));
    await syncRuntime({ workspaceRoot: workspace });
    await writeFile(join(workspace, "deck.css"), `
    :root { --bg: #fff; --ink: #111; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); }
    .slide { display: grid; width: 100vw; height: 100vh; place-items: center; }
    .chart { width: 900px; height: 500px; }
    .nice-deck-chart-error { padding: 30px; background: #fff0f0; color: #8a001f; }
  `);
    await configure([contract("01"), contract("02"), contract("03")]);
    for (const [path, bytes] of [
      ["assets/live/index.html", "<!doctype html><title>Live asset</title>"],
      ["assets/live/app.css", "body { color: #111; }"],
      ["assets/live/app.js", "document.documentElement.dataset.live = 'true';"],
      ["data/figures.js", "window.fixtureFigures = { value: 42 };"],
      ["data/extract.csv", "Date,Value\n2026-07-01,42\n"],
      ["data/extract.tsv", "Date\tValue\n2026-07-01\t42\n"],
    ]) {
      await mkdir(dirname(join(workspace, path)), { recursive: true });
      await writeFile(join(workspace, path), bytes);
    }
    await writeFile(join(workspace, "probe.html"), nativeDocument("First"));
  }
  return { workspace, configure, track, probe: join(workspace, "probe.html") };
}

// Opt-in only: normal test runs never leave artifacts in the repository or temp.
export async function retainArtifact(source, name) {
  const root = process.env.NICE_DECK_TEST_ARTIFACTS;
  if (!root) return;
  await mkdir(root, { recursive: true });
  const destination = join(root, name);
  await cp(source, destination, { recursive: true, force: true });
  console.log(`retained artifact: ${destination}`);
}
