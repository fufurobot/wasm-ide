/**
 * Static preview server for the built `dist/`.
 *
 * GitHub Pages serves plain files with no rewrite rules, so this server does
 * exactly that: it exists to prove the build works when hosted statically, and
 * it is what `bun run test:e2e` points Playwright at.
 *
 * Deliberately no `/api/*` routes and no SPA fallback — if the IDE ever needed
 * either, the Pages deployment would break, and we want the e2e run to catch
 * that rather than hide it.
 *
 * Cross-origin isolation is mandatory, not optional: `@runno/wasi` allocates a
 * `SharedArrayBuffer` for the program's stdin, and browsers only expose that to
 * cross-origin-isolated documents. Without these two headers every run fails
 * with "SharedArrayBuffer is not defined". Any static host serving this build
 * must send them too (see README).
 */

import { extname, join, normalize } from "node:path";

const DIST = join(import.meta.dir, "..", "dist");
const PORT = Number(process.env.PORT ?? 3000);

/** Headers a host must send for the wasm runtimes to work at all. */
export const CROSS_ORIGIN_ISOLATION_HEADERS: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function resolveSafe(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const candidate = normalize(join(DIST, decoded));
  // Refuse anything that escapes the build directory.
  if (!candidate.startsWith(DIST)) return null;
  return candidate;
}

/**
 * Serve one request from `dist/`, the way a plain static host would.
 *
 * Exported (and side-effect free) so unit tests can assert on the response
 * headers without binding a port.
 */
export async function handleStaticRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";

  let target = resolveSafe(pathname);
  if (!target) return new Response("Forbidden", { status: 403 });

  let file = Bun.file(target);
  if (!(await file.exists())) {
    // A directory request resolves to its index.html, as a static host would.
    target = resolveSafe(join(pathname, "index.html"));
    if (!target) return new Response("Forbidden", { status: 403 });
    file = Bun.file(target);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
  }

  return new Response(file, {
    headers: {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      ...CROSS_ORIGIN_ISOLATION_HEADERS,
    },
  });
}

/** Start the preview server. Only called when this file is the entrypoint. */
export function startPreviewServer(port = PORT) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: handleStaticRequest,
  });
}

// `import.meta.main` keeps the server from binding a port during unit tests.
if (import.meta.main) {
  const server = startPreviewServer();
  console.log(`Static preview of dist/ at ${server.url}`);
}
