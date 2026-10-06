/** The two list kinds the composer can apply to a line. */
export type ListKind = "bullet" | "ordered";

/** A list marker at the start of a line. */
export type ListMarker = {
  kind: ListKind;
  text: string;
};

/** A line broken into its list parts. */
export type ParsedListLine = {
  /** Leading whitespace. */
  indent: string;
  /** The marker without trailing space: `-`, `*`, `+`, `3.` or `3)`. */
  marker: string;
  /** Whitespace between the marker and the content. */
  gap: string;
  /** Everything after the marker. */
  content: string;
};

/** An edit that begins somewhere inside a line. */
export type LineEdit = {
  /** Characters from the start of the line where the edit begins. */
  offset: number;
  /** Characters to delete there. */
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

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])([ \t]+)(.*)$/;
const ORDERED_MARKER = /^(\d+)([.)])$/;

/** One level of indentation. */
export const INDENT_UNIT = "  ";

/**
 * Parses a line as a list item.
 *
 * @param line - The line's text, without its newline.
 * @returns The marker, indentation and content, or null when it is not a list.
 */
export function parseListLine(line: string): ParsedListLine | null {
  const match = LIST_LINE.exec(line);
  if (!match) return null;
  return { indent: match[1], marker: match[2], gap: match[3], content: match[4] };
}

/**
 * Returns which kind of list a marker introduces.
 *
 * @param marker - A marker such as `-` or `12.`.
 * @returns The list kind.
 */
export function markerKind(marker: string): ListKind {
  return ORDERED_MARKER.test(marker) ? "ordered" : "bullet";
}

/**
 * Reads the list marker at the start of a line.
 *
 * @param line - The line's text.
 * @returns The marker and its kind, or null when the line is not a list item.
 */
export function readListMarker(line: string): ListMarker | null {
  const parsed = parseListLine(line);
  if (!parsed) return null;
  return { kind: markerKind(parsed.marker), text: `${parsed.indent}${parsed.marker}${parsed.gap}` };
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
 * Returns the marker for the item following one written as `marker`.
 *
 * Bullets repeat unchanged and ordered markers keep their delimiter, so a list
 * started with `*` or `1)` continues in the same style.
 *
 * @param marker - The previous item's marker.
 * @returns The next item's marker.
 */
export function nextMarker(marker: string): string {
  const ordered = ORDERED_MARKER.exec(marker);
  if (!ordered) return marker;
  return `${Number.parseInt(ordered[1], 10) + 1}${ordered[2]}`;
}

/**
 * Plans toggling a list kind on a line.
 *
 * Applying the kind already present removes it; applying the other kind swaps
 * the marker in place; a plain line gains a marker before its text.
 *
 * @param line - The line's text.
 * @param kind - The list kind that was requested.
 * @returns The edit to apply.
 */
export function planListToggle(line: string, kind: ListKind): LineEdit {
  const parsed = parseListLine(line);

  if (parsed && markerKind(parsed.marker) === kind) {
    return {
      offset: 0,
      remove: parsed.indent.length + parsed.marker.length + parsed.gap.length,
      insert: parsed.indent,
    };
  }

  if (parsed) {
    return {
      offset: parsed.indent.length,
      remove: parsed.marker.length,
      insert: kind === "bullet" ? "-" : "1.",
    };
  }

  return { offset: 0, remove: 0, insert: listMarkerText(kind) };
}

/**
 * Plans indenting a list line by one level.
 *
 * @param line - The line's text.
 * @returns The edit, or null when the line is not a list item.
 */
export function planIndent(line: string): LineEdit | null {
  if (!parseListLine(line)) return null;
  return { offset: 0, remove: 0, insert: INDENT_UNIT };
}

/**
 * Plans outdenting a list line by one level.
 *
 * @param line - The line's text.
 * @returns The edit, or null when the line has no indentation to remove.
 */
export function planOutdent(line: string): LineEdit | null {
  const parsed = parseListLine(line);
  if (!parsed || parsed.indent.length === 0) return null;
  return { offset: 0, remove: Math.min(INDENT_UNIT.length, parsed.indent.length), insert: "" };
}

/**
 * Plans Backspace pressed at the very start of a line.
 *
 * An empty item loses its whole marker, an indented item outdents, and an item
 * at the left margin loses its marker and becomes a plain paragraph.
 *
 * @param line - The line's text.
 * @returns The edit, or null when the line is not a list item.
 */
export function planListBackspace(line: string): LineEdit | null {
  const parsed = parseListLine(line);
  if (!parsed) return null;

  if (parsed.content.trim().length === 0) {
    return {
      offset: 0,
      remove: parsed.indent.length + parsed.marker.length + parsed.gap.length,
      insert: parsed.indent,
    };
  }

  if (parsed.indent.length > 0) {
    return { offset: 0, remove: Math.min(INDENT_UNIT.length, parsed.indent.length), insert: "" };
  }

  return { offset: 0, remove: parsed.marker.length + parsed.gap.length, insert: "" };
}

/**
 * Plans Enter on a list line.
 *
 * A non-empty item continues the list in the same style. An empty item is
 * replaced by a plain newline, which is how the list ends.
 *
 * @param line - The line's text.
 * @returns The plan, or null when the line is not a list item.
 */
export function planListEnter(line: string): ListEnterPlan | null {
  const parsed = parseListLine(line);
  if (!parsed) return null;

  if (parsed.content.trim().length === 0) {
    return {
      removeMarker: parsed.indent.length + parsed.marker.length + parsed.gap.length,
      insert: "\n",
    };
  }

  return {
    removeMarker: 0,
    insert: `\n${parsed.indent}${nextMarker(parsed.marker)}${parsed.gap}`,
  };
}

/**
 * Renumbers a run of ordered-list lines.
 *
 * Indentation is respected, bullets break a run, and a run's first number is
 * kept as its starting point.
 *
 * @param lines - The block of line texts to renumber.
 * @returns The rewritten lines, or null when nothing needed to change.
 */
export function renumberOrderedLines(lines: readonly string[]): string[] | null {
  const result: string[] = [];
  let counters = new Map<string, number>();
  let changed = false;

  for (const line of lines) {
    const parsed = parseListLine(line);
    if (!parsed || markerKind(parsed.marker) !== "ordered") {
      counters = new Map();
      result.push(line);
      continue;
    }

    for (const key of [...counters.keys()]) {
      if (key.length > parsed.indent.length) counters.delete(key);
    }

    const previous = counters.get(parsed.indent);
    const number = previous === undefined ? Number.parseInt(parsed.marker, 10) : previous + 1;
    counters.set(parsed.indent, number);

    const rebuilt = `${parsed.indent}${number}${parsed.marker.slice(-1)}${parsed.gap}${parsed.content}`;
    if (rebuilt !== line) changed = true;
    result.push(rebuilt);
  }

  return changed ? result : null;
}
