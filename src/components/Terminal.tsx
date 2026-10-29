/**
 * Terminal-style output pane.
 *
 * Renders the accumulated stdout/stderr/system chunks from the runner. Kept as
 * plain DOM (no xterm.js) so the published Pages build stays small and the e2e
 * suite can assert on text directly.
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { OutputEntry } from "@/lib/ide";

const STREAM_CLASS: Record<OutputEntry["stream"], string> = {
  stdout: "text-neutral-100",
  stderr: "text-red-400",
  system: "text-muted-foreground italic",
};

export function Terminal({ output, className }: { output: OutputEntry[]; className?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest output in view, the way a real terminal does.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [output]);

  return (
    <div
      ref={scrollRef}
      data-testid="terminal-output"
      role="log"
      aria-live="polite"
      aria-label="Program output"
      className={cn(
        "h-full overflow-auto whitespace-pre-wrap break-words rounded-md border bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100",
        className,
      )}
    >
      {output.length === 0 ? (
        <span className="text-neutral-500">Press Run to execute your program in the browser.</span>
      ) : (
        output.map(entry => (
          <span key={entry.id} className={STREAM_CLASS[entry.stream]}>
            {entry.text}
          </span>
        ))
      )}
    </div>
  );
}
