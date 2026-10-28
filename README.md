# wasm-ide

[![CI (dev fast)](https://github.com/fufurobot/wasm-ide/actions/workflows/ci-dev.yml/badge.svg?branch=dev)](https://github.com/fufurobot/wasm-ide/actions/workflows/ci-dev.yml)
[![CI (main full)](https://github.com/fufurobot/wasm-ide/actions/workflows/ci-main.yml/badge.svg?branch=main)](https://github.com/fufurobot/wasm-ide/actions/workflows/ci-main.yml)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/fufurobot/wasm-ide)

A WebAssembly IDE built on [Runno](https://runno.dev) and [Monaco](https://microsoft.github.io/monaco-editor/).

It is designed to be served statically by any CDN or plain http server, so you can code
everywhere without worrying that the code would ever be leaked: the toolchain compiles to
WebAssembly, executes inside your browser tab, and **nothing you type is ever uploaded**.

**Live:** https://fufurobot.github.io/wasm-ide/ — see GitHub Pages for details.

## What works

| Language | Runtime | Notes |
| --- | --- | --- |
| C | `clang` | compiled to wasm in-browser |
| C++ | `clangpp` | |
| Python | `python` | CPython on wasm |
| JavaScript | `quickjs` | QuickJS engine |
| SQL | `sqlite` | SQLite on wasm |
| Ruby | `ruby` | |
| PHP | `php-cgi` | |

The picker mirrors Runno's runtime union exactly. Bash and TypeScript are deliberately
**absent** — Runno ships no wasm runtime for them, and a picker entry that can never run is
worse than no entry at all.

Features: Monaco editing with syntax highlighting, a terminal showing stdout/stderr and the
exit code, `stdin` piping, `Ctrl`/`Cmd`+`Enter` to run, and a **share permalink** that packs
language, source and stdin into the URL fragment so a link restores the exact workspace.

## Quick start

```bash
bun install
bun run dev            # http://localhost:3000
```

```bash
bun run build          # static bundle -> dist/
bun run preview        # serve dist/ exactly as a static host would
```

`dist/` is a self-contained static site. Drop it on any CDN, object store or `python3 -m http.server`.

## Testing

```bash
bun run typecheck      # tsc --noEmit
bun run test:unit      # pure core + repo hygiene, fast, no build needed
bun run build          # static bundle -> dist/
bun run test:dist      # asserts every asset dist/index.html references exists
bun run test:e2e       # Playwright, real wasm execution in Chromium
bun run build:lib      # npm package -> dist-lib/
bun run test:lib       # browser tests against the BUILT package
bun run test:all       # unit + build + dist + e2e
```

The unit suite runs in Bun with no browser. The e2e suite needs a browser once:

```bash
bunx playwright install chromium
```

End-to-end tests run against the **built** bundle via `bun run preview`, not the dev server,
so they exercise the same static-hosting shape GitHub Pages uses — including the assertion
that no `/api/` request is ever made.

## Use it as an npm package

The package is published to GitHub Packages as **`@fufurobot/wasm-ide`**, with two
entry points — pick whichever fits your project.

### Install

GitHub Packages requires authentication even for public packages, and requires a
scoped registry. Add an `.npmrc` to your project:

```ini
@fufurobot:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

...where `NPM_TOKEN` is a classic PAT with `read:packages`. Then:

```bash
npm install @fufurobot/wasm-ide
```

### 1. React

```tsx
import { WasmIDE } from "@fufurobot/wasm-ide";

export function Playground() {
  return <WasmIDE language="python" height="600px" />;
}
```

Props: `language`, `source`, `stdin`, `theme`, `showShareButton`, `showDownloadButton`,
`height`, `onSourceChange`, `onRunComplete`, `onReady`.

Need a custom layout instead of the batteries-included workspace? The building blocks
are exported too — `IDE`, `Terminal`, `LanguagePicker`, and the headless `useRunner`
hook, which runs WebAssembly with no editor at all.

### 2. Plain JavaScript (no bundler, no React)

```html
<div id="ide"></div>
<script type="module">
  import { createIDE } from "@fufurobot/wasm-ide/vanilla";

  const ide = createIDE({
    target: document.getElementById("ide"),
    language: "c",
    height: "600px",
  });

  ide.getState();               // { language, source, stdin }
  ide.setSource("int main(){}") // replace the buffer
  ide.destroy();                // unmount
</script>
```

The vanilla entry **inlines React, Monaco's loader and Runno** (~2.3 MB), because a page
without a bundler cannot resolve a bare module specifier. That is the trade for zero
setup. The React entry leaves them external so your bundler deduplicates them.

### Cross-origin isolation requirement

Both entries run WebAssembly with threads, which needs `SharedArrayBuffer`, which
browsers only expose to cross-origin-isolated documents. Your host must send:

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If it cannot (GitHub Pages cannot at all), ship the worker that comes with the package:

```js
// copy dist-lib/coi-serviceworker.js to your site root, then, before your app:
navigator.serviceWorker.register("/coi-serviceworker.js").then(() => location.reload());
```

Or use the exported helpers: `coiBootstrapScript()` returns the inline script, and
`planIsolation()` tells you what to do for a given `crossOriginIsolated` state.
Without isolation, the IDE renders normally but **every Run fails** with
`SharedArrayBuffer is not defined`.

### Types

Full `.d.ts` declarations ship with both entries; no `@types` package needed.

## Cross-origin isolation (important for hosting)

The Runno runtimes are compiled with threads: `@runno/wasi` allocates a `SharedArrayBuffer`
for program stdin, and browsers only expose that constructor to **cross-origin-isolated**
documents. Without isolation, every Run fails with `SharedArrayBuffer is not defined` — the
page loads, the editor works, and nothing executes.

A header-capable host satisfies this with two headers, which `bun run preview` sends:

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**GitHub Pages cannot send custom headers**, so the build also ships
`public/coi-serviceworker.js`. It intercepts same-origin responses, injects the headers, and
the inline bootstrap in `src/index.html` reloads the page once. After that the document is
isolated with no server cooperation. This is covered by `tests/e2e/isolation.spec.ts`, which
strips the headers in-flight so the service worker is proven to be doing the work.

If you host this yourself, either send the two headers (preferred — faster, no reload) or
rely on the bundled worker. If neither is possible, the bootstrap warns once and gives up
rather than reloading in a loop.

The build additionally ships `public/_headers`, which Cloudflare Pages and Netlify honour
natively (GitHub Pages ignores it). Both mechanisms ship safely together: when the document is
already isolated the bootstrap returns immediately and never registers the worker, so a
header-capable host gets isolation with no reload at all.
`tests/unit/headers-file.test.ts` keeps `_headers` in agreement with the tested policy in
`src/lib/coi.ts`, so the two cannot drift apart.

| Host | Isolation mechanism | First-visit reload |
| --- | --- | --- |
| `bun run preview` | response headers | no |
| Cloudflare Pages / Netlify | `_headers` | no |
| GitHub Pages | `coi-serviceworker.js` | once |
| Any other static host | `coi-serviceworker.js` | once |

**Test it the way it is deployed.** A GitHub Pages *project* site serves from
`/<repo>/`, and isolation bugs can hide behind a domain-root preview — one did:
the worker was registered at an absolute `/coi-serviceworker.js`, which 404'd
under the subpath and left the deployed site unable to run any code while every
local test passed. `bun run preview:subpath` reproduces that shape (subpath, no
COOP/COEP headers) and `tests/e2e/subpath.spec.ts` guards it.

```bash
bun run build
bun run preview:subpath        # http://127.0.0.1:3100/wasm-ide/
SUBPATH_BASE_URL=http://127.0.0.1:3100/wasm-ide bun run test:e2e
```

## How the code is organised

```
src/entry.ts            public React entry of the npm package
src/vanilla.tsx         plain-JS createIDE() entry
src/lib/embed.ts        option normaliser shared by both entries
src/components/WasmIDE.tsx  prop-driven <WasmIDE /> shell
build-lib.ts            library build (per-entry dependency policy)
fix-lib-types.ts        promotes declarations, rewrites "@/..." aliases
src/lib/ide.ts          pure core: language catalog, permalink codec, run requests
src/lib/coi.ts          cross-origin isolation policy (pure, unit tested)
src/hooks/useRunner.ts  drives the Runno headless API and collects output
src/components/IDE.tsx  the workspace shell
src/components/Terminal.tsx
src/components/LanguagePicker.tsx
public/coi-serviceworker.js  injects COOP/COEP where the host cannot
src/preview.ts          static file server for dist/ at the domain root
src/preview-subpath.ts  serves dist/ under /wasm-ide/, like a Pages project site
build.ts                bun bundler -> dist/ (+ copies public/)
sync-html.ts            generates the inline bootstrap; build runs it with --check
tests/unit/             Bun unit tests
tests/e2e/              Playwright specs
tools/gh.py             GitHub API helper (see below)
```

## Configuration and secrets

Copy the template and fill it in locally:

```bash
cp .env.example .env
```

`.env` is git-ignored and must never be committed. `.env.example` documents every variable
with the values erased.

| Variable | Secret | Purpose |
| --- | --- | --- |
| `DEEPSEEK_GITHUB_TOKEN` | **yes** | lets `tools/gh.py` open issues/PRs and read CI status |
| `GITHUB_REPOSITORY` | no | `owner/name` the tooling talks to |

**Why the token cannot leak into the frontend:** `bunfig.toml` sets
`[serve.static] env = "BUN_PUBLIC_*"`, so only `BUN_PUBLIC_`-prefixed variables are inlined
into the browser bundle. `DEEPSEEK_GITHUB_TOKEN` is not prefixed, so the bundler cannot see
it. CI additionally greps `dist/` for credential-shaped strings and fails the build if any
are found. The `.env` variable is *not* named `GITHUB_TOKEN`, so tools that would
automatically forward a conventionally-named token never pick it up by accident.

## Tooling: `tools/gh.py`

The agent sandbox blocks `curl`, so every GitHub call in this repository goes through one
reusable Python script instead of ad-hoc shell requests:

```bash
python3 tools/gh.py whoami
python3 tools/gh.py runs fufurobot/wasm-ide --branch dev
python3 tools/gh.py issue-create fufurobot/wasm-ide "title" "body"
python3 tools/gh.py pr-create fufurobot/wasm-ide dev main "title" "body" --draft
python3 tools/gh.py dependabot-check fufurobot/wasm-ide
```

It reads `DEEPSEEK_GITHUB_TOKEN` from the environment (or `.env`), never prints the secret,
and uses `http.client` because `urllib` stalls on POST against `api.github.com` on some hosts.

## CI/CD

The branch model is: **fast test on `dev`, full test on `main`, publish artifacts when a
release is pushed.**

| Workflow | Trigger | Does |
| --- | --- | --- |
| [`ci-dev.yml`](.github/workflows/ci-dev.yml) | push/PR to `dev` | typecheck, unit tests, build, secret grep |
| [`ci-main.yml`](.github/workflows/ci-main.yml) | push/PR to `main` | the above **plus** full Playwright e2e, then deploys to GitHub Pages |
| [`release.yml`](.github/workflows/release.yml) | release published or `v*` tag | unit tests, builds the web app **and** the npm package, attaches `dist` tarball + sha256, and **publishes `@fufurobot/wasm-ide` to GitHub Packages** (version taken from the tag) |

Red CI on `dev` is acceptable; `main` is the gate. Dependabot is configured in
[`dependabot.yml`](.github/dependabot.yml) and targets `dev` so dependency churn proves
itself before reaching `main`.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
