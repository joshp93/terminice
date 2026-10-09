import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcutGroups } from "./shortcuts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shortcutGroups", () => {
  it("names every group and gives each one shortcuts", () => {
    for (const group of shortcutGroups()) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.shortcuts.length).toBeGreaterThan(0);
    }
  });

  it("says what each key does, and never leaves either half blank", () => {
    for (const group of shortcutGroups()) {
      for (const shortcut of group.shortcuts) {
        expect(shortcut.keys.trim().length).toBeGreaterThan(0);
        expect(shortcut.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("covers the composer, the menus, the transcript, the cards and the window", () => {
    const titles = shortcutGroups().map((group) => group.title);
    expect(titles).toEqual([
      "Composer",
      "Menus",
      "Transcript",
      "Approvals and questions",
      "Window",
    ]);
  });

  it("writes the modifier the way the platform does", () => {
    const bold = shortcutGroups()
      .flatMap((group) => group.shortcuts)
      .find((shortcut) => shortcut.description === "Bold");

    expect(bold?.keys).toMatch(/^(Ctrl\+B|⌘B)$/);
  });

  it("uses the command symbol on a Mac rather than naming Control", () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");

    const written = JSON.stringify(shortcutGroups());
    expect(written).toContain("⌘B");
    expect(written).not.toContain("Ctrl");
  });

  it("names each key once per group, so the list does not repeat itself", () => {
    for (const group of shortcutGroups()) {
      const keys = group.shortcuts.map((shortcut) => shortcut.keys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
