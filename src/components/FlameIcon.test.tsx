import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlameIcon } from "./FlameIcon";

describe("FlameIcon", () => {
  it("renders a 16px svg by default", () => {
    const { container } = render(<FlameIcon />);
    const icon = container.querySelector("svg");

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("viewBox", "0 0 24 24");
    expect(icon).toHaveAttribute("width", "16");
    expect(icon).toHaveAttribute("height", "16");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("focusable", "false");
  });

  it("uses the size it is given", () => {
    const { container } = render(<FlameIcon size={32} />);
    const icon = container.querySelector("svg");

    expect(icon).toHaveAttribute("width", "32");
    expect(icon).toHaveAttribute("height", "32");
  });

  it("stays hidden from assistive technology", () => {
    render(<FlameIcon />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
