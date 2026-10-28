/**
 * Public React entry of `@fufurobot/wasm-ide`.
 *
 * Deliberately not `src/index.ts`: that file is the Bun dev server for the
 * demo app, and pointing the library build at it would ship a `Bun.serve` call
 * inside the package.
 *
 * Everything exported here is public API. Anything not exported stays an
 * implementation detail the app can refactor freely.
 */

// The component.
export { WasmIDE, type WasmIDEHandle, type WasmIDEProps } from "@/components/WasmIDE";

// Building blocks, for consumers who want a custom layout rather than the
// batteries-included workspace.
export { IDE, type IDEProps } from "@/components/IDE";
export { Terminal } from "@/components/Terminal";
export { LanguagePicker } from "@/components/LanguagePicker";

// Headless: run WebAssembly without rendering an editor at all.
export { useRunner, type RunArgs, type RunnerState, type RunnerStatus } from "@/hooks/useRunner";

// Options and state types shared with the vanilla entry.
export {
  DEFAULT_OPTIONS,
  normalizeOptions,
  snapshot,
  type IDEOptions,
  type IDEState,
  type NormalizedOptions,
} from "@/lib/embed";

// Language catalog and permalink helpers, useful for saving/sharing.
export {
  LANGUAGES,
  RUNNO_HEADLESS_LANGUAGES,
  DEFAULT_LANGUAGE,
  defaultSource,
  isRunnable,
  isLanguage,
  languageIdForMonaco,
  runtimeFor,
  encodeShareState,
  decodeShareState,
  buildRunRequest,
  mergeOutput,
  formatResult,
  outputToText,
  reconcileOutput,
  type EditorLanguage,
  type RunnoRuntime,
  type LanguageSpec,
  type ShareState,
  type OutputEntry,
  type OutputChunk,
  type OutputStream,
} from "@/lib/ide";

// Cross-origin isolation helpers: consumers on GitHub Pages or other
// header-less hosts need this to make SharedArrayBuffer available.
export {
  COI_HEADERS,
  COI_SW_PATH,
  COI_SW_FILENAME,
  COI_ATTEMPT_KEY,
  planIsolation,
  coiBootstrapScript,
  shouldIsolate,
  isSameOrigin,
  type IsolationPlan,
  type IsolationInput,
} from "@/lib/coi";

export const VERSION = "0.1.0";
