import { diffLineKind } from "../lib/diffLines";

/** Props for {@link DiffLines}. */
export type DiffLinesProps = {
  /** The lines of the patch, in order. */
  lines: readonly string[];
  /** How many lines were held back, which is shown as a trailing ellipsis. */
  hidden?: number;
};

/**
 * Renders a patch one line at a time, so what changed can be read at a glance.
 *
 * A line is its own element rather than a line of one block of text, because
 * only then can its tint run the width of the card: a background painted behind
 * the characters alone would stop at the last column of the longest line. The
 * box the lines sit in belongs to the caller, which is what lets it be measured
 * before the choice between this and two columns is made.
 *
 * @param props - The lines and how many were held back.
 * @returns The rendered patch.
 */
export function DiffLines({ lines, hidden = 0 }: DiffLinesProps) {
  return (
    <>
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line of a patch is identified by where it sits in the patch, and the same text repeats.
        <span className={`diff-line ${diffLineKind(line)}`} key={index}>
          {line}
        </span>
      ))}
      {hidden > 0 && <span className="diff-line plain">…</span>}
    </>
  );
}
