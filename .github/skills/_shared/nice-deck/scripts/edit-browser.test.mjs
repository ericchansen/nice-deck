import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const toolkit = dirname(dirname(fileURLToPath(import.meta.url)));
let browser;
test.before(async () => {
  browser = await chromium.launch({ channel: process.env.NICE_DECK_BROWSER_CHANNEL || "msedge" });
});
test.after(async () => { await browser?.close(); });

test("runtime leaves editable text, controls, shortcuts, and composition in charge of their own keys", async () => {
  const page = await browser.newPage();
  try {
    const runtime = await readFile(join(toolkit, "runtime", "deck.js"), "utf8");
    await page.setContent(`<!doctype html><html data-deck-width="800" data-deck-height="450">
      <section class="slide" id="first"><h1 contenteditable="plaintext-only">Title</h1>
      <input aria-label="Value" value="abc"><button type="button" onclick="this.textContent='Clicked'">Action</button></section>
      <section class="slide" id="second"><h1>Second</h1></section></html>`);
    await page.addScriptTag({ content: runtime });
    await page.locator("h1").first().focus();
    await page.keyboard.press("End");
    await page.keyboard.type(" with a space");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.evaluate(() => window.__niceDeck.current()), 0);
    assert.equal(await page.locator("h1").first().textContent(), "Title with a space");
    await page.getByRole("textbox", { name: "Value" }).focus();
    await page.keyboard.press("End");
    assert.equal(await page.evaluate(() => window.__niceDeck.current()), 0);
    await page.getByRole("button", { name: "Action" }).focus();
    await page.keyboard.press("Space");
    assert.equal(await page.getByRole("button").textContent(), "Clicked");
    assert.equal(await page.evaluate(() => window.__niceDeck.current()), 0);
    await page.evaluate(() => {
      document.activeElement.blur();
      dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", isComposing: true, bubbles: true }));
      dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, bubbles: true }));
    });
    assert.equal(await page.evaluate(() => window.__niceDeck.current()), 0);
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => window.__niceDeck.current()), 1);
  } finally {
    await page.close();
  }
});

async function editorFixture(context, { legacy = false, crlf = false, application = false } = {}) {
  const { startEditorServer } = await import("./edit.mjs");
  const root = await mkdtemp(join(tmpdir(), "nice-deck-editor-browser-"));
  let runtime = await readFile(join(toolkit, "runtime", "deck.js"), "utf8");
  if (legacy) {
    runtime = runtime.replace(/    const ownsKeyboard =[\s\S]*?event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey\) return;\n/, "");
  }
  let html = `<!doctype html><html data-deck-width="1000" data-deck-height="562">
  <meta charset="utf-8"><title>Editable deck fixture</title><style>
  body{font-family:Arial;background:#101418;color:#fff}.slide{padding:48px;box-sizing:border-box;overflow:hidden}
  h1{font-size:36px;margin:0 0 12px}p{font-size:20px;margin:8px 0}a{color:#9ac6ff}input,button{font-size:20px}
  table{font-size:18px;border-collapse:collapse;margin:12px 0}td,th{padding:4px 12px}.model-tier{display:block;font-size:14px}</style>
  <section class="slide" id="first" data-title="First title"><header><h1>First title</h1></header>
  <p>A short sentence.</p><p class="scope">Unit metadata</p><p>Keep <strong>rich markup</strong> intact.</p>
  <span data-editable="true" data-edit-id="caption">Short caption</span>
  <table><tr><th>Model</th><th>Input</th><th>Status</th></tr>
  <tr><td class="model-name">Model A<span class="model-tier">Short context</span></td>
  <td class="price-cell">$10</td><td class="shared-status" rowspan="2">All models:<br>Unverified</td></tr>
  <tr><td>Model B</td><td>$20</td></tr></table>
  <a href="#second">Evidence</a><svg width="100" height="40"><text y="25" fill="white">Exact SVG</text></svg>
  <input aria-label="Calculator input" type="number" value="5"><button type="button" onclick="this.textContent='Calculated'">Calculate</button></section>
  <section class="slide" id="second"><h1>Second title</h1><p>Another sentence.</p></section>
  <section class="slide" id="support" data-section="supporting"><h1>Protected supporting text</h1></section>
  <script>${runtime}</script><script>window.payload = "First title";</script></html>`;
  if (application) html = html.replace('<p>A short sentence.</p>',
    '<div id="application-row"><p>A</p><iframe id="app" srcdoc="&lt;input value=&quot;initial&quot;&gt;"></iframe><p>B</p></div>');
  if (crlf) html = html.replace(/\r?\n/g, "\r\n");
  const sourcePath = join(root, "deck.html");
  await writeFile(sourcePath, html);
  const editor = await startEditorServer({
    sourcePath,
    preview: async () => ({ ok: true, review: { status: "missing" } }),
  });
  context.after(async () => {
    await editor.close();
    await rm(root, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  context.after(() => page.close());
  return { root, sourcePath, html, editor, page };
}

async function openEditor(page, editor) {
  await page.goto(editor.url);
  await page.waitForFunction(() => !document.getElementById("edit-mode").disabled);
  await assertNoTextPanel(page);
  return page.frameLocator("#deck-frame");
}

async function assertNoTextPanel(page) {
  assert.equal(await page.locator("#text-tools, #field-select, #field-text, #field-help, #field-error, #layout-hint").count(), 0);
  assert.equal(await page.getByText("Edit selected text", { exact: true }).count(), 0);
}

async function saveChanges(page) {
  const response = page.waitForResponse((value) => value.url().endsWith("/api/save"));
  await page.locator("#save").click();
  const saved = await response;
  assert.equal(saved.status(), 200, await saved.text());
  await page.waitForFunction(() => !document.getElementById("save-status").textContent.includes("Saving"));
}

async function fillSelectedText(page, text) {
  await page.frameLocator("#deck-frame")
    .locator('[data-nice-deck-edit-selected][contenteditable="plaintext-only"]').fill(text);
}

test("legacy slide text edits, history, broad defaults and repeat frame loads preserve the source design", async (context) => {
  const { page, editor, sourcePath, html } = await editorFixture(context, { legacy: true });
  const deck = await openEditor(page, editor);
  const heading = deck.locator("#first h1");
  assert.equal(await heading.getAttribute("contenteditable"), "plaintext-only");
  assert.equal(await deck.locator("#caption").count(), 0);
  assert.equal(await deck.locator('[data-edit-id="caption"]').getAttribute("contenteditable"), "plaintext-only");
  for (const selector of ["p.scope", "strong", "a", "#support h1", ".price-cell", ".model-tier"]) {
    assert.equal(await deck.locator(selector).first().getAttribute("contenteditable"), "plaintext-only", selector);
  }
  for (const selector of ["p:has(strong)", "svg text", ".model-name", ".shared-status", "input", "button"]) {
    assert.equal(await deck.locator(selector).first().getAttribute("contenteditable"), null, selector);
  }
  await page.evaluate(() => document.getElementById("deck-frame").dispatchEvent(new Event("load")));
  assert.equal(await page.locator("#error-panel").isVisible(), false);
  await heading.focus();
  await page.keyboard.press("End");
  await page.keyboard.type(" refined");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("PageDown");
  assert.equal(await heading.textContent(), "First title refined");
  assert.equal(await heading.evaluate(() => window.__niceDeck.current()), 0);
  await page.keyboard.press("Control+z");
  assert.equal(await heading.textContent(), "First title");
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await heading.textContent(), "First title refined");
  await page.locator("#undo").click();
  assert.equal(await heading.textContent(), "First title");
  assert.equal(await readFile(sourcePath, "utf8"), html);

  await fillSelectedText(page, "A saved title");
  await saveChanges(page);
  const disk = await readFile(sourcePath, "utf8");
  assert.equal(disk, html.replace('data-title="First title"', 'data-title="A saved title"')
    .replace("<h1>First title</h1>", "<h1>A saved title</h1>"));
  assert.equal(await deck.locator("#first").getAttribute("data-title"), "A saved title");
  assert.equal(await page.locator("#slide-select option").first().textContent(), "01  A saved title · main");
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("edit-mode").disabled);
  assert.equal(await deck.locator("#first h1").textContent(), "A saved title");
  await page.locator("#read-mode").click();
  assert.equal(await deck.locator("#first h1").getAttribute("contenteditable"), null);
  assert.equal(await deck.locator("#first h1").getAttribute("role"), null);
  await deck.locator("button").first().click();
  assert.equal(await deck.locator("button").first().textContent(), "Calculated");
  await deck.locator("#first h1").click();
  await page.keyboard.press("ArrowRight");
  assert.equal(await deck.locator("#second").evaluate((node) => !node.hidden), true);
});

async function clickTextNode(locator, index) {
  const position = await locator.evaluate((node, childIndex) => {
    const range = node.ownerDocument.createRange();
    range.selectNodeContents(node.childNodes[childIndex]);
    const text = range.getBoundingClientRect();
    const element = node.getBoundingClientRect();
    return { x: text.left - element.left + text.width / 2, y: text.top - element.top + text.height / 2 };
  }, index);
  await locator.click({ position });
}

test("inline prices, labels and supporting text save while mixed fragments and SVG stay source-only", async (context) => {
  const { page, editor, sourcePath, html } = await editorFixture(context);
  const deck = await openEditor(page, editor);
  assert.match(await page.locator("#slide-source").inputValue(), /<h1>First title<\/h1>/);
  await deck.locator(".price-cell").fill("$12");
  const richMarkup = await deck.locator("p:has(strong)").innerHTML();
  await clickTextNode(deck.locator("p:has(strong)"), 0);
  assert.equal(await deck.locator("p:has(strong)").getAttribute("contenteditable"), null);
  assert.equal(await deck.locator("p:has(strong)").innerHTML(), richMarkup);
  assert.equal(await deck.locator(".price-cell").getAttribute("data-nice-deck-edit-selected"), "");
  await assertNoTextPanel(page);
  await clickTextNode(deck.locator(".model-name"), 0);
  assert.equal(await deck.locator(".model-name").getAttribute("contenteditable"), null);
  assert.equal(await deck.locator(".price-cell").getAttribute("data-nice-deck-edit-selected"), "");
  await assertNoTextPanel(page);
  assert.equal(await deck.locator(".model-tier").textContent(), "Short context");
  await deck.locator(".model-tier").fill("Standard tier");
  await clickTextNode(deck.locator(".shared-status"), 2);
  assert.equal(await deck.locator(".shared-status").getAttribute("contenteditable"), null);
  assert.equal(await deck.locator(".model-tier").getAttribute("data-nice-deck-edit-selected"), "");
  assert.equal(await deck.locator(".shared-status").innerHTML(), "All models:<br>Unverified");
  await assertNoTextPanel(page);
  assert.equal(await deck.locator(".shared-status br").count(), 1);
  await deck.locator("p.scope").fill("Published USD prices");
  await deck.locator("#first a").click();
  assert.equal(await deck.locator("#first a").evaluate(() => window.__niceDeck.current()), 0);
  await deck.locator("#first a").fill("Published evidence");
  assert.equal(await deck.locator("#first a").getAttribute("href"), "#second");
  await deck.locator("svg text").click();
  assert.equal(await deck.locator("svg text").getAttribute("contenteditable"), null);
  assert.equal(await deck.locator("svg text").textContent(), "Exact SVG");
  for (const selector of ["p:has(strong)", ".model-name", ".shared-status", "svg text"]) {
    assert.equal(await deck.locator(selector).getAttribute("role"), null);
    assert.equal(await deck.locator(selector).getAttribute("tabindex"), null);
    assert.equal(await deck.locator(selector).getAttribute("data-nice-deck-edit-field"), null);
  }
  assert.equal(await deck.locator("#first a").getAttribute("data-nice-deck-edit-selected"), "");
  await assertNoTextPanel(page);
  await page.locator("#slide-select").selectOption("2");
  await deck.locator("#support h1").fill("Supporting detail");
  await saveChanges(page);
  const expected = html.replace('<td class="price-cell">$10</td>', '<td class="price-cell">$12</td>')
    .replace('Model A<span class="model-tier">Short context</span>', 'Model A<span class="model-tier">Standard tier</span>')
    .replace("Unit metadata", "Published USD prices").replace(">Evidence</a>", ">Published evidence</a>")
    .replace("Protected supporting text", "Supporting detail");
  assert.equal(await readFile(sourcePath, "utf8"), expected);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("edit-mode").disabled);
  assert.equal(await deck.locator(".model-name").textContent(), "Model AStandard tier");
  await page.locator("#read-mode").click();
  assert.equal(await deck.locator("[data-nice-deck-edit-field]").count(), 0);
  assert.equal(await deck.locator(".shared-status").getAttribute("rowspan"), "2");
  await deck.locator("#first a").click();
  await page.waitForFunction(() => document.getElementById("deck-frame").contentWindow.__niceDeck.current() === 1);
  assert.equal(await readFile(sourcePath, "utf8"), expected);
});

test("paste stays plain and one-field-only; long text announces a layout warning", async (context) => {
  const { page, editor, sourcePath } = await editorFixture(context);
  const deck = await openEditor(page, editor);
  const heading = deck.locator("#first h1");
  await heading.focus();
  await page.keyboard.press("Control+a");
  await heading.evaluate((node) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Plain\ntext <strong>only</strong>");
    clipboardData.setData("text/html", "<strong>Do not insert markup</strong>");
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  assert.equal(await heading.textContent(), "Plain text <strong>only</strong>");
  assert.equal(await heading.locator("strong").count(), 0);
  await saveChanges(page);
  assert.match(await readFile(sourcePath, "utf8"), /Plain text &lt;strong&gt;only&lt;\/strong&gt;/);
  await fillSelectedText(page, "Long heading ".repeat(120));
  await page.waitForFunction(() => /overflow|fit|layout/i.test(document.getElementById("announcement").textContent));
  assert.equal(await page.locator("#announcement").getAttribute("aria-live"), "polite");
  await fillSelectedText(page, "");
  assert.equal(await page.locator("#save").isDisabled(), true);
  await page.waitForFunction(() => /nonempty/.test(document.getElementById("announcement").textContent));
  await page.locator("#undo").click();
  assert.equal(await page.locator("#save").isDisabled(), true);
});

test("typing after a pending save survives its response without losing calculator state", async (context) => {
  const { page, editor, sourcePath } = await editorFixture(context);
  const deck = await openEditor(page, editor);
  await deck.getByLabel("Calculator input").fill("42");
  await deck.locator("#first h1").fill("First submitted title");
  let release;
  const gate = new Promise((accept) => { release = accept; });
  await page.route("**/api/save", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.locator("#save").click();
  await page.waitForFunction(() => document.getElementById("save-status").textContent.includes("Saving"));
  await fillSelectedText(page, "Newer unsaved title");
  release();
  await page.waitForFunction(() => !document.getElementById("save-status").textContent.includes("Saving"));
  assert.equal(await deck.locator("#first h1").textContent(), "Newer unsaved title");
  assert.equal(await deck.getByLabel("Calculator input").inputValue(), "42");
  assert.match(await readFile(sourcePath, "utf8"), /<h1>First submitted title<\/h1>/);
  assert.equal(await page.locator("#save").isEnabled(), true);
  await page.unroute("**/api/save");
  await saveChanges(page);
  assert.match(await readFile(sourcePath, "utf8"), /<h1>Newer unsaved title<\/h1>/);
});

test("two tabs retain the losing draft on conflict and export a credential-free recovery file", async (context) => {
  const { page, editor, sourcePath } = await editorFixture(context);
  const second = await browser.newPage();
  context.after(() => second.close());
  await openEditor(page, editor);
  await openEditor(second, editor);
  await fillSelectedText(page, "First tab wins");
  await saveChanges(page);
  await fillSelectedText(second, "Keep second tab draft");
  const response = second.waitForResponse((value) => value.url().endsWith("/api/save"));
  await second.locator("#save").click();
  assert.equal((await response).status(), 409);
  await second.locator("#conflict-panel").waitFor({ state: "visible" });
  assert.equal(await second.frameLocator("#deck-frame").locator("#first h1").textContent(), "Keep second tab draft");
  assert.match(await readFile(sourcePath, "utf8"), /<h1>First tab wins<\/h1>/);
  const downloadEvent = second.waitForEvent("download");
  await second.locator("#conflict-download").click();
  const download = await downloadEvent;
  const recovery = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(recovery.changes[0].text, "Keep second tab draft");
  assert.equal(recovery.filename, "deck.html");
  const key = new URLSearchParams(new URL(editor.url).hash.slice(1)).get("key");
  assert.equal(JSON.stringify(recovery).includes(key), false);
  second.once("dialog", (dialog) => dialog.accept());
  await second.locator("#reload-disk").click();
  await second.waitForFunction(() => !document.getElementById("edit-mode").disabled);
  assert.equal(await second.frameLocator("#deck-frame").locator("#first h1").textContent(), "First tab wins");
});

test("composition is one undo transaction and defers save until the final input", async (context) => {
  const { page, editor, sourcePath, html } = await editorFixture(context, { legacy: true });
  const deck = await openEditor(page, editor);
  const heading = deck.locator("#first h1");
  await heading.focus();
  await page.keyboard.press("End");
  const protocol = await page.context().newCDPSession(page);
  await protocol.send("Input.imeSetComposition", { text: "text", selectionStart: 0, selectionEnd: 4 });
  assert.equal(await readFile(sourcePath, "utf8"), html);
  await protocol.send("Input.insertText", { text: "text" });
  await page.waitForFunction(() => document.getElementById("save-status").textContent.includes("unsaved"));
  assert.equal(await heading.textContent(), "First titletext");
  await page.keyboard.press("Control+z");
  assert.equal(await heading.textContent(), "First title");
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await heading.textContent(), "First titletext");
  await saveChanges(page);
  assert.match(await readFile(sourcePath, "utf8"), /<h1>First titletext<\/h1>/);
  await heading.focus();
  await page.keyboard.press("End");
  await protocol.send("Input.imeSetComposition", { text: " final", selectionStart: 0, selectionEnd: 6 });
  await heading.evaluate((node) => node.dispatchEvent(new KeyboardEvent("keydown", {
    key: "s", ctrlKey: true, isComposing: true, bubbles: true, cancelable: true,
  })));
  assert.match(await readFile(sourcePath, "utf8"), /<h1>First titletext<\/h1>/);
  const saved = page.waitForResponse((value) => value.url().endsWith("/api/save"));
  await protocol.send("Input.insertText", { text: " final" });
  assert.equal((await saved).status(), 200);
  assert.match(await readFile(sourcePath, "utf8"), /<h1>First titletext final<\/h1>/);
});

test("narrow editor keeps content and actual source side by side without page overflow", async (context) => {
  const { page, editor } = await editorFixture(context);
  await page.setViewportSize({ width: 620, height: 950 });
  const deck = await openEditor(page, editor);
  assert.equal(await page.locator("#slide-source").isVisible(), true);
  await assertNoTextPanel(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await fillSelectedText(page, "Compact view wording");
  assert.equal(await deck.locator("#first h1").textContent(), "Compact view wording");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const width of [390, 620, 900]) {
    await page.setViewportSize({ width, height: 950 });
    const content = await page.locator(".stage-panel").boundingBox();
    const source = await page.locator(".source-panel").boundingBox();
    assert.ok(content.width >= width * .4);
    assert.ok(source.width >= width * .35);
    assert.ok(source.x >= content.x + content.width - 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
});

test("three regions show authored slide HTML, navigate together and synchronize bounded edits and history", async (context) => {
  const { page, editor, html, sourcePath } = await editorFixture(context);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const deck = await openEditor(page, editor);
  const source = page.getByRole("textbox", { name: "Slide 1 HTML source" });
  assert.equal(await page.locator("[data-primary-region]").count(), 3);
  assert.equal(await page.locator(".app-header, .review-bar, #inspector, #field-list").count(), 0);
  assert.equal(await page.locator("#settings").evaluate((node) => node.open), false);
  await assertNoTextPanel(page);
  const first = html.slice(html.indexOf('<section class="slide"'), html.indexOf("</section>") + 10);
  assert.equal(await source.inputValue(), first);
  assert.equal(await source.getAttribute("readonly"), null);
  assert.ok(!(await source.inputValue()).includes("contenteditable"));

  const screenshotDir = process.env.NICE_DECK_EDITOR_SCREENSHOTS;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, "editor-desktop.png"), fullPage: true });
  }
  // Selecting source does not select an inline field or open another editor.
  await source.focus();
  await source.evaluate((node) => {
    const start = node.value.indexOf("Model A");
    node.setSelectionRange(start, start + "Model A".length);
    node.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
  });

  await assertNoTextPanel(page);
  assert.equal(await source.inputValue(), first);
  assert.equal(await page.locator("#save").isDisabled(), true);
  assert.equal(await deck.locator("#first h1").getAttribute("data-nice-deck-edit-selected"), "");
  assert.equal(await deck.locator(".model-name").textContent(), "Model AShort context");
  await deck.locator(".model-tier").fill("Standard <C> & D");
  assert.match(await source.inputValue(), /Model A<span class="model-tier">Standard &lt;C&gt; &amp; D<\/span>/);
  if (screenshotDir) {
    await page.screenshot({ path: join(screenshotDir, "editor-source-text-edit.png"), fullPage: true });
  }
  await page.locator("#undo").click();
  assert.equal(await source.inputValue(), first);
  await page.locator("#redo").click();
  assert.match(await source.inputValue(), /Standard &lt;C&gt; &amp; D/);
  await deck.locator("#first h1").fill("Draft title");
  assert.match(await source.inputValue(), /<h1>Draft title<\/h1>/);
  assert.match(await source.inputValue(), /data-title="First title"/, "Attributes reflect saved source until save.");
  await page.locator("#next-slide").click();
  assert.equal(await page.locator("#slide-source").inputValue(), '<section class="slide" id="second"><h1>Second title</h1><p>Another sentence.</p></section>');
  await page.locator("#previous-slide").click();
  assert.match(await source.inputValue(), /<h1>Draft title<\/h1>/);
  await page.locator("#read-mode").click();
  await deck.locator("#first h1").click();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.getElementById("source-label").textContent.startsWith("Slide 2 "));
  await page.locator("#slide-select").selectOption("0");
  await deck.getByLabel("Calculator input").fill("37");
  await deck.locator("button").first().click();
  assert.equal(await deck.locator("button").first().textContent(), "Calculated");
  assert.match(await source.inputValue(), />Calculate<\/button>/, "Runtime mutations never become source.");
  assert.match(await source.inputValue(), /value="5"/);
  await saveChanges(page);
  const disk = await readFile(sourcePath, "utf8");
  assert.equal(await source.inputValue(), disk.slice(disk.indexOf('<section class="slide"'), disk.indexOf("</section>") + 10));
  assert.equal(await deck.getByLabel("Calculator input").inputValue(), "37");
  await page.locator("#settings summary").click();
  assert.equal(await page.locator("#open-saved").isVisible(), true);
  assert.equal(await page.locator("#download-draft").isEnabled(), true);
  const check = page.waitForResponse((response) => response.url().endsWith("/api/check") && response.request().method() === "POST");
  await page.locator("#check-slides").click();
  assert.equal((await check).status(), 202);
  await page.locator("#settings summary").click();
  await assertNoTextPanel(page);
  if (screenshotDir) {
    await page.setViewportSize({ width: 620, height: 950 });
    await page.screenshot({ path: join(screenshotDir, "editor-narrow.png"), fullPage: true });
  }
  assert.deepEqual(errors, []);
});

test("source selections do not mutate bytes while inline saves retain authored CRLF", async (context) => {
  const { page, editor, html, sourcePath } = await editorFixture(context, { crlf: true });
  const deck = await openEditor(page, editor);
  const source = page.locator("#slide-source");
  const initialSource = await source.inputValue();
  await source.focus();
  await source.evaluate((node) => {
    const start = node.value.indexOf("Exact SVG");
    node.setSelectionRange(start, start + "Exact SVG".length);
    node.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
  });
  await assertNoTextPanel(page);
  assert.equal(await page.locator("#save").isDisabled(), true);
  assert.equal(await deck.locator("#first h1").getAttribute("data-nice-deck-edit-selected"), "");
  assert.equal(await source.inputValue(), initialSource);
  assert.match(await source.inputValue(), />Exact SVG<\/text>/);
  assert.equal(await deck.locator("svg text").textContent(), "Exact SVG");
  await deck.locator("#first h1").fill("Title & label");
  assert.match(await source.inputValue(), /<h1>Title &amp; label<\/h1>/);
  await saveChanges(page);
  const expected = html.replace('data-title="First title"', 'data-title="Title &amp; label"')
    .replace("<h1>First title</h1>", "<h1>Title &amp; label</h1>");
  assert.equal(await readFile(sourcePath, "utf8"), expected);
  // A tag selection alone does not mutate source or open another panel.
  const savedSource = await source.inputValue();
  await source.focus();
  await source.evaluate((node) => {
    node.setSelectionRange(0, 8);
    node.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
  });
  await assertNoTextPanel(page);
  assert.equal(await source.inputValue(), savedSource);
  assert.equal(await readFile(sourcePath, "utf8"), expected);
});

async function sourceSettled(page) {
  await page.waitForFunction(() => /Live HTML (draft|preview)|Last good preview/.test(document.getElementById("source-status").textContent) &&
    !/Validating|Saving/.test(document.getElementById("save-status").textContent));
}

test("source insertions and later edits retain middle iframe identity and browsing state", async (context) => {
  const { page, editor, sourcePath, html } = await editorFixture(context, { application: true });
  const deck = await openEditor(page, editor);
  const source = page.locator("#slide-source");
  const original = await source.inputValue();
  await deck.frameLocator("#app").locator("input").fill("retained state");
  await deck.locator("#app").evaluate((node) => {
    window.retainedApp = node;
    window.retainedAppDocument = node.contentDocument;
    node.contentWindow.runtimeState = 73;
  });
  const changed = original.replace("<p>A</p>", "<p>Inserted</p><p>A</p>").replace("<p>B</p>", "<p>Changed B</p>");
  for (const draft of [changed, original, changed]) {
    await source.fill(draft);
    await sourceSettled(page);
    assert.equal(await deck.locator("#app").evaluate((node) =>
      node === window.retainedApp && node.contentDocument === window.retainedAppDocument &&
      node.contentWindow.runtimeState === 73), true);
    assert.equal(await deck.frameLocator("#app").locator("input").inputValue(), "retained state");
    assert.deepEqual(await deck.locator("#application-row > p").allTextContents(),
      draft === original ? ["A", "B"] : ["Inserted", "A", "Changed B"]);
  }
  // A changed application must still become inert, not inherit the live frame.
  await source.fill(changed.replace('id="app"', 'id="app" onload="parent.draftRan=true"'));
  await sourceSettled(page);
  assert.equal(await deck.locator("#app").count(), 0);
  assert.equal(await deck.locator('[data-nice-deck-inactive="iframe"]').count(), 1);
  assert.equal(await deck.locator("#first").evaluate(() => window.draftRan), undefined);
  assert.equal(await readFile(sourcePath, "utf8"), html);
});

for (const saveKind of ["inline", "source"]) {
  for (const outcome of ["success", "failure", "conflict"]) {
    test(`${saveKind} save resumes debounced source validation after delayed ${outcome}`, async (context) => {
      const { page, editor, sourcePath, html } = await editorFixture(context);
      const deck = await openEditor(page, editor);
      const source = page.locator("#slide-source");
      if (saveKind === "inline") await deck.locator("#first h1").fill("Submitted title");
      else {
        await source.fill((await source.inputValue()).replace("First title</h1>", "Submitted title</h1>"));
        await sourceSettled(page);
      }
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      context.after(() => release());
      await page.route("**/api/save", async (route) => {
        const response = outcome === "success" ? await route.fetch() : null;
        await gate;
        if (response) await route.fulfill({ response });
        else await route.fulfill({
          status: outcome === "conflict" ? 409 : 500,
          contentType: "application/json",
          body: JSON.stringify({ error: `Test ${outcome}` }),
        });
      });
      await page.locator("#save").click();
      await page.waitForFunction(() => document.getElementById("save-status").textContent.includes("Saving"));
      const newer = (await source.inputValue()).replace("<h1>", '<h1 title="typed during save">');
      await source.fill(newer);
      // Deliberately consume the 250ms debounce while the save is blocked.
      await page.waitForTimeout(400);
      const winning = html.replace("Another sentence.", "External winner.");
      if (outcome === "conflict") await writeFile(sourcePath, winning);
      const validated = page.waitForResponse((response) => response.url().endsWith("/api/draft"));
      release();
      assert.equal((await validated).status(), outcome === "conflict" ? 409 : 200);
      await sourceSettled(page);
      assert.equal(await source.inputValue(), newer);
      assert.equal(await deck.locator("#first h1").getAttribute("title"), outcome === "conflict" ? null : "typed during save");
      if (outcome === "conflict") assert.match(await page.locator("#source-status").textContent(), /Last good preview retained/);
      assert.equal(await page.locator("#save").isEnabled(), outcome !== "conflict");
      if (outcome === "conflict") assert.equal(await page.locator("#conflict-panel").isVisible(), true);
      let expected = outcome === "conflict" ? winning : html;
      if (outcome === "success") {
        expected = expected.replace("<h1>First title</h1>", "<h1>Submitted title</h1>");
        if (saveKind === "inline") expected = expected.replace('data-title="First title"', 'data-title="Submitted title"');
      }
      assert.equal(await readFile(sourcePath, "utf8"), expected);
    });
  }
}

test("HTML markup and attributes preview before save, invalid drafts retain preview, history and cross-slide drafts persist", async (context) => {
  const { page, editor, sourcePath, html } = await editorFixture(context, { crlf: true });
  const deck = await openEditor(page, editor);
  const source = page.locator("#slide-source");
  const original = await source.inputValue();
  await deck.getByLabel("Calculator input").fill("73");
  await deck.locator("button").first().click();
  await deck.locator("#first").evaluate((node) => { window.retainedCalculator = node.querySelector("input"); });
  const changed = original.replace("<h1>First title</h1>", '<h1 style="color: rgb(255, 200, 0)" title="Live attribute">Live <em>source</em></h1>');
  await source.fill(changed);
  await source.evaluate((node) => node.setSelectionRange(24, 31));
  await sourceSettled(page);
  assert.equal(await deck.locator("#first h1 em").textContent(), "source");
  assert.equal(await deck.locator("#first h1").getAttribute("title"), "Live attribute");
  assert.equal(await deck.locator("#first h1").evaluate((node) => getComputedStyle(node).color), "rgb(255, 200, 0)");
  assert.deepEqual(await source.evaluate((node) => [node.selectionStart, node.selectionEnd]), [24, 31]);
  assert.equal(await readFile(sourcePath, "utf8"), html);
  assert.equal(await deck.getByLabel("Calculator input").inputValue(), "73");
  assert.equal(await deck.locator("button").first().textContent(), "Calculated");
  assert.equal(await deck.locator("input").evaluate((node) => node === window.retainedCalculator), true);
  const screenshotDir = process.env.NICE_DECK_EDITOR_SCREENSHOTS;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, "editor-live-source-markup.png"), fullPage: true });
    await page.setViewportSize({ width: 620, height: 950 });
    await page.screenshot({ path: join(screenshotDir, "editor-live-source-narrow.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await source.fill(changed.replace("</section>", ""));
  await sourceSettled(page);
  assert.equal(await page.locator("#save").isDisabled(), true);
  assert.equal(await deck.locator("#first h1 em").textContent(), "source");
  assert.equal(await readFile(sourcePath, "utf8"), html);
  await source.press("Control+z");
  await sourceSettled(page);
  assert.equal(await source.inputValue(), changed);
  await source.press("Control+z");
  await sourceSettled(page);
  assert.equal(await deck.locator("#first h1").textContent(), "First title");
  assert.equal(await page.locator("#save").isDisabled(), true);
  await source.press("Control+Shift+z");
  await sourceSettled(page);
  assert.equal(await deck.locator("#first h1 em").textContent(), "source");
  await page.locator("#next-slide").click();
  const second = await source.inputValue();
  await source.fill(second.replace("Second title", "Second draft"));
  await sourceSettled(page);
  await page.locator("#previous-slide").click();
  assert.equal(await source.inputValue(), changed);
  // Inline text on the newly parsed markup updates source, not a stale field offset.
  await deck.locator("#first h1 em").fill("inline too");
  await sourceSettled(page);
  assert.match(await source.inputValue(), /<em>inline too<\/em>/);
  await saveChanges(page);
  const disk = await readFile(sourcePath, "utf8");
  const rawFirst = html.slice(html.indexOf("<section"), html.indexOf("</section>") + 10);
  assert.equal(disk, html.replace(rawFirst, changed.replace("<em>source</em>", "<em>inline too</em>"))
    .replace("Second title", "Second draft"));
  assert.equal(await deck.locator("input").evaluate((node) => node === window.retainedCalculator), true);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("edit-mode").disabled);
  assert.equal(await deck.locator("#first h1 em").textContent(), "inline too");
});

test("source drafts suppress changed executable content, retain IME and typing through a save response", async (context) => {
  const { page, editor, sourcePath } = await editorFixture(context);
  const deck = await openEditor(page, editor);
  const source = page.locator("#slide-source");
  const original = await source.inputValue();
  await source.fill(original.replace("</section>", '<p id="added" onclick="parent.draftRan=true">Draft</p><script>parent.draftRan=true</script></section>'));
  await sourceSettled(page);
  await deck.locator("#added").click();
  assert.equal(await page.evaluate(() => window.draftRan), undefined);
  await source.focus();
  await source.evaluate((node) => {
    const offset = node.value.indexOf(">Draft<") + 6;
    node.setSelectionRange(offset, offset);
  });

  const protocol = await page.context().newCDPSession(page);
  await protocol.send("Input.imeSetComposition", { text: "日本", selectionStart: 0, selectionEnd: 2 });
  await protocol.send("Input.insertText", { text: "日本" });
  await sourceSettled(page);
  assert.equal(await deck.locator("#added").textContent(), "Draft日本");
  await source.press("Control+z");
  await sourceSettled(page);
  assert.equal(await deck.locator("#added").textContent(), "Draft");
  await source.press("Control+Shift+z");
  await sourceSettled(page);
  let release;
  const gate = new Promise((accept) => { release = accept; });
  await page.route("**/api/save", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.locator("#save").click();
  await page.waitForFunction(() => document.getElementById("save-status").textContent.includes("Saving"));
  const submitted = await source.inputValue();
  await source.fill(submitted.replace("Draft日本", "Newer draft"));
  release();
  await sourceSettled(page);
  assert.match(await readFile(sourcePath, "utf8"), /Draft日本/);
  assert.equal(await deck.locator("#added").textContent(), "Newer draft");
  assert.equal(await page.locator("#save").isEnabled(), true);
  assert.equal(await page.evaluate(() => window.draftRan), undefined);
  await page.unroute("**/api/save");
  await saveChanges(page);
  assert.match(await readFile(sourcePath, "utf8"), /Newer draft/);
});

test("source conflicts export the exact losing draft and reload the winning revision", async (context) => {
    const { page, editor, sourcePath } = await editorFixture(context);
    const other = await browser.newPage();
    context.after(() => other.close());
    await openEditor(page, editor);
    await openEditor(other, editor);
    const original = await page.locator("#slide-source").inputValue();
    const losing = original.replace("<h1>First title</h1>", '<h1 class="losing">Keep this source draft</h1>');
    await other.locator("#slide-source").fill(losing);
    await sourceSettled(other);
    await page.locator("#slide-source").fill(original.replace("First title</h1>", "Winning title</h1>"));
    await sourceSettled(page);
    await saveChanges(page);
    const response = other.waitForResponse((value) => value.url().endsWith("/api/save"));
    await other.locator("#save").click();
    assert.equal((await response).status(), 409);
    await other.locator("#conflict-panel").waitFor({ state: "visible" });
    assert.equal(await other.locator("#slide-source").inputValue(), losing);
    const event = other.waitForEvent("download");
    await other.locator("#conflict-download").click();
    const recovery = JSON.parse(await readFile(await (await event).path(), "utf8"));
    assert.equal(recovery.sourceChanges[0].text, losing);
    assert.equal(recovery.sourceChanges[0].oldText, original);
    assert.equal(JSON.stringify(recovery).includes(new URL(editor.url).hash.slice(5)), false);
    assert.match(await readFile(sourcePath, "utf8"), /Winning title<\/h1>/);
    other.once("dialog", (dialog) => dialog.accept());
    await other.locator("#reload-disk").click();
    await other.waitForFunction(() => !document.getElementById("edit-mode").disabled);
    assert.match(await other.locator("#slide-source").inputValue(), /Winning title<\/h1>/);
  });

test("late draft validation cannot overwrite newer input; inline history promotes to source history", async (context) => {
    const { page, editor, sourcePath, html } = await editorFixture(context);
    const deck = await openEditor(page, editor);
    const source = page.locator("#slide-source");
    await deck.locator("#first h1").fill("Inline first");
    const inlineSource = await source.inputValue();
    let release;
    const gate = new Promise((accept) => { release = accept; });
    let intercepted = false;
    await page.route("**/api/draft", async (route) => {
      const response = await route.fetch();
      if (!intercepted) {
        intercepted = true;
        await gate;
      }
      await route.fulfill({ response });
    });
    await source.fill(inlineSource.replace("<h1>", '<h1 title="older">'));
    await page.waitForTimeout(400);
    await source.fill(inlineSource.replace("<h1>", '<h1 title="newest">'));
    await sourceSettled(page);
    release();
    await page.waitForTimeout(100);
    assert.equal(await deck.locator("#first h1").getAttribute("title"), "newest");
    await page.unroute("**/api/draft");
    await page.locator("#undo").click();
    await sourceSettled(page);
    await page.locator("#undo").click();
    await sourceSettled(page);
    assert.equal(await source.inputValue(), inlineSource);
    await page.locator("#undo").click();
    await sourceSettled(page);
    assert.equal(await deck.locator("#first h1").textContent(), "First title");
    assert.equal(await page.locator("#save").isDisabled(), true);
    await page.locator("#redo").click();
    await sourceSettled(page);
    assert.equal(await deck.locator("#first h1").textContent(), "Inline first");
    assert.equal(await readFile(sourcePath, "utf8"), html);
  });
