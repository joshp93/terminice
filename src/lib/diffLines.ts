/** What one line of a rendered patch is. */
export type DiffLineKind = "addition" | "removal" | "plain";

/** The marker that opens a hunk, which is how a patch is recognised as one. */
const HUNK_HEADER = "@@";

/**
 * Whether a patch line is plumbing rather than a line of the file.
 *
 * A hunk header says where the two sides start counting from, and the `---` and
 * `+++` lines name the file. None of them belongs to either side of the change,
 * so a side-by-side view draws them across the whole width.
 *
 * @param line - One line of the patch.
 * @returns True when the line belongs to neither side.
 */
export function isPatchPlumbing(line: string): boolean {
  return line.startsWith(HUNK_HEADER) || line.startsWith("---") || line.startsWith("+++");
}

/**
 * Whether a tool's result is a rendered patch rather than ordinary output.
 *
 * Recognised by its hunk headers rather than by the tool that produced it: the
 * tools that change files hand back plain text when there was nothing to change,
 * and a line of ordinary output that happens to begin with a minus must not be
 * drawn as a removal.
 *
 * @param text - The result text.
 * @returns True when it is a patch.
 */
export function looksLikePatch(text: string): boolean {
  return text.split("\n").some((line) => line.startsWith(HUNK_HEADER));
}

/**
 * What a line of a patch is, read from the marker it begins with.
 *
 * The `---` and `+++` lines that git writes above a hunk name the file rather
 * than saying anything about its contents, so they stay plain; every other line
 * beginning with a marker is a line of the file that was added or taken away.
 *
 * @param line - One line of the patch.
 * @returns The kind of line.
 */
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("---") || line.startsWith("+++")) return "plain";
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "removal";
  return "plain";
}
