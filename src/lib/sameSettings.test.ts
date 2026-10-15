import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "../types";
import { sameSettings } from "./sameSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sameSettings", () => {
  it("says two readings of the same settings are the same", () => {
    expect(sameSettings(createDefaultSettings(), createDefaultSettings())).toBe(true);
  });

  it("says a single changed setting makes them different", () => {
    const a = createDefaultSettings();
    const b = { ...a, theme: "light" as const };

    expect(sameSettings(a, b)).toBe(false);
  });

  /// Every field is compared, including the cost rates, which are the ones a
  /// reader is most likely to have just edited by hand.
  it("compares the cost rates too", () => {
    const a = createDefaultSettings();
    const b = { ...a, inputCostPerMillion: 0.15 };

    expect(sameSettings(a, b)).toBe(false);
  });

  it("tells apart a file that lost a field", () => {
    const a = createDefaultSettings();
    const b = { ...a } as Partial<typeof a>;
    delete b.voiceEnabled;

    expect(sameSettings(a, b as typeof a)).toBe(false);
  });
});
