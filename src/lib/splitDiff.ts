import { diffLineKind, isPatchPlumbing } from "./diffLines";

/** One row of a side-by-side diff. */
export type SplitRow =
  /** A line that belongs to neither side, drawn across the whole width. */
  | { kind: "across"; text: string }
  /** A line of the file: as it was on the left, as it is now on the right. */
  | { kind: "pair"; left: string | null; right: string | null };

/**
 * The longest line that will be given a column of its own.
 *
 * Past this there is nothing to compare: two columns of very long lines wrap
 * until neither reads as a line, and one full-width column of the same text is
 * easier to follow. The limit is on the content rather than on the window, which
 * is what makes the choice a fact about this patch rather than about the app.
 */
export const SPLIT_LINE_LIMIT = 120;

/** The rule drawn between the two columns, in CSS pixels. */
const DIVIDER_WIDTH = 1;

/** What one cell adds to the text it holds, in CSS pixels. */
const CELL_PADDING = 16;

/**
 * The longest line of a patch, or null when one is too long to split at all.
 *
 * @param lines - The lines of the patch.
 * @returns The longest line's length in characters, or null when it is over the
 *   limit.
 */
export function splitLineWidth(lines: readonly string[]): number | null {
  const longest = lines.reduce((most, line) => Math.max(most, line.length), 0);
  return longest > SPLIT_LINE_LIMIT ? null : longest;
}

/** What a card has to work with when it decides how to draw a patch. */
export type SplitFit = {
  /** The width the card has for the diff, in CSS pixels. */
  available: number;
  /** The longest line of the patch, in characters. */
  longest: number;
  /** The width of one character of the font the diff is drawn in. */
  characterWidth: number;
};

/**
 * Whether two columns of this patch fit in the width this card has.
 *
 * The answer is measured rather than assumed: the card reports how wide it is,
 * the font is measured to find how wide a character is, and the two are put
 * against the longest line of this particular patch. A narrow card holding a
 * patch of long lines gets one column; the same card holding short lines gets
 * two — which a breakpoint on the window could not tell apart.
 *
 * @param fit - The width available, the longest line and a character's width.
 * @returns True when both columns fit.
 */
export function fitsSideBySide({ available, longest, characterWidth }: SplitFit): boolean {
  if (characterWidth <= 0 || available <= 0) return false;
  const column = longest * characterWidth + CELL_PADDING;
  return available >= column * 2 + DIVIDER_WIDTH;
}

/**
 * Lays a patch out as two columns.
 *
 * A block of removals followed by a block of additions is what a change looks
 * like in a unified diff, and those are exactly the lines that belong beside
 * each other: each removal is paired with the addition that took its place. A
 * block longer than its partner leaves the spare rows blank on the shorter side,
 * which is what keeps the two columns in step from there on.
 *
 * @param lines - The lines of the patch.
 * @returns One row per line, with the changed ones paired up.
 */
export function planSplitRows(lines: readonly string[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let removed: string[] = [];

  const flush = (): void => {
    for (const line of removed) rows.push({ kind: "pair", left: line, right: null });
    removed = [];
  };

  for (const line of lines) {
    if (isPatchPlumbing(line)) {
      flush();
      rows.push({ kind: "across", text: line });
      continue;
    }

    if (diffLineKind(line) === "removal") {
      removed.push(line);
      continue;
    }

    if (diffLineKind(line) === "addition") {
      rows.push({ kind: "pair", left: removed.shift() ?? null, right: line });
      continue;
    }

    // A line both sides carry: drawn in both columns, so the two stay aligned
    // through the unchanged stretches rather than only where they differ.
    flush();
    rows.push({ kind: "pair", left: line, right: line });
  }

  flush();
  return rows;
}
