import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { EditError, inspectEditableHtml, openEditableSource, patchEditableHtml } from "./edit-source.mjs";

// Synthetic only: no customer/imported documents are loaded by these tests.
const fixture = '<!doctype html>\r\n<title>Synthetic &amp; safe</title>\r\n'
  + '<section class="slide hero" id="anchor" data-slide-id="manifest-key" DATA-TITLE = \'A &amp; B\'>\r\n'
  + '<h1 data-edit-id="heading">A &amp; B</h1><p> A short sentence. </p>\r\n'
  + '<p class="scope">USD; 2026</p><svg><text>A &amp; B</text></svg>\r\n'
  + '</section>\r\n<script type="application/json">{"title":"A &amp; B","payload":[1,2,3]}</script>\r\n'
  + '<script>const x = "A &amp; B"; /* never reserialize */</script>\r\n';
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const change = (field, text) => ({ id: field.id, oldText: field.text, text });
const slideChange = (slide, text) => ({ kind: "slide", id: slide.id, oldText: slide.source, text });
const error = (code, status) => (failure) => {
  assert.ok(failure instanceof EditError);
  assert.equal(failure.code, code);
  if (status !== undefined) assert.equal(failure.status, status);
  return true;
};

async function setup(context, html = fixture) {
  const root = await fs.mkdtemp(join(tmpdir(), "nice-deck-source-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, "deck.html");
  await fs.writeFile(sourcePath, html);
  const coordinator = await openEditableSource(sourcePath);
  return { root, sourcePath, coordinator };
}

async function historyDir(root) {
  const directory = join(root, ".nice-deck-edit");
  const [name] = await fs.readdir(directory);
  assert.match(name, /^[a-f0-9]{64}$/);
  return join(directory, name);
}

test("inspection exposes exact slide source and relative text ranges without serializing markup", () => {
  const info = inspectEditableHtml(fixture);
  assert.equal(info.title, "Synthetic & safe");
  assert.equal(info.status, "ready");
  assert.equal(info.eligibleCount, 4);
  assert.deepEqual(info.slides.map(({ id, anchor, index, section }) => ({ id, anchor, index, section })), [
    { id: "manifest-key", anchor: "anchor", index: 0, section: "main" },
  ]);
  assert.deepEqual(info.fields.map(({ id, path, tag, text, multiline }) => ({ id, path, tag, text, multiline })), [
    { id: "heading", path: [0], tag: "h1", text: "A & B", multiline: false },
    { id: "field:manifest-key:1", path: [1], tag: "p", text: " A short sentence. ", multiline: false },
    { id: "field:manifest-key:2", path: [2], tag: "p", text: "USD; 2026", multiline: false },
    { id: "field:manifest-key:3.0", path: [3, 0], tag: "text", text: "A & B", multiline: false },
  ]);
  assert.equal(info.fields[0], info.slides[0].fields[0]);
  assert.equal(info.html, undefined);
  const slide = info.slides[0];
  assert.equal(slide.source, fixture.slice(fixture.indexOf("<section"), fixture.indexOf("</section>") + 10));
  assert.equal(slide.source.slice(info.fields[0].sourceRange.start, info.fields[0].sourceRange.end), "A &amp; B");
  assert.ok(slide.source.includes("DATA-TITLE = 'A &amp; B'"));
  assert.ok(slide.source.includes("\r\n"));
  assert.ok(!slide.source.includes("never reserialize"));
});

test("source ranges follow save offsets and missing explicit slide boundaries stay unavailable", () => {
  const patched = patchEditableHtml(fixture, [change(inspectEditableHtml(fixture).fields[0], "Longer 😀 & new")]);
  const info = inspectEditableHtml(patched);
  for (const field of info.fields) {
    assert.ok(field.sourceRange.start < field.sourceRange.end);
    const raw = info.slides[0].source.slice(field.sourceRange.start, field.sourceRange.end);
    assert.ok(raw.length > 0);
  }
  assert.equal(info.slides[0].source.slice(info.fields[0].sourceRange.start, info.fields[0].sourceRange.end), "Longer 😀 &amp; new");
  const unclosed = inspectEditableHtml('<section class="slide" id="x"><h1>Unclosed slide</h1>');
  assert.equal(unclosed.slides[0].source, null);
  assert.equal(unclosed.fields[0].sourceRange, undefined);
});

test("whole-slide patches retain every outside byte and reparse new markup and attributes", async (context) => {
  const original = `\ufeff${fixture}<section class="slide" id="second"><h1>Second</h1></section>\r\n<!-- tail -->`;
  const { coordinator, sourcePath } = await setup(context, original);
  const state = await coordinator.read();
  const slide = state.slides[0];
  const text = slide.source.replace('<h1 data-edit-id="heading">A &amp; B</h1>',
    '<h1 data-edit-id="heading" style="color:gold">Live <em>markup</em></h1><p title="New attribute">Added</p>');
  const edits = [slideChange(slide, text)];
  assert.equal(patchEditableHtml(original, edits), original.replace(slide.source, text));
  assert.equal(await fs.readFile(sourcePath, "utf8"), original);
  const saved = await coordinator.save({ revision: state.revision, changes: edits });
  assert.equal(await fs.readFile(sourcePath, "utf8"), original.replace(slide.source, text));
  assert.equal(saved.slides[0].source, text);
  assert.equal(saved.slides[1].source, state.slides[1].source);
  assert.ok(saved.fields.some((field) => field.text === "markup"));
  assert.equal((await (await openEditableSource(sourcePath)).read()).revision, saved.revision);
  await assert.rejects(coordinator.save({ revision: state.revision, changes: edits }), error("revision-conflict", 409));
});

test("source replacements reject syntax recovery, boundary escapes, identity changes and duplicate IDs atomically", () => {
  const slide = inspectEditableHtml(fixture).slides[0];
  for (const text of [
    slide.source + "<p>Outside</p>", "<!-- outside -->" + slide.source,
    slide.source.replace("</section>", ""), slide.source.replace("</h1>", ""),
    slide.source.replace("<h1", '<h1 title="unterminated'),
    slide.source.replace('id="anchor"', 'id="changed"'),
    slide.source.replace('data-slide-id="manifest-key"', 'data-slide-id="changed"'),
    slide.source.replace("</section>", '<section class="slide" id="nested"></section></section>'),
    slide.source.replace("</section>", '<p id="same">One</p><p id="same">Two</p></section>'),
    slide.source.replace("</section>", '<p data-edit-id="heading">Duplicate</p></section>'),
    slide.source.replace("</section>", '</section></div><div>'),
  ]) {
    assert.throws(() => patchEditableHtml(fixture, [slideChange(slide, text)]), EditError, text);
  }
  const locked = '<section class=slide id=x><h1>Title</h1><p data-edit-lock>Locked</p></section>';
  const info = inspectEditableHtml(locked);
  assert.throws(() => patchEditableHtml(locked, [slideChange(info.slides[0], locked.replace("Locked", "Changed"))]), EditError);
  assert.equal(patchEditableHtml(locked, [slideChange(info.slides[0], locked.replace("Title", "New"))]), locked.replace("Title", "New"));
  assert.throws(() => patchEditableHtml(fixture, [
    slideChange(slide, slide.source.replace("A short sentence.", "New")),
    change(inspectEditableHtml(fixture).fields[0], "Overlap"),
  ]), error("overlapping-fields", 422));
});

test("patches only selected text and corresponding static title, preserving scripts and all other markup", () => {
  const field = inspectEditableHtml(fixture).fields[0];
  const patched = patchEditableHtml(fixture, [change(field, 'New <title> & "quote" 😀')]);
  assert.equal(patched, fixture
    .replace("DATA-TITLE = 'A &amp; B'", "DATA-TITLE = 'New &lt;title&gt; &amp; &quot;quote&quot; 😀'")
    .replace('<h1 data-edit-id="heading">A &amp; B</h1>', '<h1 data-edit-id="heading">New &lt;title&gt; &amp; "quote" 😀</h1>'));
  assert.equal(inspectEditableHtml(patched).fields[0].text, 'New <title> & "quote" 😀');
  const fields = inspectEditableHtml(fixture).fields;
  assert.equal(patchEditableHtml(fixture, [change(fields[1], "Two & <three>"), change(fields[0], "One")]), fixture
    .replace("DATA-TITLE = 'A &amp; B'", "DATA-TITLE = 'One'")
    .replace('<h1 data-edit-id="heading">A &amp; B</h1>', '<h1 data-edit-id="heading">One</h1>')
    .replace("<p> A short sentence. </p>", "<p>Two &amp; &lt;three&gt;</p>"));
});

test("no-op preserves BOM, original entities, Unicode, CRLF and existing multiline/long/empty text", () => {
  const source = '\ufeff<section class=slide id=x>\r\n<h1> \t&#x1F600; &amp; e\u0301 &#13; </h1>'
    + `<p>one\r\ntwo &nbsp; &#38;</p><p>${"x".repeat(5001)}</p><p> </p></section>\r\n`;
  const { fields } = inspectEditableHtml(source);
  assert.equal(fields[0].text, " \t😀 & e\u0301 \r ");
  assert.equal(fields[1].text, "one\ntwo \u00a0 &");
  assert.equal(patchEditableHtml(source, []), source);
  assert.equal(patchEditableHtml(source, fields.map((field) => change(field, field.text))), source);
  const patched = patchEditableHtml(source, [change(fields[1], "  新しい café 😀 & <b>  ")]);
  assert.equal(patched, source.replace("one\r\ntwo &nbsp; &#38;", "  新しい café 😀 &amp; &lt;b&gt;  "));
  assert.equal(inspectEditableHtml(patched).fields[1].text, "  新しい café 😀 & <b>  ");
});

test("title sync is local to the first h1, including layout wrappers; attributes retain syntax where possible", () => {
  for (const [attribute, before, expected] of [
    ['data-title="A &amp; B"', "A &amp; B", 'data-title="Next &amp; one"'],
    ["data-title=Old", "Old", 'data-title="Next &amp; one"'],
    ['data-title="Different"', "Old", 'data-title="Different"'],
    ['data-title=" Old "', "Old", 'data-title=" Old "'],
  ]) {
    const source = `<section class=slide id=x ${attribute}><h1>${before}</h1></section>`;
    const field = inspectEditableHtml(source).fields[0];
    assert.equal(patchEditableHtml(source, [change(field, "Next & one")]),
      `<section class=slide id=x ${expected}><h1>Next &amp; one</h1></section>`);
  }
  for (const content of ["<h1>Other</h1><h1>Old</h1>", "<h2>Old</h2>"]) {
    const source = `<section class=slide id=x data-title="Old">${content}</section>`;
    const field = inspectEditableHtml(source).fields.find((item) => item.text === "Old");
    assert.match(patchEditableHtml(source, [change(field, "New")]), /data-title="Old"/);
  }
  const nested = '<section class=slide id=x data-title="Old"><header><h1>Old</h1></header></section>';
  const heading = inspectEditableHtml(nested).fields[0];
  assert.equal(patchEditableHtml(nested, [change(heading, "New")]),
    '<section class=slide id=x data-title="New"><header><h1>New</h1></header></section>');
});

test("native content is editable without opting in; executable content, controls and explicit locks are omitted", () => {
  const protectedContent = [
    "<a><p data-editable=true>link</p></a>", "<cite><span data-editable=true>citation</span></cite>",
    "<nav><h1 data-editable=true>navigation</h1></nav>",
    "<table><tr><td><p data-editable=true>table</p></td></tr></table>",
    "<svg><text data-editable=true>svg</text><foreignObject><p data-editable=true>foreign</p></foreignObject></svg>",
    "<math><mtext data-editable=true>math</mtext></math>",
    "<iframe><p>iframe</p></iframe>", "<form><p data-editable=true>form</p></form>",
    "<label data-editable=true>label</label>", "<button data-editable=true>button</button>",
    "<code><span data-editable=true>code</span></code>", "<pre><p data-editable=true>pre</p></pre>",
    "<template><p data-editable=true>template</p></template>",
    "<script type=application/json>{\"text\":\"json\"}</script>", "<style>p {color: red}</style>",
    '<div class=citation><p data-editable=true>citation class</p></div>',
    '<div role=doc-footnote><p data-editable=true>citation role</p></div>',
    '<div data-editable=false><p data-editable=true>ancestor lock</p></div>',
    '<div data-edit-lock="false"><p data-editable=true>presence lock</p></div>',
    '<p data-edit-lock data-editable=true>self lock</p>',
    "<p>mixed <em>emphasis</em></p>", "<p>comment<!-- keep -->text</p>",
    "<p>unclosed paragraph",
  ].join("");
  const source = `<section class=slide id=x><h1>Safe</h1>${protectedContent}</section>`;
  assert.deepEqual(inspectEditableHtml(source).fields.map((field) => field.text), [
    "Safe", "link", "citation", "table", "svg", "foreign", "label",
    "citation class", "citation role", "mixed ", "emphasis", "comment", "text", "unclosed paragraph",
  ]);
  assert.equal(patchEditableHtml(source, [change(inspectEditableHtml(source).fields[0], "Edited")]),
    source.replace("<h1>Safe</h1>", "<h1>Edited</h1>"));
});

test("supporting and scope text are editable by default; explicit locks still win", () => {
  const source = `<section class=slide id=main>
    <h1>Main</h1><p class=scope>Locked scope</p><p class=scope data-editable=true>Scope opt-in</p>
    <span>Not default</span><span data-editable=true>Inline opt-in</span>
    <div data-editable=true>Block opt-in</div><h4 data-editable=true>Small heading</h4>
    </section><section class=slide id=support data-section=supporting data-editable=true>
    <h1>Supporting title</h1><p>Supporting detail</p><p data-editable=true>Support opt-in</p>
    <p data-editable=false>Explicit lock</p><div data-edit-lock><p data-editable=true>Locked opt-in</p></div>
    </section>`;
  const info = inspectEditableHtml(source);
  assert.deepEqual(info.fields.map((field) => field.text), [
    "Main", "Locked scope", "Scope opt-in", "Not default", "Inline opt-in", "Block opt-in",
    "Small heading", "Supporting title", "Supporting detail", "Support opt-in",
  ]);
  assert.equal(info.slides[1].section, "supporting");
});

test("paths count element children, including implicit browser nodes but not comments/text", () => {
  // parse5/browser insert a tbody and foster-parent the invalid paragraph out
  // of the table. The editor indexes the parsed tree, not lexical source tags.
  const source = `<section class=slide id=x>text<!-- comment --><svg></svg>
    <div><img><p>Nested</p></div><table><p>Fostered</p><tr><td>Cell</td></tr></table>
    <p>Last</p></section>`;
  assert.deepEqual(inspectEditableHtml(source).fields.map(({ text, path }) => ({ text, path })), [
    { text: "text", path: [] }, { text: "Nested", path: [1, 1] }, { text: "Fostered", path: [2] },
    { text: "Cell", path: [3, 0, 0, 0] }, { text: "Last", path: [4] },
  ]);
});

test("mixed table, citation and SVG text edits preserve sibling markup and synchronize a formatted title", () => {
  const source = '<section class=slide id=prices data-title="Model prices"><h1>Model <em>prices</em></h1>'
    + '<p class=scope>USD per million tokens</p><table><tr><th>Model</th><th>Input</th><th>Status</th></tr>'
    + '<tr><td class=model>Model A<span class=tier>Short context</span></td><td>$10</td>'
    + '<td rowspan=2>All models:<br>Unverified</td></tr><tr><td>Model B</td><td>$20</td></tr></table>'
    + '<footer class=citation><a href="https://example.com/pricing?a=1&amp;b=2" data-source=prices target=_blank rel=noopener>Pricing source</a></footer>'
    + '<svg viewBox="0 0 100 50"><text x=4 y=10>Region<tspan dy=15>Label</tspan></text></svg>'
    + '<p>Before<!-- preserve this -->After</p></section>';
  const updates = new Map([
    ["Model ", "Current "], ["prices", "pricing"], ["USD per million tokens", "Published USD prices"],
    ["Model A", "Model C"], ["Short context", "Standard tier"], ["$10", "$12"],
    ["All models:", "Public prices:"], ["Unverified", "Draft only"], ["Pricing source", "Published source"],
    ["Region", "Data zone"], ["Label", "East"], ["Before", "Earlier"], ["After", "Later"],
  ]);
  const info = inspectEditableHtml(source);
  const changes = info.fields.filter((field) => updates.has(field.text)).map((field) => change(field, updates.get(field.text)));
  assert.equal(changes.length, updates.size);
  assert.equal(info.fields.find((field) => field.text === "Model A").textNode, 0);
  assert.equal(info.fields.find((field) => field.text === "Unverified").textNode, 2);
  assert.equal(info.fields.find((field) => field.text === "Label").namespace, "svg");
  const patched = patchEditableHtml(source, changes);
  assert.equal(patched, source
    .replace('data-title="Model prices"', 'data-title="Current pricing"')
    .replace("<h1>Model <em>prices</em>", "<h1>Current <em>pricing</em>")
    .replace("USD per million tokens", "Published USD prices")
    .replace("Model A<span class=tier>Short context", "Model C<span class=tier>Standard tier")
    .replace("<td>$10</td>", "<td>$12</td>")
    .replace("All models:<br>Unverified", "Public prices:<br>Draft only")
    .replace(">Pricing source</a>", ">Published source</a>")
    .replace(">Region<tspan dy=15>Label", ">Data zone<tspan dy=15>East")
    .replace("Before<!-- preserve this -->After", "Earlier<!-- preserve this -->Later"));
  assert.deepEqual(inspectEditableHtml(patched).fields.map((field) => field.id), info.fields.map((field) => field.id));
  assert.equal(inspectEditableHtml(source.replace(' data-title="Model prices"', "")).slides[0].title, "Model prices");
});

test("foster-parented text ranges never replace structural markup that fragment parsing discards", () => {
  for (const middle of ["<tr></tr>", "<tr><td></td></tr>", "<!-- preserve -->"]) {
    const source = `<section class=slide id=x><h1>Safe</h1><table>before${middle}after</table></section>`;
    const info = inspectEditableHtml(source);
    assert.equal(info.fields.some((field) => field.text === "beforeafter"), false);
    assert.equal(patchEditableHtml(source, [change(info.fields[0], "Edited")]), source.replace(">Safe<", ">Edited<"));
  }
  const source = "<section class=slide id=x><p>Price < 20 &amp; size &lt;b&gt;</p></section>";
  const field = inspectEditableHtml(source).fields[0];
  assert.equal(field.text, "Price < 20 & size <b>");
  assert.equal(patchEditableHtml(source, [change(field, "Price < 30 & <b>")]),
    "<section class=slide id=x><p>Price &lt; 30 &amp; &lt;b&gt;</p></section>");
});

test("slide and field identifiers must be unique and slide contexts unambiguous", () => {
  for (const source of [
    '<section class=slide id=x></section><section class=slide id=x></section>',
    '<section class=slide id=a data-slide-id=x></section><section class=slide id=b data-slide-id=x></section>',
    '<div id=x></div><section class=slide id=x><h1>Title</h1></section>',
  ]) assert.throws(() => inspectEditableHtml(source), error("duplicate-slide-id"));
  for (const source of [
    '<section class=slide id=x><h1 data-edit-id=a>One</h1><p data-edit-id=a>Two</p></section>',
    '<section class=slide id=x><h1>One</h1><p data-edit-id="field:x:0">Two</p></section>',
    '<section class=slide id=x><h1>One</h1><a data-edit-id="field:x:0">Locked</a></section>',
  ]) assert.throws(() => inspectEditableHtml(source), error("duplicate-field-id"));
  assert.throws(() => inspectEditableHtml('<section class=slide><h1>Missing ID</h1></section>'), error("invalid-id"));
  assert.throws(() => inspectEditableHtml('<section class=slide id=x><section class=slide id=y></section></section>'),
    error("invalid-slide-context"));
  assert.throws(() => inspectEditableHtml('<h1 class=slide id=x>Not a container</h1>'), error("invalid-slide-context"));
});

test("all request changes are validated atomically, including text limits and surrogate/control rejection", () => {
  const { fields } = inspectEditableHtml(fixture);
  for (const text of ["", " \t ", "x".repeat(5001), "line\nbreak", "line\rbreak", "tab\there", "nul\0", "\u007f", "\u0085", "\u2028", "\ud800", "\udc00"]) {
    assert.throws(() => patchEditableHtml(fixture, [change(fields[0], "Valid"), change(fields[1], text)]), error("invalid-text"));
  }
  assert.equal(inspectEditableHtml(patchEditableHtml(fixture, [change(fields[0], "😀".repeat(2500))])).fields[0].text.length, 5000);
  assert.throws(() => patchEditableHtml(fixture, [change(fields[0], "One"), change(fields[0], "Two")]), error("duplicate-change"));
  assert.throws(() => patchEditableHtml(fixture, [{ ...change(fields[0], "New"), oldText: "Stale" }]), error("text-conflict", 409));
  assert.throws(() => patchEditableHtml(fixture, [{ id: "missing", oldText: "X", text: "Y" }]), error("unknown-field", 422));
  for (const changes of [null, {}, Array(101).fill(change(fields[0], "New")), [{ id: 1, oldText: "A", text: "B" }],
    [{ ...change(fields[0], "New"), html: "<b>no</b>" }]]) {
    assert.throws(() => patchEditableHtml(fixture, changes), error("invalid-changes"));
  }
});

test("zero eligible fields explains unsupported edits but permits a byte-identical empty no-op", async (context) => {
  const source = "<section class=slide id=x><iframe src=calculator.html></iframe></section>";
  const info = inspectEditableHtml(source);
  assert.equal(info.eligibleCount, 0);
  assert.equal(info.status, "no-editable-fields");
  assert.match(info.reviewHint, /No source-backed/);
  assert.throws(() => patchEditableHtml(source, [{ id: "unknown", oldText: "", text: "New" }]), error("no-editable-fields", 422));
  const { coordinator } = await setup(context, source);
  const state = await coordinator.read();
  const noop = await coordinator.save({ revision: state.revision, changes: [] });
  assert.equal(noop.revision, state.revision);
  assert.equal(noop.html, source);
  assert.equal(noop.status, "no-editable-fields");
  assert.deepEqual(await coordinator.history(), []);
  await assert.rejects(coordinator.save({
    revision: state.revision, changes: [{ id: "unknown", oldText: "", text: "New" }],
  }), error("no-editable-fields", 422));
});

test("3.5MB embedded calculator payload and 43-slide synthetic import remain byte-exact outside one heading", () => {
  const payload = `<script type=application/json id=calculator-data>{"data":"${"abc123_".repeat(500_000)}"}</script>`;
  const main = Array.from({ length: 8 }, (_, index) => `<section class=slide id=m${index}><h1>Main ${index}</h1>`
    + (index < 3 ? `<iframe src="calculator-${index}.html"></iframe>` : "<p>Plain paragraph</p>") + "</section>").join("");
  const support = Array.from({ length: 35 }, (_, index) => `<section class=slide id=s${index} data-section=supporting>`
    + `<h1>Support ${index}</h1><p>Supporting detail</p></section>`).join("");
  const source = main + payload + support;
  const info = inspectEditableHtml(source);
  assert.equal(info.slides.length, 43);
  assert.equal(info.fields.length, 83);
  const patched = patchEditableHtml(source, [change(info.fields[0], "Edited main")]);
  assert.equal(patched, source.replace("<h1>Main 0</h1>", "<h1>Edited main</h1>"));
  assert.ok(patched.includes(payload));
});

test("read gives a canonical byte snapshot; save persists private before/after logs and restart status", async (context) => {
  const original = Buffer.from(`\ufeff${fixture}`);
  const { coordinator, sourcePath, root } = await setup(context, original);
  const state = await coordinator.read();
  assert.equal(state.filename, "deck.html");
  assert.equal(state.revision, sha256(original));
  assert.deepEqual(state.buffer, original);
  assert.equal(state.html, original.toString("utf8"));
  assert.equal(JSON.parse(JSON.stringify(state)).html, undefined);
  assert.equal(JSON.parse(JSON.stringify(state)).buffer, undefined);
  const edits = [change(state.fields[0], "Saved 😀")];
  const saved = await coordinator.save({ revision: state.revision, changes: edits });
  const actual = await fs.readFile(sourcePath);
  assert.equal(saved.revision, sha256(actual));
  assert.equal(saved.status, "needs-review");
  assert.equal(saved.lastSave.needsReview, true);
  assert.equal(saved.lastSave.status, "committed");
  assert.equal(saved.lastSave.matchesCurrentRevision, true);
  assert.equal(saved.lastSave.changes, undefined);
  assert.equal(saved.lastSave.temporaryFilename, undefined);
  assert.match(saved.reviewHint, /Outline, manifest, sources and evidence have not been updated/);
  assert.deepEqual(saved.buffer, actual);
  const records = await coordinator.history();
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].changes, edits);
  assert.equal(records[0].baseRevision, state.revision);
  const directory = await historyDir(root);
  assert.deepEqual(await fs.readdir(directory), [records[0].id]);
  const transaction = join(directory, records[0].id);
  assert.deepEqual(await fs.readFile(join(transaction, "before.html")), original);
  assert.deepEqual(await fs.readFile(join(transaction, "after.html")), actual);
  const restarted = await openEditableSource(sourcePath);
  assert.equal((await restarted.read()).lastSave.revision, saved.revision);
  const noop = await restarted.save({ revision: saved.revision, changes: [change(saved.fields[0], saved.fields[0].text)] });
  assert.equal(noop.revision, saved.revision);
  assert.equal((await restarted.history()).length, 1);
});

test("no-op save writes neither source nor history records and preserves POSIX source mode", async (context) => {
  const { coordinator, sourcePath } = await setup(context);
  if (process.platform !== "win32") await fs.chmod(sourcePath, 0o640);
  const initialStat = await fs.stat(sourcePath);
  const state = await coordinator.read();
  await coordinator.save({ revision: state.revision, changes: [] });
  assert.equal((await fs.stat(sourcePath)).mtimeMs, initialStat.mtimeMs);
  assert.equal(await fs.readFile(sourcePath, "utf8"), fixture);
  assert.deepEqual(await coordinator.history(), []);
  await coordinator.save({ revision: state.revision, changes: [change(state.fields[0], "Changed")] });
  if (process.platform !== "win32") assert.equal((await fs.stat(sourcePath)).mode & 0o777, 0o640);
});

test("stale revisions and two coordinators serialize without lost updates; queued requests are copied", async (context) => {
  const { coordinator, sourcePath } = await setup(context);
  const other = await openEditableSource(sourcePath);
  const state = await coordinator.read();
  const request = { revision: state.revision, changes: [change(state.fields[0], "First writer")] };
  const first = coordinator.save(request);
  request.changes[0].text = "Mutated after enqueue";
  const second = other.save({ revision: state.revision, changes: [change(state.fields[0], "Second writer")] });
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.code, "revision-conflict");
  assert.equal(results[1].reason.status, 409);
  assert.equal((await other.read()).fields[0].text, "First writer");
  assert.equal((await coordinator.history()).length, 1);
  await fs.appendFile(sourcePath, "<!-- external -->");
  await assert.rejects(coordinator.save({
    revision: results[0].value.revision, changes: [change(results[0].value.fields[0], "Overwrite")],
  }), error("revision-conflict", 409));
  assert.match(await fs.readFile(sourcePath, "utf8"), /<!-- external -->$/);
});

test("a lock held by another process is never bypassed, even with an ancient timestamp", async (context) => {
  const { root, coordinator } = await setup(context);
  const state = await coordinator.read();
  await coordinator.save({ revision: state.revision, changes: [] });
  const lock = join(await historyDir(root), "lock");
  const script = 'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], '
    + 'JSON.stringify({pid:process.pid,at:"1970-01-01"}), {flag:"wx"});';
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, ["-e", script, lock], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? accept() : reject(new Error(stderr)));
  });
  await assert.rejects(coordinator.save({ revision: state.revision, changes: [change(state.fields[0], "Blocked")] }),
    error("source-locked", 423));
  assert.match(await fs.readFile(lock, "utf8"), /1970/);
});

test("rename failure retains original and draft, reports failure and blocks subsequent saves for recovery", async (context) => {
  const { root, coordinator, sourcePath } = await setup(context);
  const state = await coordinator.read();
  const originalRename = fs.rename;
  context.mock.method(fs, "rename", async (from, to) => {
    if (basename(to) === basename(sourcePath)) throw Object.assign(new Error("Synthetic rename denied"), { code: "EACCES" });
    return originalRename(from, to);
  });
  await assert.rejects(coordinator.save({ revision: state.revision, changes: [change(state.fields[0], "Retained draft")] }),
    error("save-failed", 500));
  assert.equal(await fs.readFile(sourcePath, "utf8"), fixture);
  const records = await coordinator.history();
  assert.equal(records[0].status, "prepared");
  const directory = join(await historyDir(root), records[0].id);
  assert.equal(await fs.readFile(join(directory, "before.html"), "utf8"), fixture);
  assert.match(await fs.readFile(join(directory, "after.html"), "utf8"), /Retained draft/);
  assert.match(await fs.readFile(join(root, records[0].temporaryFilename), "utf8"), /Retained draft/);
  const restarted = await openEditableSource(sourcePath);
  assert.equal((await restarted.read()).status, "recovery-required");
  await assert.rejects(restarted.save({ revision: state.revision, changes: [] }), error("recovery-required", 409));
});

test("commit-metadata failure never reports saved; restart shows the new source and prepared recovery record", async (context) => {
  const { coordinator, sourcePath } = await setup(context);
  const state = await coordinator.read();
  const originalOpen = fs.open;
  context.mock.method(fs, "open", async (path, ...args) => {
    if (basename(path) === "committed.json" && args[0] === "wx") {
      throw Object.assign(new Error("Synthetic metadata disk failure"), { code: "ENOSPC" });
    }
    return originalOpen(path, ...args);
  });
  await assert.rejects(coordinator.save({ revision: state.revision, changes: [change(state.fields[0], "Unacknowledged draft")] }),
    (failure) => {
      error("save-failed", 500)(failure);
      assert.equal(failure.sourceMayHaveChanged, true);
      return true;
    });
  assert.match(await fs.readFile(sourcePath, "utf8"), /Unacknowledged draft/);
  const restarted = await openEditableSource(sourcePath);
  const fresh = await restarted.read();
  assert.equal(fresh.fields[0].text, "Unacknowledged draft");
  assert.equal(fresh.status, "recovery-required");
  assert.equal(fresh.lastSave.status, "prepared");
  assert.equal(fresh.lastSave.matchesCurrentRevision, true);
});

test("external change during preparation is detected by the immediate pre-replacement recheck", async (context) => {
  const { coordinator, sourcePath } = await setup(context);
  const state = await coordinator.read();
  const originalOpen = fs.open;
  context.mock.method(fs, "open", async (path, ...args) => {
    if (basename(path) === "prepared.json" && args[0] === "wx") {
      await fs.writeFile(sourcePath, fixture + "<!-- changed during prepare -->");
    }
    return originalOpen(path, ...args);
  });
  await assert.rejects(coordinator.save({ revision: state.revision, changes: [change(state.fields[0], "Do not overwrite")] }),
    error("revision-conflict", 409));
  assert.equal(await fs.readFile(sourcePath, "utf8"), fixture + "<!-- changed during prepare -->");
  assert.equal((await coordinator.history())[0].status, "prepared");
});

test("readback detects an uncooperative post-rename writer without rolling back over it", async (context) => {
  const { coordinator, sourcePath } = await setup(context);
  const state = await coordinator.read();
  const originalRename = fs.rename;
  context.mock.method(fs, "rename", async (from, to) => {
    await originalRename(from, to);
    if (basename(to) === basename(sourcePath)) await fs.writeFile(sourcePath, fixture + "<!-- post-rename writer -->");
  });
  await assert.rejects(coordinator.save({ revision: state.revision, changes: [change(state.fields[0], "Draft")] }),
    error("save-raced", 409));
  assert.equal(await fs.readFile(sourcePath, "utf8"), fixture + "<!-- post-rename writer -->");
  assert.equal((await coordinator.read()).status, "recovery-required");
});

test("path/type/encoding/request validation rejects unsafe inputs without modifying the source", async (context) => {
  const { coordinator, sourcePath, root } = await setup(context);
  for (const request of [null, {}, { html: fixture }, { revision: "bad", changes: [] },
    { revision: sha256(fixture), changes: [], sourcePath: join(root, "other.html") }]) {
    await assert.rejects(coordinator.save(request), error("invalid-request", 400));
  }
  await assert.rejects(openEditableSource(join(root, "deck.htm")), error("invalid-source-path", 400));
  const nonUtf8 = join(root, "latin.html");
  await fs.writeFile(nonUtf8, Buffer.from([0xff, 0xfe, 0x3c, 0x00]));
  await assert.rejects(openEditableSource(nonUtf8), error("unsupported-encoding", 422));
  for (const subdir of ["_renders", ".nice-deck-edit", join("output", "a123456789ab", "site")]) {
    const directory = join(root, subdir);
    await fs.mkdir(directory, { recursive: true });
    const path = join(directory, "deck.html");
    await fs.writeFile(path, fixture);
    await assert.rejects(openEditableSource(path), error("generated-source", 400));
  }
  const directorySource = join(root, "directory.html");
  await fs.mkdir(directorySource);
  await assert.rejects(openEditableSource(directorySource), error("unsafe-path"));
  assert.equal(await fs.readFile(sourcePath, "utf8"), fixture);
});

test("linked source ancestors and linked history directories are rejected (junctions on Windows)", async (context) => {
  const { root, coordinator, sourcePath } = await setup(context);
  const outside = await fs.mkdtemp(join(tmpdir(), "nice-deck-source-link-test-"));
  context.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(join(outside, "deck.html"), fixture);
  const type = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(outside, join(root, "linked"), type);
  await assert.rejects(openEditableSource(join(root, "linked", "deck.html")), error("unsafe-path"));
  await fs.symlink(outside, join(root, ".nice-deck-edit"), type);
  await assert.rejects(coordinator.read(), error("unsafe-path"));
  await assert.rejects(coordinator.save({ revision: sha256(fixture), changes: [] }), error("unsafe-path"));
  assert.equal(await fs.readFile(sourcePath, "utf8"), fixture);
  assert.deepEqual(await fs.readdir(outside), ["deck.html"]);
});

test("direct source symlinks are rejected where the OS permits creating one", async (context) => {
  const { root, sourcePath } = await setup(context);
  const link = join(root, "source-link.html");
  try { await fs.symlink(sourcePath, link, "file"); } catch (failure) {
    if (["EPERM", "EACCES"].includes(failure.code)) return context.skip("OS account cannot create file symlinks");
    throw failure;
  }
  await assert.rejects(openEditableSource(link), error("unsafe-path"));
});
