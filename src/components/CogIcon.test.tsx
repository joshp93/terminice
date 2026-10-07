import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CogIcon } from "./CogIcon";

describe("CogIcon", () => {
  it("renders a 16px svg by default", () => {
    const { container } = render(<CogIcon />);
    const icon = container.querySelector("svg");

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("viewBox", "0 0 24 24");
    expect(icon).toHaveAttribute("width", "16");
    expect(icon).toHaveAttribute("height", "16");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("focusable", "false");
  });

  it("uses the size it is given", () => {
    const { container } = render(<CogIcon size={20} />);
    const icon = container.querySelector("svg");

    expect(icon).toHaveAttribute("width", "20");
    expect(icon).toHaveAttribute("height", "20");
  });

  it("stays hidden from assistive technology", () => {
    render(<CogIcon />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
