import { useSideBySideDiff } from "../hooks/useSideBySideDiff";
import { useDiffLayout } from "./DiffLayoutContext";
import { DiffLines } from "./DiffLines";
import { SplitDiff } from "./SplitDiff";

/** Props for {@link DiffView}. */
export type DiffViewProps = {
  /** The lines of the patch, in order. */
  lines: readonly string[];
  /** How many lines were held back, which is shown as a trailing ellipsis. */
  hidden?: number;
  /**
   * The file the patch belongs to, when the patch does not name it.
   *
   * An edit's result is hunks alone, so the language it is drawn in comes from
   * the call's own input rather than from the output.
   */
  filePath?: string | null;
};

/**
 * Draws a patch as two columns when they fit, and as one column when they do not.
 *
 * Which of the two it is, is decided per patch rather than per window: the box
 * is measured, the font is measured, and the answer is whether this patch's
 * longest line gets a readable column. A narrow card holding short lines still
 * gets two columns, and a wide one holding long lines falls back to one.
 *
 * @param props - The lines and how many were held back.
 * @returns The rendered patch.
 */
export function DiffView({ lines, hidden = 0, filePath = null }: DiffViewProps) {
  const sideBySide = useDiffLayout();
  const { ref, split } = useSideBySideDiff(lines, sideBySide);

  return (
    <div className={split ? "diff split" : "diff"} ref={ref}>
      {split ? (
        <SplitDiff lines={lines} hidden={hidden} filePath={filePath} />
      ) : (
        <DiffLines lines={lines} hidden={hidden} filePath={filePath} />
      )}
    </div>
  );
}
