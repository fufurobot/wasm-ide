/**
 * Library build for the published npm package.
 *
 * Two entries, because there are two consumption modes:
 *
 *   index    -> React consumers (`import { WasmIDE } from "@fufurobot/wasm-ide"`)
 *   vanilla  -> plain JS / no bundler (`.../vanilla`, `createIDE`)
 *
 * Dependency policy differs per entry, and that difference is the whole reason
 * this script exists:
 *
 *   - React/render/ReactDOM are EXTERNAL in `index`: the consumer supplies its
 *     own React, or you get two copies and broken hooks.
 *   - React is BUNDLED into `vanilla`: the whole point is that a page without
 *     React, and without a bundler, can use it. Leaving it external would make
 *     the vanilla entry import a bare specifier the browser cannot resolve.
 *
 * Monaco and Runno stay external in both: they are large, and the consumer's
 * bundler should own them (Monaco also loads workers from a CDN at runtime).
 *
 * Types are emitted with `tsc` (see package.json) because Bun's bundler does not
 * emit declarations.
 */

import { rm } from "node:fs/promises";
import path from "node:path";

const ROOT = import.meta.dir;
const OUTDIR = path.join(ROOT, "dist-lib");

await rm(OUTDIR, { recursive: true, force: true });

// The React entry leaves these to the consumer's bundler: they are large and
// the consumer almost certainly already has them.
//
// The vanilla entry must NOT leave @monaco-editor/react external. A page with
// no bundler cannot resolve a bare specifier, so `import Editor from
// "@monaco-editor/react"` would throw "Failed to resolve module specifier" and
// the whole IDE would fail to load. Bundling it (and letting it load Monaco's
// runtime from its CDN at runtime, which is what the package does anyway) makes
// the vanilla build genuinely self-contained.
const REACT_CONSUMER_EXTERNAL = ["@runno/runtime", "@monaco-editor/react", "monaco-editor"];

// The vanilla build inlines everything with a bare specifier. A page without a
// bundler cannot resolve ANY bare specifier, including the lazily imported
// `import("@runno/runtime")` in the runner - which failed in a real browser
// with "Failed to resolve module specifier '@runno/runtime'". Runno still
// fetches its wasm images from its own CDN at run time; only the JS wrapper is
// inlined.
const VANILLA_EXTERNAL: string[] = [];

type BuildSpec = {
  entry: string;
  format: "esm" | "cjs";
  external: string[];
  outfile: string;
};

const specs: BuildSpec[] = [
  // React entry: React is a peer the consumer provides.
  {
    entry: "src/entry.ts",
    format: "esm",
    external: [...REACT_CONSUMER_EXTERNAL, "react", "react-dom", "react/jsx-runtime"],
    outfile: "index.js",
  },
  {
    entry: "src/entry.ts",
    format: "cjs",
    external: [...REACT_CONSUMER_EXTERNAL, "react", "react-dom", "react/jsx-runtime"],
    outfile: "index.cjs",
  },
  // Vanilla entry: React is bundled in so no-React pages can use it.
  { entry: "src/vanilla.tsx", format: "esm", external: VANILLA_EXTERNAL, outfile: "vanilla.js" },
  { entry: "src/vanilla.tsx", format: "cjs", external: VANILLA_EXTERNAL, outfile: "vanilla.cjs" },
];

for (const spec of specs) {
  const result = await Bun.build({
    entrypoints: [path.join(ROOT, spec.entry)],
    outdir: OUTDIR,
    naming: spec.outfile,
    format: spec.format,
    target: "browser",
    external: spec.external,
    minify: false, // published libraries should stay debuggable
    sourcemap: "linked",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`library build failed for ${spec.entry} (${spec.format})`);
  }

  const output = result.outputs[0]!;
  console.log(` ${spec.outfile}  ${(output.size / 1024).toFixed(1)} KB`);
}

// The isolation service worker ships with the package too: consumers hosting on
// a header-less static host (GitHub Pages) need it, exactly as the app does.
const worker = Bun.file(path.join(ROOT, "public", "coi-serviceworker.js"));
await Bun.write(path.join(OUTDIR, "coi-serviceworker.js"), worker);
console.log(" coi-serviceworker.js (copied)");
