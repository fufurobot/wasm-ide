/**
 * Language selector.
 *
 * A plain native <select> is used deliberately: it is keyboard- and
 * screen-reader-friendly by default and the e2e suite drives it with
 * `selectOption`, which is far less brittle than a custom Radix listbox.
 * The catalog comes from `src/lib/ide.ts`, which mirrors Runno's runtime union.
 */

import { DEFAULT_LANGUAGE, LANGUAGES, type EditorLanguage } from "@/lib/ide";

export function LanguagePicker({
  value,
  onChange,
  disabled,
}: {
  value: EditorLanguage;
  onChange: (language: EditorLanguage) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Language</span>
      <select
        data-testid="language-picker"
        aria-label="Language"
        disabled={disabled}
        value={value}
        onChange={event => onChange(event.target.value as EditorLanguage)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {(Object.keys(LANGUAGES) as EditorLanguage[]).map(id => (
          <option key={id} value={id}>
            {LANGUAGES[id].label}
          </option>
        ))}
      </select>
    </label>
  );
}

export { DEFAULT_LANGUAGE };
