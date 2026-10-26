import { describe, expect, it } from "vitest";
import { describeToolDescription } from "./describeToolDescription";

describe("describeToolDescription", () => {
  it("reads the description a tool call gave itself", () => {
    expect(describeToolDescription({ command: "ls", description: "List the files" })).toBe(
      "List the files",
    );
  });

  it("keeps the first line and trims it", () => {
    expect(describeToolDescription({ description: "  List the files\nand more  " })).toBe(
      "List the files",
    );
  });

  it("has nothing to say when the input carries no description", () => {
    expect(describeToolDescription({ command: "ls" })).toBe("");
    expect(describeToolDescription({ description: 42 })).toBe("");
    expect(describeToolDescription(null)).toBe("");
    expect(describeToolDescription("ls")).toBe("");
  });
});
