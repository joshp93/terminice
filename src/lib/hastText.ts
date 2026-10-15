import { asArray, asRecord, asText } from "./json";

/**
 * Reads the text of a rendered Markdown node.
 *
 * The Markdown is rendered with its syntax highlighted, so a fenced block in
 * the tree is not the code that was written: it is a tree of spans, one per
 * token. What the tree *means* is the text at its leaves, which is what this
 * collects — so what a copy button hands to the clipboard is the code as the
 * message wrote it, rather than the markup it was rendered into.
 *
 * Only `value` is read from each node, so nothing a node carries as an
 * attribute — a class name, a language — can end up in the text.
 *
 * @param node - A node from the rendered tree, or anything else.
 * @returns The text the node holds, in order.
 */
export function textInHast(node: unknown): string {
  const record = asRecord(node);
  if (!record) return "";

  const own = asText(record.value);
  return own + asArray(record.children).map(textInHast).join("");
}
