import { markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { planSelectionToggle, type TextChange } from "./styleEdits";

/** Writes a document's changes into it, from the back so positions hold. */
function apply(text: string, changes: readonly TextChange[]): string {
  let out = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  return out;
}

/**
 * The text carried by each bold run, read back out of the Markdown.
 *
 * The point of these tests is what the result *means*, not what characters are
 * in it, and only the parser knows that.
 */
function boldText(text: string): string[] {
  const tree = markdownLanguage.parser.parse(text);
  const found: string[] = [];
  tree.iterate({
    enter: (reference) => {
      const node = reference.node;
      if (node.name !== "StrongEmphasis") return undefined;
      const first = node.firstChild;
      const last = node.lastChild;
      if (first && last) found.push(text.slice(first.to, last.from));
      return undefined;
    },
  });
  return found;
}

/** Presses a style over a selection written as `[these]` in the text. */
function toggle(text: string, style: "bold" | "italic" = "bold"): string {
  const from = text.indexOf("[");
  const to = text.indexOf("]") - 1;
  const bare = text.slice(0, from) + text.slice(from + 1, to + 1) + text.slice(to + 2);
  const tree = markdownLanguage.parser.parse(bare);
  const plan = planSelectionToggle(tree, style, bare, from, to);
  if (plan.kind === "wrap") throw new Error("nothing of that style was there");
  return apply(bare, plan.changes);
}

describe("a selection that carries the style throughout", () => {
  /// The regression case: the selection is the whole of the style, so the
  /// markers have nothing left to hold and go.
  it("takes the markers out when the selection is all of it", () => {
    const result = toggle("***[Hello]** world*");

    expect(result).toBe("*Hello world*");
    expect(boldText(result)).toEqual([]);
  });

  /// The `llo` keeps the bold the `He` lost, so the opening markers move to the
  /// selection's edge rather than being deleted with it.
  it("moves the opening markers to the edge of a selection at the start", () => {
    const result = toggle("***[He]llo** world*");

    expect(result).toBe("*He**llo** world*");
    expect(boldText(result)).toEqual(["llo"]);
  });

  it("moves the closing markers to the edge of a selection at the end", () => {
    const result = toggle("***Hel[lo]** world*");

    expect(result).toBe("***Hel**lo world*");
    expect(boldText(result)).toEqual(["Hel"]);
  });

  /// A hole scooped out of the middle leaves the bold on both sides of it, so a
  /// pair of markers goes at each edge of the selection.
  it("leaves the style on both sides of a hole in the middle", () => {
    const result = toggle("***H[ell]o** world*");

    expect(result).toBe("***H**ell**o** world*");
    expect(boldText(result)).toEqual(["H", "o"]);
  });
});

describe("a selection that carries the style only in part", () => {
  /// Toggling on wins: the selection reaches past where the bold ended, so the
  /// bold ends further along rather than a second run being started inside it.
  it("stretches the style over the rest of the selection", () => {
    const result = toggle("***Hel[lo** wor]ld*");

    expect(result).toBe("***Hello wor**ld*");
    expect(boldText(result)).toEqual(["Hello wor"]);
  });

  /// The other end of the same rule: half the selection is bold, so the bold
  /// reaches back to the start of it.
  it("stretches back to a selection that starts before the style", () => {
    const result = toggle("[x**y]**z");

    expect(result).toBe("**xy**z");
    expect(boldText(result)).toEqual(["xy"]);
  });
});

describe("a selection with none of the style in it", () => {
  it("has nothing to take off, so the caller wraps it instead", () => {
    const text = "***Hello** [world]*";
    const from = text.indexOf("[");
    const bare = text.replace(/[[\]]/g, "");
    const tree = markdownLanguage.parser.parse(bare);
    const to = from + "world".length;

    expect(planSelectionToggle(tree, "bold", bare, from, to)).toEqual({ kind: "wrap" });
  });

  it("has nothing to take off for a style the text does not use at all", () => {
    const tree = markdownLanguage.parser.parse("plain words");

    expect(planSelectionToggle(tree, "bold", "plain words", 0, 5)).toEqual({ kind: "wrap" });
  });
});
