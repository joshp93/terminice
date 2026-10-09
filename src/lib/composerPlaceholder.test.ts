import { describe, expect, it } from "vitest";
import { composerPlaceholder } from "./composerPlaceholder";
import { modifierShortcut } from "./modifierShortcut";

describe("composerPlaceholder", () => {
  it("says Enter sends when it does", () => {
    const text = composerPlaceholder({ enterBehaviour: "send", dictates: false });
    expect(text).toContain("Enter sends");
    expect(text).toContain("Shift+Enter for a new line");
  });

  it("says Enter breaks the line when that is what it is set to", () => {
    const text = composerPlaceholder({ enterBehaviour: "newline", dictates: false });
    expect(text).toContain("Enter for a new line");
    expect(text).not.toContain("Shift+Enter");
  });

  it("names the key that sends when Enter does not, rather than staying quiet", () => {
    const text = composerPlaceholder({ enterBehaviour: "newline", dictates: false });
    expect(text).toContain(`${modifierShortcut("Enter")} sends`);
  });

  it("mentions dictation only when it can actually be used", () => {
    expect(composerPlaceholder({ enterBehaviour: "send", dictates: true })).toContain(
      "hold space to dictate",
    );
    expect(composerPlaceholder({ enterBehaviour: "send", dictates: false })).not.toContain(
      "dictate",
    );
  });

  it("always opens with what the composer is for and where commands live", () => {
    for (const dictates of [true, false]) {
      for (const enterBehaviour of ["send", "newline"] as const) {
        const text = composerPlaceholder({ enterBehaviour, dictates });
        expect(text.startsWith("Message Claude — / for commands")).toBe(true);
      }
    }
  });

  it("reads as one sentence when both the settings are away from their defaults", () => {
    expect(composerPlaceholder({ enterBehaviour: "newline", dictates: true })).toBe(
      `Message Claude — / for commands, hold space to dictate, Enter for a new line, ${modifierShortcut("Enter")} sends`,
    );
  });
});
