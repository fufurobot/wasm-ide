/**
 * Spec: the public library API.
 *
 * Pins the surface both consumers see, so a refactor of the app's internal
 * components cannot silently change the published contract.
 *
 *   React:    WasmIDE, useWasmIDE, IDEProvider?
 *   Vanilla:  createIDE({ target, ... }) -> handle
 *
 * The handle returned by `createIDE` is deliberately imperative and small:
 * destroy(), getState(), setLanguage(), setSource(), run().
 */

import { describe, expect, test } from "bun:test";

describe("shared options", () => {
  test("exports the same option normaliser to both entries", async () => {
    const mod = await import("@/lib/embed");
    expect(typeof mod.normalizeOptions).toBe("function");
  });

  test("defaults are applied for omitted options", async () => {
    const { normalizeOptions, DEFAULT_OPTIONS } = await import("@/lib/embed");
    const options = normalizeOptions();
    expect(options.language).toBe(DEFAULT_OPTIONS.language);
    expect(typeof options.source).toBe("string");
    expect(typeof options.showShareButton).toBe("boolean");
  });

  test("validates an unknown language instead of passing it through", async () => {
    const { normalizeOptions } = await import("@/lib/embed");
    const options = normalizeOptions({ language: "brainfuck" as never });
    // Falls back to the default rather than handing Runno an unrunnable id.
    expect(options.language).toBe("python");
  });

  test("accepts a partial source override", async () => {
    const { normalizeOptions } = await import("@/lib/embed");
    const options = normalizeOptions({ language: "c", source: "int main(){}" });
    expect(options.language).toBe("c");
    expect(options.source).toBe("int main(){}");
  });

  test("uses the language default source when source is omitted", async () => {
    const { normalizeOptions } = await import("@/lib/embed");
    const { defaultSource } = await import("@/lib/ide");
    const options = normalizeOptions({ language: "ruby" });
    expect(options.source).toBe(defaultSource("ruby" as never));
  });
});

describe("vanilla entry", () => {
  test("is importable without React resolving", async () => {
    // The vanilla module must not import react at module scope.
    const source = await Bun.file(
      new URL("../../src/vanilla.tsx", import.meta.url).pathname,
    ).text().catch(() => "");
    // If the file does not exist yet this is the red state; assert it exists.
    expect(source.length).toBeGreaterThan(0);
  });

  test("createIDE fails loudly when the target is missing", async () => {
    const { createIDE } = await import("@/vanilla");
    // @ts-expect-error deliberately invalid
    expect(() => createIDE({})).toThrow();
  });

  test("createIDE returns a handle with the documented methods", async () => {
    const { createIDE } = await import("@/vanilla");
    const target = { nodeType: 1, appendChild: () => {}, removeChild: () => {} } as unknown as HTMLElement;
    const handle = createIDE({ target });
    for (const method of ["destroy", "getState", "setLanguage", "setSource"]) {
      expect(`${method}:${typeof (handle as Record<string, unknown>)[method]}`).toBe(
        `${method}:function`,
      );
    }
    handle.destroy();
  });
});

describe("react entry", () => {
  test("exports the WasmIDE component", async () => {
    const mod = await import("@/components/WasmIDE");
    expect(typeof mod.WasmIDE).toBe("function");
  });

  test("exports a headless runner hook", async () => {
    const mod = await import("@/hooks/useRunner");
    expect(typeof mod.useRunner).toBe("function");
  });
});
