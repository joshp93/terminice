import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffLayoutProvider } from "./DiffLayoutContext";
import { DiffView } from "./DiffView";

/// jsdom offers no canvas, so a character would measure as nothing wide and
/// every patch would fall back to one column. The measuring is not what these
/// tests are about; the decision it feeds is.
vi.mock("../lib/characterWidth", () => ({ characterWidth: () => 8 }));

const PATCH = ["@@ -1,2 +1,2 @@", " kept", "-gone", "+arrived"];

/** The longest line is 201 characters, which is past anything worth a column. */
const TOO_LONG = [`@@ -1 +1 @@`, `-${"x".repeat(200)}`];

/** Pretends the card has been laid out at a given width. */
function laidOutAt(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 0,
    top: 0,
    right: width,
    bottom: 0,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("DiffView", () => {
  it("draws two columns when the card is wide enough for this patch", () => {
    laidOutAt(700);
    const { container } = render(<DiffView lines={PATCH} />);

    expect(container.querySelector(".diff.split")).not.toBeNull();
    expect(container.querySelectorAll(".diff-row").length).toBeGreaterThan(0);
  });

  it("draws one column when the card is too narrow for two", () => {
    laidOutAt(200);
    const { container } = render(<DiffView lines={PATCH} />);

    expect(container.querySelector(".diff.split")).toBeNull();
    expect(container.querySelectorAll(".diff-line")).toHaveLength(4);
  });

  /// The answer is about the patch as much as the card: a width that fits short
  /// lines does not fit long ones.
  it("draws one column for lines too long to compare in the same width", () => {
    laidOutAt(700);
    const { container } = render(<DiffView lines={TOO_LONG} />);

    expect(container.querySelector(".diff.split")).toBeNull();
  });

  it("draws one column when the reader has asked for one", () => {
    laidOutAt(700);
    const { container } = render(
      <DiffLayoutProvider sideBySide={false}>
        <DiffView lines={PATCH} />
      </DiffLayoutProvider>,
    );

    expect(container.querySelector(".diff.split")).toBeNull();
  });

  it("wants two columns when nothing says otherwise", () => {
    laidOutAt(700);
    const { container } = render(<DiffView lines={PATCH} />);

    expect(container.querySelector(".diff.split")).not.toBeNull();
  });
});
