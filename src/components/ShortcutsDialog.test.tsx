import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shortcutGroups } from "../lib/shortcuts";
import { ShortcutsDialog } from "./ShortcutsDialog";

describe("ShortcutsDialog", () => {
  it("lists every shortcut the application answers to", () => {
    render(<ShortcutsDialog onClose={vi.fn()} />);

    for (const group of shortcutGroups()) {
      expect(screen.getByRole("heading", { name: group.title })).toBeInTheDocument();
      for (const shortcut of group.shortcuts) {
        expect(screen.getByText(shortcut.description)).toBeInTheDocument();
      }
    }
  });

  it("names itself, so it is announced as a dialog rather than as loose text", () => {
    render(<ShortcutsDialog onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("takes the keyboard as it opens, so Escape has somewhere to land", () => {
    render(<ShortcutsDialog onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog onClose={onClose} />);

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on the close button", async () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Close shortcuts" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the pointer goes down outside it", async () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog onClose={onClose} />);

    await userEvent.click(document.body);

    expect(onClose).toHaveBeenCalled();
  });

  it("stays open when the pointer goes down inside it", async () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog onClose={onClose} />);

    await userEvent.click(screen.getByText("Keyboard shortcuts"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the keyboard inside, rather than letting Tab walk the window behind", async () => {
    render(<ShortcutsDialog onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "Close shortcuts" });

    await userEvent.tab();
    expect(close).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it("says where each key works, rather than listing keys with no home", () => {
    render(<ShortcutsDialog onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Composer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Transcript" })).toBeInTheDocument();
  });
});
