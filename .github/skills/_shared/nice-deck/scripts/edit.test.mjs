import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { createConnection } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { startEditorServer } from "./edit.mjs";
import { startStaticServer } from "./preview.mjs";

const fixture = `<!doctype html><title>Editing fixture</title>
<section class="slide" id="first" data-title="First title"><h1>First title</h1>
<p>A short sentence.</p><p class="scope">USD; 2026</p>
<a href="https://example.com">Evidence</a><svg><text>Exact label</text></svg></section>
<section class="slide" id="second"><h1>Second title</h1></section>
<script>window.payload = "First title";</script>`;

async function setup(context, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "nice-deck-editor-service-"));
  const sourcePath = join(root, "deck.html");
  await writeFile(sourcePath, fixture);
  const editor = await startEditorServer({
    sourcePath,
    preview: async () => ({ ok: true, review: { status: "missing" } }),
    ...options,
  });
  context.after(async () => {
    await editor.close();
    await rm(root, { recursive: true, force: true });
  });
  const launch = new URL(editor.url);
  const token = new URLSearchParams(launch.hash.slice(1)).get("key");
  const origin = launch.origin;
  const api = (path, { method = "GET", body, headers = {} } = {}) => fetch(`${origin}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { root, sourcePath, editor, token, origin, api };
}

test("API authorizes slide source and frame separately without exposing paths or whole-document source", async (context) => {
  const { api, origin, sourcePath } = await setup(context);
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  const response = await api("/api/state");
  const state = await response.json();
  assert.equal(response.status, 200);
  assert.equal(state.filename, "deck.html");
  assert.equal(state.imported, true);
  assert.equal(state.slides.length, 2);
  assert.ok(state.fields.some((field) => field.text === "A short sentence."));
  assert.equal(state.html, undefined);
  assert.equal(state.sourcePath, undefined);
  assert.equal(state.slides[0].source, fixture.slice(fixture.indexOf("<section"), fixture.indexOf("</section>") + 10));
  assert.ok(!state.slides[0].source.includes("window.payload"));
  assert.equal(state.reviewStatus, "unreviewed-import");
  assert.equal((await fetch(`${origin}${state.deckUrl}`)).status, 401);
  const session = await api("/api/session", { method: "POST", body: {} });
  const cookie = session.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const deck = await fetch(`${origin}${state.deckUrl}`, { headers: { Cookie: cookie.split(";")[0] } });
  assert.equal(deck.status, 200);
  assert.equal(await deck.text(), await readFile(sourcePath, "utf8"));
});

test("saved edits survive a fresh read, retain unrelated bytes, and reject stale tabs", async (context) => {
  const { api, sourcePath } = await setup(context);
  const state = await (await api("/api/state")).json();
  const field = state.fields.find((candidate) => candidate.text === "First title");
  const body = { revision: state.revision, changes: [{ id: field.id, oldText: field.text, text: "A revised title" }] };
  const saved = await api("/api/save", { method: "POST", body });
  assert.equal(saved.status, 200, await saved.clone().text());
  const result = await saved.json();
  assert.notEqual(result.revision, state.revision);
  assert.equal(result.fields.find((candidate) => candidate.id === field.id).text, "A revised title");
  const disk = await readFile(sourcePath, "utf8");
  assert.match(disk, /<h1>A revised title<\/h1>/);
  assert.match(disk, /<script>window.payload = "First title";<\/script>/);
  assert.match(disk, /<svg><text>Exact label<\/text><\/svg>/);
  assert.doesNotMatch(disk, /contenteditable|editor\.js|nice-deck-edit-field/);
  assert.equal((await api("/api/save", { method: "POST", body })).status, 409);
  const fresh = await (await api("/api/state")).json();
  assert.equal(fresh.revision, result.revision);
  assert.notEqual(fresh.reviewStatus, "approved");
});

test("draft route validates markup without writes; explicit bounded save persists and conflicts retain disk", async (context) => {
  const { api, sourcePath, origin } = await setup(context);
  const state = await (await api("/api/state")).json();
  const slide = state.slides[0];
  const text = slide.source.replace("<h1>First title</h1>", '<h1 title="Live">New <em>markup</em></h1>');
  const body = { revision: state.revision, changes: [{ kind: "slide", id: slide.id, oldText: slide.source, text }] };
  assert.equal((await fetch(`${origin}/api/draft`, { method: "POST" })).status, 401);
  assert.equal((await api("/api/draft", { method: "POST", body, headers: { Origin: "https://example.com" } })).status, 403);
  const draft = await api("/api/draft", { method: "POST", body });
  assert.equal(draft.status, 200, await draft.clone().text());
  assert.equal((await draft.json()).slides[0].source, text);
  assert.equal(await readFile(sourcePath, "utf8"), fixture);
  const bad = { ...body, changes: [{ ...body.changes[0], text: text + "<p>Outside</p>" }] };
  for (const path of ["/api/draft", "/api/save"]) {
    assert.equal((await api(path, { method: "POST", body: bad })).status, 422);
    assert.equal(await readFile(sourcePath, "utf8"), fixture);
  }
  assert.equal((await api("/api/save", { method: "POST", body })).status, 200);
  assert.equal(await readFile(sourcePath, "utf8"), fixture.replace(slide.source, text));
  assert.equal((await api("/api/draft", { method: "POST", body })).status, 409);
  assert.equal((await api("/api/save", { method: "POST", body })).status, 409);
});

test("external edits are not overwritten and no-op saves preserve original bytes", async (context) => {
  const { api, sourcePath } = await setup(context);
  const state = await (await api("/api/state")).json();
  assert.equal((await api("/api/save", { method: "POST", body: { revision: state.revision, changes: [] } })).status, 200);
  assert.equal(await readFile(sourcePath, "utf8"), fixture);
  await writeFile(sourcePath, `${fixture}\n<!-- external -->`);
  const field = state.fields[0];
  const response = await api("/api/save", {
    method: "POST",
    body: { revision: state.revision, changes: [{ id: field.id, oldText: field.text, text: "Do not overwrite" }] },
  });
  assert.equal(response.status, 409);
  assert.equal(await readFile(sourcePath, "utf8"), `${fixture}\n<!-- external -->`);
});

test("write routes reject cross-origin, wrong-token, wrong-content-type and arbitrary HTML", async (context) => {
  const { api, sourcePath } = await setup(context);
  assert.equal((await api("/api/state", { headers: { Origin: "https://example.com" } })).status, 403);
  assert.equal((await api("/api/state", { headers: { Authorization: "Bearer invalid" } })).status, 401);
  assert.equal((await api("/api/save", {
    method: "POST", body: {}, headers: { "Content-Type": "text/plain" },
  })).status, 415);
  assert.equal((await api("/api/save", { method: "POST", body: { html: "<h1>Overwrite</h1>" } })).status, 400);
  assert.equal((await api("/api/save", { method: "PUT", body: {} })).status, 405);
  assert.equal(await readFile(sourcePath, "utf8"), fixture);
});

test("deck asset routes deny history, traversal, unsupported files and linked files", async (context) => {
  const { api, root, origin } = await setup(context);
  await writeFile(join(root, "private.md"), "not a slide asset");
  const response = await api("/api/session", { method: "POST", body: {} });
  const cookie = response.headers.get("set-cookie").split(";")[0];
  for (const path of [
    "/deck/.nice-deck-edit/state.json", "/deck/private.md", "/deck/%2e%2e%2foutside.html",
    "/deck/a%5cb.html", "/deck/%00", "/deck/",
  ]) {
    assert.equal((await fetch(`${origin}${path}`, { headers: { Cookie: cookie } })).status, 403, path);
  }
  const outside = await mkdtemp(join(tmpdir(), "nice-deck-editor-outside-"));
  context.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "linked.html"), "outside");
  await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await fetch(`${origin}/deck/linked/linked.html`, { headers: { Cookie: cookie } })).status, 403);
});

test("render failures are visible and never roll back an acknowledged source save", async (context) => {
  const errors = [];
  const { api, sourcePath } = await setup(context, {
    preview: async () => { throw new Error("Renderer unavailable"); },
    onError: (failure) => errors.push(failure),
  });
  const state = await (await api("/api/state")).json();
  const field = state.fields[0];
  const response = await api("/api/save", {
    method: "POST",
    body: { revision: state.revision, changes: [{ id: field.id, oldText: field.text, text: "Saved draft" }] },
  });
  assert.equal(response.status, 200);
  await new Promise((accept) => setTimeout(accept, 30));
  const check = await (await api("/api/check")).json();
  assert.equal(check.state, "error");
  assert.match(check.message, /Renderer unavailable/);
  assert.equal(errors.length, 1);
  assert.match(await readFile(sourcePath, "utf8"), /<h1>Saved draft<\/h1>/);
});

test("generated preview and recovery files cannot become editable sources", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "nice-deck-generated-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const segments of [
    ["_renders", "deck.html"], [".nice-deck-edit", "deck.html"],
    ["custom-output", "a123456789ab", "site", "deck.html"],
  ]) {
    const file = join(root, ...segments);
    await mkdir(join(root, ...segments.slice(0, -1)), { recursive: true });
    await writeFile(file, fixture);
    await assert.rejects(startEditorServer({ sourcePath: file }), { code: "generated-source", status: 400 });
    assert.equal(await readFile(file, "utf8"), fixture);
  }
});

test("canonical preview runs outside the API event loop and returns its immutable record", async (context) => {
  const { api, sourcePath } = await setup(context, { preview: undefined });
  assert.equal((await api("/api/check", { method: "POST", body: {} })).status, 202);
  assert.equal((await api("/api/state")).status, 200);
  let checks;
  const deadline = Date.now() + 60_000;
  do {
    await new Promise((accept) => setTimeout(accept, 150));
    checks = await (await api("/api/check")).json();
  } while (checks.state === "running" && Date.now() < deadline);
  assert.equal(checks.state, "complete", checks.message);
  assert.match(checks.sourceHash, /^[a-f0-9]{64}$/);
  const record = JSON.parse(await readFile(checks.previewFile, "utf8"));
  assert.equal(record.sourceHash, checks.sourceHash);
  assert.equal(record.screenshots.length, 2);
  assert.equal((await fetch(checks.url)).status, 200);
  assert.equal(await readFile(sourcePath, "utf8"), fixture);
});

test("shutdown disconnects stalled clients without writing their incomplete requests", async (context) => {
  const { editor, origin, token, sourcePath } = await setup(context);
  const pending = request(`${origin}/api/save`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, Origin: origin,
      "Content-Type": "application/json", "Content-Length": "500",
    },
  });

  let disconnected = false;
  pending.on("error", () => { disconnected = true; });
  pending.write("{");
  await new Promise((accept) => setTimeout(accept, 30));
  let timer;
  try {
    await Promise.race([
      editor.close(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Shutdown stalled")), 2_000); }),
    ]);
  } finally {
    clearTimeout(timer);
    pending.destroy();
  }
  await new Promise((accept) => setTimeout(accept, 10));
  assert.equal(disconnected, true);
  assert.equal(await readFile(sourcePath, "utf8"), fixture);
});

test("retiring a read-only preview closes browser preconnections that never sent a request", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "nice-deck-preview-shutdown-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const server = await startStaticServer(root);
  context.after(async () => {
    try { await server.close(); } catch (failure) {
      if (failure.code !== "ERR_SERVER_NOT_RUNNING") throw failure;
    }
  });
  const url = new URL(server.urlFor(join(server.root, "deck.html")));
  const socket = createConnection({ host: url.hostname, port: Number(url.port) });
  await new Promise((accept, reject) => { socket.once("connect", accept); socket.once("error", reject); });
  const disconnected = new Promise((accept) => socket.once("close", accept));
  let timer;
  try {
    await Promise.race([
      server.close(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Preview shutdown stalled")), 2_000); }),
    ]);
    await disconnected;
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
  assert.equal(socket.destroyed, true);
});
