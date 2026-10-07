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
