/**
 * Generates the inline cross-origin-isolation bootstrap in `src/index.html`.
 *
 * The script must run *before* the app bundle, and inlining it avoids a
 * sub-resource fetch on the critical path. Keeping it generated from
 * `coiBootstrapScript()` means the tested policy in `src/lib/coi.ts` stays the
 * single source of truth instead of being copy-pasted into HTML by hand.
 *
 * Run with: bun run sync:html     (CI verifies it with --check)
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { coiBootstrapScript } from "./src/lib/coi";

const HTML = path.join(import.meta.dir, "src", "index.html");
const START = "<!-- coi-bootstrap:start -->";
const END = "<!-- coi-bootstrap:end -->";

function render(html: string, script: string): string {
  const block = `${START}\n    <script>\n${script}\n    </script>\n    ${END}`;
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (pattern.test(html)) return html.replace(pattern, block);
  // First run: insert just before </head>.
  return html.replace("  </head>", `    ${block}\n  </head>`);
}

const html = await readFile(HTML, "utf8");
const script = coiBootstrapScript();
const next = render(html, script);

const check = process.argv.includes("--check");
if (check) {
  if (next !== html) {
    console.error(
      "src/index.html is out of date with src/lib/coi.ts.\n" +
        "Run: bun run sync:html",
    );
    process.exit(1);
  }
  console.log("src/index.html is in sync with the isolation bootstrap");
} else if (next === html) {
  console.log("src/index.html already up to date");
} else {
  await writeFile(HTML, next, "utf8");
  console.log("src/index.html updated with the isolation bootstrap");
}
