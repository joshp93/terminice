import { describe, expect, it } from "vitest";
import { isModShortcut } from "./isModShortcut";

/** A keyboard event with only the fields the shortcut reads. */
function press(
  key: string,
  held: Partial<Record<"ctrl" | "meta" | "alt" | "shift", boolean>> = {},
) {
  return {
    key,
    ctrlKey: held.ctrl === true,
    metaKey: held.meta === true,
    altKey: held.alt === true,
    shiftKey: held.shift === true,
  };
}

describe("isModShortcut", () => {
  it("matches either the platform modifier or Control", () => {
    expect(isModShortcut(press("p", { ctrl: true }), "p")).toBe(true);
    expect(isModShortcut(press("p", { meta: true }), "p")).toBe(true);
  });

  it("takes the key whatever case it arrives in", () => {
    expect(isModShortcut(press("P", { ctrl: true }), "p")).toBe(true);
    expect(isModShortcut(press("m", { ctrl: true }), "M")).toBe(true);
  });

  it("refuses a key held with no modifier at all", () => {
    expect(isModShortcut(press("p"), "p")).toBe(false);
  });

  it("refuses a modifier the shortcut does not name", () => {
    expect(isModShortcut(press("p", { ctrl: true, shift: true }), "p")).toBe(false);
    expect(isModShortcut(press("p", { ctrl: true, alt: true }), "p")).toBe(false);
  });

  it("refuses a different key", () => {
    expect(isModShortcut(press("o", { ctrl: true }), "p")).toBe(false);
  });
});
