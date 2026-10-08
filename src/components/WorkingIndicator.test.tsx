import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkingIndicator } from "./WorkingIndicator";

describe("WorkingIndicator", () => {
  it("shows what it was given to say", () => {
    render(<WorkingIndicator label="Thinking… 1,500 tokens" />);
    expect(screen.getByText("Thinking… 1,500 tokens")).toBeInTheDocument();
  });

  it("shows the mark beside the words", () => {
    const { container } = render(<WorkingIndicator label="Working…" />);
    expect(container.querySelector(".working-mark")).not.toBeNull();
  });

  it("hides the mark from a reader, because it only repeats the words", () => {
    const { container } = render(<WorkingIndicator label="Working…" />);
    expect(container.querySelector(".working-mark")).toHaveAttribute("aria-hidden", "true");
  });
});
