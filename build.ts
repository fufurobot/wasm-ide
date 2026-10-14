import tailwind from "bun-plugin-tailwind";
import { cp, rm } from "node:fs/promises";
import path from "node:path";

const outdir = path.join(process.cwd(), "dist");
await rm(outdir, { recursive: true, force: true });

const entrypoints = [...new Bun.Glob("src/**/*.html").scanSync()];

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [tailwind],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("build failed");
}

for (const output of result.outputs) {
  console.log(` ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`);
}

// Static files that must be served verbatim from the site root.
//
// `coi-serviceworker.js` in particular has to live at `/` rather than under an
// asset directory: a service worker's scope is limited to its own directory,
// and it must be able to intercept the whole app.
await cp(path.join(process.cwd(), "public"), outdir, { recursive: true });
console.log(" public/  -> dist/ (copied verbatim)");
