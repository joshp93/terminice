import { describe, expect, it } from "vitest";
import {
  armFormat,
  createInlineState,
  disarmFormat,
  FORMATS,
  formatMarkers,
  formatShortcutLabel,
  planTypedCharacter,
  quoteShortcutLabel,
  toggleArmedFormat,
  wrapOffsets,
} from "./richFormat";

describe("formatMarkers", () => {
  it("emits nothing for no styles", () => {
    expect(formatMarkers([])).toBe("");
  });

  it("emits a single marker", () => {
    expect(formatMarkers(["bold"])).toBe("**");
  });

  it("orders markers the same way regardless of insertion order", () => {
    expect(formatMarkers(["code", "bold"])).toBe(formatMarkers(["bold", "code"]));
  });

  it("emits bold before italic so the longer marker wins", () => {
    expect(formatMarkers(["italic", "bold"])).toBe("***");
  });

  it("ignores duplicates", () => {
    expect(formatMarkers(["bold", "bold"])).toBe("**");
  });
});

describe("formatShortcutLabel", () => {
  it("names the key for the platform", () => {
    expect(formatShortcutLabel("bold")).toMatch(/^(Ctrl\+B|⌘B)$/);
  });

  it("has a label for every offered style", () => {
    for (const format of FORMATS) {
      expect(formatShortcutLabel(format.id)).toMatch(/^(Ctrl\+|⌘)/);
    }
  });

  it("names the quote the way it names the styles", () => {
    expect(quoteShortcutLabel()).toMatch(/^(Ctrl\+>|⌘>)$/);
  });
});

describe("createInlineState", () => {
  it("starts with nothing armed", () => {
    expect(createInlineState().armed.size).toBe(0);
  });
});

describe("armFormat and disarmFormat", () => {
  it("arms a style that is not armed", () => {
    expect(armFormat("bold", createInlineState()).armed.has("bold")).toBe(true);
  });

  it("leaves the other styles alone", () => {
    const state = armFormat("bold", createInlineState());
    expect(armFormat("italic", state).armed.has("bold")).toBe(true);
  });

  it("disarms only the style named", () => {
    const state = armFormat("bold", armFormat("italic", createInlineState()));
    const disarmed = disarmFormat("bold", state);
    expect(disarmed.armed.has("bold")).toBe(false);
    expect(disarmed.armed.has("italic")).toBe(true);
  });

  it("disarming one that is not armed changes nothing", () => {
    expect(disarmFormat("bold", createInlineState()).armed.size).toBe(0);
  });
});

describe("toggleArmedFormat", () => {
  it("arms a style that is not armed", () => {
    expect(toggleArmedFormat("bold", createInlineState()).armed.has("bold")).toBe(true);
  });

  it("disarms a style that is already armed", () => {
    const armed = toggleArmedFormat("bold", createInlineState());
    expect(toggleArmedFormat("bold", armed).armed.has("bold")).toBe(false);
  });

  it("keeps each style apart when several are armed", () => {
    let state = toggleArmedFormat("bold", createInlineState());
    state = toggleArmedFormat("italic", state);
    expect([...state.armed].sort()).toEqual(["bold", "italic"]);
  });
});

describe("planTypedCharacter", () => {
  it("inserts plainly when nothing is armed", () => {
    expect(planTypedCharacter("a", createInlineState())).toBeNull();
  });

  /// Both markers go in at once, so what is on screen is what will be sent and
  /// the caret sits where the next character belongs.
  it("wraps the character in both markers and leaves the caret inside them", () => {
    const armed = armFormat("bold", createInlineState());
    const plan = planTypedCharacter("a", armed);

    expect(plan?.insert).toBe("**a**");
    expect(plan?.caretOffset).toBe(3);
    expect(plan?.state.armed.size).toBe(0);
  });

  it("wraps every armed style at once, in the same order as their markers", () => {
    const armed = armFormat("italic", armFormat("bold", createInlineState()));
    const plan = planTypedCharacter("a", armed);

    expect(plan?.insert).toBe("***a***");
    expect(plan?.caretOffset).toBe(4);
  });

  it("puts the caret after the character whatever the markers are", () => {
    const armed = armFormat("code", armFormat("strike", createInlineState()));
    const plan = planTypedCharacter("a", armed);

    expect(plan?.caretOffset).toBe("~~`a".length);
  });

  it("inserts whitespace plainly and stays armed", () => {
    const armed = armFormat("bold", createInlineState());
    expect(planTypedCharacter(" ", armed)).toBeNull();
  });

  it("treats a tab and a newline as whitespace", () => {
    const armed = armFormat("italic", createInlineState());
    expect(planTypedCharacter("\t", armed)).toBeNull();
    expect(planTypedCharacter("\n", armed)).toBeNull();
  });
});

describe("wrapOffsets", () => {
  it("returns the whole string when it has no padding", () => {
    expect(wrapOffsets("text")).toEqual({ start: 0, end: 4 });
  });

  it("leaves leading and trailing whitespace outside the markers", () => {
    expect(wrapOffsets("  text  ")).toEqual({ start: 2, end: 6 });
  });

  it("returns null for whitespace alone", () => {
    expect(wrapOffsets("   ")).toBeNull();
  });

  it("returns null for an empty selection", () => {
    expect(wrapOffsets("")).toBeNull();
  });

  it("handles a selection padded on one side only", () => {
    expect(wrapOffsets("text ")).toEqual({ start: 0, end: 4 });
  });
});
