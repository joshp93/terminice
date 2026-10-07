import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import {
  codeBlockText,
  findCodeBlock,
  findStyleNode,
  nodeRepresentsFormat,
  spanOf,
  spansCover,
  stripMarkers,
  styleAppliesAt,
  styleNodesInRange,
  styleStateInRange,
} from "./markdownSpans";

const parse = (text: string) => markdownLanguage.parser.parse(text);

const nodesNamed = (text: string, name: string): SyntaxNode[] => {
  const found: SyntaxNode[] = [];
  parse(text).iterate({
    enter: (reference) => {
      if (reference.name === name) found.push(reference.node);
    },
  });
  return found;
};

const nodeNamed = (text: string, name: string): SyntaxNode => {
  const [node] = nodesNamed(text, name);
  if (!node) throw new Error(`no ${name} node in "${text}"`);
  return node;
};

const bounds = (nodes: readonly SyntaxNode[]) => nodes.map((node) => [node.from, node.to]);

const span = (from: number, to: number) => ({ from, to }) as unknown as SyntaxNode;

describe("nodeRepresentsFormat", () => {
  it("maps each inline style node to its format", () => {
    expect(nodeRepresentsFormat(nodeNamed("**x**", "StrongEmphasis"), "bold")).toBe(true);
    expect(nodeRepresentsFormat(nodeNamed("*x*", "Emphasis"), "italic")).toBe(true);
    expect(nodeRepresentsFormat(nodeNamed("~~x~~", "Strikethrough"), "strike")).toBe(true);
    expect(nodeRepresentsFormat(nodeNamed("`x`", "InlineCode"), "code")).toBe(true);
  });

  it("does not claim a node for a format it is not", () => {
    expect(nodeRepresentsFormat(nodeNamed("**x**", "StrongEmphasis"), "italic")).toBe(false);
    expect(nodeRepresentsFormat(nodeNamed("hello", "Paragraph"), "bold")).toBe(false);
  });
});

describe("spanOf", () => {
  it("reads the markers of a bold node", () => {
    expect(spanOf(nodeNamed("**bold**", "StrongEmphasis"))).toEqual({
      openFrom: 0,
      openTo: 2,
      closeFrom: 6,
      closeTo: 8,
    });
  });

  it("reads the markers of inline code", () => {
    expect(spanOf(nodeNamed("`code`", "InlineCode"))).toEqual({
      openFrom: 0,
      openTo: 1,
      closeFrom: 5,
      closeTo: 6,
    });
  });

  it("reads the markers of strikethrough", () => {
    expect(spanOf(nodeNamed("~~gone~~", "Strikethrough"))).toEqual({
      openFrom: 0,
      openTo: 2,
      closeFrom: 6,
      closeTo: 8,
    });
  });

  it("returns null for a node with no children", () => {
    expect(spanOf(nodeNamed("hello", "Paragraph"))).toBeNull();
  });

  it("returns null when the node's edges are not markers", () => {
    expect(spanOf(parse("one\n\ntwo").topNode)).toBeNull();
  });
});

describe("findStyleNode", () => {
  it("finds the enclosing span from a node inside it", () => {
    const tree = parse("**bold** and *it*");
    const inside = tree.resolveInner(3, -1);
    expect(findStyleNode(inside, "bold", 3, 6)?.name).toBe("StrongEmphasis");
  });

  it("returns the innermost matching style", () => {
    const emphasis = nodeNamed("**a *b* c**", "Emphasis");
    expect(findStyleNode(emphasis, "italic", 5, 6)?.name).toBe("Emphasis");
    expect(findStyleNode(emphasis, "bold", 5, 6)?.name).toBe("StrongEmphasis");
  });

  it("returns null when the range falls outside the node", () => {
    const tree = parse("**bold** and *it*");
    expect(findStyleNode(tree.resolveInner(3, -1), "bold", 10, 12)).toBeNull();
  });

  it("returns null when no ancestor carries the style", () => {
    const tree = parse("**bold**");
    expect(findStyleNode(tree.resolveInner(3, -1), "italic", 3, 6)).toBeNull();
  });

  it("returns null for a null starting node", () => {
    expect(findStyleNode(null, "bold", 0, 1)).toBeNull();
  });
});

describe("styleNodesInRange", () => {
  it("collects every overlapping span in document order", () => {
    const tree = parse("**a** plain **b**");
    expect(bounds(styleNodesInRange(tree, "bold", 0, 17))).toEqual([
      [0, 5],
      [12, 17],
    ]);
  });

  it("excludes a span that only touches the range's edge", () => {
    const tree = parse("**a** plain **b**");
    expect(styleNodesInRange(tree, "bold", 5, 12)).toEqual([]);
  });

  it("keeps a span that properly overlaps a partial range", () => {
    const tree = parse("**a** plain **b**");
    expect(bounds(styleNodesInRange(tree, "bold", 0, 6))).toEqual([[0, 5]]);
  });

  it("finds a nested span of the inner style", () => {
    const tree = parse("**a *b* c**");
    expect(bounds(styleNodesInRange(tree, "italic", 0, 11))).toEqual([[4, 7]]);
  });

  it("finds nothing when the style is absent", () => {
    expect(styleNodesInRange(parse("hello"), "bold", 0, 5)).toEqual([]);
  });
});

describe("spansCover", () => {
  it("is true for a single span spanning the range", () => {
    expect(spansCover([span(0, 5)], 1, 4)).toBe(true);
  });

  it("is true for adjacent spans that leave no gap", () => {
    expect(spansCover([span(3, 6), span(0, 3)], 0, 6)).toBe(true);
  });

  it("is false when a gap remains between spans", () => {
    expect(spansCover([span(0, 2), span(4, 6)], 0, 6)).toBe(false);
  });

  it("is false when the range extends past the spans", () => {
    expect(spansCover([span(0, 5)], 0, 6)).toBe(false);
  });

  it("is false when there are no spans", () => {
    expect(spansCover([], 0, 4)).toBe(false);
  });
});

describe("styleStateInRange", () => {
  it("is off when the style is absent", () => {
    expect(styleStateInRange(parse("plain"), "bold", 0, 5)).toBe("off");
  });

  it("is on when a span covers the whole range", () => {
    expect(styleStateInRange(parse("**bold**"), "bold", 0, 8)).toBe("on");
    expect(styleStateInRange(parse("**bold**"), "bold", 2, 6)).toBe("on");
  });

  it("is mixed when the span covers only part of the range", () => {
    expect(styleStateInRange(parse("**a**b"), "bold", 0, 6)).toBe("mixed");
  });
});

describe("styleAppliesAt", () => {
  it("is true between a span's markers", () => {
    expect(styleAppliesAt(parse("**bold**"), "bold", 3)).toBe(true);
  });

  it("is true at both inner edges of the markers", () => {
    const tree = parse("**bold**");
    expect(styleAppliesAt(tree, "bold", 2)).toBe(true);
    expect(styleAppliesAt(tree, "bold", 6)).toBe(true);
  });

  it("is false just past the closing marker, where another run would merge", () => {
    expect(styleAppliesAt(parse("**bold**"), "bold", 7)).toBe(false);
  });

  it("is false before the opening marker", () => {
    expect(styleAppliesAt(parse("**bold**"), "bold", 0)).toBe(false);
  });

  it("is false for a style the text does not carry", () => {
    expect(styleAppliesAt(parse("**bold**"), "italic", 3)).toBe(false);
  });

  it("is true inside inline code", () => {
    expect(styleAppliesAt(parse("`x`"), "code", 1)).toBe(true);
  });
});

describe("findCodeBlock", () => {
  it("finds the fenced block around a node inside it", () => {
    const tree = parse("```\ncode here\n```\n");
    expect(findCodeBlock(tree.resolveInner(5, -1))?.name).toBe("FencedCode");
  });

  it("treats an indented block as code too", () => {
    const tree = parse("    indented code\n");
    expect(findCodeBlock(tree.resolveInner(6, -1))?.name).toBe("CodeBlock");
  });

  it("does not mistake inline code for a block", () => {
    const tree = parse("`x`");
    expect(findCodeBlock(tree.resolveInner(1, -1))).toBeNull();
  });

  it("returns null outside any code", () => {
    expect(findCodeBlock(parse("hello").resolveInner(2, -1))).toBeNull();
  });

  it("returns null for a null node", () => {
    expect(findCodeBlock(null)).toBeNull();
  });
});

describe("codeBlockText", () => {
  it("reads a fenced block's content range, excluding its fences", () => {
    expect(codeBlockText(nodeNamed("```\ncode here\n```\n", "FencedCode"))).toEqual({
      from: 4,
      to: 13,
    });
  });

  it("reads an indented block's whole range", () => {
    expect(codeBlockText(nodeNamed("    indented code\n", "CodeBlock"))).toEqual({
      from: 4,
      to: 17,
    });
  });

  it("returns null for an empty fenced block", () => {
    expect(codeBlockText(nodeNamed("```\n```\n", "FencedCode"))).toBeNull();
  });
});

describe("stripMarkers", () => {
  it("removes a span's markers from the range's text", () => {
    const tree = parse("**bold**");
    const nodes = styleNodesInRange(tree, "bold", 0, 8);
    expect(stripMarkers(nodes, 0, 8, "**bold**")).toBe("bold");
  });

  it("leaves markers falling outside the range alone", () => {
    const tree = parse("**bold**");
    const nodes = styleNodesInRange(tree, "bold", 0, 8);
    expect(stripMarkers(nodes, 2, 6, "bold")).toBe("bold");
  });

  it("strips the markers from a selection that includes surrounding text", () => {
    const tree = parse("a **b** c");
    const nodes = styleNodesInRange(tree, "bold", 0, 9);
    expect(stripMarkers(nodes, 0, 9, "a **b** c")).toBe("a b c");
  });

  it("returns the text unchanged when there are no spans", () => {
    expect(stripMarkers([], 0, 4, "text")).toBe("text");
  });
});
