import { describe, expect, it } from "vitest";
import { compactLabel, turnLabel } from "./turnStatus";

describe("turnLabel", () => {
  it("says the turn is working when nothing has been counted", () => {
    expect(turnLabel(0)).toBe("Working…");
  });

  it("counts the reasoning tokens once there are some", () => {
    expect(turnLabel(1500)).toBe("Thinking… 1,500 tokens");
  });

  it("counts a single token without a separator", () => {
    expect(turnLabel(1)).toBe("Thinking… 1 tokens");
  });
});

describe("compactLabel", () => {
  it("says only that a compaction is running when the size is unknown", () => {
    expect(compactLabel(null)).toBe("Compacting…");
  });

  it("names the size it is summarising", () => {
    expect(compactLabel(24000)).toBe("Compacting 24,000 tokens…");
  });

  it("treats an empty context as a size rather than as unknown", () => {
    expect(compactLabel(0)).toBe("Compacting 0 tokens…");
  });
});
