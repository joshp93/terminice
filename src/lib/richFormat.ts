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

/**
 * The characters a style is written with.
 *
 * A marker is only a marker when it stands beside real text: one that lands
 * against another marker, or against nothing, is either swallowed into a longer
 * run or fails to close at all.
 */
export const MARKER_CHARACTERS = "*_~`";

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

/**
 * Which styles are armed.
 *
 * Armed means the next character typed will be wrapped, and nothing has been
 * written yet — pressing a style writes nothing at all until there is something
 * to put between the markers. Once a character has been wrapped the state is
 * empty again: whether the caret is inside a style is read from the Markdown
 * itself rather than remembered here, so moving the caret in or out of a block
 * needs nothing to be kept in step.
 */
export type InlineState = {
  /** Styles that will wrap the next typed character. */
  armed: ReadonlySet<FormatId>;
};

/** The result of typing a character while a style is armed. */
export type TypingPlan = {
  /** The opening markers, the character, and the closing markers. */
  insert: string;
  /** Where the caret lands inside what is inserted. */
  caretOffset: number;
  state: InlineState;
};

function usesCommandKey(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * Creates the inline state for an empty composer.
 *
 * @returns The inline state, with nothing armed.
 */
export function createInlineState(): InlineState {
  return { armed: new Set() };
}

/**
 * Builds the marker string for a set of styles.
 *
 * Order is fixed so the same set always produces the same markers, and so the
 * closing markers mirror the opening ones.
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
 * Names a shortcut the way the platform writes it.
 *
 * @param key - The key, as it appears after the modifier.
 * @returns A label such as `Ctrl+B` or `⌘B`.
 */
function shortcutLabel(key: string): string {
  return usesCommandKey() ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * Returns the platform-appropriate shortcut label for a style.
 *
 * @param id - The style.
 * @returns A label such as `Ctrl+B` or `⌘B`.
 */
export function formatShortcutLabel(id: FormatId): string {
  return shortcutLabel(SHORTCUT_KEYS[id]);
}

/**
 * The key that toggles a quote, as a keymap names it.
 *
 * `>` is written with the shift key on most layouts, but CodeMirror reads a
 * character from `event.key` and does not add `Shift-` for one, so the binding
 * is the same whether the layout puts `>` behind a shift or not.
 */
export const QUOTE_SHORTCUT_KEY = "Mod->";

/**
 * Returns the platform-appropriate shortcut label for the quote.
 *
 * @returns A label such as `Ctrl+>` or `⌘>`.
 */
export function quoteShortcutLabel(): string {
  return shortcutLabel(">");
}

/**
 * Arms a style, so the next character typed is wrapped in it.
 *
 * @param id - The style to arm.
 * @param state - The current inline state.
 * @returns The state with the style armed.
 */
export function armFormat(id: FormatId, state: InlineState): InlineState {
  const armed = new Set(state.armed);
  armed.add(id);
  return { armed };
}

/**
 * Disarms a style.
 *
 * @param id - The style to disarm.
 * @param state - The current inline state.
 * @returns The state without the style armed.
 */
export function disarmFormat(id: FormatId, state: InlineState): InlineState {
  const armed = new Set(state.armed);
  armed.delete(id);
  return { armed };
}

/**
 * Arms a style that is not armed, and disarms one that is.
 *
 * @param id - The style that was pressed.
 * @param state - The current inline state.
 * @returns The state with the style the other way round.
 */
export function toggleArmedFormat(id: FormatId, state: InlineState): InlineState {
  return state.armed.has(id) ? disarmFormat(id, state) : armFormat(id, state);
}

/**
 * Plans what to insert for a typed character.
 *
 * Both markers are written at once, with the caret left between the character
 * and the closing markers, so what is on screen is what will be sent rather
 * than a block waiting to be closed. Whitespace is inserted plainly and the
 * styles stay armed, because Markdown cannot open emphasis against a space —
 * wrapping one would leave the markers as literal characters.
 *
 * @param char - The character typed.
 * @param state - The current inline state.
 * @returns The text to insert and where the caret lands, or null to insert
 *   plainly.
 */
export function planTypedCharacter(char: string, state: InlineState): TypingPlan | null {
  if (state.armed.size === 0) return null;
  if (/\s/.test(char)) return null;

  const markers = formatMarkers(state.armed);
  return {
    insert: `${markers}${char}${markers}`,
    caretOffset: markers.length + char.length,
    state: createInlineState(),
  };
}

/** Offsets into a selection of the text its markers should enclose. */
export type WrapOffsets = {
  start: number;
  end: number;
};

/**
 * Narrows a selection to the text its markers should enclose.
 *
 * Markdown will not open or close emphasis against whitespace, so wrapping a
 * selection that ends in a space produces literal asterisks rather than bold
 * text. The whitespace is left in the document, outside the markers.
 *
 * @param text - The selection's text.
 * @returns Offsets relative to the selection, or null when it holds no visible text.
 */
export function wrapOffsets(text: string): WrapOffsets | null {
  let start = 0;
  let end = text.length;
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return start >= end ? null : { start, end };
}
