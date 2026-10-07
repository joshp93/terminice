import { describe, expect, it } from "vitest";
import {
  CLAUDE_CONFIG_KEYS,
  describeFastMode,
  describePermissionMode,
  humaniseKey,
  PERMISSION_MODES,
} from "./claudeConfig";

describe("humaniseKey", () => {
  it("splits a camel-cased key and capitalises the first character", () => {
    expect(humaniseKey("autoCompact")).toBe("Auto Compact");
  });

  it("keeps the capitals already inside a camel-cased key", () => {
    expect(humaniseKey("useAutoModeDuringPlan")).toBe("Use Auto Mode During Plan");
  });

  it("treats underscores and dashes as spaces without capitalising the next word", () => {
    expect(humaniseKey("output_style")).toBe("Output style");
    expect(humaniseKey("output-style")).toBe("Output style");
  });

  it("splits an acronym off the following word", () => {
    expect(humaniseKey("autoConnectIde")).toBe("Auto Connect Ide");
  });

  it("capitalises an already single word", () => {
    expect(humaniseKey("theme")).toBe("Theme");
  });
});

describe("CLAUDE_CONFIG_KEYS", () => {
  it("carries the key that /config accepts alongside its label", () => {
    const model = CLAUDE_CONFIG_KEYS.find((entry) => entry.key === "model");
    expect(model?.label).toBe("Model");
    expect(CLAUDE_CONFIG_KEYS.find((entry) => entry.key === "autoCompact")?.label).toBe(
      "Auto Compact",
    );
    expect(model?.values).toContain("sonnet");
  });

  it("marks the settings that are only true or false", () => {
    expect(CLAUDE_CONFIG_KEYS.find((entry) => entry.key === "verbose")?.boolean).toBe(true);
  });

  it("does not mark a setting with more than two values as boolean", () => {
    expect(CLAUDE_CONFIG_KEYS.find((entry) => entry.key === "theme")?.boolean).toBe(false);
  });

  it("leaves a free-text setting with no values to offer", () => {
    expect(CLAUDE_CONFIG_KEYS.find((entry) => entry.key === "language")?.values).toEqual([]);
  });

  it("offers model and permissionMode, which the menu routes over the control channel", () => {
    const keys = CLAUDE_CONFIG_KEYS.map((entry) => entry.key);
    expect(keys).toContain("model");
    expect(keys).toContain("permissionMode");
  });
});

describe("PERMISSION_MODES", () => {
  it("lists the modes the CLI accepts, in its own order", () => {
    expect([...PERMISSION_MODES]).toEqual(["default", "plan", "acceptEdits", "auto", "dontAsk"]);
  });
});

describe("describePermissionMode", () => {
  it("names every mode the app can cycle to", () => {
    for (const mode of PERMISSION_MODES) {
      expect(describePermissionMode(mode)).not.toBe("");
      expect(describePermissionMode(mode)).not.toBe(mode);
    }
  });

  it("names bypass mode, which is reachable but not cycled", () => {
    expect(describePermissionMode("bypassPermissions")).toBe("Bypass");
  });

  it("humanises a mode it does not know", () => {
    expect(describePermissionMode("someNewMode")).toBe("Some New Mode");
  });
});

describe("describeFastMode", () => {
  it("says it is on", () => {
    expect(describeFastMode("on", null)).toBe("Fast mode is on");
  });

  it("says it is paused after a rate limit", () => {
    expect(describeFastMode("cooldown", null)).toContain("paused");
  });

  it("is simply off when the CLI gave no reason", () => {
    expect(describeFastMode("off", null)).toBe("Fast mode is off");
  });

  it("explains a reason code in words", () => {
    expect(describeFastMode("off", "sdk_opt_in_required")).toBe(
      "Fast mode is off because the session has not opted in.",
    );
  });

  it("falls back to a generic sentence for an unknown reason code", () => {
    expect(describeFastMode("off", "something_new")).toBe(
      "Fast mode is off because for a reason the CLI did not name.",
    );
  });
});
