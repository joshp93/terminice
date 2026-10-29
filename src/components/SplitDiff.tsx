import { useMemo } from "react";
import { diffLineKind, isPatchPlumbing } from "../lib/diffLines";
import { highlightSide, languageOfPatch } from "../lib/highlightPatch";
import { type CharRange, changedRanges } from "../lib/inlineDiff";
import { planSplitRows } from "../lib/splitDiff";
import { DiffText } from "./DiffText";

/** Props for {@link SplitDiff}. */
export type SplitDiffProps = {
  /** The lines of the patch, in order. */
  lines: readonly string[];
  /** How many lines were held back, which is shown as a trailing row. */
  hidden?: number;
  /** The file the patch belongs to, when the patch does not name it. */
  filePath?: string | null;
};

/** What one row's characters differ by, on each side. */
type RowMarks = { left: CharRange[]; right: CharRange[] } | null;

/**
 * What one cell of a row is drawn as.
 *
 * An empty cell is not a cell with nothing in it: it is the side that had no
 * line to show, which is what the removal or the addition beside it is read
 * against.
 *
 * @param line - The line, or null for the side with nothing to show.
 * @param side - Which column the cell is in.
 * @returns The classes for the cell.
 */
function cellClass(line: string | null, side: "left" | "right"): string {
  return line === null ? `diff-cell ${side} empty` : `diff-cell ${side} ${diffLineKind(line)}`;
}

/**
 * The text of a line without its patch marker.
 *
 * @param line - The line, or null for the side with nothing to show.
 * @returns The line's content, with no marker.
 */
function contentOf(line: string | null): string {
  if (line === null) return "";
  return isPatchPlumbing(line) ? line : line.slice(1);
}

/**
 * Finds what each paired line differs by.
 *
 * Only a removal beside the addition that replaced it is compared: a context
 * line is the same on both sides, and a removal with nothing beside it has no
 * counterpart to be compared with.
 *
 * @param rows - The rows of the two-column layout.
 * @returns The marks for each row, or null for a row with no changed pair.
 */
function marksForRows(rows: ReturnType<typeof planSplitRows>): RowMarks[] {
  return rows.map((row) => {
    if (row.kind !== "pair" || row.left === null || row.right === null) return null;
    if (isPatchPlumbing(row.left) || isPatchPlumbing(row.right)) return null;

    const changed = changedRanges(row.left.slice(1), row.right.slice(1));
    if (changed.before.length === 0 && changed.after.length === 0) return null;
    return { left: changed.before, right: changed.after };
  });
}

/**
 * Renders a patch as two columns: the old lines beside the new ones.
 *
 * Rows rather than a box, so the caller owns the element that gets measured and
 * laid out as a grid. Each cell is drawn in its file's language, and a removal
 * and the addition that replaced it carry the characters that changed.
 *
 * @param props - The lines and how many were held back.
 * @returns The rendered patch.
 */
export function SplitDiff({ lines, hidden = 0, filePath = null }: SplitDiffProps) {
  const rows = useMemo(() => planSplitRows(lines), [lines]);
  const language = useMemo(() => languageOfPatch(lines, filePath), [lines, filePath]);
  const marks = useMemo(() => marksForRows(rows), [rows]);

  const segments = useMemo(() => {
    const left = rows.map((row) => (row.kind === "pair" ? contentOf(row.left) : ""));
    const right = rows.map((row) => (row.kind === "pair" ? contentOf(row.right) : ""));

    return {
      left: highlightSide(left, language),
      right: highlightSide(right, language),
    };
  }, [rows, language]);

  return (
    <>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a row of a patch is identified by where it sits in the patch, and the same text repeats.
        <div className="diff-row" key={index}>
          {row.kind === "across" ? (
            <span className={`diff-cell across ${diffLineKind(row.text)}`}>{row.text}</span>
          ) : (
            <>
              <span className={cellClass(row.left, "left")}>
                <span className="diff-marker">{row.left?.slice(0, 1) ?? ""}</span>
                <DiffText segments={segments.left[index]} marks={marks[index]?.left} />
              </span>
              <span className={cellClass(row.right, "right")}>
                <span className="diff-marker">{row.right?.slice(0, 1) ?? ""}</span>
                <DiffText segments={segments.right[index]} marks={marks[index]?.right} />
              </span>
            </>
          )}
        </div>
      ))}
      {hidden > 0 && (
        <div className="diff-row">
          <span className="diff-cell across plain">…</span>
        </div>
      )}
    </>
  );
}
