/**
 * Plain-JS entry: `import { createIDE } from "@fufurobot/wasm-ide/vanilla"`.
 *
 * Mounts the same workspace into any DOM node with no JSX, no hooks and no
 * build step at the call site:
 *
 *   <div id="ide"></div>
 *   <script type="module">
 *     import { createIDE } from "@fufurobot/wasm-ide/vanilla";
 *     const ide = createIDE({ target: document.getElementById("ide") });
 *   </script>
 *
 * React is still used *internally* (the workspace is written in React), but it
 * is bundled into this build rather than imported from the consumer's
 * node_modules. That is what makes the plain-JS path possible: a page with no
 * bundler and no React anywhere can still run the IDE.
 */

import { createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

import { IDE } from "@/components/IDE";
import { normalizeOptions, type IDEOptions, type IDEState } from "@/lib/embed";
import type { EditorLanguage } from "@/lib/ide";

export type CreateIDEOptions = IDEOptions & {
  /** Element to mount into, or a selector for one. */
  target: HTMLElement | string;
  /** CSS height for the mounted workspace. Default "640px". */
  height?: string;
};

export type IDEHandle = {
  /** Unmount the IDE and release its DOM. Safe to call twice. */
  destroy: () => void;
  /** Current language, source and stdin. */
  getState: () => IDEState;
  /** Replace the language without touching the buffer. */
  setLanguage: (language: EditorLanguage) => void;
  /** Replace the source buffer. */
  setSource: (source: string) => void;
  /** Replace stdin. */
  setStdin: (stdin: string) => void;
  /** The element the IDE was mounted into. */
  root: HTMLElement;
};

function resolveTarget(target: HTMLElement | string | undefined): HTMLElement {
  if (!target) {
    throw new Error("createIDE: `target` is required (an element or a CSS selector).");
  }
  if (typeof target !== "string") return target;

  const element = document.querySelector<HTMLElement>(target);
  if (!element) {
    throw new Error(`createIDE: no element matches selector "${target}".`);
  }
  return element;
}

export function createIDE(options: CreateIDEOptions): IDEHandle {
  const mount = resolveTarget(options.target);
  const normalized = normalizeOptions(options);

  // Container takes the caller's element out of the layout equation: the app
  // styles a full-viewport grid, which does not belong inside an arbitrary host.
  const container = document.createElement("div");
  container.dataset.wasmIdeRoot = "";
  container.style.height = options.height ?? "640px";
  container.style.minHeight = "0";
  container.style.overflow = "hidden";
  mount.appendChild(container);

  const root: Root = createRoot(container);
  type IDEComponentProps = ComponentProps<typeof IDE>;

  let state: IDEState = {
    language: normalized.language,
    source: normalized.source,
    stdin: normalized.stdin,
  };

  const props: IDEComponentProps = {
    initialLanguage: normalized.language,
    initialSource: normalized.source,
    initialStdin: normalized.stdin,
    showShareButton: normalized.showShareButton,
    showDownloadButton: normalized.showDownloadButton,
    theme: normalized.theme,
    onSourceChange: (source: string) => {
      state = { ...state, source };
      normalized.onSourceChange?.(source, state.language);
    },
    onRunComplete: normalized.onRunComplete,
  };

  root.render(createElement(IDE, props));

  let destroyed = false;

  return {
    root: mount,
    getState: () => ({ ...state }),
    setLanguage: (language: EditorLanguage) => {
      state = { ...state, language };
      // Re-seed the workspace with the new language. `IDE` seeds from these
      // props on mount, so remount via a fresh key rather than relying on prop
      // effects for a state reset.
      const nextProps: IDEComponentProps & { key: string } = {
        ...props,
        key: language,
        initialLanguage: language,
        initialSource: state.source,
      };
      root.render(createElement(IDE, nextProps));
    },
    setSource: (source: string) => {
      state = { ...state, source };
      normalized.onSourceChange?.(source, state.language);
    },
    setStdin: (stdin: string) => {
      state = { ...state, stdin };
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      // Defer so React can finish any in-flight render before unmounting.
      queueMicrotask(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

export type { IDEOptions, IDEState };
export default createIDE;
