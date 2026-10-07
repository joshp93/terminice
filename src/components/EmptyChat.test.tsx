import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyChat } from "./EmptyChat";

describe("EmptyChat", () => {
  it("renders the placeholder caption", () => {
    render(<EmptyChat />);
    expect(screen.getByText("Do you like my nice green jacket?")).toBeInTheDocument();
  });

  it("shows a decorative logo", () => {
    const { container } = render(<EmptyChat />);
    expect(container.querySelector(".chat-empty")).not.toBeNull();
    expect(container.querySelector(".chat-empty-logo")).not.toBeNull();
  });

  it("hides the logo from assistive technology", () => {
    const { container } = render(<EmptyChat />);
    const logo = container.querySelector(".chat-empty-logo");
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(logo).toHaveAttribute("draggable", "false");
  });

  it("exposes no image to the accessibility tree", () => {
    render(<EmptyChat />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
