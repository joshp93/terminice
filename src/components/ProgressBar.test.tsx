import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("exposes itself as a progress bar named by its label", () => {
    render(<ProgressBar label="Compacting 12,000 tokens…" />);
    expect(
      screen.getByRole("progressbar", { name: "Compacting 12,000 tokens…" }),
    ).toBeInTheDocument();
  });

  it("carries the label as its value text", () => {
    render(<ProgressBar label="Compacting…" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Compacting…");
  });

  it("reports no percentage, because a compaction has none", () => {
    render(<ProgressBar label="Compacting…" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).not.toHaveAttribute("aria-valuemin");
    expect(bar).not.toHaveAttribute("aria-valuemax");
  });

  it("shows the label beside the bar", () => {
    render(<ProgressBar label="Compacting…" />);
    expect(screen.getByText("Compacting…")).toBeInTheDocument();
  });

  it("renders a track and a sweeping fill", () => {
    const { container } = render(<ProgressBar label="Compacting…" />);
    expect(container.querySelector(".progress-track .progress-fill")).not.toBeNull();
  });
});
