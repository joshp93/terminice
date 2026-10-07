/** The character that opens the file menu. */
export const MENTION_PREFIX = "@";

/** How many characters must follow `@` before the menu is worth opening. */
export const MENTION_MINIMUM = 2;

/** A file mention the caret is sitting inside. */
export type Mention = {
  /** What has been typed after the `@`. */
  query: string;
  /** Where the `@` sits in the document. */
  from: number;
};

/**
 * Finds the file mention the caret is inside, if any.
 *
 * The `@` has to open a word, so an address in the middle of a sentence does
 * not turn the composer into a file menu, and the query stops at the first
 * space, so a mention that has been typed past is no longer one.
 *
 * @param text - The composer's contents.
 * @param caret - Where the caret is.
 * @returns The query and where its `@` sits, or null when this is not a mention.
 */
export function mentionIn(text: string, caret: number): Mention | null {
  const before = text.slice(0, caret);
  const from = before.lastIndexOf(MENTION_PREFIX);
  if (from < 0) return null;

  const query = before.slice(from + MENTION_PREFIX.length);
  if (/[\s@]/.test(query)) return null;
  if (query.length < MENTION_MINIMUM) return null;

  const preceding = from > 0 ? before[from - 1] : "\n";
  if (!/\s/.test(preceding)) return null;

  return { query, from };
}
