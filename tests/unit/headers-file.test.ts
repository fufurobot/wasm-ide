/**
 * Spec: the `_headers` file must agree with the tested isolation policy.
 *
 * `public/_headers` is consumed by Cloudflare Pages / Netlify (GitHub Pages
 * ignores it). The header names and values must match `COI_HEADERS`, otherwise
 * a CDN could send subtly different headers than the ones the service worker
 * fallback injects — and the two would drift silently.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COI_HEADERS, COI_SW_FILENAME } from "@/lib/coi";

const HEADERS_FILE = join(import.meta.dir, "..", "..", "public", "_headers");
const body = readFileSync(HEADERS_FILE, "utf8");

/** Collect `Name: value` pairs appearing under a given path rule. */
function headersFor(pathRule: string): Record<string, string> {
  const lines = body.split("\n");
  const found: Record<string, string> = {};
  let active = false;
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      active = line.trim() === pathRule;
      continue;
    }
    if (!active) continue;
    const match = /^\s+([A-Za-z-]+):\s*(.+?)\s*$/.exec(line);
    if (match) found[match[1]!] = match[2]!;
  }
  return found;
}

describe("public/_headers", () => {
  test("applies the isolation headers to every path", () => {
    const wildcard = headersFor("/*");
    for (const [name, value] of Object.entries(COI_HEADERS)) {
      expect(`${name}: ${wildcard[name]}`).toBe(`${name}: ${value}`);
    }
  });

  test("also covers the service worker path", () => {
    // Hosts match rules against request paths, so these stay absolute even
    // though the bootstrap registers the worker relatively. Both the domain
    // root and the GitHub Pages project-subpath form are covered.
    for (const rule of [`/${COI_SW_FILENAME}`, `/wasm-ide/${COI_SW_FILENAME}`]) {
      const sw = headersFor(rule);
      expect(`${rule} COOP: ${sw["Cross-Origin-Opener-Policy"]}`).toBe(
        `${rule} COOP: ${COI_HEADERS["Cross-Origin-Opener-Policy"]}`,
      );
      expect(`${rule} COEP: ${sw["Cross-Origin-Embedder-Policy"]}`).toBe(
        `${rule} COEP: ${COI_HEADERS["Cross-Origin-Embedder-Policy"]}`,
      );
    }
  });

  test("prevents caching of the app shell and the worker", () => {
    // A stale index.html would reference bundle hashes that no longer exist,
    // and a stale worker could keep a broken shim alive.
    expect(headersFor("/")["Cache-Control"]).toContain("no-cache");
    expect(headersFor(`/${COI_SW_FILENAME}`)["Cache-Control"]).toContain("no-cache");
  });

  test("allows hashed chunks to be cached immutably", () => {
    expect(headersFor("/chunk-*")["Cache-Control"]).toContain("immutable");
  });

  test("names the service worker it depends on", () => {
    expect(body).toContain(COI_SW_FILENAME);
  });
});
