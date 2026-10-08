/** Which way an arrow key steps through what has already been sent. */
export type RecallStep = -1 | 1 | null;

/** What the composer looks like at the moment an arrow key arrives. */
export type RecallInput = {
  /** The key that was pressed. */
  key: string;
  /** Whether the caret sits at the very start of what has been written. */
  atStart: boolean;
  /** Whether the caret sits at the very end of it. */
  atEnd: boolean;
  /** Whether it holds a slash command, whose end belongs to its own menu. */
  writingCommand: boolean;
};

/**
 * Decides whether an arrow key steps through what has been sent.
 *
 * The arrows only reach back into the history from the edges of the text, so
 * the moment the caret moves into the middle of a message they belong to the
 * caret and it can be edited like any other text — which is what makes an
 * old message worth recalling rather than a trap to be escaped from.
 *
 * Backwards wants the very start. Forwards wants the very end, because the end
 * of a message is where a reader who has finished with it is standing. A
 * command is the exception: the caret only counts for it at the start, since
 * the end of a command is where its menu is open and reading Down as a move
 * through the menu's own entries.
 *
 * @param input - The key and where the caret is.
 * @returns -1 to step older, 1 to step newer, or null to leave the key alone.
 */
export function recallStepFor({ key, atStart, atEnd, writingCommand }: RecallInput): RecallStep {
  if (key === "ArrowUp") return atStart ? -1 : null;
  if (key !== "ArrowDown") return null;
  if (atStart) return 1;
  return atEnd && !writingCommand ? 1 : null;
}
