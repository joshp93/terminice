import type { SyntaxNode, Tree } from "@lezer/common";
import { findStyleNode, nodeRepresentsFormat, type StyleSpan, spanOf } from "./markdownSpans";
import { type FormatId, MARKER_CHARACTERS } from "./richFormat";

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
 * Whether a character is one a run can see past when looking for a neighbour.
 *
 * Whitespace and markers, and nothing else: those are the only things that can
 * stand between two runs of one style without something being there.
 */
function isPadding(char: string | undefined): boolean {
  return char !== undefined && (/\s/.test(char) || MARKER_CHARACTERS.includes(char));
}

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
 * Finds the run of a style lying against one end of a selection.
 *
 * The walk goes out over whitespace and over markers, and whatever it lands on
 * has to be carried by the style for there to be a neighbour at all. That is
 * what joins the two bold runs of `**a** x **b**` when `x` is selected, and
 * what leaves `**a** some text **b**` alone: there the words in between belong
 * to no run of the style, so the walk lands on one of them and stops.
 *
 * @param tree - The document's syntax tree.
 * @param id - The style being looked for.
 * @param text - The document's text.
 * @param position - The end of the selection to look outward from.
 * @param step - -1 to look back from the selection's start, 1 to look on.
 * @returns The neighbouring run, or null when there is not one.
 */
function adjacentRun(
  tree: Tree,
  id: FormatId,
  text: string,
  position: number,
  step: -1 | 1,
): SyntaxNode | null {
  let at = position;
  while (
    at + step >= 0 &&
    at + step <= text.length &&
    isPadding(step < 0 ? text[at - 1] : text[at])
  ) {
    at += step;
  }

  const landed = step < 0 ? at - 1 : at;
  if (landed < 0 || landed >= text.length) return null;
  return findStyleNode(tree.resolveInner(landed, -1), id, landed, landed);
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
 * Plans stretching the runs of a style over the range that was selected.
 *
 * A selection that runs off an end of a run is taken as wanting the rest of it
 * styled, so the markers at that end move out to the selection's edge. A
 * selection that sits between two runs is taken as wanting them joined, so the
 * markers between them go and the two become one — which is how
 * `***This** is the **best***` with `is the` selected comes back to
 * `***This is the best***` rather than growing a third run of its own.
 *
 * The boundaries slide out the same way they do when a style is taken off, for
 * the same reason: the styled region has to begin and end against text, so a
 * space beside the selection is taken into the style rather than left outside a
 * marker that could not close there.
 *
 * @param text - The document's text.
 * @param spans - The runs involved, in document order.
 * @param from - Start of the selection.
 * @param to - End of the selection.
 * @returns The changes to make, in document order.
 */
function joiningFor(
  text: string,
  spans: readonly StyleSpan[],
  from: number,
  to: number,
): TextChange[] {
  const changes: TextChange[] = [];
  const markers = (span: StyleSpan): string => text.slice(span.openFrom, span.openTo);

  // Runs with nothing but padding between them are one run.
  for (let index = 0; index + 1 < spans.length; index += 1) {
    const left = spans[index];
    const right = spans[index + 1];
    changes.push({ from: left.closeFrom, to: left.closeTo, insert: "" });
    changes.push({ from: right.openFrom, to: right.openTo, insert: "" });
  }

  const first = spans[0];
  const last = spans[spans.length - 1];

  if (from < first.openTo && from <= first.openFrom) {
    const start = slideOutward(text, from, -1, "open");
    changes.push({ from: first.openFrom, to: first.openTo, insert: "" });
    changes.push({ from: start, to: start, insert: markers(first) });
  }

  if (to > last.closeFrom && to >= last.closeTo) {
    const end = slideOutward(text, to, 1, "close");
    changes.push({ from: last.closeFrom, to: last.closeTo, insert: "" });
    changes.push({ from: end, to: end, insert: markers(last) });
  }

  return changes;
}

/**
 * Puts a set of changes in order, dropping any that would overlap.
 *
 * Joining runs and moving their outer markers can arrive at the same marker
 * from two directions, and a document cannot be rewritten twice at one place.
 * The first change at a position is the one the shape of the edit asks for.
 *
 * @param changes - The changes to put in order.
 * @returns The changes to make, in document order.
 */
function tidy(changes: readonly TextChange[]): TextChange[] {
  const kept: TextChange[] = [];
  for (const change of [...changes].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = kept[kept.length - 1];
    if (last && change.from < last.to) continue;
    if (last && change.from === last.from && change.to === last.to) continue;
    kept.push(change);
  }
  return kept;
}

/**
 * Plans what pressing a style should do to a selection.
 *
 * The three outcomes are decided by how much of the selection already carries
 * the style, which is read from the parse rather than assumed: all of it means
 * take it off, some of it means stretch the runs at its edges over the rest,
 * and none of it means there is nothing here to undo.
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
  const overlapping: SyntaxNode[] = [];
  tree.iterate({
    from,
    to,
    enter: (reference) => {
      const node = reference.node;
      if (node.from < to && node.to > from && nodeRepresentsFormat(node, id))
        overlapping.push(node);
    },
  });

  // Taking the style off is what every character of the selection already
  // carrying it means — not the selection being the whole of one run. A
  // selection of the first word of a bold sentence carries the bold throughout
  // and comes off; one that runs off the end of the bold does not, and the bold
  // is stretched to cover it instead.
  const within =
    overlapping.length > 0 &&
    overlapping.every((node) => {
      const span = spanOf(node);
      return span !== null && from >= span.openTo && to <= span.closeFrom;
    });

  if (within) {
    const spans = overlapping.map(spanOf).filter((span): span is StyleSpan => span !== null);
    return {
      kind: "toggle-off",
      changes: tidy(spans.flatMap((span) => removalFor(text, span, from, to))),
    };
  }

  // Deduplicated by where each run starts rather than by the node, because the
  // tree hands back a fresh node object every time it is asked for the same
  // one — so a run reached both by the walk and by overlapping would be counted
  // twice, and then treated as its own neighbour and joined with itself.
  const involved: SyntaxNode[] = [];
  const seen = new Set<number>();
  for (const node of [
    adjacentRun(tree, id, text, from, -1),
    ...overlapping,
    adjacentRun(tree, id, text, to, 1),
  ]) {
    if (!node || seen.has(node.from)) continue;
    seen.add(node.from);
    involved.push(node);
  }
  if (involved.length === 0) return { kind: "wrap" };

  involved.sort((a, b) => a.from - b.from);
  const spans = involved.map(spanOf).filter((span): span is StyleSpan => span !== null);
  return { kind: "toggle-on", changes: tidy(joiningFor(text, spans, from, to)) };
}
