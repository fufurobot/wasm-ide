/**
 * Spec: output must not be lost at the end of a run.
 *
 * Runno streams stdout/stderr out of its worker with `postMessage`, but
 * `await instance.start()` resolves on `proc_exit` — which can happen while the
 * final message is still queued. The e2e run of the default Python sample hit
 * exactly this: the terminal showed `fib(0)` … `fib(9)` and the last line was
 * missing, even though the program had finished.
 *
 * These tests pin the reconciliation rule that fixes it: when both a streamed
 * transcript and a final result are available, prefer whichever is *longer*,
 * so a truncated tail is never displayed.
 */

import { describe, expect, test } from "bun:test";
import { reconcileOutput } from "@/lib/ide";

describe("reconcileOutput", () => {
  test("prefers the streamed transcript when the result is truncated", () => {
    const streamed = "fib(0) = 0\nfib(1) = 1\nfib(2) = 1\n";
    const final = "fib(0) = 0\nfib(1) = 1\n"; // last line lost to the race
    expect(reconcileOutput(streamed, final)).toBe(streamed);
  });

  test("prefers the final result when streaming missed the start", () => {
    const streamed = "fib(1) = 1\nfib(2) = 1\n";
    const final = "fib(0) = 0\nfib(1) = 1\nfib(2) = 1\n";
    expect(reconcileOutput(streamed, final)).toBe(final);
  });

  test("returns the final result when nothing was streamed", () => {
    // Non-interactive TTY paths never emit stream messages.
    expect(reconcileOutput("", "hello\n")).toBe("hello\n");
  });

  test("returns the streamed text when the result is empty", () => {
    expect(reconcileOutput("hello\n", "")).toBe("hello\n");
  });

  test("returns an empty string when both are empty", () => {
    expect(reconcileOutput("", "")).toBe("");
  });

  test("is stable when both are identical", () => {
    expect(reconcileOutput("same\n", "same\n")).toBe("same\n");
  });
});
