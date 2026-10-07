import type { SyntaxNode, Tree } from "@lezer/common";
import type { FormatId } from "./richFormat";

/** Maps a Markdown syntax node name to the style it represents. */
const NODE_FORMATS: Record<string, FormatId> = {
  StrongEmphasis: "bold",
  Emphasis: "italic",
  Strikethrough: "strike",
  InlineCode: "code",
};

/** The positions of a style's opening and closing markers. */
export type StyleSpan = {
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
};

/**
 * Whether a syntax node represents a given style.
 *
 * @param node - The node to test.
 * @param id - The style.
 * @returns True when the node's name maps to that style.
 */
export function nodeRepresentsFormat(node: SyntaxNode, id: FormatId): boolean {
  return NODE_FORMATS[node.name] === id;
}

/**
 * Reads the marker positions of a style node.
 *
 * The markers are the node's first and last children.
 *
 * @param node - A node representing an inline style.
 * @returns The marker ranges, or null when the node has no distinct pair.
 */
export function spanOf(node: SyntaxNode): StyleSpan | null {
  const first = node.firstChild;
  const last = node.lastChild;
  if (!first || !last || first === last) return null;
  if (!first.name.endsWith("Mark") || !last.name.endsWith("Mark")) return null;
  return { openFrom: first.from, openTo: first.to, closeFrom: last.from, closeTo: last.to };
}

/**
 * Finds the innermost span of a style that contains a range.
 *
 * @param node - The node to start from.
 * @param id - The style to look for.
 * @param from - Start of the range.
 * @param to - End of the range.
 * @returns The enclosing style node, or null.
 */
export function findStyleNode(
  node: SyntaxNode | null,
  id: FormatId,
  from: number,
  to: number,
): SyntaxNode | null {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (nodeRepresentsFormat(current, id) && current.from <= from && current.to >= to) {
      return current;
    }
  }
  return null;
}

/**
 * Collects every node of a style that properly overlaps a range.
 *
 * Nodes that merely touch an edge of the range are excluded, so a selection
 * butting up against a styled run does not count as covering it.
 *
 * @param tree - The syntax tree to search.
 * @param id - The style to collect.
 * @param from - Start of the range.
 * @param to - End of the range.
 * @returns The matching nodes, in document order.
 */
export function styleNodesInRange(
  tree: Tree,
  id: FormatId,
  from: number,
  to: number,
): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  tree.iterate({
    from,
    to,
    enter: (reference) => {
      const node = reference.node;
      if (node.from < to && node.to > from && nodeRepresentsFormat(node, id)) found.push(node);
    },
  });
  return found;
}

/** A deletion that removes one marker. */
export type MarkDeletion = {
  from: number;
  to: number;
};

/** Node names that represent a block of code rather than inline code. */
const CODE_BLOCK_NODES = new Set(["FencedCode", "CodeBlock"]);

/**
 * Finds the code block enclosing a node.
 *
 * @param node - The innermost node at the position of interest.
 * @returns The enclosing code block, or null.
 */
export function findCodeBlock(node: SyntaxNode | null): SyntaxNode | null {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (CODE_BLOCK_NODES.has(current.name)) return current;
  }
  return null;
}

/**
 * Reads the content range of a code block, excluding its fences.
 *
 * @param node - A code block node.
 * @returns The content range, or null for an empty block.
 */
export function codeBlockText(node: SyntaxNode): { from: number; to: number } | null {
  const text = node.getChild("CodeText");
  return text ? { from: text.from, to: text.to } : null;
}

/**
 * Removes the markers of the given nodes from a range's text.
 *
 * Markers falling outside the range are left alone.
 *
 * @param nodes - The style nodes whose markers should go.
 * @param from - Start of the range.
 * @param to - End of the range.
 * @param text - The range's text.
 * @returns The text with those markers removed.
 */
export function stripMarkers(
  nodes: readonly SyntaxNode[],
  from: number,
  to: number,
  text: string,
): string {
  const deletions: MarkDeletion[] = [];
  for (const node of nodes) {
    const span = spanOf(node);
    if (!span) continue;
    deletions.push({ from: span.openFrom, to: span.openTo });
    deletions.push({ from: span.closeFrom, to: span.closeTo });
  }

  const inside = deletions
    .filter((deletion) => deletion.from >= from && deletion.to <= to)
    .sort((a, b) => a.from - b.from);

  let out = "";
  let cursor = from;
  for (const deletion of inside) {
    out += text.slice(cursor - from, deletion.from - from);
    cursor = deletion.to;
  }
  return out + text.slice(cursor - from);
}

/** How a style relates to a range of text. */
export type StyleState = "off" | "on" | "mixed";

/**
 * Whether a set of spans covers a range completely.
 *
 * @param nodes - The spans to test, in any order.
 * @param from - Start of the range.
 * @param to - End of the range.
 * @returns True when no gap exists between `from` and `to`.
 */
export function spansCover(nodes: readonly SyntaxNode[], from: number, to: number): boolean {
  let covered = from;
  for (const node of [...nodes].sort((a, b) => a.from - b.from)) {
    if (node.from > covered) return false;
    covered = Math.max(covered, node.to);
    if (covered >= to) return true;
  }
  return covered >= to;
}

/**
 * Reports how a style applies across a range of text.
 *
 * A range is fully styled, partly styled, or untouched, which is what lets a
 * toolbar button show a third, indeterminate state.
 *
 * @param tree - The syntax tree to consult.
 * @param id - The style.
 * @param from - Start of the range.
 * @param to - End of the range.
 * @returns The style's state across the range.
 */
export function styleStateInRange(tree: Tree, id: FormatId, from: number, to: number): StyleState {
  const nodes = styleNodesInRange(tree, id, from, to);
  if (nodes.length === 0) return "off";
  return spansCover(nodes, from, to) ? "on" : "mixed";
}

/**
 * Whether a style applies at a bare caret.
 *
 * True only between a span's opening and closing markers, which is exactly
 * where typing produces styled text. Just past the closing marker the answer is
 * false, because inserting another pair of markers there would merge the two
 * runs rather than start a new one.
 *
 * @param tree - The syntax tree to consult.
 * @param id - The style.
 * @param pos - The caret position.
 * @returns True when typing at the caret would be styled.
 */
export function styleAppliesAt(tree: Tree, id: FormatId, pos: number): boolean {
  for (
    let current: SyntaxNode | null = tree.resolveInner(pos, -1);
    current;
    current = current.parent
  ) {
    if (!nodeRepresentsFormat(current, id)) continue;
    const span = spanOf(current);
    if (span && pos >= span.openTo && pos <= span.closeFrom) return true;
  }
  return false;
}
