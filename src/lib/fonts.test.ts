import { describe, expect, it } from "vitest";
import { MONO_FONT_STACK } from "./fonts";

describe("MONO_FONT_STACK", () => {
  it("ends with a generic monospace family, so there is always a fallback", () => {
    expect(MONO_FONT_STACK.trimEnd().endsWith("monospace")).toBe(true);
  });

  it("tries a Nerd Font first, so glyphs pasted from a terminal survive", () => {
    expect(MONO_FONT_STACK.startsWith('"MesloLGLDZ Nerd Font Mono"')).toBe(true);
  });

  it("quotes every family that has a space in its name", () => {
    for (const family of MONO_FONT_STACK.split(",").map((part) => part.trim())) {
      if (family.includes(" ") && family !== "monospace") {
        expect(family.startsWith('"') && family.endsWith('"')).toBe(true);
      }
    }
  });
});
