/**
 * Shared keyboard allow-list for NUMERIC scene entries — the typed draw-length
 * pill, the guide-offset pill, and the rotate-gizmo typed-angle input.
 *
 * The rule (user-specified): while a numeric scene entry is capturing
 * keystrokes, the ONLY letter it may accept is `m` (for mm/m units). Digits,
 * `.`, `-`, `/` (fractions) and `'`/`"` (feet/inches) edit the value;
 * editing/navigation keys (Backspace, Delete, arrows, Home/End, Tab) plus
 * Enter and Escape stay in the entry. ANY other letter — and Space — must
 * cancel the entry/operation AND fire the global hotkey it is bound to
 * (V→select, D→draw, Space→select, …), exactly as if no entry were active.
 * Modifier combos (Ctrl/Cmd/Alt) keep their existing behavior untouched.
 *
 * Normal text fields (rename, search, …) are NOT numeric entries — letters
 * stay letters there. A real DOM `<input>` that follows this rule marks
 * itself with `data-numeric-entry` so the global hotkey handler's
 * "ignore keys typed into inputs" guard lets its cancelled-hotkey keys
 * through instead of swallowing them.
 */

/** DOM attribute marking a real `<input>` as a numeric scene entry. */
export const NUMERIC_ENTRY_ATTR = 'data-numeric-entry';

/** Spread onto a numeric-entry `<input>` so the global handler recognizes it. */
export const NUMERIC_ENTRY_DOM_PROPS: Record<string, string> = { [NUMERIC_ENTRY_ATTR]: 'true' };

/** True when a keyboard event's target is a marked numeric scene entry. */
export function isNumericEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.hasAttribute(NUMERIC_ENTRY_ATTR);
}

export type NumericEntryKeyAction =
  /** character joins the typed value (digits, `.`, `-`, `/`, `'`, `"`, `m`/`M`) */
  | 'insert'
  /** caret/editing key — stays inside the entry (Backspace, Delete, arrows, Home/End, Tab) */
  | 'edit'
  /** Enter — commit the entry */
  | 'commit'
  /** Escape — the entry's own cancel path */
  | 'cancel'
  /** disallowed letter or Space — cancel the entry AND run the global hotkey */
  | 'hotkey'
  /** any other printable char (unlisted punctuation) — consumed, no effect */
  | 'ignore'
  /** not the entry's business (modifier combos, F-keys, bare Shift, …) */
  | 'pass';

const INSERT_CHAR = /^[0-9.\-/'"m]$/i;

const EDIT_KEYS = new Set([
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Tab',
]);

/** Only the fields of KeyboardEvent the classifier reads (keeps it testable). */
export interface NumericEntryKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Classify a keydown against the numeric-entry allow-list. Pure. */
export function classifyNumericEntryKey(e: NumericEntryKeyInput): NumericEntryKeyAction {
  // Ctrl/Cmd/Alt combos keep their current behavior everywhere (undo/redo, …).
  if (e.ctrlKey || e.metaKey || e.altKey) return 'pass';
  if (e.key === 'Enter') return 'commit';
  if (e.key === 'Escape') return 'cancel';
  if (EDIT_KEYS.has(e.key)) return 'edit';
  if (e.key.length === 1) {
    if (INSERT_CHAR.test(e.key)) return 'insert';
    // Space and every letter other than m/M: cancel + fire the hotkey.
    if (e.key === ' ' || /\p{L}/u.test(e.key)) return 'hotkey';
    return 'ignore';
  }
  return 'pass';
}
