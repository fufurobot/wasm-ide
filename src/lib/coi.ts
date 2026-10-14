/**
 * Cross-origin isolation policy.
 *
 * `@runno/wasi` allocates a `SharedArrayBuffer` for program stdin, and browsers
 * only expose that constructor to cross-origin-isolated documents. A
 * header-capable host satisfies this with two response headers (see
 * `src/preview.ts`), but **GitHub Pages cannot send custom headers at all**.
 *
 * The standard workaround is a service worker that injects the headers into
 * same-origin responses and reloads the page once, after which the document is
 * cross-origin isolated without any server cooperation.
 *
 * This module holds the policy as pure functions so the rules can be unit
 * tested without a browser, a worker, or a network. `public/coi-serviceworker.js`
 * is the thin worker shell that applies them, and `src/components/COIBootstrap.tsx`
 * registers it.
 */

/** The two headers that make a document cross-origin isolated. */
export const COI_HEADERS: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * Where the worker is served from.
 *
 * It must sit at the site root: a worker's scope is limited to its own
 * directory, and the wasm assets live at the root of the Pages deployment.
 */
export const COI_SW_PATH = "/coi-serviceworker.js";

/** sessionStorage key recording that we already tried the reload. */
export const COI_ATTEMPT_KEY = "wasm-ide:coi-reload-attempted";

/** True when `url` shares an origin with `origin`. */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin === "null" || !parsed.protocol.startsWith("http")) return false;
    return parsed.origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Decide whether a response should have the isolation headers injected.
 *
 * Rewriting a cross-origin response's headers would break CORS and the wasm
 * CDN, so only same-origin sub-resources the document itself needs are
 * isolated. The worker is excluded so it cannot try to intercept itself.
 */
export function shouldIsolate(url: string, origin: string, destination: string): boolean {
  // `destination === ""` marks an opaque/unknown request such as a beacon.
  if (!destination) return false;
  if (!isSameOrigin(url, origin)) return false;
  try {
    if (new URL(url, origin).pathname === COI_SW_PATH) return false;
  } catch {
    return false;
  }
  return true;
}

export type IsolationInput = {
  crossOriginIsolated: boolean;
  controlled: boolean;
  attempted: boolean;
  serviceWorkerSupported?: boolean;
};

export type IsolationPlan = {
  action: "already-isolated" | "register-and-reload" | "give-up" | "unsupported";
  reason: string;
};

/**
 * Work out what the bootstrap should do.
 *
 * The critical rule is that the reload happens **at most once**. A page that
 * reloads on every load is worse than a page that runs without isolation, so
 * once an attempt has been recorded we stop and report honestly instead of
 * looping.
 */
export function planIsolation({
  crossOriginIsolated,
  controlled,
  attempted,
  serviceWorkerSupported = true,
}: IsolationInput): IsolationPlan {
  if (crossOriginIsolated) {
    return { action: "already-isolated", reason: "the document is already cross-origin isolated" };
  }

  if (!serviceWorkerSupported) {
    return {
      action: "unsupported",
      reason: "this browser has no service worker support, so headers must come from the host",
    };
  }

  if (attempted) {
    return {
      action: "give-up",
      reason:
        "cross-origin isolation could not be enabled by the service worker; " +
        "this host must send Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy explicitly",
    };
  }

  if (controlled) {
    // Already controlled but still not isolated: the worker is active and its
    // headers will apply to the next navigation, so reload once.
    return { action: "register-and-reload", reason: "worker is active; reloading to apply headers" };
  }

  // Not yet controlled. Registration takes effect on the next navigation, so
  // the reload is part of the same step rather than a separate action.
  return {
    action: "register-and-reload",
    reason: "registering the isolation service worker and reloading to apply headers",
  };
}

/**
 * Inline bootstrap source.
 *
 * Kept as a string so `src/index.html` can inline it: an external script would
 * itself be a sub-resource fetched before isolation is in place, and inlining
 * avoids an extra round trip on the critical path.
 */
export function coiBootstrapScript(): string {
  return `(function () {
  var SW = ${JSON.stringify(COI_SW_PATH)};
  var KEY = ${JSON.stringify(COI_ATTEMPT_KEY)};
  var headers = ${JSON.stringify(COI_HEADERS)};
  function attempted() {
    try { return sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }
  function markAttempted() {
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
  }
  function isolated() {
    return typeof self !== "undefined" && self.crossOriginIsolated === true;
  }
  if (isolated()) return;
  if (!("serviceWorker" in navigator)) return;
  if (attempted()) {
    console.warn(
      "[wasm-ide] Cross-origin isolation could not be enabled by the service worker. " +
      "Serving COOP/COEP headers from the host is required for the WebAssembly runtimes to work."
    );
    return;
  }
  navigator.serviceWorker.register(SW).then(function () {
    return navigator.serviceWorker.ready;
  }).then(function () {
    if (!isolated()) {
      markAttempted();
      location.reload();
    }
  }).catch(function (error) {
    console.warn("[wasm-ide] isolation service worker failed to register:", error);
  });
})();`;
}
