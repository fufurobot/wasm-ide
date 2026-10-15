/**
 * Spec: every asset the built HTML references must actually ship.
 *
 * The live GitHub Pages deployment served `index.html` referencing
 * `./logo.svg`, but `build.ts` only bundled `src/**\/*.html` and never copied
 * the SVG, so the favicon returned 404. Nothing caught it because the app still
 * rendered — a broken favicon is invisible to a functional test.
 *
 * This test reads the built HTML, extracts every relative asset reference, and
 * asserts each one exists in `dist/`. It would have caught the 404 before
 * deployment.
 *
 * It lives in `tests/dist/` rather than `tests/unit/` because it needs a real
 * build: CI runs the unit suite *before* `bun run build`, so a dist-dependent
 * test in there fails for ordering reasons rather than for real breakage. The
 * `test:dist` script runs after the build.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const DIST = join(ROOT, "dist");
const INDEX = join(DIST, "index.html");

let html = "";

beforeAll(() => {
  if (existsSync(INDEX)) html = readFileSync(INDEX, "utf8");
});

/** Relative asset references (./foo) from src/href attributes. */
function referencedAssets(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
    found.add(match[1]!);
  }
  return [...found];
}

describe("built bundle completeness", () => {
  test("dist/index.html exists (run `bun run build` first)", () => {
    expect(existsSync(INDEX)).toBe(true);
  });

  test("references at least one asset", () => {
    // Guards against the extraction regex silently matching nothing.
    expect(referencedAssets(html).length).toBeGreaterThan(0);
  });

  test("every referenced asset is present in dist/", () => {
    const missing = referencedAssets(html).filter(asset => !existsSync(join(DIST, asset)));
    // Reporting the names makes the failure actionable rather than just "false".
    expect(missing.join(", ")).toBe("");
  });

  test("the favicon in particular ships", () => {
    // The exact asset that 404'd in production.
    const favicon = /<link[^>]+rel="icon"[^>]+href="\.\/([^"]+)"/.exec(html)?.[1];
    expect(favicon).toBeTruthy();
    expect(existsSync(join(DIST, favicon!))).toBe(true);
  });
});
