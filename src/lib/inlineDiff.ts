/** A half-open range of characters within one line. */
export type CharRange = { start: number; end: number };

/** The ranges that differ, on each side of one changed line. */
export type LineMarks = { before: CharRange[]; after: CharRange[] };

/**
 * The most cells a character comparison may fill.
 *
 * The comparison is quadratic, and a patch line can be very long. Past this the
 * middle of the two lines is marked whole, which is the honest answer for a
 * line that was rewritten rather than edited.
 */
const MAX_CELLS = 250_000;

/**
 * The length of the opening the two strings share.
 *
 * @param before - The old line.
 * @param after - The new line.
 * @returns The number of characters they start with.
 */
function commonPrefix(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let index = 0;
  while (index < limit && before[index] === after[index]) index += 1;
  return index;
}

/**
 * The length of the ending the two strings share, without overlapping the
 * opening they already share.
 *
 * @param before - The old line.
 * @param after - The new line.
 * @param prefix - How many characters the opening shares.
 * @returns The number of characters they end with.
 */
function commonSuffix(before: string, after: string, prefix: number): number {
  const limit = Math.min(before.length, after.length) - prefix;
  let length = 0;
  while (
    length < limit &&
    before[before.length - 1 - length] === after[after.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

/**
 * Turns a set of changed positions into contiguous ranges.
 *
 * A range grows across one unchanged character as well as across none: a
 * character that happens to match in the middle of a rewritten run — the `a` of
 * `chang` against `alter` — is noise the eye reads straight past, and splitting
 * the mark around it would paint two stripes over one edit.
 *
 * @param positions - The positions that differ, in order.
 * @returns The runs of changed positions.
 */
function runsOf(positions: readonly number[]): CharRange[] {
  const ranges: CharRange[] = [];
  for (const position of positions) {
    const last = ranges[ranges.length - 1];
    if (last && position <= last.end + 1) last.end = position + 1;
    else ranges.push({ start: position, end: position + 1 });
  }
  return ranges;
}

/**
 * Finds the characters that were edited between two versions of a line.
 *
 * The shared opening and ending are taken off first, so the usual change — one
 * character in the middle of a long line — costs nothing to find and is drawn
 * as that one character rather than as the whole line. What is left is compared
 * character by character, which also finds several separate edits on one line.
 *
 * @param before - The old line.
 * @param after - The new line.
 * @returns The differing ranges, as offsets into each line.
 */
export function changedRanges(before: string, after: string): LineMarks {
  const prefix = commonPrefix(before, after);
  const suffix = commonSuffix(before, after, prefix);
  const oldMiddle = before.slice(prefix, before.length - suffix);
  const newMiddle = after.slice(prefix, after.length - suffix);

  if (oldMiddle.length === 0 && newMiddle.length === 0) return { before: [], after: [] };

  const whole = (): LineMarks => ({
    before: oldMiddle.length > 0 ? [{ start: prefix, end: prefix + oldMiddle.length }] : [],
    after: newMiddle.length > 0 ? [{ start: prefix, end: prefix + newMiddle.length }] : [],
  });

  if (oldMiddle.length === 0 || newMiddle.length === 0) return whole();
  if (oldMiddle.length * newMiddle.length > MAX_CELLS) return whole();

  const width = newMiddle.length + 1;
  const table = new Uint32Array((oldMiddle.length + 1) * width);

  for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex * width + newIndex] =
        oldMiddle[oldIndex] === newMiddle[newIndex]
          ? table[(oldIndex + 1) * width + newIndex + 1] + 1
          : Math.max(
              table[(oldIndex + 1) * width + newIndex],
              table[oldIndex * width + newIndex + 1],
            );
    }
  }

  const oldChanged: number[] = [];
  const newChanged: number[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldMiddle.length && newIndex < newMiddle.length) {
    if (oldMiddle[oldIndex] === newMiddle[newIndex]) {
      oldIndex += 1;
      newIndex += 1;
    } else if (table[(oldIndex + 1) * width + newIndex] >= table[oldIndex * width + newIndex + 1]) {
      oldChanged.push(prefix + oldIndex);
      oldIndex += 1;
    } else {
      newChanged.push(prefix + newIndex);
      newIndex += 1;
    }
  }

  for (; oldIndex < oldMiddle.length; oldIndex += 1) oldChanged.push(prefix + oldIndex);
  for (; newIndex < newMiddle.length; newIndex += 1) newChanged.push(prefix + newIndex);

  return { before: runsOf(oldChanged), after: runsOf(newChanged) };
}
