/**
 * Serves the built `dist/` under a URL prefix, mimicking a GitHub Pages
 * *project* site (`https://<user>.github.io/<repo>/`).
 *
 * This exists because the app shipped a bug that only appears under a subpath:
 * the isolation bootstrap registered the service worker at the absolute
 * `/coi-serviceworker.js`, which 404s when the site is mounted at `/wasm-ide/`.
 * The domain-root preview (`src/preview.ts`) could never have caught it.
 *
 * Like GitHub Pages, this deliberately sends **no** COOP/COEP headers, so the
 * service worker path is what gets exercised.
 *
 * PORT env var overrides the port; PREFIX overrides the mount path.
 */

import { extname, join, normalize } from "node:path";

const DIST = join(import.meta.dir, "..", "dist");
const PORT = Number(process.env.PORT ?? 3100);
const PREFIX = process.env.PREFIX ?? "/wasm-ide";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = url.pathname;

    // Anything outside the prefix is not part of this deployment.
    if (pathname === PREFIX) return Response.redirect(`${PREFIX}/`, 302);
    if (!pathname.startsWith(`${PREFIX}/`)) {
      return new Response("Not found", { status: 404 });
    }

    pathname = pathname.slice(PREFIX.length) || "/";
    if (pathname === "/") pathname = "/index.html";

    const target = normalize(join(DIST, decodeURIComponent(pathname)));
    if (!target.startsWith(DIST)) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(target);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    return new Response(file, {
      headers: {
        "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
        // No cross-origin isolation headers: GitHub Pages cannot send them.
      },
    });
  },
});

console.log(`Subpath preview of dist/ at ${server.url}${PREFIX}/`);
