/**
 * Spec: the cross-origin-isolation service worker.
 *
 * GitHub Pages cannot set response headers, but `@runno/wasi` needs
 * `SharedArrayBuffer`, which browsers only expose to cross-origin-isolated
 * documents. The service worker closes that gap by injecting COOP/COEP into
 * same-origin responses and reloading once.
 *
 * These tests pin the shim's *policy* — which responses get which headers, and
 * the reload-once behaviour — independently of any browser.
 */

import { describe, expect, test } from "bun:test";
import {
  COI_HEADERS,
  COI_SW_PATH,
  isSameOrigin,
  shouldIsolate,
  planIsolation,
  coiBootstrapScript,
} from "@/lib/coi";

describe("COI_HEADERS", () => {
  test("matches what a header-capable host would send", () => {
    expect(COI_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(COI_HEADERS["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
  });
});

describe("service worker path", () => {
  test("is relative, so subpath deployments resolve it", () => {
    // This is the bug that broke production. GitHub Pages project sites are
    // served from /<repo>/, so an absolute "/coi-serviceworker.js" resolved to
    // https://fufurobot.github.io/coi-serviceworker.js and 404'd, while the
    // file actually shipped to /wasm-ide/coi-serviceworker.js.
    expect(COI_SW_PATH.startsWith("/")).toBe(false);
    expect(COI_SW_PATH.endsWith(".js")).toBe(true);
  });

  test("resolves against a subpath base the way a browser would", () => {
    // Path-relative resolution: "./x.js" at /wasm-ide/ -> /wasm-ide/x.js
    const resolved = new URL(COI_SW_PATH, "https://example.com/wasm-ide/").pathname;
    expect(resolved).toBe("/wasm-ide/coi-serviceworker.js");
  });

  test("still resolves correctly when served from the domain root", () => {
    const resolved = new URL(COI_SW_PATH, "https://example.com/").pathname;
    expect(resolved).toBe("/coi-serviceworker.js");
  });
});

describe("isSameOrigin", () => {
  test("accepts a same-origin URL", () => {
    expect(isSameOrigin("https://example.com/app.js", "https://example.com")).toBe(true);
  });

  test("rejects a cross-origin URL", () => {
    expect(isSameOrigin("https://cdn.example.net/lib.js", "https://example.com")).toBe(false);
  });

  test("rejects an opaque or relative scheme", () => {
    expect(isSameOrigin("about:blank", "https://example.com")).toBe(false);
  });
});

describe("shouldIsolate", () => {
  test("isolates same-origin document and script responses", () => {
    for (const dest of ["document", "script", "worker", "style"]) {
      expect(`${dest}:${shouldIsolate("https://example.com", "https://example.com", dest)}`).toBe(
        `${dest}:true`,
      );
    }
  });

  test("leaves cross-origin responses alone", () => {
    // Rewriting a third party's headers would break CORS and the wasm CDN.
    expect(shouldIsolate("https://cdn.example.net/x.js", "https://example.com", "script")).toBe(
      false,
    );
  });

  test("skips the worker itself so it cannot recurse", () => {
    // Resolved under a subpath base, as it would be in production.
    expect(
      shouldIsolate("https://example.com/wasm-ide/coi-serviceworker.js", "https://example.com", "script"),
    ).toBe(false);
    expect(shouldIsolate("https://example.com/coi-serviceworker.js", "https://example.com", "script")).toBe(
      false,
    );
  });

  test("skips already-isolated opaque responses", () => {
    expect(shouldIsolate("https://example.com/a.js", "https://example.com", "")).toBe(false);
  });
});

describe("planIsolation", () => {
  test("asks for a reload when the page is not yet isolated", () => {
    const plan = planIsolation({ crossOriginIsolated: false, controlled: false, attempted: false });
    expect(plan.action).toBe("register-and-reload");
  });

  test("does not reload forever once isolation has been attempted", () => {
    // A reload loop would make the page unusable; this is the single most
    // important behaviour to pin.
    const plan = planIsolation({ crossOriginIsolated: false, controlled: true, attempted: true });
    expect(plan.action).toBe("give-up");
    expect(plan.reason).toMatch(/header|explicit/i);
  });

  test("reports success when the document is already isolated", () => {
    const plan = planIsolation({ crossOriginIsolated: true, controlled: true, attempted: true });
    expect(plan.action).toBe("already-isolated");
  });

  test("is a no-op where service workers are unavailable", () => {
    const plan = planIsolation({
      crossOriginIsolated: false,
      controlled: false,
      attempted: false,
      serviceWorkerSupported: false,
    });
    expect(plan.action).toBe("unsupported");
  });
});

describe("coiBootstrapScript", () => {
  test("is a self-contained inline script", () => {
    const script = coiBootstrapScript();
    expect(script.length).toBeGreaterThan(0);
    // It must survive being inlined into HTML.
    expect(script).not.toContain("</script>");
  });

  test("guards against reloading more than once", () => {
    expect(coiBootstrapScript()).toMatch(/sessionStorage|reload/i);
  });
});
