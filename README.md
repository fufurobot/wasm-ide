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
bun run test:unit      # pure core + repo hygiene, fast
bun run test:e2e       # Playwright, real wasm execution in Chromium
bun run test:all       # unit + build + e2e
```

The unit suite runs in Bun with no browser. The e2e suite needs a browser once:

```bash
bunx playwright install chromium
```

End-to-end tests run against the **built** bundle via `bun run preview`, not the dev server,
so they exercise the same static-hosting shape GitHub Pages uses — including the assertion
that no `/api/` request is ever made.

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

## How the code is organised

```
src/lib/ide.ts          pure core: language catalog, permalink codec, run requests
src/lib/coi.ts          cross-origin isolation policy (pure, unit tested)
src/hooks/useRunner.ts  drives the Runno headless API and collects output
src/components/IDE.tsx  the workspace shell
src/components/Terminal.tsx
src/components/LanguagePicker.tsx
public/coi-serviceworker.js  injects COOP/COEP where the host cannot
src/preview.ts          static file server for dist/ (mirrors Pages, no /api, no rewrites)
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
| [`release.yml`](.github/workflows/release.yml) | release published or `v*` tag | unit tests, build, attach `dist` tarball + sha256 to the release |

Red CI on `dev` is acceptable; `main` is the gate. Dependabot is configured in
[`dependabot.yml`](.github/dependabot.yml) and targets `dev` so dependency churn proves
itself before reaching `main`.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
