/**
 * Cross-origin isolation service worker.
 *
 * GitHub Pages cannot send custom response headers, but `@runno/wasi` needs
 * `SharedArrayBuffer`, which browsers only expose to cross-origin-isolated
 * documents. This worker closes that gap: it intercepts same-origin responses
 * and adds COOP/COEP, after which the page is isolated without any server
 * cooperation. The page reloads once to pick the headers up.
 *
 * The policy (which requests to touch, and the reload-once rule) is unit tested
 * in `tests/unit/coi.test.ts` against `src/lib/coi.ts`. This file is the thin
 * worker shell and is deliberately kept dependency-free, because a worker
 * cannot import from the app bundle.
 *
 * This file is copied verbatim into `dist/` by `build.ts`, so it must stay at
 * the site root — a worker's scope is limited to its own directory.
 */

/* eslint-disable no-undef */

const COI_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const SW_FILENAME = "coi-serviceworker.js";

self.addEventListener("install", () => {
  // Take over as soon as possible; the page will reload to apply headers.
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

/**
 * Inject the isolation headers when the response is missing them.
 *
 * Only same-origin responses are touched: rewriting a third party's headers
 * would break CORS and the WebAssembly CDN that Runno downloads images from.
 */
function isolate(response) {
  // Opaque and error responses have immutable headers.
  if (response.type === "opaque" || response.type === "opaqueredirect") return response;
  if (!response.ok) return response;

  const headers = new Headers(response.headers);
  let changed = false;
  for (const [name, value] of Object.entries(COI_HEADERS)) {
    if (headers.get(name) !== value) {
      headers.set(name, value);
      changed = true;
    }
  }
  if (!changed) return response;

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;

  // Only same-origin http(s) GETs, and never the worker itself.
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.protocol.startsWith("http")) return;
  if (url.pathname.endsWith("/" + SW_FILENAME)) return;
  if (!request.destination) return;

  event.respondWith(
    fetch(request)
      .then(isolate)
      .catch(() => {
        // Network failure: fall back to the cache, then to a plain error.
        return caches.match(request).then(cached => cached ?? Response.error());
      }),
  );
});
