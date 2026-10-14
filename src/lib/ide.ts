/**
 * Pure core of the wasm IDE.
 *
 * This module has no React, no DOM and no Runno/Monaco imports, so it can be
 * unit tested in Bun and reused by the UI shell. Keeping the browser globals
 * out of here is what makes the runner testable at all.
 *
 * Runno's `Runtime` union is the source of truth for what can actually run:
 *   python | quickjs | sqlite | clang | clangpp | ruby | php-cgi
 * There is deliberately no Bash and no TypeScript entry, because Runno ships
 * no wasm runtime for them; advertising them would be a broken picker item.
 */

export type EditorLanguage = "python" | "javascript" | "sql" | "c" | "cpp" | "ruby" | "php";

/** Every runtime target Runno can execute. */
export const RUNNO_HEADLESS_LANGUAGES = [
  "python",
  "quickjs",
  "sqlite",
  "clang",
  "clangpp",
  "ruby",
  "php-cgi",
] as const;

export type RunnoRuntime = (typeof RUNNO_HEADLESS_LANGUAGES)[number];

export type LanguageSpec = {
  /** Human label for the picker. */
  label: string;
  /** Monaco's language id. */
  monacoId: string;
  /** Runno runtime id. */
  runnoId: RunnoRuntime;
  /** Extension of the entry file, including the dot. */
  extension: string;
  /** Entry file base name inside the virtual FS. */
  entryName: string;
  /** Map a runtime id to the entry extension; a single language per runtime. */
  extensionFor: (runtime: RunnoRuntime) => string;
};

/**
 * Entry file the IDE compiles/runs. Runno's C/C++ and Python images all look
 * for `main`, so the base name is stable and only the extension varies.
 */
const ENTRY_BASE = "main";

function makeSpec(
  label: string,
  monacoId: string,
  runnoId: RunnoRuntime,
  extension: string,
): LanguageSpec {
  return {
    label,
    monacoId,
    runnoId,
    extension,
    entryName: `${ENTRY_BASE}${extension}`,
    extensionFor: (runtime: RunnoRuntime) => {
      const spec = Object.values(LANGUAGES).find(candidate => candidate.runnoId === runtime);
      return spec?.extension ?? extension;
    },
  };
}

export const LANGUAGES: Record<EditorLanguage, LanguageSpec> = {
  python: makeSpec("Python", "python", "python", ".py"),
  javascript: makeSpec("JavaScript", "javascript", "quickjs", ".js"),
  sql: makeSpec("SQL (SQLite)", "sql", "sqlite", ".sql"),
  c: makeSpec("C (clang)", "c", "clang", ".c"),
  cpp: makeSpec("C++ (clang++)", "cpp", "clangpp", ".cpp"),
  ruby: makeSpec("Ruby", "ruby", "ruby", ".rb"),
  php: makeSpec("PHP", "php", "php-cgi", ".php"),
};

/** Default language for a fresh workspace or an unreadable permalink. */
export const DEFAULT_LANGUAGE: EditorLanguage = "python";

export function isLanguage(value: unknown): value is EditorLanguage {
  return typeof value === "string" && Object.hasOwn(LANGUAGES, value);
}

/** True when the language has a Runno runtime behind it. */
export function isRunnable(value: unknown): value is EditorLanguage {
  if (!isLanguage(value)) return false;
  return (RUNNO_HEADLESS_LANGUAGES as readonly string[]).includes(LANGUAGES[value].runnoId);
}

export function languageIdForMonaco(language: EditorLanguage): string {
  return LANGUAGES[language]?.monacoId ?? "plaintext";
}

export function runtimeFor(language: EditorLanguage): RunnoRuntime {
  const spec = LANGUAGES[language];
  if (!spec) throw new Error(`Unknown language: ${String(language)}`);
  return spec.runnoId;
}

const DEFAULT_SOURCES: Record<EditorLanguage, string> = {
  python: `# Python running fully in your browser via WebAssembly.
# Nothing you type here ever leaves this page.

def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

for i in range(10):
    print(f"fib({i}) = {fib(i)}")
`,
  javascript: `// JavaScript on the QuickJS WebAssembly runtime.
const names = ["ada", "grace", "katherine"];

for (const [i, name] of names.entries()) {
  console.log(\`\${i + 1}. \${name.toUpperCase()}\`);
}
`,
  sql: `-- SQLite compiled to WebAssembly.
CREATE TABLE languages (name TEXT, year INTEGER);

INSERT INTO languages (name, year) VALUES
  ('C', 1972),
  ('Python', 1991),
  ('Rust', 2010);

SELECT name, year FROM languages ORDER BY year;
`,
  c: `#include <stdio.h>

int main(void) {
    for (int i = 1; i <= 5; i++) {
        printf("square(%d) = %d\\n", i, i * i);
    }
    return 0;
}
`,
  cpp: `#include <iostream>
#include <vector>

int main() {
    std::vector<int> values{3, 1, 4, 1, 5, 9, 2, 6};
    int total = 0;
    for (int value : values) total += value;
    std::cout << "sum = " << total << std::endl;
    return 0;
}
`,
  ruby: `# Ruby on WebAssembly.
%w[wasm ide without a server].each_with_index do |word, i|
  puts "#{i + 1}: #{word}"
end
`,
  php: `<?php
$stack = ["monaco", "runno", "webassembly"];

foreach ($stack as $index => $layer) {
    echo ($index + 1) . ". " . strtoupper($layer) . PHP_EOL;
}
`,
};

export function defaultSource(language: EditorLanguage): string {
  return DEFAULT_SOURCES[language] ?? DEFAULT_SOURCES[DEFAULT_LANGUAGE];
}

// ---------------------------------------------------------------------------
// Permalink state
// ---------------------------------------------------------------------------

export type ShareState = {
  language: EditorLanguage;
  source: string;
  stdin: string;
};

/**
 * Encode workspace state into a URL-hash-safe string.
 *
 * base64url avoids `#`, `&`, `=` and `/`, all of which would otherwise need
 * escaping inside a fragment. UTF-8 is encoded first so unicode sources work.
 */
export function encodeShareState(state: ShareState): string {
  const payload = JSON.stringify({
    v: 1,
    l: state.language,
    s: state.source,
    i: state.stdin ?? "",
  });
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a permalink fragment. Returns null when the input is empty or
 * malformed so callers can fall back to a fresh workspace.
 */
export function decodeShareState(fragment: string): ShareState | null {
  const trimmed = (fragment ?? "").replace(/^#/, "").trim();
  if (!trimmed) return null;

  try {
    const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      l?: unknown;
      s?: unknown;
      i?: unknown;
    };

    if (typeof parsed?.s !== "string") return null;

    return {
      language: isRunnable(parsed.l) ? parsed.l : DEFAULT_LANGUAGE,
      source: parsed.s,
      stdin: typeof parsed.i === "string" ? parsed.i : "",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run requests
// ---------------------------------------------------------------------------

export type RunFile = { path: string; content: string };

export type RunRequest = {
  runtime: RunnoRuntime;
  entryPath: string;
  files: RunFile[];
  stdin: string;
};

/**
 * Build the fully-specified request the runner needs. Throws for a language
 * with no runtime so the UI surfaces the problem instead of hanging.
 */
export function buildRunRequest(
  language: EditorLanguage,
  source: string,
  stdin?: string,
): RunRequest {
  if (!isRunnable(language)) {
    throw new Error(`Language "${String(language)}" has no WebAssembly runtime.`);
  }
  const spec = LANGUAGES[language];
  return {
    runtime: spec.runnoId,
    entryPath: spec.entryName,
    files: [{ path: spec.entryName, content: source }],
    stdin: typeof stdin === "string" ? stdin : "",
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type OutputStream = "stdout" | "stderr" | "system";

export type OutputChunk = { stream: OutputStream; text: string };

export type OutputEntry = OutputChunk & { id: string };

let outputSequence = 0;

/** Append chunks in arrival order, dropping empties and tagging each with an id. */
export function mergeOutput(chunks: OutputChunk[]): OutputEntry[] {
  const entries: OutputEntry[] = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk.text !== "string" || chunk.text.length === 0) continue;
    entries.push({ ...chunk, id: `out-${++outputSequence}` });
  }
  return entries;
}

export type RunSummary = { exitCode: number; durationMs: number };

/** One-line summary shown under the terminal after a run settles. */
export function formatResult({ exitCode, durationMs }: RunSummary): string {
  const seconds = (durationMs / 1000).toFixed(2);
  const verdict = exitCode === 0 ? "finished" : "exited";
  return `Process ${verdict} with exit code ${exitCode} in ${seconds}s`;
}

/** Render accumulated output entries as plain text for copying. */
export function outputToText(entries: OutputEntry[]): string {
  return entries.map(entry => entry.text).join("");
}
