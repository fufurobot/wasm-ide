/**
 * `<WasmIDE />` — the React entry point of the published package.
 *
 * This is a thin, prop-driven shell over the same workspace the app renders, so
 * the app and library consumers run identical code. Keeping it thin matters:
 * every behaviour difference here is a behaviour the e2e suites would stop
 * covering.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { IDE } from "@/components/IDE";
import type { IDEOptions, IDEState } from "@/lib/embed";
import { normalizeOptions } from "@/lib/embed";
import type { EditorLanguage } from "@/lib/ide";

export type WasmIDEProps = IDEOptions & {
  /** Extra class applied to the workspace root. */
  className?: string;
  /** Height of the workspace. Defaults to the full viewport. */
  height?: string;
  /** Receives the imperative handle, so callers can drive the editor. */
  onReady?: (handle: WasmIDEHandle) => void;
};

export type WasmIDEHandle = {
  getState: () => IDEState;
  setLanguage: (language: EditorLanguage) => void;
  setSource: (source: string) => void;
  setStdin: (stdin: string) => void;
};

export function WasmIDE({
  className,
  height = "100vh",
  onReady,
  onSourceChange,
  ...options
}: WasmIDEProps) {
  const normalized = normalizeOptions(options);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Controlled from the outside via the handle; the IDE keeps its own state.
  const [language, setLanguage] = useState<EditorLanguage>(normalized.language);
  const [source, setSource] = useState<string>(normalized.source);
  const [stdin, setStdin] = useState<string>(normalized.stdin);

  // Re-seed when the caller explicitly changes the language prop.
  const languageProp = normalized.language;
  useEffect(() => {
    setLanguage(languageProp);
  }, [languageProp]);

  const handleSourceChange = useCallback(
    (next: string) => {
      onSourceChange?.(next, language);
    },
    [onSourceChange, language],
  );

  useEffect(() => {
    onReadyRef.current?.({
      getState: () => ({ language, source, stdin }),
      setLanguage,
      setSource,
      setStdin,
    });
  }, [language, source, stdin]);

  return (
    <div className={className} style={{ height, minHeight: 0 }}>
      <IDE
        initialLanguage={language}
        initialSource={source}
        initialStdin={stdin}
        showShareButton={normalized.showShareButton}
        showDownloadButton={normalized.showDownloadButton}
        theme={normalized.theme}
        onSourceChange={handleSourceChange}
        onRunComplete={normalized.onRunComplete}
      />
    </div>
  );
}

export default WasmIDE;
