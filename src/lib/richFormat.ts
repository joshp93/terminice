/** A Markdown inline style the composer can apply. */
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

/** The inline styles offered in the composer toolbar, in display order. */
export const FORMATS: readonly FormatDefinition[] = [
  { id: "bold", label: "Bold", glyph: "B" },
  { id: "italic", label: "Italic", glyph: "I" },
  { id: "strike", label: "Strikethrough", glyph: "S" },
  { id: "code", label: "Inline code", glyph: "‹›" },
];

/** Which styles are armed, and which have been opened and await closing. */
export type InlineState = {
  /** Styles that will wrap the next typed character. */
  armed: ReadonlySet<FormatId>;
  /** Styles whose opening markers are written and await their closing markers. */
  open: ReadonlySet<FormatId>;
};

/** What pressing a style control does. */
export type TogglePlan =
  | { kind: "close"; insert: string; state: InlineState }
  | { kind: "arm"; state: InlineState };

/** The result of typing a character while a style is armed. */
export type TypingPlan = {
  insert: string;
  state: InlineState;
};

function usesCommandKey(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Creates the inline state for an empty composer. */
export function createInlineState(): InlineState {
  return { armed: new Set(), open: new Set() };
}

/**
 * Builds the marker string for a set of styles.
 *
 * Order is fixed so the same selection always produces the same markers.
 *
 * @param active - The styles to build markers for.
 * @returns The concatenated markers, or an empty string for none.
 */
export function formatMarkers(active: Iterable<FormatId>): string {
  const set = new Set(active);
  return FORMAT_ORDER.filter((id) => set.has(id))
    .map((id) => FORMAT_MARKERS[id])
    .join("");
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
 * Whether a style should render as active.
 *
 * @param state - The current inline state.
 * @param id - The style.
 * @returns True while the style is armed or open.
 */
export function isFormatActive(state: InlineState, id: FormatId): boolean {
  return state.armed.has(id) || state.open.has(id);
}

/**
 * Returns the markers needed to close the open group.
 *
 * @param state - The current inline state.
 * @returns The closing markers, or an empty string when nothing is open.
 */
export function closingMarkers(state: InlineState): string {
  return formatMarkers(state.open);
}

/**
 * Plans what pressing a style control does when nothing is selected.
 *
 * Pressing the same style again closes the group; pressing an unarmed style
 * arms it so the next typed character is wrapped.
 *
 * @param id - The style that was pressed.
 * @param state - The current inline state.
 * @returns Either a close to perform, or the state to adopt.
 */
export function planToggle(id: FormatId, state: InlineState): TogglePlan {
  if (state.armed.has(id)) {
    const armed = new Set(state.armed);
    armed.delete(id);
    return { kind: "arm", state: { armed, open: state.open } };
  }

  if (state.open.has(id)) {
    return { kind: "close", insert: closingMarkers(state), state: createInlineState() };
  }

  const armed = new Set(state.armed);
  armed.add(id);
  return { kind: "arm", state: { armed, open: state.open } };
}

/**
 * Plans what to insert for a typed character.
 *
 * @param char - The character typed.
 * @param state - The current inline state.
 * @returns The text to insert and the resulting state, or null to insert plainly.
 */
export function planTypedCharacter(char: string, state: InlineState): TypingPlan | null {
  if (state.armed.size === 0) return null;
  const open = new Set(state.open);
  for (const id of state.armed) open.add(id);
  return {
    insert: formatMarkers(state.armed) + char,
    state: { armed: new Set(), open },
  };
}
