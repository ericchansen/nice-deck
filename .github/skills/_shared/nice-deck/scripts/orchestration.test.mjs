import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openPreviewSession } from "../lib/browser-session.mjs";
import * as preview from "./preview.mjs";
import * as files from "../lib/files.mjs";
import * as workspace from "../lib/workspace.mjs";
import * as server from "../lib/server.mjs";

test("feedback does not invoke workspace scan, rendered audit or review assessment", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import", new URL("./test-support/browser-preload.mjs", import.meta.url).href,
    fileURLToPath(new URL("./test-support/feedback-boundary.mjs", import.meta.url)),
  ], { timeout: 60000 });
  assert.match(stdout, /all audit\/review operations trapped/);
});

test("compatibility exports retain their internal owner identities", () => {
  assert.equal(preview.atomicWriteFile, files.atomicWriteFile);
  assert.equal(preview.computeDeckSourceHash, workspace.computeDeckSourceHash);
  assert.equal(preview.findWorkspaceRoot, workspace.findWorkspaceRoot);
  assert.equal(preview.startStaticServer, server.startStaticServer);
});

test("internal modules do not import command adapters; capture has no audit/review dependency", async () => {
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) await visit(url);
      else if (entry.name.endsWith(".mjs")) {
        const source = await readFile(url, "utf8");
        assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*["'][^"']*scripts\//);
      }
    }
  }
  await visit(new URL("../lib/", import.meta.url));
  const capture = await readFile(new URL("../lib/capture.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(capture, /(?:from\s*|import\s*\()\s*["'][^"']*(?:audit|review|layout)\.mjs/);
});

test("partial session failures close only their context and preserve the supplied browser", async () => {
  for (const failAt of ["routeWebSocket", "route", "newPage", "goto"]) {
    let contextsClosed = 0;
    let browsersClosed = 0;
    const fail = async () => { throw new Error(`injected ${failAt}`); };
    const context = {
      close: async () => { contextsClosed += 1; },
      routeWebSocket: async () => {},
      route: async () => {},
      on() {},
      newPage: async () => ({ on() {}, goto: fail }),
    };
    if (failAt !== "goto") context[failAt] = fail;
    const browser = {
      newContext: async () => context,
      close: async () => { browsersClosed += 1; },
    };
    await assert.rejects(
      openPreviewSession({ browser, url: "http://127.0.0.1:1234/deck.html", browserErrors: [] }),
      new RegExp(`injected ${failAt}`),
    );
    assert.equal(contextsClosed, 1, failAt);
    assert.equal(browsersClosed, 0, failAt);
  }
});
