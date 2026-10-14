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
 */

import { extname, join, normalize } from "node:path";

const DIST = join(import.meta.dir, "..", "dist");
const PORT = Number(process.env.PORT ?? 3000);

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

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(request) {
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
      },
    });
  },
});

console.log(`Static preview of dist/ at ${server.url}`);
