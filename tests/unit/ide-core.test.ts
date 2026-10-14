/**
 * Spec: the wasm IDE's pure core.
 *
 * Everything here is deliberately free of React and of the Runno/Monaco browser
 * globals so it can be unit tested in Bun. The UI is a thin shell over these
 * functions, and the Playwright e2e suite covers the wiring.
 */

import { describe, expect, test } from "bun:test";
import {
  LANGUAGES,
  RUNNO_HEADLESS_LANGUAGES,
  defaultSource,
  encodeShareState,
  decodeShareState,
  buildRunRequest,
  isRunnable,
  languageIdForMonaco,
  mergeOutput,
  formatResult,
  type EditorLanguage,
  type ShareState,
} from "@/lib/ide";

/** Assert a decoded permalink is present, narrowing away the null branch. */
function expectDecoded(fragment: string): ShareState {
  const decoded = decodeShareState(fragment);
  if (decoded === null) throw new Error(`expected ${fragment} to decode`);
  return decoded;
}

describe("language catalog", () => {
  test("covers exactly the runtimes Runno actually ships", () => {
    // Runno's Runtime union is: python | quickjs | sqlite | clang | clangpp |
    // ruby | php-cgi. Bash and TypeScript have no wasm runtime, so the catalog
    // must mirror Runno rather than advertise more than it can run.
    const ids = Object.keys(LANGUAGES).sort();
    expect(ids).toEqual(["c", "cpp", "javascript", "php", "python", "ruby", "sql"].sort());
  });

  test("every language has a Monaco id and a Runno id", () => {
    for (const [id, spec] of Object.entries(LANGUAGES)) {
      expect(`${id}:monaco=${Boolean(spec.monacoId)}`).toBe(`${id}:monaco=true`);
      expect(`${id}:runno=${Boolean(spec.runnoId)}`).toBe(`${id}:runno=true`);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.extension).toMatch(/^\./);
    }
  });

  test("Runno ids are a subset of the supported runtime targets", () => {
    for (const spec of Object.values(LANGUAGES)) {
      expect(RUNNO_HEADLESS_LANGUAGES).toContain(spec.runnoId as never);
    }
  });

  test("a single language is offered per runtime, with matching extensions", () => {
    const seen = new Map<string, string>();
    for (const [id, spec] of Object.entries(LANGUAGES)) {
      expect(seen.has(spec.runnoId)).toBe(false);
      seen.set(spec.runnoId, id);
      expect(spec.extensionFor(spec.runnoId)).toBe(spec.extension);
    }
  });

  test("languageIdForMonaco maps every language", () => {
    expect(languageIdForMonaco("python" as EditorLanguage)).toBe("python");
    expect(languageIdForMonaco("cpp" as EditorLanguage)).toBe("cpp");
    expect(languageIdForMonaco("javascript" as EditorLanguage)).toBe("javascript");
    expect(languageIdForMonaco("php" as EditorLanguage)).toBe("php");
  });

  test("every catalogued language is runnable, unknown ids are not", () => {
    for (const id of Object.keys(LANGUAGES) as EditorLanguage[]) {
      expect(`${id}:${isRunnable(id)}`).toBe(`${id}:true`);
    }
    expect(isRunnable("nope" as EditorLanguage)).toBe(false);
    expect(isRunnable("bash" as EditorLanguage)).toBe(false);
  });
});

describe("defaultSource", () => {
  test("returns a non-empty hello-world for every language", () => {
    for (const id of Object.keys(LANGUAGES) as EditorLanguage[]) {
      const src = defaultSource(id);
      expect(`${id}:${src.length > 0}`).toBe(`${id}:true`);
    }
  });

  test("python default prints a greeting", () => {
    expect(defaultSource("python" as EditorLanguage)).toContain("print");
  });

  test("is stable across calls (no random content)", () => {
    expect(defaultSource("c" as EditorLanguage)).toBe(defaultSource("c" as EditorLanguage));
  });
});

describe("permalink encoding", () => {
  test("round-trips source, language and stdin", () => {
    const state: ShareState = {
      language: "python" as EditorLanguage,
      source: 'print("hi")\n',
      stdin: "42\n",
    };
    const decoded = expectDecoded(encodeShareState(state));
    expect(decoded.language).toBe("python");
    expect(decoded.source).toBe('print("hi")\n');
    expect(decoded.stdin).toBe("42\n");
  });

  test("survives unicode, newlines and hash-hostile characters", () => {
    const state: ShareState = {
      language: "javascript" as EditorLanguage,
      source: 'const s = "#&=?/ 日本語 🎉";\nconsole.log(s);\n',
      stdin: "",
    };
    const decoded = expectDecoded(encodeShareState(state));
    expect(decoded.source).toBe(state.source);
  });

  test("encoded payload is URL-hash safe", () => {
    const encoded = encodeShareState({
      language: "c" as EditorLanguage,
      source: "int main(){return 0;}",
      stdin: "",
    });
    expect(encoded).not.toMatch(/[#&=?\s]/);
  });

  test("returns null for empty or malformed input", () => {
    expect(decodeShareState("")).toBeNull();
    expect(decodeShareState("#")).toBeNull();
    expect(decodeShareState("not-base64!!")).toBeNull();
  });

  test("falls back to the default language when the id is unknown", () => {
    const encoded = encodeShareState({
      language: "python" as EditorLanguage,
      source: "x",
      stdin: "",
    });
    // Corrupt the language field while keeping the payload decodable.
    const raw = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
    raw.language = "brainfuck";
    const tampered = btoa(JSON.stringify(raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const decoded = decodeShareState(tampered);
    expect(decoded).not.toBeNull();
    expect(isRunnable(decoded!.language)).toBe(true);
  });

  test("tolerates a leading # in the input", () => {
    const encoded = encodeShareState({
      language: "c" as EditorLanguage,
      source: "int main(){}",
      stdin: "",
    });
    expect(decodeShareState(`#${encoded}`)?.source).toBe("int main(){}");
  });
});

describe("buildRunRequest", () => {
  test("names the entry file after the language extension", () => {
    const req = buildRunRequest("python" as EditorLanguage, "print(1)", "");
    expect(req.files[0]!.path).toBe("main.py");
    expect(req.files[0]!.content).toBe("print(1)");
    expect(req.runtime).toBe("python");
  });

  test("uses main.cpp for cpp and main.c for c", () => {
    expect(buildRunRequest("cpp" as EditorLanguage, "x", "").files[0]!.path).toBe("main.cpp");
    expect(buildRunRequest("c" as EditorLanguage, "x", "").files[0]!.path).toBe("main.c");
  });

  test("passes stdin through and defaults it to empty", () => {
    expect(buildRunRequest("python" as EditorLanguage, "x", "hello").stdin).toBe("hello");
    expect(buildRunRequest("python" as EditorLanguage, "x", undefined as never).stdin).toBe("");
  });

  test("throws for a language with no Runno runtime", () => {
    expect(() => buildRunRequest("nope" as EditorLanguage, "x", "")).toThrow();
  });
});

describe("output accumulation", () => {
  test("mergeOutput appends stdout and stderr in arrival order", () => {
    const out = mergeOutput([
      { stream: "stdout", text: "a" },
      { stream: "stderr", text: "b" },
      { stream: "stdout", text: "c" },
    ]);
    expect(out.map(e => `${e.stream}:${e.text}`).join("|")).toBe("stdout:a|stderr:b|stdout:c");
  });

  test("mergeOutput drops empty chunks", () => {
    expect(mergeOutput([{ stream: "stdout", text: "" }]).length).toBe(0);
  });

  test("mergeOutput gives every entry a stable id", () => {
    const out = mergeOutput([
      { stream: "stdout", text: "a" },
      { stream: "stdout", text: "b" },
    ]);
    expect(new Set(out.map(e => e.id)).size).toBe(2);
  });

  test("formatResult reports exit code and duration", () => {
    const text = formatResult({ exitCode: 1, durationMs: 1234 });
    expect(text).toContain("1");
    expect(text).toMatch(/exited|exit/i);
  });

  test("formatResult marks a successful run", () => {
    expect(formatResult({ exitCode: 0, durationMs: 5 })).toMatch(/0/);
  });
});
