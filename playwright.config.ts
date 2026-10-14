/**
 * Playwright config for the wasm IDE.
 *
 * Point `PW_BASE_URL` at an already-running preview (CI uses this after
 * `bun run build` + `bun run preview`) or omit it to let Playwright boot
 * `bun run dev` itself.
 *
 * Wasm runtimes are downloaded on first use and compiled in the browser, so
 * timeouts are generous and tests run serially to avoid competing for CPU.
 */

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PW_BASE_URL ?? "http://127.0.0.1:3000";
const useExternalServer = Boolean(process.env.PW_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: useExternalServer
    ? undefined
    : {
        command: "bun run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
