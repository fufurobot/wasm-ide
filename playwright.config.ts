/**
 * Playwright config for the wasm IDE.
 *
 * Servers are always external: different suites need different deployment
 * shapes (domain root, a /<repo>/ subpath, and the published-library fixtures),
 * so each is started by its own script and pointed at with an env var.
 *
 * Wasm runtimes are downloaded on first use and compiled in the browser, so
 * timeouts are generous and tests run serially to avoid competing for CPU.
 */

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PW_BASE_URL ?? "http://127.0.0.1:3000";

/**
 * Set `PW_CHROMIUM_EXECUTABLE` to use an already-installed browser (for
 * example `/usr/bin/chromium` in CI images that ship one) instead of
 * Playwright's own download.
 */
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./tests/e2e",
  // ONE browser at a time, always. This is a deliberate resource constraint:
  // each Chromium instance boots a Monaco editor and compiles multi-megabyte
  // wasm toolchains, and running several at once exhausts the machine. It also
  // means two Playwright invocations must never be started concurrently - run
  // one suite, wait for it, then run the next.
  fullyParallel: false,
  workers: 1,
  maxFailures: 0,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Video needs Playwright's bundled ffmpeg. When running against a system
    // browser (PW_CHROMIUM_EXECUTABLE), that binary may be absent while the
    // browser itself is fine, so recording is opt-in rather than breaking the
    // whole suite.
    video: process.env.PW_VIDEO === "1" ? "retain-on-failure" : "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(executablePath ? { launchOptions: { executablePath } } : {}) },
    },
  ],
});
