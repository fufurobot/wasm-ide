/**
 * Serves the built library and the consumer fixture pages, for the library
 * integration suite (`tests/e2e/library.spec.ts`).
 *
 * It intentionally serves `dist-lib/` at `/dist-lib/` and the fixtures at the
 * root, with cross-origin isolation headers, so a fixture reproduces what a
 * consumer sees after `npm i @fufurobot/wasm-ide`.
 *
 * The fixtures import the built output directly, which is the only way to catch
 * packaging mistakes: a broken `exports` map, an unbundled bare React import in
 * the vanilla build, or a missing declaration would all be invisible to unit
 * tests that import `src/`.
 */

import { extname, join, normalize } from "node:path";

// Resolve the repo root from this file's own location. `import.meta.dir`
// follows the working directory under `bun run`, which is fragile.
const ROOT = join(import.meta.path, "..", "..", "..");
const LIB = join(ROOT, "dist-lib");
const FIXTURES = join(ROOT, "tests", "fixtures");
const PORT = Number(process.env.PORT ?? 3200);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

// Same isolation headers a well-configured host sends. Without them the wasm
// runtimes cannot allocate a SharedArrayBuffer and nothing executes.
const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

function safe(root: string, pathname: string): string | null {
  const target = normalize(join(root, decodeURIComponent(pathname)));
  return target.startsWith(root) ? target : null;
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = url.pathname;

    let target: string | null;
    if (pathname.startsWith("/dist-lib/")) {
      target = safe(LIB, pathname.slice("/dist-lib".length));
    } else {
      if (pathname === "/") pathname = "/vanilla.html";
      target = safe(FIXTURES, pathname);
    }

    if (!target) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(target);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    return new Response(file, {
      headers: {
        "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
        ...ISOLATION,
      },
    });
  },
});

console.log(`Library fixtures at ${server.url}`);
