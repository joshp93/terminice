import { describe, expect, it } from "vitest";
import {
  INDENT_UNIT,
  listMarkerText,
  markerKind,
  nextMarker,
  parseListLine,
  planIndent,
  planListBackspace,
  planListEnter,
  planListToggle,
  planOutdent,
  readListMarker,
  renumberOrderedLines,
} from "./listMarkers";

describe("parseListLine", () => {
  it("splits a bullet into its parts", () => {
    expect(parseListLine("- item")).toEqual({
      indent: "",
      marker: "-",
      gap: " ",
      content: "item",
    });
  });

  it("keeps the indentation and the marker's own style", () => {
    expect(parseListLine("  * a b")).toEqual({
      indent: "  ",
      marker: "*",
      gap: " ",
      content: "a b",
    });
    expect(parseListLine("12) y")).toEqual({
      indent: "",
      marker: "12)",
      gap: " ",
      content: "y",
    });
  });

  it("accepts a tab as the gap", () => {
    expect(parseListLine("-\tx")).toEqual({ indent: "", marker: "-", gap: "\t", content: "x" });
  });

  it("reads an item with no content", () => {
    expect(parseListLine("- ")).toEqual({ indent: "", marker: "-", gap: " ", content: "" });
  });

  it("rejects a line that is not a list", () => {
    expect(parseListLine("plain")).toBeNull();
    expect(parseListLine("x - y")).toBeNull();
    expect(parseListLine("# heading")).toBeNull();
  });

  it("requires whitespace after the marker", () => {
    expect(parseListLine("-x")).toBeNull();
    expect(parseListLine("1.x")).toBeNull();
    expect(parseListLine("-")).toBeNull();
  });
});

describe("markerKind", () => {
  it("calls a numbered marker ordered", () => {
    expect(markerKind("1.")).toBe("ordered");
    expect(markerKind("12)")).toBe("ordered");
  });

  it("calls bullets and undelimited numbers bullet", () => {
    expect(markerKind("-")).toBe("bullet");
    expect(markerKind("+")).toBe("bullet");
    expect(markerKind("1")).toBe("bullet");
  });
});

describe("readListMarker", () => {
  it("returns the marker with its indent and gap", () => {
    expect(readListMarker("- item")).toEqual({ kind: "bullet", text: "- " });
    expect(readListMarker("  3) x")).toEqual({ kind: "ordered", text: "  3) " });
  });

  it("returns null for a line that is not a list", () => {
    expect(readListMarker("plain")).toBeNull();
    expect(readListMarker("-x")).toBeNull();
  });
});

describe("listMarkerText", () => {
  it("always starts a bullet list at a dash", () => {
    expect(listMarkerText("bullet")).toBe("- ");
    expect(listMarkerText("bullet", 7)).toBe("- ");
  });

  it("numbers an ordered list from the given position", () => {
    expect(listMarkerText("ordered")).toBe("1. ");
    expect(listMarkerText("ordered", 5)).toBe("5. ");
  });
});

describe("nextMarker", () => {
  it("increments an ordered marker", () => {
    expect(nextMarker("3.")).toBe("4.");
    expect(nextMarker("9.")).toBe("10.");
  });

  it("keeps the delimiter an ordered list was written with", () => {
    expect(nextMarker("3)")).toBe("4)");
  });

  it("repeats a bullet unchanged", () => {
    expect(nextMarker("-")).toBe("-");
    expect(nextMarker("+")).toBe("+");
  });
});

describe("planListToggle", () => {
  it("removes a marker when the kind is already applied", () => {
    expect(planListToggle("- item", "bullet")).toEqual({ offset: 0, remove: 2, insert: "" });
    expect(planListToggle("1. item", "ordered")).toEqual({ offset: 0, remove: 3, insert: "" });
  });

  it("keeps the indentation when removing a marker", () => {
    expect(planListToggle("  - item", "bullet")).toEqual({ offset: 0, remove: 4, insert: "  " });
  });

  it("swaps the marker in place when the other kind is applied", () => {
    expect(planListToggle("1. item", "bullet")).toEqual({ offset: 0, remove: 2, insert: "-" });
    expect(planListToggle("- item", "ordered")).toEqual({ offset: 0, remove: 1, insert: "1." });
  });

  it("adds a marker to a plain line", () => {
    expect(planListToggle("plain text", "bullet")).toEqual({ offset: 0, remove: 0, insert: "- " });
    expect(planListToggle("plain text", "ordered")).toEqual({
      offset: 0,
      remove: 0,
      insert: "1. ",
    });
  });
});

describe("planIndent", () => {
  it("inserts one indent unit before the line", () => {
    expect(planIndent("- item")).toEqual({ offset: 0, remove: 0, insert: INDENT_UNIT });
  });

  it("returns null when the line is not a list item", () => {
    expect(planIndent("plain")).toBeNull();
  });
});

describe("planOutdent", () => {
  it("removes one indent unit", () => {
    expect(planOutdent("    - item")).toEqual({ offset: 0, remove: 2, insert: "" });
  });

  it("removes only what indentation exists", () => {
    expect(planOutdent(" - item")).toEqual({ offset: 0, remove: 1, insert: "" });
  });

  it("returns null at the left margin or off a list", () => {
    expect(planOutdent("- item")).toBeNull();
    expect(planOutdent("plain")).toBeNull();
  });
});

describe("planListBackspace", () => {
  it("removes the whole marker from an empty item", () => {
    expect(planListBackspace("- ")).toEqual({ offset: 0, remove: 2, insert: "" });
    expect(planListBackspace("  - ")).toEqual({ offset: 0, remove: 4, insert: "  " });
  });

  it("outdents a non-empty indented item", () => {
    expect(planListBackspace("  - x")).toEqual({ offset: 0, remove: 2, insert: "" });
    expect(planListBackspace(" - x")).toEqual({ offset: 0, remove: 1, insert: "" });
  });

  it("drops the marker of a non-empty item at the left margin", () => {
    expect(planListBackspace("- x")).toEqual({ offset: 0, remove: 2, insert: "" });
  });

  it("returns null for a line that is not a list item", () => {
    expect(planListBackspace("plain")).toBeNull();
  });
});

describe("planListEnter", () => {
  it("continues an ordered list with the next number", () => {
    expect(planListEnter("3. a")).toEqual({ removeMarker: 0, insert: "\n4. " });
    expect(planListEnter("3) a")).toEqual({ removeMarker: 0, insert: "\n4) " });
  });

  it("continues a bullet list in the same style", () => {
    expect(planListEnter("- a")).toEqual({ removeMarker: 0, insert: "\n- " });
    expect(planListEnter("  * a")).toEqual({ removeMarker: 0, insert: "\n  * " });
  });

  it("ends the list by replacing an empty item with a newline", () => {
    expect(planListEnter("- ")).toEqual({ removeMarker: 2, insert: "\n" });
    expect(planListEnter("  - ")).toEqual({ removeMarker: 4, insert: "\n" });
  });

  it("returns null for a line that is not a list item", () => {
    expect(planListEnter("plain")).toBeNull();
  });
});

describe("renumberOrderedLines", () => {
  it("renumbers a run of ordered items from one", () => {
    expect(renumberOrderedLines(["1. a", "1. b", "1. c"])).toEqual(["1. a", "2. b", "3. c"]);
  });

  it("returns null when nothing needed to change", () => {
    expect(renumberOrderedLines(["1. a", "2. b"])).toBeNull();
    expect(renumberOrderedLines([])).toBeNull();
  });

  it("keeps the number the run started from", () => {
    expect(renumberOrderedLines(["5. a", "5. b"])).toEqual(["5. a", "6. b"]);
  });

  it("keeps the delimiter the run was written with", () => {
    expect(renumberOrderedLines(["1) a", "1) b"])).toEqual(["1) a", "2) b"]);
  });

  it("restarts numbering after a bullet breaks the run", () => {
    expect(renumberOrderedLines(["1. a", "2. b", "- x", "9. c", "9. d"])).toEqual([
      "1. a",
      "2. b",
      "- x",
      "9. c",
      "10. d",
    ]);
  });

  it("counts each indentation level separately", () => {
    expect(renumberOrderedLines(["1. a", "  1. b", "  1. c", "1. d"])).toEqual([
      "1. a",
      "  1. b",
      "  2. c",
      "2. d",
    ]);
  });

  it("leaves a plain paragraph alone and breaks the run", () => {
    expect(renumberOrderedLines(["1. a", "text", "1. b"])).toBeNull();
  });
});
