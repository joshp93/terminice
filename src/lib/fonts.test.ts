import { describe, expect, it } from "vitest";
import {
  availableFontFamilies,
  availableUiFontFamilies,
  availableUiFontGroups,
  detectFontFamilies,
  detectUiFontFamilies,
  FONT_FAMILY_CANDIDATES,
  MONO_FONT_STACK,
  monoFontStack,
  quoteFamily,
  UI_FONT_CANDIDATES,
  UI_FONT_STACK,
  uiFontStack,
} from "./fonts";

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

describe("quoteFamily", () => {
  it("leaves a name CSS reads as one unquoted", () => {
    expect(quoteFamily("Consolas")).toBe("Consolas");
    expect(quoteFamily("Iosevka-Term")).toBe("Iosevka-Term");
  });

  it("quotes a name with a space in it", () => {
    expect(quoteFamily("JetBrainsMono Nerd Font")).toBe('"JetBrainsMono Nerd Font"');
  });
});

describe("monoFontStack", () => {
  it("falls back to the built-in stack when nothing has been chosen", () => {
    expect(monoFontStack("")).toBe(MONO_FONT_STACK);
    expect(monoFontStack("   ")).toBe(MONO_FONT_STACK);
  });

  it("puts the chosen family in front of the built-in stack", () => {
    const stack = monoFontStack("Hack");
    expect(stack.startsWith("Hack, ")).toBe(true);
    expect(stack.endsWith(MONO_FONT_STACK)).toBe(true);
  });

  it("quotes a chosen family that needs it", () => {
    expect(monoFontStack("JetBrainsMono Nerd Font")).toContain('"JetBrainsMono Nerd Font", ');
  });

  it("still ends in a generic family", () => {
    expect(monoFontStack("Hack").trimEnd().endsWith("monospace")).toBe(true);
  });
});

describe("detectFontFamilies", () => {
  it("reports that it cannot measure when there is no canvas to measure with", () => {
    expect(detectFontFamilies(["Hack"])).toBeNull();
  });
});

describe("availableFontFamilies", () => {
  it("offers the candidates when detection is unavailable, so the setting still works", () => {
    expect(availableFontFamilies()).toEqual([...FONT_FAMILY_CANDIDATES]);
  });

  it("offers patched spellings, so a Nerd Font can be picked", () => {
    const families = availableFontFamilies();
    expect(families).toContain("JetBrainsMono Nerd Font");
    expect(families).toContain("CaskaydiaCove NFM");
  });

  it("holds no duplicates", () => {
    const families = availableFontFamilies();
    expect(new Set(families).size).toBe(families.length);
  });
});

describe("UI_FONT_STACK", () => {
  it("ends with a generic family, so there is always a fallback", () => {
    expect(UI_FONT_STACK.trimEnd().endsWith("sans-serif")).toBe(true);
  });

  it("tries the Windows interface face before the generic one", () => {
    expect(UI_FONT_STACK.startsWith('"Segoe UI Variable Text"')).toBe(true);
  });

  it("quotes every family that has a space in its name", () => {
    for (const family of UI_FONT_STACK.split(",").map((part) => part.trim())) {
      if (family.includes(" ") && family !== "sans-serif") {
        expect(family.startsWith('"') && family.endsWith('"')).toBe(true);
      }
    }
  });

  it("offers no monospace family, because it is not the stack for code", () => {
    expect(UI_FONT_STACK).not.toContain("monospace");
  });
});

describe("uiFontStack", () => {
  it("falls back to the built-in stack when nothing has been chosen", () => {
    expect(uiFontStack("")).toBe(UI_FONT_STACK);
    expect(uiFontStack("   ")).toBe(UI_FONT_STACK);
  });

  it("puts the chosen family in front of the built-in stack", () => {
    const stack = uiFontStack("Inter");
    expect(stack.startsWith("Inter, ")).toBe(true);
    expect(stack.endsWith(UI_FONT_STACK)).toBe(true);
  });

  it("still ends in a generic family", () => {
    expect(uiFontStack("Inter").trimEnd().endsWith("sans-serif")).toBe(true);
  });

  it("is a different stack from the one code is drawn in", () => {
    expect(uiFontStack("")).not.toBe(monoFontStack(""));
  });
});

describe("detectUiFontFamilies", () => {
  it("reports that it cannot measure when there is no canvas to measure with", () => {
    expect(detectUiFontFamilies(["Inter"])).toBeNull();
  });
});

describe("availableUiFontFamilies", () => {
  it("offers the candidates when detection is unavailable", () => {
    expect(availableUiFontFamilies()).toEqual([...UI_FONT_CANDIDATES]);
  });

  it("offers interface faces", () => {
    const families = availableUiFontFamilies();
    expect(families).toContain("Segoe UI");
    expect(families).toContain("Georgia");
  });

  it("offers the patched monospace families too, so a Nerd Font can be used everywhere", () => {
    const families = availableUiFontFamilies();
    expect(families).toContain("JetBrainsMono Nerd Font");
    expect(families).toContain("CaskaydiaCove NFM");
  });

  it("holds no duplicates across the two sections", () => {
    const families = availableUiFontFamilies();
    expect(new Set(families).size).toBe(families.length);
  });

  it("is not simply the code list, because it carries the interface faces as well", () => {
    expect(availableUiFontFamilies()).not.toEqual(availableFontFamilies());
    expect(availableUiFontFamilies().length).toBeGreaterThan(availableFontFamilies().length);
  });
});

describe("availableUiFontGroups", () => {
  it("splits the list into an interface section and a code section", () => {
    expect(availableUiFontGroups().map((group) => group.label)).toEqual([
      "Interface",
      "Code and Nerd Fonts",
    ]);
  });

  it("says which section a family belongs to", () => {
    const groups = availableUiFontGroups();
    const section = (family: string) =>
      groups.find((group) => group.families.includes(family))?.label;

    expect(section("Segoe UI")).toBe("Interface");
    expect(section("Georgia")).toBe("Interface");
    expect(section("JetBrainsMono Nerd Font")).toBe("Code and Nerd Fonts");
    expect(section("Consolas")).toBe("Code and Nerd Fonts");
  });

  it("leaves out a section with nothing installed rather than showing an empty heading", () => {
    expect(availableUiFontGroups().every((group) => group.families.length > 0)).toBe(true);
  });

  it("flattens to the same list the picker stores a value from", () => {
    const flattened = availableUiFontGroups().flatMap((group) => group.families);
    expect(flattened).toEqual(availableUiFontFamilies());
  });
});
