import { describe, expect, it } from "vitest";
import { elapsedLabel } from "./elapsedLabel";

describe("elapsedLabel", () => {
  it("counts seconds while the tool is new", () => {
    expect(elapsedLabel(0)).toBe("0s");
    expect(elapsedLabel(12)).toBe("12s");
    expect(elapsedLabel(59.9)).toBe("59s");
  });

  it("moves to minutes and keeps the seconds two digits wide", () => {
    expect(elapsedLabel(60)).toBe("1m 00s");
    expect(elapsedLabel(65)).toBe("1m 05s");
    expect(elapsedLabel(3599)).toBe("59m 59s");
  });

  it("moves to hours and keeps the minutes two digits wide", () => {
    expect(elapsedLabel(3600)).toBe("1h 00m");
    expect(elapsedLabel(3661)).toBe("1h 01m");
  });

  it("never shows a negative duration", () => {
    expect(elapsedLabel(-5)).toBe("0s");
  });
});
