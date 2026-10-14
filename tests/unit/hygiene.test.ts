/**
 * Spec: repository secret hygiene.
 *
 * The runner is a statically-served wasm IDE; there is no backend that may hold
 * credentials. Therefore the only safe configuration is:
 *   1. `.env` is never tracked,
 *   2. every credential-bearing file pattern is ignored,
 *   3. `.env.example` documents the shape of the file with values erased,
 *   4. no secret can reach the browser bundle, which bunfig.toml gates behind
 *      the `BUN_PUBLIC_*` prefix.
 *
 * These tests are intentionally written against the filesystem, so they fail
 * before the hygiene commit and pass after it.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Run `git check-ignore` for a path; exit 0 means ignored. */
function isIgnored(rel: string): boolean {
  const proc = Bun.spawnSync(["git", "check-ignore", "-q", rel], { cwd: ROOT });
  return proc.exitCode === 0;
}

describe("gitignore", () => {
  const ignored = [
    ".env",
    ".env.local",
    ".env.production",
    "deploy.pem",
    "private.pem",
    "id_rsa",
  ];

  for (const path of ignored) {
    test(`${path} is ignored`, () => {
      expect(isIgnored(path)).toBe(true);
    });
  }

  test("the real .env is not tracked by git", () => {
    const proc = Bun.spawnSync(["git", "ls-files", "--error-unmatch", ".env"], { cwd: ROOT });
    expect(proc.exitCode).not.toBe(0);
  });
});

describe(".env.example", () => {
  test("exists", () => {
    expect(existsSync(join(ROOT, ".env.example"))).toBe(true);
  });

  test("is tracked (it is documentation, not a secret)", () => {
    const proc = Bun.spawnSync(["git", "ls-files", "--error-unmatch", ".env.example"], { cwd: ROOT });
    expect(proc.exitCode).toBe(0);
  });

  test("documents DEEPSEEK_GITHUB_TOKEN with an empty value", () => {
    const body = read(".env.example");
    expect(body).toMatch(/^DEEPSEEK_GITHUB_TOKEN=\s*$/m);
  });

  test("contains no credential-shaped values", () => {
    const body = read(".env.example");
    // GitHub fine-grained PATs and classic tokens, plus generic long secrets.
    expect(body).not.toMatch(/github_pat_[A-Za-z0-9_]{20,}/);
    expect(body).not.toMatch(/gh[pousr]_[A-Za-z0-9]{30,}/);
    expect(body).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });

  test("every assignment is empty or an obvious placeholder", () => {
    const body = read(".env.example");
    for (const line of body.split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, value] = match as unknown as [string, string, string];
      const looksPlaceholder = value === "" || /^(<.*>|your[_-]|xxx|changeme|placeholder)/i.test(value);
      expect(`${key}=${value} placeholder=${looksPlaceholder}`).toBe(`${key}=${value} placeholder=true`);
    }
  });
});

describe("bundle isolation", () => {
  test("bunfig.toml only exposes BUN_PUBLIC_* to the frontend", () => {
    const body = read("bunfig.toml");
    expect(body).toMatch(/env\s*=\s*"BUN_PUBLIC_\*"/);
  });

  test("the token variable is not BUN_PUBLIC_ prefixed", () => {
    const body = read(".env.example");
    expect(body).not.toMatch(/^BUN_PUBLIC_/m);
  });
});

describe("no secrets committed to the working tree", () => {
  test("tracked files contain no fine-grained PAT", () => {
    const proc = Bun.spawnSync(["git", "grep", "-I", "-l", "-E", "github_pat_[A-Za-z0-9_]{20,}"], {
      cwd: ROOT,
    });
    const found = proc.stdout.toString().trim();
    expect(found).toBe("");
  });
});
