import { diffLineKind } from "../lib/diffLines";
import { planSplitRows } from "../lib/splitDiff";

/** Props for {@link SplitDiff}. */
export type SplitDiffProps = {
  /** The lines of the patch, in order. */
  lines: readonly string[];
  /** How many lines were held back, which is shown as a trailing row. */
  hidden?: number;
};

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
 * Renders a patch as two columns: the old lines beside the new ones.
 *
 * Rows rather than a box, so the caller owns the element that gets measured and
 * laid out as a grid.
 *
 * @param props - The lines and how many were held back.
 * @returns The rendered patch.
 */
export function SplitDiff({ lines, hidden = 0 }: SplitDiffProps) {
  const rows = planSplitRows(lines);

  return (
    <>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a row of a patch is identified by where it sits in the patch, and the same text repeats.
        <div className="diff-row" key={index}>
          {row.kind === "across" ? (
            <span className={`diff-cell across ${diffLineKind(row.text)}`}>{row.text}</span>
          ) : (
            <>
              <span className={cellClass(row.left, "left")}>{row.left ?? ""}</span>
              <span className={cellClass(row.right, "right")}>{row.right ?? ""}</span>
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
