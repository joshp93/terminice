const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

/**
 * Wraps text so a terminal treats it as one atomic paste.
 *
 * Embedded paste markers are removed so a payload cannot break out of the
 * bracketed region and be interpreted as typed input.
 *
 * @param text - The text to wrap.
 * @returns The text surrounded by bracketed paste markers.
 */
export function bracketedPaste(text: string): string {
  const sanitized = text.split(PASTE_END).join("").split(PASTE_START).join("");
  return `${PASTE_START}${sanitized}${PASTE_END}`;
}
