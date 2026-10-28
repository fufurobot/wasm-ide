/**
 * Options shared by both consumer entries.
 *
 * The React component and the vanilla `createIDE` must accept the same options
 * and behave identically, so the normalisation lives here once. Both entries are
 * thin shells over these functions.
 */

import {
  DEFAULT_LANGUAGE,
  isRunnable,
  defaultSource,
  type EditorLanguage,
} from "./ide";

export type IDEOptions = {
  /** Language for the initial buffer. Unrunnable ids fall back to the default. */
  language?: EditorLanguage;
  /** Initial source. Defaults to the language's sample program. */
  source?: string;
  /** Initial stdin. */
  stdin?: string;
  /** Show the Share (permalink) button. */
  showShareButton?: boolean;
  /** Show the Download button. */
  showDownloadButton?: boolean;
  /** Editor theme understood by Monaco. */
  theme?: "vs-dark" | "vs-light";
  /** Called whenever the source changes. */
  onSourceChange?: (source: string, language: EditorLanguage) => void;
  /** Called when a run settles. */
  onRunComplete?: (result: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }) => void;
};

export type NormalizedOptions = Required<
  Pick<IDEOptions, "language" | "source" | "stdin" | "showShareButton" | "showDownloadButton" | "theme">
> &
  Pick<IDEOptions, "onSourceChange" | "onRunComplete">;

export const DEFAULT_OPTIONS: NormalizedOptions = {
  language: DEFAULT_LANGUAGE,
  source: defaultSource(DEFAULT_LANGUAGE),
  stdin: "",
  showShareButton: true,
  showDownloadButton: true,
  theme: "vs-dark",
};

/**
 * Turn caller input into a complete, safe option set.
 *
 * An unrunnable language id is replaced with the default rather than passed
 * through: Runno has no runtime for it, so forwarding it would produce an IDE
 * whose Run button can only fail.
 */
export function normalizeOptions(options: IDEOptions = {}): NormalizedOptions {
  const language = isRunnable(options.language) ? options.language : DEFAULT_LANGUAGE;

  return {
    language,
    source:
      typeof options.source === "string" && options.source.length > 0
        ? options.source
        : defaultSource(language),
    stdin: typeof options.stdin === "string" ? options.stdin : "",
    showShareButton: options.showShareButton ?? DEFAULT_OPTIONS.showShareButton,
    showDownloadButton: options.showDownloadButton ?? DEFAULT_OPTIONS.showDownloadButton,
    theme: options.theme === "vs-light" ? "vs-light" : "vs-dark",
    onSourceChange: options.onSourceChange,
    onRunComplete: options.onRunComplete,
  };
}

export type IDEState = {
  language: EditorLanguage;
  source: string;
  stdin: string;
};

/**
 * Read the current state of an IDE surface.
 *
 * Used by the vanilla handle's `getState()`, and useful for save/restore.
 */
export function snapshot(state: IDEState): IDEState {
  return { language: state.language, source: state.source, stdin: state.stdin };
}
