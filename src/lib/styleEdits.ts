import type { SyntaxNode, Tree } from "@lezer/common";
import { nodeRepresentsFormat, type StyleSpan, spanOf } from "./markdownSpans";
import type { FormatId } from "./richFormat";

/** One replacement to make, in the document's own positions. */
export type TextChange = {
  from: number;
  to: number;
  insert: string;
};

/** What pressing a style with a selection should do. */
export type SelectionPlan =
  /** The selection carries the style throughout, so take it off. */
  | { kind: "toggle-off"; changes: TextChange[] }
  /** Some of it does, so the style is stretched to cover all of it. */
  | { kind: "toggle-on"; changes: TextChange[] }
  /** None of it does, so there is nothing to take off and it is wrapped instead. */
  | { kind: "wrap" };

/**
 * Plans taking a style off the range that was selected.
 *
 * Everything outside the selection keeps the style, so the markers move to the
 * selection's edges rather than being deleted: a style trimmed at one end moves
 * the markers at that end, and a selection scooped out of the middle leaves the
 * style on both sides of it by putting a pair of markers at each edge — which is
 * how `***Hello** world*` with `He` selected becomes `*He**llo** world*`, the
 * `llo` keeping the bold the `He` lost.
 *
 * @param span - The style's markers and the text between them.
 * @param from - Start of the selection.
 * @param to - End of the selection.
 * @param markers - The markers, as they are written.
 * @returns The changes to make, in document order.
 */
function removalFor(span: StyleSpan, from: number, to: number, markers: string): TextChange[] {
  const takesStart = from <= span.openTo;
  const takesEnd = to >= span.closeFrom;

  if (takesStart && takesEnd) {
    return [
      { from: span.openFrom, to: span.openTo, insert: "" },
      { from: span.closeFrom, to: span.closeTo, insert: "" },
    ];
  }

  if (takesStart) {
    return [
      { from: span.openFrom, to: span.openTo, insert: "" },
      { from: to, to, insert: markers },
    ];
  }

  if (takesEnd) {
    return [
      { from: from, to: from, insert: markers },
      { from: span.closeFrom, to: span.closeTo, insert: "" },
    ];
  }

  return [
    { from: from, to: from, insert: markers },
    { from: to, to, insert: markers },
  ];
}

/**
 * Plans stretching a style to cover the range that was selected.
 *
 * A selection that runs off one end of a style — half of it styled and half of
 * it not — is taken as wanting the whole of it styled, so the markers at that
 * end move out to the selection's edge. That is how the italic of
 * `***Hel[lo** wor]ld*` leaves `***Hello wor**ld*`: the selection reaches past
 * where the bold ended, so the bold ends further along.
 *
 * Markers are not moved onto themselves, and a selection that starts or ends
 * inside a marker is left alone rather than having two changes overlap.
 *
 * @param span - The style's markers and the text between them.
 * @param from - Start of the selection.
 * @param to - End of the selection.
 * @param markers - The markers, as they are written.
 * @returns The changes to make, in document order.
 */
function extensionFor(span: StyleSpan, from: number, to: number, markers: string): TextChange[] {
  const changes: TextChange[] = [];

  if (from < span.openTo && from <= span.openFrom) {
    changes.push({ from: span.openFrom, to: span.openTo, insert: "" });
    changes.push({ from, to: from, insert: markers });
  }

  if (to > span.closeFrom && to >= span.closeTo) {
    changes.push({ from: span.closeFrom, to: span.closeTo, insert: "" });
    changes.push({ from: to, to, insert: markers });
  }

  return changes.sort((a, b) => a.from - b.from);
}

/**
 * Plans what pressing a style should do to a selection.
 *
 * The three outcomes are decided by how much of the selection already carries
 * the style, which is read from the parse rather than assumed: all of it means
 * take it off, some of it means stretch it over the rest, and none of it means
 * there is nothing here to undo.
 *
 * @param tree - The document's syntax tree.
 * @param id - The style that was pressed.
 * @param text - The document's text.
 * @param from - Start of the selection.
 * @param to - End of the selection.
 * @returns What to do, and the changes to do it with.
 */
export function planSelectionToggle(
  tree: Tree,
  id: FormatId,
  text: string,
  from: number,
  to: number,
): SelectionPlan {
  const nodes: SyntaxNode[] = [];
  tree.iterate({
    from,
    to,
    enter: (reference) => {
      const node = reference.node;
      if (node.from < to && node.to > from && nodeRepresentsFormat(node, id)) nodes.push(node);
    },
  });

  if (nodes.length === 0) return { kind: "wrap" };

  // Taking the style off is what every character of the selection already
  // carrying it means — not the selection being the whole of the style. A
  // selection of the first word of a bold sentence carries the bold throughout
  // and comes off; one that runs off the end of the bold does not, and the bold
  // is stretched to cover it instead.
  const within = nodes.every((node) => {
    const span = spanOf(node);
    return span !== null && from >= span.openTo && to <= span.closeFrom;
  });

  const changes: TextChange[] = [];
  for (const node of nodes) {
    const span = spanOf(node);
    if (!span) continue;
    const markers = text.slice(span.openFrom, span.openTo);
    changes.push(
      ...(within ? removalFor(span, from, to, markers) : extensionFor(span, from, to, markers)),
    );
  }

  return { kind: within ? "toggle-off" : "toggle-on", changes };
}
