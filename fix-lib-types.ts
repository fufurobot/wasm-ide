/**
 * Move emitted declarations from `dist-lib/types/` to the paths in the exports map.
 *
 * `tsc -p tsconfig.lib.json` writes a mirror of the `src/` tree under
 * `dist-lib/types/` (types/entry.d.ts, types/vanilla.d.ts, ...), but the
 * `exports` map in package.json points at `dist-lib/index.d.ts` and
 * `dist-lib/vanilla.d.ts`. Rather than reshape the whole declaration tree, this
 * step puts the two public entry declarations where consumers (and their
 * editors) expect them, and rewrites their relative imports so they still
 * resolve.
 *
 * Consumers only ever import the two entry points, so the internal declaration
 * tree stays under types/ and the entries re-export from it.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const LIB = path.join(import.meta.dir, "dist-lib");
const TYPES = path.join(LIB, "types");

/** Map a `@/lib/x` alias tail to its declaration file, without a .ts extension. */
function stripExt(spec: string): string {
  return spec
    .replace(/\.tsx$/, "")
    .replace(/\.ts$/, "")
    .replace(/\/index$/, "/index");
}

/** entry file in types/ -> public .d.ts emitter */
const ENTRY_MAP: Array<{ source: string; target: string }> = [
  // src/entry.ts -> types/entry.d.ts  =>  dist-lib/index.d.ts
  { source: "entry.d.ts", target: "index.d.ts" },
  // src/vanilla.tsx -> types/vanilla.d.ts  =>  dist-lib/vanilla.d.ts
  { source: "vanilla.d.ts", target: "vanilla.d.ts" },
];

for (const { source, target } of ENTRY_MAP) {
  const from = path.join(TYPES, source);
  const to = path.join(LIB, target);

  let body: string;
  try {
    body = await readFile(from, "utf8");
  } catch {
    throw new Error(
      `declarations missing: ${path.relative(import.meta.dir, from)} does not exist. ` +
        `Run: bunx tsc -p tsconfig.lib.json`,
    );
  }

  // tsc preserves the project's `@/*` path alias verbatim in .d.ts output.
  // Consumers have no such alias, so every one must become a relative path into
  // the declaration tree. This is the difference between a package that
  // type-checks for consumers and one that fails with "Cannot find module '@/...'".
  const withoutAlias = body.replace(/(from\s+")(@\/)([^"]+)(")/g, (_m, pre, _alias, spec, post) => {
    return `${pre}./types/${stripExt(spec)}${post}`;
  });

  // Rewrite remaining relative module specifiers so they resolve from dist-lib/
  // rather than dist-lib/types/.
  const rewritten = withoutAlias.replace(
    /(from\s+")(\.\/)([^"]+)(")/g,
    (_match, pre, _dot, spec, post) => {
      // Already pointing into types/ (from the alias pass above) - leave it.
      if (spec.startsWith("types/")) return `${pre}./${spec}${post}`;
      return `${pre}./types/${spec}${post}`;
    },
  );

  await writeFile(to, rewritten, "utf8");
  console.log(` ${path.relative(import.meta.dir, from)} -> ${path.relative(import.meta.dir, to)}`);
}

// `vanilla.d.ts` re-exports from types/; the entry declaration may import the
// vanilla module through "@/" aliases that tsc already resolved to relative
// paths. Verify no "@/" specifier survived, because consumers have no such alias.
for (const { target } of ENTRY_MAP) {
  const to = path.join(LIB, target);
  const body = await readFile(to, "utf8");
  if (body.includes('from "@/') || body.includes('import("@/')) {
    throw new Error(`${target} still contains a "@/..." alias, which consumers cannot resolve`);
  }
}

// tsc keeps the project's `@/*` path alias in EVERY emitted declaration, not
// just the entries. Consumers have no such alias, so rewrite all of them to
// relative specifiers inside the declaration tree. Without this, importing the
// package fails with "Cannot find module '@/lib/ide'" in the consumer's editor.
async function rewriteAliasesInTree(dir: string): Promise<number> {
  let changed = 0;
  const entries = new Bun.Glob("**/*.d.ts").scanSync({ cwd: dir });

  for (const relative of entries) {
    const file = path.join(dir, relative);
    const original = await readFile(file, "utf8");
    if (!original.includes("@/")) continue;

    // Resolve "@/x" relative to `dir`, so the correct number of "../" is used
    // for files nested at different depths.
    const depth = relative.split("/").length - 1;
    const prefix = depth === 0 ? "./" : "../".repeat(depth);

    const rewritten = original.replace(
      /(from\s+")(@\/)([^"]+)(")/g,
      (_m, pre, _alias, spec, post) => `${pre}${prefix}${stripExt(spec)}${post}`,
    );

    if (rewritten !== original) {
      await writeFile(file, rewritten, "utf8");
      changed += 1;
    }
  }

  return changed;
}

const rewrittenCount = await rewriteAliasesInTree(TYPES);
console.log(` rewrote @/ aliases in ${rewrittenCount} declaration file(s)`);

// Leave a pointer so the package's internal layout is discoverable.
await writeFile(
  path.join(TYPES, "README.md"),
  "Internal type declarations. Import from `@fufurobot/wasm-ide` or " +
    "`@fufurobot/wasm-ide/vanilla`; the public entry declarations live in `../index.d.ts` " +
    "and `../vanilla.d.ts`.\n",
  "utf8",
);

// The declarations copied above are now the public ones; keep the .map files
// consistent by dropping maps for the promoted entries (they pointed at the
// types/ copies and would show misleading source paths).
for (const { source } of ENTRY_MAP) {
  const mapPath = path.join(LIB, source.replace(/\.d\.ts$/, ".d.ts.map"));
  await rm(mapPath, { force: true });
  // Remove the originals too: they still carry "@/" specifiers and nothing
  // references them any more, so shipping them would only confuse consumers.
  await rm(path.join(TYPES, source), { force: true });
}
