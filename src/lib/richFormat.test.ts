import { describe, expect, it } from "vitest";
import {
  closingMarkers,
  createInlineState,
  FORMATS,
  formatMarkers,
  formatShortcutLabel,
  planToggle,
  planTypedCharacter,
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
});

describe("createInlineState", () => {
  it("starts with nothing armed and nothing open", () => {
    const state = createInlineState();
    expect(state.armed.size).toBe(0);
    expect(state.open.size).toBe(0);
  });
});

describe("planToggle", () => {
  it("arms a style that is not open", () => {
    const plan = planToggle("bold", createInlineState());
    expect(plan.kind).toBe("arm");
    if (plan.kind !== "arm") return;
    expect(plan.state.armed.has("bold")).toBe(true);
    expect(plan.state.open.size).toBe(0);
  });

  it("disarms a style that is already armed", () => {
    const armed = planToggle("bold", createInlineState());
    if (armed.kind !== "arm") throw new Error("expected the first press to arm");
    const disarmed = planToggle("bold", armed.state);
    expect(disarmed.kind).toBe("arm");
    if (disarmed.kind !== "arm") return;
    expect(disarmed.state.armed.has("bold")).toBe(false);
  });

  it("closes a group that has been opened", () => {
    const opened = planTypedCharacter("a", planToggle("bold", createInlineState()).state);
    if (!opened) throw new Error("expected a typing plan");
    const closed = planToggle("bold", opened.state);
    expect(closed.kind).toBe("close");
    if (closed.kind !== "close") return;
    expect(closed.insert).toBe("**");
    expect(closed.state.open.size).toBe(0);
  });

  it("closes every open marker at once", () => {
    let state = createInlineState();
    for (const id of ["bold", "italic"] as const) {
      const armed = planToggle(id, state);
      if (armed.kind !== "arm") throw new Error("expected an arm plan");
      const typed = planTypedCharacter("a", armed.state);
      if (!typed) throw new Error("expected a typing plan");
      state = typed.state;
    }
    const closed = planToggle("bold", state);
    expect(closed.kind === "close" && closed.insert).toBe("***");
  });
});

describe("planTypedCharacter", () => {
  it("inserts plainly when nothing is armed", () => {
    expect(planTypedCharacter("a", createInlineState())).toBeNull();
  });

  it("wraps the character and clears the arming", () => {
    const armed = planToggle("bold", createInlineState());
    if (armed.kind !== "arm") throw new Error("expected an arm plan");
    const plan = planTypedCharacter("a", armed.state);
    expect(plan?.insert).toBe("**a");
    expect(plan?.state.armed.size).toBe(0);
    expect(plan?.state.open.has("bold")).toBe(true);
  });

  it("inserts whitespace plainly and stays armed", () => {
    const armed = planToggle("bold", createInlineState());
    if (armed.kind !== "arm") throw new Error("expected an arm plan");
    expect(planTypedCharacter(" ", armed.state)).toBeNull();
  });

  it("treats a tab and a newline as whitespace", () => {
    const armed = planToggle("italic", createInlineState());
    if (armed.kind !== "arm") throw new Error("expected an arm plan");
    expect(planTypedCharacter("\t", armed.state)).toBeNull();
    expect(planTypedCharacter("\n", armed.state)).toBeNull();
  });
});

describe("closingMarkers", () => {
  it("is empty when nothing is open", () => {
    expect(closingMarkers(createInlineState())).toBe("");
  });

  it("is the markers of everything open", () => {
    expect(closingMarkers({ armed: new Set(), open: new Set(["bold"]) })).toBe("**");
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
