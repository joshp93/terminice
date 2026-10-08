import { type LineEdit, type ListEnterPlan, planListEnter } from "./listMarkers";

/** The prefix a quoted line carries. */
export const QUOTE_MARKER = "> ";

/** A line that carries a quote, split at the quote's own edge. */
export type ParsedQuoteLine = {
  /** The marker and its space, as written. */
  prefix: string;
  /** Everything after it. */
  content: string;
};

/**
 * The quote at the start of a line, however it was spaced.
 *
 * Every level is taken as one prefix, so a nested quote continues as a nested
 * quote rather than being flattened one line down. The space after a `>` is
 * optional because a bare `>` is a quote with nothing in it, which is what an
 * emptied quote line looks like.
 */
const QUOTE_LINE = /^((?:>[ \t]?)+)(.*)$/;

/**
 * Parses a line as a quoted one.
 *
 * @param line - The line's text, without its newline.
 * @returns The prefix and the content, or null when the line is not quoted.
 */
export function parseQuoteLine(line: string): ParsedQuoteLine | null {
  const match = QUOTE_LINE.exec(line);
  if (!match) return null;
  return { prefix: match[1], content: match[2] };
}

/**
 * Plans toggling a quote on a line.
 *
 * A quoted line loses its quote; a plain line gains one. A list marker is left
 * where it is, so quoting a list item gives `> - item` rather than replacing
 * the list with prose.
 *
 * @param line - The line's text.
 * @returns The edit to apply.
 */
export function planQuoteToggle(line: string): LineEdit {
  const quoted = parseQuoteLine(line);
  if (quoted) return { offset: 0, remove: quoted.prefix.length, insert: "" };
  return { offset: 0, remove: 0, insert: QUOTE_MARKER };
}

/**
 * Plans Enter on a quoted line.
 *
 * The quote carries on to the next line, and so does anything inside it: the
 * quote is peeled off, the rest of the line is planned as whatever it is, and
 * the quote is put back in front. An emptied line unwinds one level at a time —
 * an empty list item inside a quote drops the list and keeps the quote, and an
 * empty quote drops the quote — which is the way out of both without reaching
 * for Backspace.
 *
 * @param line - The line's text.
 * @returns The plan, or null when the line is not quoted.
 */
export function planQuoteEnter(line: string): ListEnterPlan | null {
  const quoted = parseQuoteLine(line);
  if (!quoted) return null;

  const inner = planListEnter(quoted.content);
  if (inner) {
    // The list ended inside the quote, so its marker goes with the quote's own
    // when the line is cleared — the count is from the start of the line, and
    // the list marker is not at the start of it.
    if (inner.removeMarker > 0) {
      return {
        removeMarker: quoted.prefix.length + inner.removeMarker,
        insert: `\n${quoted.prefix}`,
      };
    }
    return { removeMarker: 0, insert: `\n${quoted.prefix}${inner.insert.slice(1)}` };
  }

  if (quoted.content.trim().length === 0) {
    return { removeMarker: quoted.prefix.length, insert: "\n" };
  }

  return { removeMarker: 0, insert: `\n${quoted.prefix}` };
}
