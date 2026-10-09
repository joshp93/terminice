/**
 * How long the space bar must be held before it becomes speech.
 *
 * Long enough that a space held while thinking about the next word is not
 * mistaken for an attempt to dictate, and short enough that starting to speak
 * does not feel like waiting for something. This is the one dial for that
 * trade-off.
 */
export const HOLD_TO_TALK_MS = 500;

/** A range of the composer's text. */
export type TextRange = {
  from: number;
  to: number;
};

/**
 * The spaces one hold-to-talk press typed, which the recording stands in for.
 *
 * A held key repeats, so a second of holding leaves a run of spaces behind it.
 * Only the run this press produced is taken back: a space typed deliberately
 * before the hold is not redundant, and removing it would run the dictated
 * words into the word before them.
 *
 * @param text - The composer's whole contents.
 * @param from - Where the caret was when the press began.
 * @param to - Where the caret is now.
 * @returns The range to delete, or null when there is nothing to take back.
 */
export function holdCleanupRange(text: string, from: number, to: number): TextRange | null {
  if (from >= to || from < 0 || to > text.length) return null;

  const typed = text.slice(from, to);
  return /^ +$/.test(typed) ? { from, to } : null;
}
