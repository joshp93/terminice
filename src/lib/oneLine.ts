/** The most characters a single-line summary keeps before it is shortened. */
const DEFAULT_LIMIT = 80;

/**
 * Collapses text to a single, bounded line.
 *
 * Summaries are shown in places that have room for one line — a card's title, a
 * collapsed row — so a multi-line command or a long path would otherwise break
 * the layout it was written for.
 *
 * @param text - The text to collapse.
 * @param limit - The most characters to keep, including any ellipsis.
 * @returns The first line, trimmed, shortened with an ellipsis when it was too
 *   long.
 */
export function oneLine(text: string, limit: number = DEFAULT_LIMIT): string {
  const collapsed = text.split("\n")[0].trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}
