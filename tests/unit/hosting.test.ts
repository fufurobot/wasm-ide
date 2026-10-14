/**
 * Spec: the static host must be cross-origin isolated.
 *
 * `@runno/wasi` allocates a `SharedArrayBuffer` for program stdin. Browsers
 * only expose that constructor to cross-origin-isolated documents, which means
 * a host that forgets COOP/COEP breaks *every* run with
 * "SharedArrayBuffer is not defined".
 *
 * That is not hypothetical: the first end-to-end run of this project failed
 * exactly that way. These tests pin the behaviour on a real response so it
 * cannot regress.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CROSS_ORIGIN_ISOLATION_HEADERS, handleStaticRequest } from "@/preview";

/**
 * `handleStaticRequest` reads from `<repo>/dist`.
 *
 * CI runs the unit suite *before* the build, so rather than assume a built
 * bundle exists (which failed on the first CI run), these tests lay down the
 * two files they need. That keeps the suite order-independent.
 */
const DIST = join(import.meta.dir, "..", "..", "dist");
const INDEX = join(DIST, "index.html");
const FIXTURE = `<html data-wasm-ide-test-fixture="true"><body>fixture</body></html>`;

let hadRealBuild = false;

beforeAll(async () => {
  await mkdir(DIST, { recursive: true });
  const existing = Bun.file(INDEX);
  hadRealBuild = await existing.exists();
  if (!hadRealBuild) await writeFile(INDEX, FIXTURE, "utf8");
});

afterAll(async () => {
  // Never leave a fake index.html behind for a later real build or the e2e run.
  if (!hadRealBuild) await rm(INDEX, { force: true });
});

describe("cross-origin isolation header contract", () => {
  test("declares opener policy same-origin", () => {
    expect(CROSS_ORIGIN_ISOLATION_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  test("declares embedder policy require-corp", () => {
    expect(CROSS_ORIGIN_ISOLATION_HEADERS["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
  });

  test("allows the wasm CDN to be embedded", () => {
    expect(CROSS_ORIGIN_ISOLATION_HEADERS["Cross-Origin-Resource-Policy"]).toBe("cross-origin");
  });
});

describe("handleStaticRequest", () => {
  test("serves index.html with the isolation headers execution requires", async () => {
    const response = await handleStaticRequest(new Request("http://localhost/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
  });

  test("404s an unknown path rather than falling back to index.html", async () => {
    // No SPA fallback: GitHub Pages has no rewrite rules, so inventing one here
    // would hide a real deployment break.
    const response = await handleStaticRequest(new Request("http://localhost/definitely-missing"));
    expect(response.status).toBe(404);
  });

  test("refuses to escape the build directory", async () => {
    const response = await handleStaticRequest(new Request("http://localhost/../../etc/passwd"));
    expect([403, 404]).toContain(response.status);
  });
});
