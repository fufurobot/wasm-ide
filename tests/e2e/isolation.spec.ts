/**
 * Spec: the deployed site must become cross-origin isolated even when the host
 * cannot send COOP/COEP headers.
 *
 * GitHub Pages — the actual deployment target — has no way to set response
 * headers, but `@runno/wasi` needs `SharedArrayBuffer`, which browsers only
 * expose to cross-origin-isolated documents. `public/coi-serviceworker.js`
 * injects the headers client-side to close that gap.
 *
 * A plain static server strips the headers in `beforeEach`, so these tests
 * prove the *service worker* is doing the work rather than a header the host
 * happened to send. Without it, every Run in production would fail.
 */

import { expect, test } from "@playwright/test";

test.describe("cross-origin isolation without host headers", () => {
  test.beforeEach(async ({ page }) => {
    // Simulate GitHub Pages: no COOP/COEP on any response. Playwright applies
    // this to every request the page makes, including the worker script.
    await page.route("**/*", async route => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["cross-origin-opener-policy"];
      delete headers["cross-origin-embedder-policy"];
      delete headers["cross-origin-resource-policy"];
      await route.fulfill({ response, headers });
    });
  });

  test("the service worker makes the document cross-origin isolated", async ({ page }) => {
    await page.goto("/");

    // The bootstrap registers the worker and reloads once; isolation must then
    // be true, which is what unlocks SharedArrayBuffer.
    await expect
      .poll(async () => page.evaluate(() => self.crossOriginIsolated), { timeout: 30_000 })
      .toBe(true);
  });

  test("SharedArrayBuffer becomes usable, so the runtimes can allocate", async ({ page }) => {
    await page.goto("/");
    await expect
      .poll(async () => page.evaluate(() => self.crossOriginIsolated), { timeout: 30_000 })
      .toBe(true);

    // This is the exact constructor that failed before the shim existed.
    const ok = await page.evaluate(() => {
      try {
        const buffer = new SharedArrayBuffer(8);
        return buffer.byteLength === 8;
      } catch {
        return false;
      }
    });
    expect(ok).toBe(true);
  });

  test("does not reload forever when isolation cannot be achieved", async ({ page }) => {
    // Break the worker so isolation can never succeed, then count reloads.
    let navigations = 0;
    page.on("framenavigated", frame => {
      if (frame === page.mainFrame()) navigations += 1;
    });

    await page.route("**/coi-serviceworker.js", route => route.fulfill({ status: 404, body: "" }));
    await page.goto("/");

    // Give any reload loop time to reveal itself.
    await page.waitForTimeout(6_000);
    // One navigation plus at most one reload attempt. A loop would blow past this.
    expect(navigations).toBeLessThanOrEqual(3);
  });
});
