/**
 * Spec: both consumption modes work in a REAL browser.
 *
 * Unit tests can only prove the package *shape*. What actually matters is that
 * a consumer can use the published library, so these tests load the built
 * library bundles the way a third party would:
 *
 *   - vanilla: a bare <script type="module"> page, no bundler, no React
 *   - react:   a module page that imports React from a CDN and mounts <WasmIDE />
 *
 * Both then execute real WebAssembly, because "it renders" is not the contract —
 * "it runs your code" is.
 *
 * Requires `bun run build:lib` and a static server for the fixture pages.
 */

import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.LIB_BASE_URL;

test.describe("library consumers", () => {
  test.skip(!BASE, "set LIB_BASE_URL to run the library integration suite");

  async function waitForTerminalText(page: Page, needle: string, timeout = 240_000) {
    await expect(page.locator('[data-testid="terminal-output"]').first()).toContainText(needle, {
      timeout,
    });
  }

  test("vanilla: createIDE mounts and runs code with no React on the page", async ({ page }) => {
    const reactLoaded: string[] = [];
    page.on("request", request => {
      if (/react/i.test(request.url())) reactLoaded.push(request.url());
    });

    await page.goto(`${BASE}/vanilla.html`);

    // The fixture page records what the library returned so we can assert on it.
    await expect(page.locator("[data-testid='mount-status']")).toHaveText("mounted", {
      timeout: 30_000,
    });

    await page.locator("[data-testid='run-button']").first().click();
    await waitForTerminalText(page, "fib(9) = 34");

    // The React entry must never be needed for the vanilla path.
    expect(reactLoaded.filter(url => !url.includes("monaco"))).toEqual([]);
  });

  test("vanilla: exposes an imperative handle", async ({ page }) => {
    await page.goto(`${BASE}/vanilla.html`);
    await expect(page.locator("[data-testid='mount-status']")).toHaveText("mounted");

    const api = await page.evaluate(() => {
      const handle = (window as unknown as { ide: Record<string, unknown> }).ide;
      return {
        hasDestroy: typeof handle?.destroy === "function",
        hasSetLanguage: typeof handle?.setLanguage === "function",
        hasSetSource: typeof handle?.setSource === "function",
        state: handle?.getState ? JSON.parse(JSON.stringify(handle.getState())) : null,
      };
    });

    expect(api.hasDestroy).toBe(true);
    expect(api.hasSetLanguage).toBe(true);
    expect(api.hasSetSource).toBe(true);
    expect(api.state?.language).toBe("python");
  });

  test("react: <WasmIDE /> mounts and runs code", async ({ page }) => {
    await page.goto(`${BASE}/react.html`);
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });

    await page.locator("[data-testid='run-button']").first().click();
    await waitForTerminalText(page, "fib(9) = 34");
  });

  test("react: respects the language and source props", async ({ page }) => {
    await page.goto(`${BASE}/react.html?lang=c`);

    // The C sample is what the prop asks for; running it must print its marker.
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });
    await page.locator("[data-testid='run-button']").first().click();
    await waitForTerminalText(page, "square(5) = 25");
  });

  test("the library never contacts an /api/ backend", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", request => {
      if (request.url().includes("/api/")) apiCalls.push(request.url());
    });

    await page.goto(`${BASE}/vanilla.html`);
    await expect(page.locator("[data-testid='mount-status']")).toHaveText("mounted");
    await page.locator("[data-testid='run-button']").first().click();
    await waitForTerminalText(page, "fib(9) = 34");

    expect(apiCalls).toEqual([]);
  });
});
