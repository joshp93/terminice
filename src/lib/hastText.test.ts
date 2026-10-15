import { describe, expect, it } from "vitest";
import { textInHast } from "./hastText";

describe("textInHast", () => {
  it("reads a text node", () => {
    expect(textInHast({ type: "text", value: "hello" })).toBe("hello");
  });

  /// A highlighted block is a tree of spans, one per token, and what it means is
  /// the text at its leaves.
  it("joins the leaves of a tree in order", () => {
    const highlighted = {
      type: "element",
      tagName: "code",
      properties: { className: ["language-ts", "hljs"] },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["hljs-keyword"] },
          children: [{ type: "text", value: "const" }],
        },
        { type: "text", value: " x = " },
        {
          type: "element",
          tagName: "span",
          properties: {},
          children: [{ type: "text", value: "1" }],
        },
      ],
    };

    expect(textInHast(highlighted)).toBe("const x = 1");
  });

  /// Class names, languages and every other attribute belong to the drawing
  /// rather than to the code, and must not reach the clipboard.
  it("reads no attribute", () => {
    const node = {
      type: "element",
      tagName: "code",
      properties: { className: ["language-ts"], "data-value": "attribute-text" },
      children: [],
    };

    expect(textInHast(node)).toBe("");
  });

  it("keeps the whitespace that is part of the code", () => {
    const node = {
      type: "element",
      tagName: "code",
      children: [
        { type: "text", value: "  indented\n" },
        { type: "text", value: "\tand a tab\n" },
      ],
    };

    expect(textInHast(node)).toBe("  indented\n\tand a tab\n");
  });

  it("has nothing to say about anything that is not a node", () => {
    expect(textInHast(undefined)).toBe("");
    expect(textInHast(null)).toBe("");
    expect(textInHast("plain string")).toBe("");
    expect(textInHast({ type: "element" })).toBe("");
  });
});
