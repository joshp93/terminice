import { useMemo } from "react";
import { diffLineKind, isPatchPlumbing } from "../lib/diffLines";
import { highlightSide, languageOfPatch } from "../lib/highlightPatch";
import { unifiedMarks } from "../lib/unifiedMarks";
import { DiffText } from "./DiffText";

/** Props for {@link DiffLines}. */
export type DiffLinesProps = {
  /** The lines of the patch, in order. */
  lines: readonly string[];
  /** How many lines were held back, which is shown as a trailing ellipsis. */
  hidden?: number;
  /** The file the patch belongs to, when the patch does not name it. */
  filePath?: string | null;
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
 * The marker is drawn apart from the line, so the characters that were edited
 * can be marked without the marker being one of them, and the line itself is
 * drawn in the language the patch's file names.
 *
 * @param props - The lines and how many were held back.
 * @returns The rendered patch.
 */
export function DiffLines({ lines, hidden = 0, filePath = null }: DiffLinesProps) {
  const language = useMemo(() => languageOfPatch(lines, filePath), [lines, filePath]);
  const content = useMemo(
    () => lines.map((line) => (isPatchPlumbing(line) ? line : line.slice(1))),
    [lines],
  );
  const segments = useMemo(() => highlightSide(content, language), [content, language]);
  const marks = useMemo(() => unifiedMarks(lines), [lines]);

  return (
    <>
      {lines.map((line, index) => {
        const kind = diffLineKind(line);
        if (isPatchPlumbing(line)) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line of a patch is identified by where it sits in the patch, and the same text repeats.
            <span className={`diff-line ${kind}`} key={index}>
              {line}
            </span>
          );
        }

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a line of a patch is identified by where it sits in the patch, and the same text repeats.
          <span className={`diff-line ${kind}`} key={index}>
            <span className="diff-marker">{line.slice(0, 1)}</span>
            <DiffText segments={segments[index]} marks={marks.get(index)} />
          </span>
        );
      })}
      {hidden > 0 && <span className="diff-line plain">…</span>}
    </>
  );
}
