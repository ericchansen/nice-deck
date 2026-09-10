import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditError, openEditableSource } from "./edit-source.mjs";
import { startPreviewWorker } from "./edit-preview.mjs";

const authoringRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "authoring");
const assets = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".csv", "text/csv; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".gif", "image/gif"],
  [".woff", "font/woff"], [".woff2", "font/woff2"], [".mp4", "video/mp4"],
]);
const shellFiles = new Map([
  ["/", "editor.html"], ["/editor.css", "editor.css"], ["/editor.js", "editor.js"],
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function error(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function matches(value, expected) {
  if (typeof value !== "string") return false;
  const candidate = Buffer.from(value);
  const actual = Buffer.from(expected);
  return candidate.length === actual.length && timingSafeEqual(candidate, actual);
}

function within(root, file) {
  const path = relative(root, file);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (failure) {
    if (failure.code === "ENOENT") return false;
    throw failure;
  }
}

async function jsonBody(request) {
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
    throw error(415, "content-type", "This operation requires application/json.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 600_000) throw error(413, "too-large", "The edit request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw error(400, "invalid-json", "The edit request is not valid JSON.");
  }
}

function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function countFindings(result) {
  return {
    design: result.scan?.length ?? 0,
    layout: (result.layoutIssues?.length ?? 0) + (result.viewportAudit?.length ?? 0),
    contrast: result.contrast?.length ?? 0,
    browser: result.browserErrors?.length ?? 0,
    charts: result.chartAudit?.length ?? 0,
    runtime: result.runtimeIntegrity?.length ?? 0,
  };
}

async function closeServer(server) {
  if (!server) return;
  try {
    await server.close();
  } catch (failure) {
    if (failure.code !== "ERR_SERVER_NOT_RUNNING") throw failure;
  }
}

export async function startEditorServer({ sourcePath, preview, onError = () => {} } = {}) {
  if (!sourcePath) throw error(400, "source-required", "Choose a source HTML file.");
  const source = await realpath(resolve(sourcePath));
  const root = dirname(source);
  const filename = basename(source);
  const generatedPath = source.split(/[\\/]/).some((part) => (
    ["_renders", ".nice-deck-edit"].includes(part.toLowerCase())
  ));
  const snapshotPath = basename(root) === "site" && /^[a-f\d]{12,64}$/i.test(basename(dirname(root)));
  if (generatedPath || snapshotPath) {
    throw error(400, "generated-source",
      "This is a generated preview or recovery copy. Choose the authored HTML or an independent deck copy.");
  }
  const coordinator = await openEditableSource(sourcePath);
  const initial = await coordinator.read();
  const token = randomBytes(32).toString("base64url");
  const reader = randomBytes(32).toString("base64url");
  const cookieName = `nice_deck_reader_${randomBytes(8).toString("hex")}`;
  let origin;
  let currentPreview;
  let closing = false;
  let closedTask;
  const operations = new Set();
  let checkRequested = false;
  let checkTask;
  let checks = { state: "idle", message: "Saved text needs a fresh render and review." };
  const sourceRevision = async () => sha256(await readFile(source));
  const imported = !(await Promise.all(
    ["brief.md", "outline.json", "visual-manifest.json", "sources.json"]
      .map((name) => exists(join(root, name))),
  )).every(Boolean);
  const render = preview ?? (() => startPreviewWorker({
    sourcePath: source,
    outDir: join(root, ".nice-deck-edit", `renders-${sha256(filename).slice(0, 12)}`),
    browserChannel: process.env.NICE_DECK_BROWSER_CHANNEL,
  }, (failure) => {
    checks = { state: "error", message: "The preview process stopped. Render the saved slides again." };
    onError(failure);
  }));

  async function state(value) {
    const data = value ?? await coordinator.read();
    return {
      title: data.title || filename,
      filename,
      revision: data.revision,
      slides: data.slides,
      fields: data.fields,
      lastSave: data.lastSave,
      status: data.status,
      reviewHint: data.reviewHint,
      imported,
      reviewStatus: checks.sourceRevision === data.revision
        ? checks.reviewStatus ?? "pending"
        : imported ? "unreviewed-import" : "stale",
      checks,
      deckUrl: `/deck/${encodeURIComponent(filename)}?revision=${data.revision}`,
    };
  }

  function requestCheck() {
    if (closing) return;
    checkRequested = true;
    if (checkTask) return;
    checks = { state: "running", message: "Rendering saved slides..." };
    checkTask = (async () => {
      while (checkRequested && !closing) {
        checkRequested = false;
        checks = { state: "running", sourceRevision: await sourceRevision(), message: "Rendering saved slides..." };
        try {
          const result = await render({ sourcePath: source });
          const renderedRevision = result.server?.root
            ? sha256(await readFile(join(result.server.root, filename)))
            : checks.sourceRevision;
          const previous = currentPreview;
          currentPreview = result.server;
          await closeServer(previous);
          checks = {
            state: "complete", sourceRevision: renderedRevision, ok: result.ok,
            counts: countFindings(result), url: result.url,
            sourceHash: result.sourceHash,
            previewFile: result.previewFile,
            reviewStatus: result.review?.status ?? "missing",
            message: result.ok
              ? "Render complete. Approval requires inspection of the exact screenshots."
              : "Draft render has findings. Inspect the preview before presentation.",
          };
        } catch (failure) {
          checks = { state: "error", message: `Render failed: ${failure.message}` };
          onError(failure);
        }
      }
    })().catch((failure) => {
      checks = { state: "error", message: "Could not read the saved source for rendering." };
      onError(failure);
    }).finally(() => {
      checkTask = undefined;
    });
  }

  async function deckFile(request, response, pathname, url) {
    const cookies = String(request.headers.cookie ?? "").split(";").map((part) => part.trim());
    if (!cookies.some((entry) => matches(entry, `${cookieName}=${reader}`))) {
      throw error(401, "session-required", "Open the editor link to authorize this local deck.");
    }
    const path = pathname.slice("/deck/".length);
    const parts = path.split("/");
    const selectedFile = path === filename;
    if (!path || parts.some((part) => !part || (!selectedFile && part.startsWith(".")) || /[\\:\0]/.test(part))) {
      throw error(403, "path-rejected", "That asset path is not allowed.");
    }
    const lexical = resolve(root, ...parts);
    if (!within(root, lexical)) throw error(403, "path-rejected", "That asset is outside the selected deck.");
    for (let index = 1; index <= parts.length; index += 1) {
      if ((await lstat(join(root, ...parts.slice(0, index)))).isSymbolicLink()) {
        throw error(403, "path-rejected", "Linked assets are not served by the editor.");
      }
    }
    const file = await realpath(lexical);
    if (!within(root, file) || !(await stat(file)).isFile()) {
      throw error(403, "path-rejected", "That asset is not available.");
    }
    const mime = assets.get(extname(file).toLowerCase());
    if (!mime) throw error(403, "asset-type", "That file type is not served by the editor.");
    const bytes = await readFile(file);
    if (file === source) {
      const revision = sha256(bytes);
      if (url.searchParams.has("revision") && url.searchParams.get("revision") !== revision) {
        throw error(409, "source-changed", "The source changed. Reload it in the editor.");
      }
      response.setHeader("X-Deck-Revision", revision);
    }
    response.writeHead(200, { "Content-Type": mime });
    response.end(request.method === "HEAD" ? undefined : bytes);
  }

  async function handleRequest(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (request.headers.host !== new URL(origin).host) {
        throw error(403, "host-rejected", "Unexpected local server host.");
      }
      if (request.headers.origin && request.headers.origin !== origin) {
        throw error(403, "origin-rejected", "Cross-origin editor requests are not allowed.");
      }
      let pathname;
      try {
        pathname = decodeURIComponent(request.url.split("?", 1)[0]);
      } catch {
        throw error(400, "invalid-path", "Invalid URL encoding.");
      }
      const url = new URL(request.url, origin);
      if (/[\0\\]/.test(pathname) || pathname.split("/").some((part) => part === "..")) {
        throw error(403, "path-rejected", "That path is not allowed.");
      }
      if (shellFiles.has(pathname) && ["GET", "HEAD"].includes(request.method)) {
        const file = join(authoringRoot, shellFiles.get(pathname));
        response.setHeader("Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self' blob:; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'");
        response.writeHead(200, { "Content-Type": assets.get(extname(file)) });
        response.end(request.method === "HEAD" ? undefined : await readFile(file));
        return;
      }
      if (pathname.startsWith("/deck/") && ["GET", "HEAD"].includes(request.method)) {
        await deckFile(request, response, pathname, url);
        return;
      }
      if (!pathname.startsWith("/api/")) throw error(404, "not-found", "Not found.");
      if (!matches(request.headers.authorization, `Bearer ${token}`)) {
        throw error(401, "unauthorized", "Open the original editor launch link to reconnect.");
      }
      if (!["GET", "POST"].includes(request.method)) throw error(405, "method", "Method not allowed.");
      if (request.method === "POST" && request.headers.origin !== origin) {
        throw error(403, "origin-required", "A same-origin request is required.");
      }
      if (pathname === "/api/session" && request.method === "POST") {
        await jsonBody(request);
        response.setHeader("Set-Cookie", `${cookieName}=${reader}; Path=/deck/; HttpOnly; SameSite=Strict`);
        json(response, { ready: true });
      } else if (pathname === "/api/state" && request.method === "GET") {
        json(response, await state());
      } else if (pathname === "/api/save" && request.method === "POST") {
        const result = await coordinator.save(await jsonBody(request));
        requestCheck();
        json(response, await state(result));
      } else if (pathname === "/api/check" && request.method === "GET") {
        json(response, checks);
      } else if (pathname === "/api/check" && request.method === "POST") {
        await jsonBody(request);
        requestCheck();
        json(response, checks, 202);
      } else {
        throw error(404, "not-found", "Unknown editor operation.");
      }
    } catch (failure) {
      if (closing && response.destroyed) return;
      const status = failure.status ?? (failure.code === "ENOENT" ? 404 : 500);
      if (status >= 500) onError(failure);
      const message = status >= 500 && !(failure instanceof EditError)
        ? "The operation failed. Your unsaved changes are retained." : failure.message;
      if (!response.headersSent) json(response, {
        error: {
          code: failure.code ?? "operation-failed", message,
          sourceMayHaveChanged: failure.sourceMayHaveChanged === true,
        },
      }, status);
      else response.destroy(failure);
    }
  }
  const server = createServer((request, response) => {
    const operation = handleRequest(request, response);
    operations.add(operation);
    void operation.then(
      () => operations.delete(operation),
      (failure) => {
        operations.delete(operation);
        onError(failure);
        response.destroy(failure);
      },
    );
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}/#key=${token}`,
    sourcePath: source,
    initial: await state(initial),
    read: () => state(),
    close: () => {
      closedTask ??= (async () => {
        closing = true;
        const stopped = new Promise((accept, reject) => server.close((failure) => failure ? reject(failure) : accept()));
        server.closeAllConnections();
        await stopped;
        // Disconnect clients, but let already accepted source transactions finish.
        await Promise.allSettled([...operations]);
        await checkTask;
        await closeServer(currentPreview);
      })();
      return closedTask;
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const editor = await startEditorServer({
      sourcePath: process.argv[2],
      onError: (failure) => console.error(`Editor operation failed: ${failure.message}`),
    });
    console.log(`Editor: ${editor.url}`);
    console.log(`Source: ${editor.sourcePath}`);
    console.log("This launch link authorizes local edits. Do not share it. Press Ctrl+C to stop.");
    let stopping = false;
    async function stop() {
      if (stopping) return;
      stopping = true;
      await editor.close();
    }
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => stop().catch((failure) => {
        console.error(`Editor shutdown failed: ${failure.message}`);
        process.exitCode = 1;
      }));
    }
  } catch (failure) {
    console.error(`Editor failed: ${failure.message}`);
    process.exitCode = 1;
  }
}
