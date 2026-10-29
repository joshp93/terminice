import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiffLines } from "./DiffLines";

const PATCH = ["@@ -1,2 +1,2 @@", " kept", "-gone", "+arrived"];

describe("DiffLines", () => {
  it("marks every line with what it is", () => {
    const { container } = render(<DiffLines lines={PATCH} />);

    const classes = [...container.querySelectorAll(".diff-line")].map((line) => line.className);

    expect(classes).toEqual([
      "diff-line plain",
      "diff-line plain",
      "diff-line removal",
      "diff-line addition",
    ]);
  });

  /// Each line is an element of its own, which is what lets a tint run the width
  /// of the card rather than stopping at the last character on the line. The box
  /// around them belongs to the caller, which is what gets measured.
  it("draws a line as its own element", () => {
    const { container } = render(<DiffLines lines={PATCH} />);

    expect(container.querySelectorAll(":scope > .diff-line")).toHaveLength(4);
  });

  it("keeps the text of a line exactly as the patch wrote it", () => {
    const { container } = render(<DiffLines lines={PATCH} />);

    expect(container.querySelector(".diff-line.removal")).toHaveTextContent("-gone");
    expect(container.querySelector(".diff-line.addition")).toHaveTextContent("+arrived");
  });

  it("says so when lines are being held back", () => {
    const { container } = render(<DiffLines lines={PATCH} hidden={12} />);

    expect(container.querySelectorAll(".diff-line")).toHaveLength(5);
    expect(container.querySelector(".diff-line.plain:last-child")).toHaveTextContent("…");
  });

  it("adds no ellipsis when nothing is held back", () => {
    const { container } = render(<DiffLines lines={PATCH} />);

    expect(container.textContent).not.toContain("…");
  });

  /// A line that differs by one character marks that character, not the line:
  /// the line's own tint already says which side of the edit it is on.
  it("marks only the characters that changed", () => {
    const { container } = render(
      <DiffLines lines={["@@ -1 +1 @@", "-const a = 1;", "+const a = 2;"]} />,
    );

    const marks = [...container.querySelectorAll("mark.diff-mark")].map((mark) => mark.textContent);
    expect(marks).toEqual(["1", "2"]);
  });

  it("draws a patch in the language its file names", () => {
    const { container } = render(
      <DiffLines lines={["+++ b/src/app.ts", "@@ -1 +1 @@", "-const a = 1;", "+const a = 2;"]} />,
    );

    expect(container.querySelector(".diff-line.addition .hljs-keyword")).toHaveTextContent("const");
  });
});
