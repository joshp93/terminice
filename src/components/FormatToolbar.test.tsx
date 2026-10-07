import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComposerStatus } from "../lib/createComposer";
import type { StyleState } from "../lib/markdownSpans";
import { type FormatId, formatShortcutLabel } from "../lib/richFormat";
import { FormatToolbar, type FormatToolbarProps } from "./FormatToolbar";

const formatsOf = (...entries: [FormatId, StyleState][]): ReadonlyMap<FormatId, StyleState> =>
  new Map(entries);

const statusOf = (overrides: Partial<ComposerStatus> = {}): ComposerStatus => ({
  formats: formatsOf(),
  listKind: null,
  inCodeBlock: false,
  text: "",
  caret: 0,
  ...overrides,
});

const toolbarProps = (overrides: Partial<FormatToolbarProps> = {}): FormatToolbarProps => ({
  status: statusOf(),
  onToggleFormat: vi.fn(),
  onToggleList: vi.fn(),
  onToggleCodeBlock: vi.fn(),
  ...overrides,
});

describe("FormatToolbar", () => {
  it("keeps its own quiet treatment rather than the green fill", () => {
    render(<FormatToolbar {...toolbarProps()} />);

    for (const name of ["Bold", "Italic", "Strikethrough", "Inline code", "Code block"]) {
      expect(screen.getByRole("button", { name })).not.toHaveClass("green-button");
    }
  });

  it("renders a button for every inline format", () => {
    render(<FormatToolbar {...toolbarProps()} />);

    for (const name of ["Bold", "Italic", "Strikethrough", "Inline code"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("renders the code block and both list buttons", () => {
    render(<FormatToolbar {...toolbarProps()} />);

    expect(screen.getByRole("button", { name: "Code block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bulleted list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Numbered list" })).toBeInTheDocument();
  });

  it("names each format button after its shortcut", () => {
    render(<FormatToolbar {...toolbarProps()} />);

    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "title",
      `Bold (${formatShortcutLabel("bold")})`,
    );
    expect(screen.getByRole("button", { name: "Strikethrough" })).toHaveAttribute(
      "title",
      `Strikethrough (${formatShortcutLabel("strike")})`,
    );
  });

  it("leaves a format button untouched when its style is off", () => {
    render(<FormatToolbar {...toolbarProps()} />);

    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveClass("format-button", "glyph-bold");
    expect(bold).not.toHaveClass("on");
    expect(bold).not.toHaveClass("mixed");
    expect(bold).toHaveAttribute("aria-pressed", "false");
  });

  it("marks a format button on when its style applies throughout", () => {
    render(
      <FormatToolbar
        {...toolbarProps({ status: statusOf({ formats: formatsOf(["bold", "on"]) }) })}
      />,
    );

    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveClass("format-button", "glyph-bold", "on");
    expect(bold).toHaveAttribute("aria-pressed", "true");
  });

  it("marks a format button mixed when its style only partly applies", () => {
    render(
      <FormatToolbar
        {...toolbarProps({ status: statusOf({ formats: formatsOf(["italic", "mixed"]) }) })}
      />,
    );

    const italic = screen.getByRole("button", { name: "Italic" });
    expect(italic).toHaveClass("format-button", "glyph-italic", "mixed");
    expect(italic).not.toHaveClass("on");
    expect(italic).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the code block button on while the caret sits inside one", () => {
    render(<FormatToolbar {...toolbarProps({ status: statusOf({ inCodeBlock: true }) })} />);

    const code = screen.getByRole("button", { name: "Code block" });
    expect(code).toHaveClass("format-button", "on");
    expect(code).toHaveAttribute("aria-pressed", "true");
  });

  it("marks the list button matching the caret's line", () => {
    render(<FormatToolbar {...toolbarProps({ status: statusOf({ listKind: "ordered" }) })} />);

    expect(screen.getByRole("button", { name: "Numbered list" })).toHaveClass(
      "format-button",
      "on",
    );
    expect(screen.getByRole("button", { name: "Numbered list" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Bulleted list" })).toHaveClass("format-button");
    expect(screen.getByRole("button", { name: "Bulleted list" })).not.toHaveClass("on");
  });

  it("reports the format whose button was pressed", async () => {
    const onToggleFormat = vi.fn();
    render(<FormatToolbar {...toolbarProps({ onToggleFormat })} />);

    await userEvent.click(screen.getByRole("button", { name: "Strikethrough" }));

    expect(onToggleFormat).toHaveBeenCalledWith("strike");
  });

  it("reports the list kind whose button was pressed", async () => {
    const onToggleList = vi.fn();
    render(<FormatToolbar {...toolbarProps({ onToggleList })} />);

    await userEvent.click(screen.getByRole("button", { name: "Bulleted list" }));

    expect(onToggleList).toHaveBeenCalledWith("bullet");
  });

  it("reports a code block toggle", async () => {
    const onToggleCodeBlock = vi.fn();
    render(<FormatToolbar {...toolbarProps({ onToggleCodeBlock })} />);

    await userEvent.click(screen.getByRole("button", { name: "Code block" }));

    expect(onToggleCodeBlock).toHaveBeenCalledTimes(1);
  });

  it("cancels the pointer press so the editor keeps focus", () => {
    render(<FormatToolbar {...toolbarProps()} />);

    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Bold" }))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Code block" }))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Numbered list" }))).toBe(false);
  });
});
