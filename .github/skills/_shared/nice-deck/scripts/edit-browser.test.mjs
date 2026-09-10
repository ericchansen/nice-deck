import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function editorFixture(context, { legacy = false } = {}) {
  const { startEditorServer } = await import("./edit.mjs");
  const root = await mkdtemp(join(tmpdir(), "nice-deck-editor-browser-"));
  let runtime = await readFile(join(toolkit, "runtime", "deck.js"), "utf8");
  if (legacy) {
    runtime = runtime.replace(/    const ownsKeyboard =[\s\S]*?event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey\) return;\n/, "");
  }
  const html = `<!doctype html><html data-deck-width="1000" data-deck-height="562">
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
  return page.frameLocator("#deck-frame");
}

async function saveChanges(page) {
  const response = page.waitForResponse((value) => value.url().endsWith("/api/save"));
  await page.locator("#save").click();
  const saved = await response;
  assert.equal(saved.status(), 200, await saved.text());
  await page.waitForFunction(() => !document.getElementById("save-status").textContent.includes("Saving"));
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

  await page.locator("#field-text").fill("A saved title");
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

test("prices, formatted fragments, citation labels, SVG and supporting text save without changing markup", async (context) => {
  const { page, editor, sourcePath, html } = await editorFixture(context);
  const deck = await openEditor(page, editor);
  const preview = page.locator(".field-choice-preview").first();
  assert.equal(await preview.textContent(), "First title");
  assert.ok((await preview.boundingBox()).height >= 12, "Field previews must not collapse when the list overflows.");
  await deck.locator(".price-cell").fill("$12");
  await clickTextNode(deck.locator(".model-name"), 0);
  assert.equal(await page.locator("#field-text").inputValue(), "Model A");
  await page.locator("#field-text").fill("Model C");
  assert.equal(await deck.locator(".model-tier").textContent(), "Short context");
  await deck.locator(".model-tier").fill("Standard tier");
  await clickTextNode(deck.locator(".shared-status"), 2);
  assert.equal(await page.locator("#field-text").inputValue(), "Unverified");
  await page.locator("#field-text").fill("Draft only");
  assert.equal(await deck.locator(".shared-status br").count(), 1);
  await deck.locator("p.scope").fill("Published USD prices");
  await deck.locator("#first a").click();
  assert.equal(await deck.locator("#first a").evaluate(() => window.__niceDeck.current()), 0);
  await deck.locator("#first a").fill("Published evidence");
  assert.equal(await deck.locator("#first a").getAttribute("href"), "#second");
  await deck.locator("svg text").click();
  assert.equal(await page.locator("#field-text").inputValue(), "Exact SVG");
  await page.locator("#field-text").fill("Updated SVG");
  await page.locator("#slide-select").selectOption("2");
  await deck.locator("#support h1").fill("Supporting detail");
  await saveChanges(page);
  const expected = html.replace('<td class="price-cell">$10</td>', '<td class="price-cell">$12</td>')
    .replace('Model A<span class="model-tier">Short context</span>', 'Model C<span class="model-tier">Standard tier</span>')
    .replace("All models:<br>Unverified", "All models:<br>Draft only")
    .replace("Unit metadata", "Published USD prices").replace(">Evidence</a>", ">Published evidence</a>")
    .replace(">Exact SVG</text>", ">Updated SVG</text>").replace("Protected supporting text", "Supporting detail");
  assert.equal(await readFile(sourcePath, "utf8"), expected);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("edit-mode").disabled);
  assert.equal(await deck.locator(".model-name").textContent(), "Model CStandard tier");
  await page.locator("#read-mode").click();
  assert.equal(await deck.locator("[data-nice-deck-edit-field]").count(), 0);
  assert.equal(await deck.locator(".shared-status").getAttribute("rowspan"), "2");
  await deck.locator("#first a").click();
  await page.waitForFunction(() => document.getElementById("deck-frame").contentWindow.__niceDeck.current() === 1);
  assert.equal(await readFile(sourcePath, "utf8"), expected);
});

test("paste stays plain and one-field-only; long text produces a visible layout warning", async (context) => {
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
  await page.locator("#field-text").fill("Long heading ".repeat(120));
  assert.equal(await page.locator("#layout-hint").isVisible(), true);
  await page.locator("#field-text").fill("");
  assert.equal(await page.locator("#save").isDisabled(), true);
  assert.match(await page.locator("#field-error").textContent(), /nonempty/);
  await page.locator("#undo").click();
  assert.equal(await page.locator("#save").isDisabled(), true);
});

test("typing after a pending save survives its response without losing calculator state", async (context) => {
  const { page, editor, sourcePath } = await editorFixture(context);
  const deck = await openEditor(page, editor);
  await deck.getByLabel("Calculator input").fill("42");
  await page.locator("#field-text").fill("First submitted title");
  let release;
  const gate = new Promise((accept) => { release = accept; });
  await page.route("**/api/save", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.locator("#save").click();
  await page.waitForFunction(() => document.getElementById("save-status").textContent.includes("Saving"));
  await page.locator("#field-text").fill("Newer unsaved title");
  release();
  await page.waitForFunction(() => !document.getElementById("save-status").textContent.includes("Saving"));
  assert.equal(await page.locator("#field-text").inputValue(), "Newer unsaved title");
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
  await page.locator("#field-text").fill("First tab wins");
  await saveChanges(page);
  await second.locator("#field-text").fill("Keep second tab draft");
  const response = second.waitForResponse((value) => value.url().endsWith("/api/save"));
  await second.locator("#save").click();
  assert.equal((await response).status(), 409);
  await second.locator("#conflict-panel").waitFor({ state: "visible" });
  assert.equal(await second.locator("#field-text").inputValue(), "Keep second tab draft");
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
  assert.equal(await second.locator("#field-text").inputValue(), "First tab wins");
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

test("narrow editor has no horizontal overflow and retains the text-panel fallback", async (context) => {
  const { page, editor } = await editorFixture(context);
  await page.setViewportSize({ width: 620, height: 950 });
  const deck = await openEditor(page, editor);
  assert.equal(await page.locator("#inspector").isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator("#toggle-inspector").click();
  assert.equal(await page.locator("#field-text").isVisible(), true);
  await page.locator("#field-text").fill("Compact view wording");
  assert.equal(await deck.locator("#first h1").textContent(), "Compact view wording");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
