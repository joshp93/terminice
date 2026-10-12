import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplitDiff } from "./SplitDiff";

const PATCH = ["@@ -1,2 +1,2 @@", " kept", "-gone", "+arrived"];

const rows = (container: HTMLElement): Element[] => [...container.querySelectorAll(".diff-row")];

const cells = (container: HTMLElement, row: number): Element[] => [
  ...(rows(container)[row]?.querySelectorAll(".diff-cell") ?? []),
];

describe("SplitDiff", () => {
  it("draws a hunk header across the width", () => {
    const { container } = render(<SplitDiff lines={PATCH} />);

    expect(cells(container, 0)).toHaveLength(1);
    expect(container.querySelector(".diff-cell.across")).toHaveTextContent("@@ -1,2 +1,2 @@");
  });

  it("draws every other line as two cells", () => {
    const { container } = render(<SplitDiff lines={PATCH} />);

    expect(cells(container, 1)).toHaveLength(2);
    expect(cells(container, 2)).toHaveLength(2);
  });

  it("puts the removal on the left and the addition that replaced it on the right", () => {
    const { container } = render(<SplitDiff lines={PATCH} />);

    expect(cells(container, 2)[0]?.className).toContain("removal");
    expect(cells(container, 2)[1]?.className).toContain("addition");
  });

  it("shows a line both sides carry in both columns", () => {
    const { container } = render(<SplitDiff lines={PATCH} />);

    expect(cells(container, 1)[0]).toHaveTextContent("kept");
    expect(cells(container, 1)[1]).toHaveTextContent("kept");
  });

  it("marks the side that had no line to show", () => {
    const { container } = render(<SplitDiff lines={["+only"]} />);

    expect(cells(container, 0)[0]?.className).toContain("empty");
    expect(cells(container, 0)[1]?.className).toContain("addition");
  });

  /// The patch's four lines are three rows: the removal and the addition that
  /// took its place share one.
  it("says so when lines are being held back", () => {
    const { container } = render(<SplitDiff lines={PATCH} hidden={9} />);

    const across = [...container.querySelectorAll(".diff-cell.across")];
    expect(rows(container)).toHaveLength(4);
    expect(across.at(-1)).toHaveTextContent("…");
  });
});
