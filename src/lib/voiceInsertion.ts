/**
 * The punctuation a dictated word must not be run into.
 *
 * Every one of these is written hard against the word before it, so a transcript
 * landing straight after one arrives joined to the sentence: "Done.Well, I
 * think…" rather than "Done. Well, I think…".
 */
const RUNS_TOGETHER = ".,;:!?";

/**
 * What to put in front of a transcript so it does not run into what precedes it.
 *
 * Only the character immediately before the caret is read. A reader who typed a
 * space after their full stop has already separated the two, and the character
 * before the caret is then that space — which is not punctuation, so nothing is
 * added and the gap is not doubled.
 *
 * @param before - The character immediately before the caret, or "" at the very start.
 * @param transcript - The words about to be written.
 * @returns One space, or nothing when the words already stand apart.
 */
export function dictationPrefix(before: string, transcript: string): string {
  if (before.length !== 1 || !RUNS_TOGETHER.includes(before)) return "";
  if (/^\s/.test(transcript)) return "";
  return " ";
}
