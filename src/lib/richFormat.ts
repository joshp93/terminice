/** A Markdown inline style the composer can wrap words in. */
export type FormatId = "bold" | "italic" | "strike" | "code";

/** How a style is presented in the toolbar. */
export type FormatDefinition = {
  id: FormatId;
  label: string;
  glyph: string;
};

/**
 * Markdown markers per style.
 *
 * These follow CommonMark, so the rendered transcript agrees with what is sent:
 * a single `*` is emphasis, and bold needs `**`.
 */
export const FORMAT_MARKERS: Record<FormatId, string> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
};

const FORMAT_ORDER: readonly FormatId[] = ["bold", "italic", "strike", "code"];

const SHORTCUT_KEYS: Record<FormatId, string> = {
  bold: "B",
  italic: "I",
  strike: "Shift+X",
  code: "E",
};

/** The styles offered in the composer toolbar, in display order. */
export const FORMATS: readonly FormatDefinition[] = [
  { id: "bold", label: "Bold", glyph: "B" },
  { id: "italic", label: "Italic", glyph: "I" },
  { id: "strike", label: "Strikethrough", glyph: "S" },
  { id: "code", label: "Inline code", glyph: "‹›" },
];

/** Tracks whether a marker-wrapped word is currently open. */
export type TypingState = {
  /** Markers that opened the current word, or an empty string when none is open. */
  openMarkers: string;
};

/** The text to insert for one typed character, and the state that follows. */
export type InsertionPlan = {
  insert: string;
  state: TypingState;
};

function usesCommandKey(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * Returns the platform-appropriate shortcut label for a style.
 *
 * @param id - The style.
 * @returns A label such as `Ctrl+B` or `⌘B`.
 */
export function formatShortcutLabel(id: FormatId): string {
  return usesCommandKey() ? `⌘${SHORTCUT_KEYS[id]}` : `Ctrl+${SHORTCUT_KEYS[id]}`;
}

/**
 * Builds the marker string for the armed styles.
 *
 * Order is fixed so the same selection always produces the same markers.
 *
 * @param active - The armed styles.
 * @returns The concatenated markers, or an empty string when none are armed.
 */
export function formatMarkers(active: Iterable<FormatId>): string {
  const set = new Set(active);
  return FORMAT_ORDER.filter((id) => set.has(id))
    .map((id) => FORMAT_MARKERS[id])
    .join("");
}

/** Creates the typing state for an empty composer. */
export function createTypingState(): TypingState {
  return { openMarkers: "" };
}

/**
 * Whether a character ends the word it appears in.
 *
 * @param char - The character typed.
 * @returns True for whitespace.
 */
export function isWordBoundary(char: string): boolean {
  return /\s/.test(char);
}

/**
 * Plans the insertion of one typed character.
 *
 * While styles are armed the first character of a word is prefixed with the
 * markers and any word boundary closes them, so typing `Hello, world` with bold
 * armed produces `**Hello,** **world**`.
 *
 * @param char - The character typed.
 * @param markers - Markers for the armed styles; empty disables wrapping.
 * @param state - The typing state before this character.
 * @returns The text to insert and the resulting state.
 */
export function planInsertion(char: string, markers: string, state: TypingState): InsertionPlan {
  if (markers.length === 0) {
    return { insert: char, state };
  }
  if (isWordBoundary(char)) {
    return { insert: state.openMarkers + char, state: createTypingState() };
  }
  if (state.openMarkers.length === 0) {
    return { insert: markers + char, state: { openMarkers: markers } };
  }
  return { insert: char, state };
}

/**
 * Returns the markers needed to close a word left open.
 *
 * @param state - The typing state.
 * @returns The closing markers, or an empty string when no word is open.
 */
export function planClose(state: TypingState): string {
  return state.openMarkers;
}
