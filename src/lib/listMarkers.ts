/** The two list kinds the composer can apply to a line. */
export type ListKind = "bullet" | "ordered";

/** A list marker found at the start of a line. */
export type ListMarker = {
  kind: ListKind;
  text: string;
};

/** How a line's prefix should be rewritten when a list kind is toggled. */
export type ListTogglePlan = {
  /** Number of characters to delete from the start of the line. */
  remove: number;
  /** Text to write in their place. */
  insert: string;
};

/** What Enter should do on a list line. */
export type ListEnterPlan = {
  /** Characters of the existing marker to delete, or 0 to leave it alone. */
  removeMarker: number;
  /** Text to insert at the cursor. */
  insert: string;
};

const BULLET_PATTERN = /^[-*+]\s/;
const ORDERED_PATTERN = /^(\d+)[.)]\s/;

/**
 * Reads the list marker at the start of a line.
 *
 * @param line - The line's text, without its newline.
 * @returns The marker and its kind, or null when the line is not a list item.
 */
export function readListMarker(line: string): ListMarker | null {
  const bullet = BULLET_PATTERN.exec(line);
  if (bullet) return { kind: "bullet", text: bullet[0] };
  const ordered = ORDERED_PATTERN.exec(line);
  if (ordered) return { kind: "ordered", text: ordered[0] };
  return null;
}

/**
 * Returns the marker text a list of `kind` starts with.
 *
 * @param kind - The list kind.
 * @param position - The item number, used only for ordered lists.
 * @returns The marker, including its trailing space.
 */
export function listMarkerText(kind: ListKind, position = 1): string {
  return kind === "bullet" ? "- " : `${position}. `;
}

/**
 * Plans toggling a list kind on a line.
 *
 * Applying the kind already present removes it; applying the other kind swaps
 * the marker instead of stacking a second one.
 *
 * @param line - The line's text.
 * @param kind - The list kind that was requested.
 * @returns What to delete and what to write.
 */
export function planListToggle(line: string, kind: ListKind): ListTogglePlan {
  const existing = readListMarker(line);
  if (existing && existing.kind === kind) {
    return { remove: existing.text.length, insert: "" };
  }
  return { remove: existing?.text.length ?? 0, insert: listMarkerText(kind) };
}

/**
 * Plans Enter on a list line.
 *
 * A non-empty item continues the list, numbering ordered lists in sequence. An
 * empty item is replaced by a plain newline, which is how the list ends.
 *
 * @param line - The line's text.
 * @returns The plan, or null when the line is not a list item.
 */
export function planListEnter(line: string): ListEnterPlan | null {
  const marker = readListMarker(line);
  if (!marker) return null;

  const content = line.slice(marker.text.length);
  if (content.trim().length === 0) {
    return { removeMarker: marker.text.length, insert: "\n" };
  }

  const next =
    marker.kind === "bullet"
      ? listMarkerText("bullet")
      : listMarkerText("ordered", Number.parseInt(marker.text, 10) + 1);

  return { removeMarker: 0, insert: `\n${next}` };
}
