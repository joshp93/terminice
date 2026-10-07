import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedChoice } from "./SegmentedChoice";

const THEMES = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

describe("SegmentedChoice", () => {
  it("renders one button per option, grouped under the label", () => {
    render(<SegmentedChoice label="Theme" value="dark" options={THEMES} onSelect={vi.fn()} />);

    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
  });

  it("presses only the option that is in force", () => {
    render(<SegmentedChoice label="Theme" value="dark" options={THEMES} onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");
  });

  it("gives the option in force the active class and leaves the others plain", () => {
    render(<SegmentedChoice label="Theme" value="light" options={THEMES} onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Light" })).toHaveClass("segment", "active");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveClass("segment");
    expect(screen.getByRole("button", { name: "Dark" })).not.toHaveClass("active");
  });

  it("reports the value whose button was pressed", async () => {
    const onSelect = vi.fn();
    render(<SegmentedChoice label="Theme" value="dark" options={THEMES} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(onSelect).toHaveBeenCalledWith("light");
  });

  it("reports the value even when it is already the one in force", async () => {
    const onSelect = vi.fn();
    render(<SegmentedChoice label="Theme" value="dark" options={THEMES} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(onSelect).toHaveBeenCalledWith("dark");
  });
});
