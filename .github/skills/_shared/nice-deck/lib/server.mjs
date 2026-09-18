import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { isHidden, isWithin } from "./files.mjs";
import { mimeTypes, staticExtensions } from "./static-policy.mjs";

export async function startStaticServer(root) {
  const absoluteRoot = await realpath(resolve(root));

  const server = createServer(async (request, response) => {
    try {
      const rawPath = request.url.split(/[?#]/, 1)[0];
      const decodedRawPath = decodeURIComponent(rawPath);
      const rawSegments = decodedRawPath.split(/[\\/]/).filter(Boolean);
      if (
        decodedRawPath.includes("\\")
        || rawSegments.some((segment) => segment === ".." || isHidden(segment))
      ) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname.startsWith("/__nice-deck/")) {
        response.writeHead(410, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Preview-only runtime path retired. Use a relative workspace runtime/ path.");
        return;
      }
      const segments = pathname.split("/").filter(Boolean);
      if (segments.some(isHidden)) {
        response.writeHead(403).end("forbidden");
        return;
      }

      const lexicalTarget = resolve(absoluteRoot, ...segments);
      if (!isWithin(absoluteRoot, lexicalTarget)) {
        response.writeHead(403).end("forbidden");
        return;
      }

      const target = await realpath(lexicalTarget);
      if (!isWithin(absoluteRoot, target)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      if (!(await stat(target)).isFile()) {
        response.writeHead(404).end("not found");
        return;
      }

      const extension = extname(target).toLowerCase();
      if (!staticExtensions.has(extension)) {
        response.writeHead(403).end("forbidden");
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes.get(extension),
      });
      response.end(await readFile(target));
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.message);
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const { port } = server.address();
  const closed = new Promise((resolveClose) => server.once("close", resolveClose));
  return {
    closed,
    root: absoluteRoot,
    urlFor(file, version = "") {
      const path = relative(absoluteRoot, resolve(file));
      if (path.startsWith("..") || isAbsolute(path)) {
        throw new Error(`${file} is outside preview root ${absoluteRoot}`);
      }
      const encodedPath = path.split(sep).map(encodeURIComponent).join("/");
      return `http://127.0.0.1:${port}/${encodedPath}${version ? `?v=${version}` : ""}`;
    },
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    }),
  };
}
