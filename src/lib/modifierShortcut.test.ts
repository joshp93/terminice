import { afterEach, describe, expect, it, vi } from "vitest";
import { modifierShortcut } from "./modifierShortcut";

/** Replaces the platform the label is read from. */
function pretendPlatform(platform: string): void {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("modifierShortcut", () => {
  it("writes Control on Windows and Linux", () => {
    pretendPlatform("Win32");
    expect(modifierShortcut("B")).toBe("Ctrl+B");
    pretendPlatform("Linux x86_64");
    expect(modifierShortcut("B")).toBe("Ctrl+B");
  });

  it("writes the command symbol on a Mac", () => {
    pretendPlatform("MacIntel");
    expect(modifierShortcut("B")).toBe("⌘B");
  });

  it("treats an iPad as a Mac, since that is the keyboard it can have", () => {
    pretendPlatform("iPad");
    expect(modifierShortcut("Enter")).toBe("⌘Enter");
  });
});
