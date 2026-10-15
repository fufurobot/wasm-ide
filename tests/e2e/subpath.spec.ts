/**
 * Spec: the app must work when served from a SUBPATH, not just a domain root.
 *
 * This is the bug that shipped. GitHub Pages project sites serve from
 * `/<repo>/`, but the isolation bootstrap registered the worker at the absolute
 * `/coi-serviceworker.js`. That 404'd in production, so the page never became
 * cross-origin isolated and could not run any WebAssembly — while every local
 * test passed, because `bun run preview` serves from `/`.
 *
 * `SUBPATH_BASE_URL` points at a preview that mounts `dist/` under a prefix
 * (see the `preview:subpath` script). When it is unset these tests skip rather
 * than silently pass.
 */

import { expect, test, type Page } from "@playwright/test";

const SUBPATH_BASE = process.env.SUBPATH_BASE_URL;

test.describe("subpath deployment (GitHub Pages project site)", () => {
  test.skip(!SUBPATH_BASE, "set SUBPATH_BASE_URL to run the subpath suite");

  async function openApp(page: Page) {
    await page.goto(`${SUBPATH_BASE}/`);
    await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
  }

  test("the service worker registers at the subpath, not the domain root", async ({ page }) => {
    await openApp(page);

    // Give the bootstrap a chance to register and reload.
    await expect
      .poll(async () => page.evaluate(() => self.crossOriginIsolated), { timeout: 60_000 })
      .toBe(true);

    const registered = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.map(r => r.active?.scriptURL ?? r.scope);
    });

    expect(registered.length).toBeGreaterThan(0);
    // The whole point: the script URL must live under the subpath.
    for (const url of registered) {
      expect(url).toContain(new URL(`${SUBPATH_BASE}/`).pathname);
    }
  });

  test("SharedArrayBuffer is available under the subpath", async ({ page }) => {
    await openApp(page);
    await expect
      .poll(async () => page.evaluate(() => self.crossOriginIsolated), { timeout: 60_000 })
      .toBe(true);

    const ok = await page.evaluate(() => {
      try {
        return new SharedArrayBuffer(8).byteLength === 8;
      } catch {
        return false;
      }
    });
    expect(ok).toBe(true);
  });

  test("code actually executes under the subpath", async ({ page }) => {
    await openApp(page);
    await expect
      .poll(async () => page.evaluate(() => self.crossOriginIsolated), { timeout: 60_000 })
      .toBe(true);

    await page.locator('[data-testid="run-button"]').click();
    // A cold run downloads the python image and boots CPython.
    await expect(page.locator('[data-testid="terminal-output"]')).toContainText("fib(9) = 34", {
      timeout: 240_000,
    });
  });
});
