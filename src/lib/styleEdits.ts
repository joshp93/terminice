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
 * Slides a position outward until a marker there would sit against text.
 *
 * A marker is only a marker when it stands beside a real character: Markdown
 * will not open emphasis against a space, nor close it against one. So the
 * spaces at the edge of a selection decide where the markers can go, and they
 * have to be given to whichever side the marker is not on. That is why
 * `***This [is the] best***` becomes `***This** is the **best***` and not
 * `***This **is the** best***`, whose markers are against spaces and cannot
 * close at all. An opening marker needs a character after it and a closing one
 * a character before it, so which character is tested depends on the marker,
 * while the direction always moves away from the selection.
 *
 * @param text - The document's text.
 * @param position - Where the boundary is before it is slid.
 * @param step - -1 for a boundary at the start of the range, 1 for its end.
 * @param marker - Whether the marker being placed opens or closes the style.
 * @returns The position to put the marker at.
 */
function slideOutward(
  text: string,
  position: number,
  step: -1 | 1,
  marker: "open" | "close",
): number {
  const blocked = (at: number): boolean => {
    const character = marker === "open" ? text[at] : text[at - 1];
    return character === undefined || /\s/.test(character);
  };

  let at = position;
  while (at + step >= 0 && at + step <= text.length && blocked(at)) at += step;
  return at;
}

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
 * The hole being cut is bounded by a closing marker at its start and an opening
 * one at its end, and each has to be slid out until it sits against text. The
 * hole only ever grows, so the spaces beside a selection are taken with it
 * however much or little of them the selection happened to include.
 *
 * @param text - The document's text.
 * @param span - The style's markers and the text between them.
 * @param from - Start of the selection.
 * @param to - End of the selection.
 * @returns The changes to make, in document order.
 */
function removalFor(text: string, span: StyleSpan, from: number, to: number): TextChange[] {
  const markers = text.slice(span.openFrom, span.openTo);
  const takesStart = from <= span.openTo;
  const takesEnd = to >= span.closeFrom;

  if (takesStart && takesEnd) {
    return [
      { from: span.openFrom, to: span.openTo, insert: "" },
      { from: span.closeFrom, to: span.closeTo, insert: "" },
    ];
  }

  const start = slideOutward(text, from, -1, "close");
  const end = slideOutward(text, to, 1, "open");

  if (takesStart) {
    return [
      { from: span.openFrom, to: span.openTo, insert: "" },
      { from: end, to: end, insert: markers },
    ];
  }

  if (takesEnd) {
    return [
      { from: start, to: start, insert: markers },
      { from: span.closeFrom, to: span.closeTo, insert: "" },
    ];
  }

  return [
    { from: start, to: start, insert: markers },
    { from: end, to: end, insert: markers },
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
 * The boundaries slide out the same way they do when the style is taken off,
 * for the same reason: the styled region has to end against text, so a space
 * beside the selection is taken into the style rather than left outside a
 * marker that could not close there.
 *
 * Markers are not moved onto themselves, and a selection that starts or ends
 * inside a marker is left alone rather than having two changes overlap.
 *
 * @param text - The document's text.
 * @param span - The style's markers and the text between them.
 * @param from - Start of the selection.
 * @param to - End of the selection.
 * @returns The changes to make, in document order.
 */
function extensionFor(text: string, span: StyleSpan, from: number, to: number): TextChange[] {
  const markers = text.slice(span.openFrom, span.openTo);
  const changes: TextChange[] = [];

  if (from < span.openTo && from <= span.openFrom) {
    const start = slideOutward(text, from, -1, "open");
    changes.push({ from: span.openFrom, to: span.openTo, insert: "" });
    changes.push({ from: start, to: start, insert: markers });
  }

  if (to > span.closeFrom && to >= span.closeTo) {
    const end = slideOutward(text, to, 1, "close");
    changes.push({ from: span.closeFrom, to: span.closeTo, insert: "" });
    changes.push({ from: end, to: end, insert: markers });
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
    changes.push(
      ...(within ? removalFor(text, span, from, to) : extensionFor(text, span, from, to)),
    );
  }

  return { kind: within ? "toggle-off" : "toggle-on", changes };
}
