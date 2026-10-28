/**
 * The wasm IDE workspace.
 *
 * A Monaco editor on the left, a sticky Runno terminal on the right, and a
 * permalink that serialises the whole workspace into the URL fragment so a
 * shared link restores exactly what the author was looking at.
 *
 * There is no backend: the build is a static bundle published to GitHub Pages,
 * which is what makes the "your code never leaves the page" promise checkable
 * rather than merely asserted.
 */

import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LanguagePicker } from "@/components/LanguagePicker";
import { Terminal } from "@/components/Terminal";
import { Button } from "@/components/ui/button";
import { useRunner } from "@/hooks/useRunner";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  decodeShareState,
  defaultSource,
  encodeShareState,
  isRunnable,
  languageIdForMonaco,
  outputToText,
  type EditorLanguage,
} from "@/lib/ide";

export type IDEProps = {
  /** Language for the initial buffer. */
  initialLanguage?: EditorLanguage;
  /** Initial source text. */
  initialSource?: string;
  /** Initial stdin. */
  initialStdin?: string;
  /** Whether to offer the permalink button. */
  showShareButton?: boolean;
  /** Whether to offer the download button. */
  showDownloadButton?: boolean;
  /** Monaco theme. */
  theme?: "vs-dark" | "vs-light";
  /** Notified on every edit. */
  onSourceChange?: (source: string) => void;
  /** Notified when a run settles. */
  onRunComplete?: (result: { exitCode: number | null; stdout: string; stderr: string }) => void;
};

export function IDE({
  initialLanguage = DEFAULT_LANGUAGE,
  initialSource,
  initialStdin = "",
  showShareButton = true,
  showDownloadButton = true,
  theme = "vs-dark",
  onSourceChange,
  onRunComplete,
}: IDEProps) {
  const [language, setLanguage] = useState<EditorLanguage>(initialLanguage);
  const [source, setSource] = useState<string>(() => initialSource ?? defaultSource(initialLanguage));
  const [stdin, setStdin] = useState(initialStdin);
  const [copied, setCopied] = useState(false);

  const { state, run, stop, isBusy } = useRunner();

  // Restore a permalink on mount and on hash changes (back/forward, paste).
  useEffect(() => {
    const applyHash = () => {
      const restored = decodeShareState(window.location.hash);
      if (!restored) return;
      setLanguage(restored.language);
      setSource(restored.source);
      setStdin(restored.stdin);
    };

    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const handleLanguageChange = useCallback((next: EditorLanguage) => {
    setSource(current =>
      // Swap in the new sample only while the buffer is still some language's
      // untouched default; never destroy something the user actually wrote.
      (Object.keys(LANGUAGES) as EditorLanguage[]).some(id => defaultSource(id) === current)
        ? defaultSource(next)
        : current,
    );
    setLanguage(next);
  }, []);

  const handleRun = useCallback(() => {
    void run({ language, source, stdin });
  }, [run, language, source, stdin]);

  // Surface the settled result to library consumers. Keyed on the run status so
  // it fires once per completed run rather than on every state change.
  const lastNotified = useRef<string | null>(null);
  useEffect(() => {
    if (state.status !== "done" && state.status !== "error") return;
    const key = `${state.status}:${state.durationMs}:${state.exitCode}`;
    if (lastNotified.current === key) return;
    lastNotified.current = key;

    onRunComplete?.({
      exitCode: state.exitCode,
      stdout: state.output.filter(e => e.stream === "stdout").map(e => e.text).join(""),
      stderr: state.output.filter(e => e.stream === "stderr").map(e => e.text).join(""),
    });
  }, [state.status, state.durationMs, state.exitCode, state.output, onRunComplete]);

  // Ctrl/Cmd+Enter runs, matching every other code playground.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        handleRun();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRun]);

  const shareUrl = useMemo(() => {
    const encoded = encodeShareState({ language, source, stdin });
    return `${window.location.origin}${window.location.pathname}#${encoded}`;
  }, [language, source, stdin]);

  const handleShare = useCallback(async () => {
    // Reflect the permalink in the address bar first so the e2e assertion on
    // `page.url()` sees it even when the clipboard is unavailable.
    window.history.replaceState(null, "", `#${encodeShareState({ language, source, stdin })}`);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [language, source, shareUrl, stdin]);

  const handleDownload = useCallback(() => {
    const spec = LANGUAGES[language];
    const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = spec.entryName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [language, source]);

  const handleCopyOutput = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(outputToText(state.output));
    } catch {
      /* clipboard unavailable: nothing to do */
    }
  }, [state.output]);

  const spec = LANGUAGES[language];
  const runnable = isRunnable(language);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">wasm-ide</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">
            runno + monaco · runs entirely in your browser
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LanguagePicker value={language} onChange={handleLanguageChange} disabled={isBusy} />
          {showShareButton ? (
            <Button
              data-testid="share-button"
              variant="outline"
              size="sm"
              onClick={() => void handleShare()}
            >
              {copied ? "Link copied" : "Share"}
            </Button>
          ) : null}
          {showDownloadButton ? (
            <Button variant="outline" size="sm" onClick={handleDownload}>
              Download
            </Button>
          ) : null}
        </div>
      </header>

      <main className="grid flex-1 gap-4 p-4 lg:grid-cols-2">
        {/* Editor pane */}
        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
            <span className="font-mono text-xs text-muted-foreground">{spec.entryName}</span>
            <span className="text-xs text-muted-foreground">{spec.label}</span>
          </div>
          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              language={languageIdForMonaco(language)}
              value={source}
              onChange={value => {
                const next = value ?? "";
                setSource(next);
                onSourceChange?.(next);
              }}
              theme={theme}
              options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                renderWhitespace: "selection",
              }}
            />
          </div>
        </section>

        {/* Runner pane */}
        <section className="flex min-h-[420px] flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button data-testid="run-button" onClick={handleRun} disabled={isBusy || !runnable}>
                {isBusy ? "Running…" : "Run"}
              </Button>
              <Button variant="outline" onClick={stop} disabled={!isBusy}>
                Stop
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void handleCopyOutput()} disabled={!state.output.length}>
                Copy output
              </Button>
              <span
                data-testid="run-status"
                aria-live="polite"
                className="ml-auto text-xs text-muted-foreground"
              >
                {state.summary ?? (isBusy ? "Executing…" : "Ready")}
              </span>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">stdin (one value per line)</span>
              <textarea
                data-testid="stdin-input"
                aria-label="Program stdin"
                value={stdin}
                onChange={event => setStdin(event.target.value)}
                rows={2}
                spellCheck={false}
                placeholder="Input passed to the program's standard input…"
                className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
          </div>

          <Terminal output={state.output} className="min-h-[260px] flex-1" />

          <p className="text-xs text-muted-foreground">
            WebAssembly compiles and executes locally. Nothing is uploaded — you can serve this page
            from any static host, or open it offline.
          </p>
        </section>
      </main>
    </div>
  );
}

export default IDE;
