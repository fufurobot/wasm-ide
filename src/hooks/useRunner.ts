/**
 * Drives a Runno WebAssembly runtime from React.
 *
 * Everything runs in the browser via `@runno/runtime`'s headless API: the wasm
 * image is fetched from the CDN, the program is compiled and executed locally,
 * and stdout/stderr are streamed back. No user code is ever uploaded anywhere.
 *
 * `headlessRunFS` takes the whole filesystem up front and resolves once the
 * program finishes (Runno's runner is not chunk-streaming), so the hook
 * appends the terminal output in one pass and reports a synthetic "system"
 * line while the wasm is still being fetched.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildRunRequest,
  formatResult,
  mergeOutput,
  reconcileOutput,
  type EditorLanguage,
  type OutputEntry,
} from "@/lib/ide";

/** Lazily imported so the ~wasm loader never blocks first paint. */
type RunnoModule = typeof import("@runno/runtime");
let runnoModule: Promise<RunnoModule> | null = null;
function loadRunno(): Promise<RunnoModule> {
  runnoModule ??= import("@runno/runtime");
  return runnoModule;
}

export type RunnerStatus = "idle" | "loading" | "running" | "done" | "error";

export type RunnerState = {
  status: RunnerStatus;
  output: OutputEntry[];
  exitCode: number | null;
  durationMs: number | null;
  summary: string | null;
};

const INITIAL: RunnerState = {
  status: "idle",
  output: [],
  exitCode: null,
  durationMs: null,
  summary: null,
};

export type RunArgs = {
  language: EditorLanguage;
  source: string;
  stdin: string;
};

/** Raw text Runno pushed out of its worker, kept separately from the UI log. */
type StreamedText = { stdout: string[]; stderr: string[] };

export function useRunner() {
  const [state, setState] = useState<RunnerState>(INITIAL);
  const runIdRef = useRef(0);
  /**
   * Text Runno pushed out of its worker during the current run.
   *
   * Kept in a ref rather than state because it is a transcript for
   * reconciliation, not something the UI renders directly.
   */
  const streamRef = useRef<StreamedText>({ stdout: [], stderr: [] });

  // Abort state updates from a superseded run (e.g. the user hit Run twice).
  const isCurrent = useCallback((id: number) => runIdRef.current === id, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setState(INITIAL);
  }, []);

  const run = useCallback(
    async ({ language, source, stdin }: RunArgs) => {
      const id = ++runIdRef.current;
      streamRef.current = { stdout: [], stderr: [] };

      let request;
      try {
        request = buildRunRequest(language, source, stdin);
      } catch (error) {
        setState({
          ...INITIAL,
          status: "error",
          output: mergeOutput([
            { stream: "stderr", text: `${(error as Error).message}\n` },
          ]),
        });
        return;
      }

      setState({
        status: "loading",
        output: mergeOutput([
          { stream: "system", text: `Loading ${request.runtime} runtime (WebAssembly)…\n` },
        ]),
        exitCode: null,
        durationMs: null,
        summary: null,
      });

      const startedAt = performance.now();

      try {
        const { headlessRunCode, headlessRunFS } = await loadRunno();
        if (!isCurrent(id)) return;

        setState(previous => ({
          ...previous,
          status: "running",
          output: mergeOutput([
            ...previous.output,
            { stream: "system", text: `Running ${request.entryPath}…\n\n` },
          ]),
        }));

        // A single-file program has no extra filesystem, so `headlessRunCode`
        // is the right call; `headlessRunFS` is kept for multi-file support.
        const result =
          request.files.length === 1 && request.files[0]!.path === request.entryPath
            ? await headlessRunCode(request.runtime, request.files[0]!.content, request.stdin)
            : await headlessRunFS(
                request.runtime,
                request.entryPath,
                Object.fromEntries(
                  request.files.map(file => [
                    file.path,
                    { path: file.path, content: new TextEncoder().encode(file.content), mode: "string" },
                  ]),
                ) as never,
                request.stdin,
              );

        if (!isCurrent(id)) return;

        const durationMs = Math.round(performance.now() - startedAt);

        if (result.resultType === "crash") {
          setState({
            status: "error",
            output: mergeOutput([
              { stream: "stderr", text: `${result.error.type}: ${result.error.message}\n` },
            ]),
            exitCode: 1,
            durationMs,
            summary: `Runtime crashed after ${(durationMs / 1000).toFixed(2)}s`,
          });
          return;
        }

        if (result.resultType === "timeout") {
          setState({
            status: "error",
            output: mergeOutput([{ stream: "stderr", text: "Execution timed out.\n" }]),
            exitCode: null,
            durationMs,
            summary: "Timed out",
          });
          return;
        }

        if (result.resultType === "terminated") {
          setState(previous => ({
            ...previous,
            status: "done",
            durationMs,
            summary: "Stopped by user",
          }));
          return;
        }

        // Complete result. Runno accumulates stdout/stderr in its worker and
        // returns them here, but `start()` resolves on proc_exit and can beat
        // the worker's final postMessage through the queue, so the returned
        // text may be short by one chunk. reconcileOutput takes whichever
        // transcript is longer rather than trusting one blindly.
        const streamed = streamRef.current;
        const stdout = reconcileOutput(streamed.stdout.join(""), result.stdout);
        const stderr = reconcileOutput(streamed.stderr.join(""), result.stderr);

        setState({
          status: "done",
          output: mergeOutput([
            { stream: "stdout" as const, text: stdout },
            { stream: "stderr" as const, text: stderr },
          ]),
          exitCode: result.exitCode,
          durationMs,
          summary: formatResult({ exitCode: result.exitCode, durationMs }),
        });
      } catch (error) {
        if (!isCurrent(id)) return;
        setState({
          status: "error",
          output: mergeOutput([
            { stream: "stderr", text: `${(error as Error)?.message ?? String(error)}\n` },
          ]),
          exitCode: null,
          durationMs: Math.round(performance.now() - startedAt),
          summary: "Failed to start the runtime",
        });
      }
    },
    [isCurrent],
  );

  /** Runno's headless call is a promise; there is no cancel token to revoke. */
  const stop = useCallback(() => {
    runIdRef.current += 1;
    setState(previous => ({
      ...previous,
      status: "done",
      summary: "Stopped by user",
    }));
  }, []);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
    };
  }, []);

  const isBusy = state.status === "loading" || state.status === "running";

  return { state, run, reset, stop, isBusy };
}
