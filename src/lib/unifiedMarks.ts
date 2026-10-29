import { diffLineKind, isPatchPlumbing } from "./diffLines";
import { type CharRange, changedRanges } from "./inlineDiff";

/**
 * Finds what to mark in a one-column patch.
 *
 * A block of removals is followed by a block of additions, and each removal is
 * paired with the addition that took its place — the same pairing the two-column
 * view makes. The pair is compared character by character, so a line that
 * differs by one character marks that character rather than the whole line.
 *
 * @param lines - The lines of the patch.
 * @returns The ranges to mark, keyed by the line's index.
 */
export function unifiedMarks(lines: readonly string[]): Map<number, CharRange[]> {
  const marks = new Map<number, CharRange[]>();
  let removed: number[] = [];

  lines.forEach((line, index) => {
    if (isPatchPlumbing(line)) {
      removed = [];
      return;
    }

    const kind = diffLineKind(line);
    if (kind === "removal") {
      removed.push(index);
      return;
    }

    if (kind === "addition") {
      const before = removed.shift();
      if (before !== undefined) {
        const pair = changedRanges(lines[before].slice(1), line.slice(1));
        if (pair.before.length > 0) marks.set(before, pair.before);
        if (pair.after.length > 0) marks.set(index, pair.after);
      }
      return;
    }

    removed = [];
  });

  return marks;
}
