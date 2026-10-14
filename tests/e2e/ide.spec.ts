/**
 * Sprint 1 e2e spec — written BEFORE the UI exists.
 *
 * This is the contract for the wasm IDE. It runs against the dev server and
 * asserts what a user can actually do:
 *   - pick a language, see it reflected in the editor
 *   - edit and RUN real WebAssembly code, seeing real stdout
 *   - feed stdin into the program
 *   - share a permalink that restores the workspace on reload
 *   - keep working with no backend at all
 *
 * Run with:  bun run test:e2e
 */

import { expect, test, type Page } from "@playwright/test";

/** Wait until the Monaco editor has mounted and expose it as a locator. */
async function waitForEditor(page: Page) {
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return editor;
}

/** Replace the whole editor buffer with `code` via the keyboard. */
async function setEditorContent(page: Page, code: string) {
  await waitForEditor(page);
  await page.locator(".monaco-editor textarea").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  // Monaco auto-closes brackets; insertText bypasses that and pastes verbatim.
  await page.keyboard.insertText(code);
}

const TERMINAL = '[data-testid="terminal-output"]';
const RUN_BUTTON = '[data-testid="run-button"]';
const LANGUAGE_PICKER = '[data-testid="language-picker"]';

test.describe("wasm-ide", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders the IDE shell with editor, terminal and controls", async ({ page }) => {
    await waitForEditor(page);
    await expect(page.locator(TERMINAL)).toBeVisible();
    await expect(page.locator(RUN_BUTTON)).toBeVisible();
    await expect(page.locator(LANGUAGE_PICKER)).toBeVisible();
  });

  test("runs the default Python program and shows real stdout", async ({ page }) => {
    await waitForEditor(page);
    await page.locator(RUN_BUTTON).click();

    // Real wasm execution: fib(10) == 55 must appear in the output.
    await expect(page.locator(TERMINAL)).toContainText("fib(9) = 34", { timeout: 180_000 });
    await expect(page.locator(TERMINAL)).toContainText("fib(10) = 55");
  });

  test("runs edited C code through clang", async ({ page }) => {
    await page.locator(LANGUAGE_PICKER).selectOption("c");
    await setEditorContent(
      page,
      ['#include <stdio.h>', "int main(void) {", '  printf("C-RUNTIME-OK\\n");', "  return 0;", "}"].join(
        "\n",
      ),
    );

    await page.locator(RUN_BUTTON).click();
    await expect(page.locator(TERMINAL)).toContainText("C-RUNTIME-OK", { timeout: 240_000 });
  });

  test("feeds stdin into the running program", async ({ page }) => {
    await page.locator(LANGUAGE_PICKER).selectOption("python");
    await setEditorContent(page, 'name = input("who? ")\nprint(f"hello {name}")');

    await page.locator('[data-testid="stdin-input"]').fill("wasm");
    await page.locator(RUN_BUTTON).click();

    await expect(page.locator(TERMINAL)).toContainText("hello wasm", { timeout: 180_000 });
  });

  test("surfaces stderr and a non-zero exit code", async ({ page }) => {
    await page.locator(LANGUAGE_PICKER).selectOption("python");
    await setEditorContent(page, 'import sys\nprint("to stderr", file=sys.stderr)\nsys.exit(3)');

    await page.locator(RUN_BUTTON).click();

    await expect(page.locator(TERMINAL)).toContainText("to stderr", { timeout: 180_000 });
    await expect(page.locator('[data-testid="run-status"]')).toContainText("3");
  });

  test("language picker offers exactly Runno's runnable languages", async ({ page }) => {
    const options = page.locator(`${LANGUAGE_PICKER} option`);
    await expect(options).toHaveCount(7);
    const values = await options.evaluateAll(nodes =>
      nodes.map(node => (node as HTMLOptionElement).value),
    );
    expect(values.sort()).toEqual(
      ["c", "cpp", "javascript", "php", "python", "ruby", "sql"].sort(),
    );
  });

  test("switching language swaps the sample program", async ({ page }) => {
    await waitForEditor(page);
    const before = await page.locator(".monaco-editor").first().innerText();

    await page.locator(LANGUAGE_PICKER).selectOption("ruby");

    await expect
      .poll(async () => page.locator(".monaco-editor").first().innerText(), { timeout: 15_000 })
      .not.toBe(before);
  });

  test("share permalink restores the workspace after reload", async ({ page }) => {
    await page.locator(LANGUAGE_PICKER).selectOption("python");
    await setEditorContent(page, 'print("PERMALINK-ROUNDTRIP")');

    await page.locator('[data-testid="share-button"]').click();

    // The share action must put state in the URL fragment.
    await expect.poll(async () => page.url(), { timeout: 10_000 }).toContain("#");
    const shared = page.url();

    await page.goto(shared);
    await waitForEditor(page);
    await expect(page.locator(".monaco-editor").first()).toContainText("PERMALINK-ROUNDTRIP", {
      timeout: 15_000,
    });

    await page.locator(RUN_BUTTON).click();
    await expect(page.locator(TERMINAL)).toContainText("PERMALINK-ROUNDTRIP", { timeout: 180_000 });
  });

  test("works with no backend: every request is same-origin static", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", request => {
      if (request.url().includes("/api/")) apiCalls.push(request.url());
    });

    await waitForEditor(page);
    await page.locator(RUN_BUTTON).click();
    await expect(page.locator(TERMINAL)).toContainText("fib(", { timeout: 180_000 });

    // The starter template shipped an /api/hello endpoint; the IDE must not
    // depend on any server-side route because it is published to Pages.
    expect(apiCalls).toEqual([]);
  });
});
