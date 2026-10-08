/**
 * How much of one local command's output is handed to the model.
 *
 * This is the cap that actually protects the context window: a careless command
 * would otherwise consume all of it.
 */
export const MAX_MODEL_OUTPUT = 30_000;

/**
 * How much of one local command's output the transcript keeps.
 *
 * Far above what the model is given, so the card still shows essentially
 * everything a command printed. It exists only so that one runaway command
 * cannot hold the whole of a huge file in memory and render it into the DOM.
 */
export const MAX_DISPLAY_OUTPUT = 1_000_000;

/**
 * How much of one tool's output an expanded card renders.
 *
 * A tool can return as much as it likes, and a card is a summary of a call
 * rather than a file viewer: without a cap one call that returned a large file
 * renders the whole of it into the document, which is slow to lay out and
 * impossible to read past. What is dropped is said so on the card itself.
 */
export const MAX_CARD_OUTPUT = 20_000;

/**
 * How much of one line a collapsed card shows.
 *
 * Lines are capped as well as counted, because output with no line breaks in it
 * — a minified document, a long JSON result — is one line however long it runs,
 * and a card that shows two of those shows all of it.
 */
export const MAX_PREVIEW_LINE = 240;

/**
 * Steps back off a surrogate pair so a cut never splits a character.
 *
 * @param text - The text being cut.
 * @param limit - The offset to cut at.
 * @returns The offset to use, which is one lower inside a surrogate pair.
 */
function safeCut(text: string, limit: number): number {
  const code = text.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

/**
 * Truncates text to a limit, saying so when anything was dropped.
 *
 * @param text - The text to cap.
 * @param limit - The most characters to keep.
 * @param note - Appended after the kept text when something was dropped.
 * @returns The text unchanged when it fits, otherwise a prefix and the note.
 */
function cap(text: string, limit: number, note: string): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, safeCut(text, limit))}\n${note}`;
}

/**
 * Caps one stream of local command output before it reaches the model.
 *
 * @param text - What the command printed, in full.
 * @returns The text unchanged when it fits, otherwise a prefix and a note
 *   saying how much was dropped.
 */
export function capForModel(text: string): string {
  return cap(text, MAX_MODEL_OUTPUT, `… output truncated at ${MAX_MODEL_OUTPUT} bytes`);
}

/**
 * Caps one stream of local command output before the transcript keeps it.
 *
 * @param text - What the command printed, in full.
 * @returns The text unchanged when it fits, otherwise a prefix and a note
 *   saying it was cut short for display.
 */
export function capForDisplay(text: string): string {
  return cap(
    text,
    MAX_DISPLAY_OUTPUT,
    `… output truncated for display at ${MAX_DISPLAY_OUTPUT} bytes`,
  );
}

/**
 * Caps one tool output before an expanded card renders it.
 *
 * @param text - The output, in full.
 * @returns The text unchanged when it fits, otherwise a prefix and a note
 *   saying how much was held back.
 */
export function capForCard(text: string): string {
  return cap(text, MAX_CARD_OUTPUT, `… output truncated at ${MAX_CARD_OUTPUT} characters`);
}

/**
 * Shortens one line to what a collapsed card has room for.
 *
 * @param line - The line to shorten.
 * @param limit - The most characters to keep.
 * @returns The line unchanged when it fits, otherwise a prefix and an ellipsis.
 */
export function clipLine(line: string, limit: number = MAX_PREVIEW_LINE): string {
  if (line.length <= limit) return line;
  return `${line.slice(0, safeCut(line, limit))}…`;
}
