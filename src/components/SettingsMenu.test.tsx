import { routeInvoke } from "@test/tauriMock";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { loadSettings, saveSettings } from "../lib/settings";
import { createDefaultSettings, type Settings } from "../types";
import { SettingsMenu, type SettingsMenuProps } from "./SettingsMenu";

/** Settings to render with, so a new field does not have to be added here. */
const settings = (overrides: Partial<Settings> = {}): Settings => ({
  ...createDefaultSettings(),
  ...overrides,
});

const menuProps = (overrides: Partial<SettingsMenuProps> = {}): SettingsMenuProps => ({
  settings: settings(),
  onChange: vi.fn(),
  open: true,
  onOpenChange: vi.fn(),
  ...overrides,
});

describe("SettingsMenu", () => {
  it("shows no panel until the trigger is pressed", async () => {
    const onOpenChange = vi.fn();
    render(<SettingsMenu {...menuProps({ open: false, onOpenChange })} />);

    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("shows both settings, pressing the values that are in force", () => {
    render(
      <SettingsMenu
        {...menuProps({ settings: settings({ enterBehaviour: "newline", theme: "light" }) })}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New line" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Sends" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports a theme change, leaving the Enter behaviour alone", async () => {
    const onChange = vi.fn();
    render(
      <SettingsMenu
        {...menuProps({
          settings: settings({ enterBehaviour: "newline", theme: "dark" }),
          onChange,
        })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(onChange).toHaveBeenCalledWith(settings({ enterBehaviour: "newline", theme: "light" }));
  });

  it("reports an Enter behaviour change, leaving the theme alone", async () => {
    const onChange = vi.fn();
    render(
      <SettingsMenu
        {...menuProps({ settings: settings({ enterBehaviour: "send", theme: "light" }), onChange })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "New line" }));

    expect(onChange).toHaveBeenCalledWith(settings({ enterBehaviour: "newline", theme: "light" }));
  });

  it("puts the keyboard on the first control when it opens", () => {
    render(<SettingsMenu {...menuProps()} />);

    expect(screen.getByRole("button", { name: "Sends" })).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const onOpenChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onOpenChange })} />);

    await userEvent.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes when the pointer goes down outside the panel", () => {
    const onOpenChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onOpenChange })} />);

    fireEvent.pointerDown(document.body);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open when the pointer goes down inside the panel", () => {
    const onOpenChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onOpenChange })} />);

    fireEvent.pointerDown(screen.getByRole("dialog", { name: "Settings" }));

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("falls back to the defaults when the stored settings cannot be read", async () => {
    routeInvoke("load_settings", () => {
      throw new Error("no settings file");
    });

    const settings = await loadSettings();
    render(<SettingsMenu {...menuProps({ settings })} />);

    expect(screen.getByRole("button", { name: "Sends" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });

  it("persists a change through the save_settings command", async () => {
    const saved: Settings[] = [];
    routeInvoke("save_settings", (args) => {
      saved.push(args.settings as Settings);
    });

    const onChange = vi.fn((next: Settings) => {
      void saveSettings(next);
    });
    render(<SettingsMenu {...menuProps({ onChange })} />);

    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    const expected = settings({ theme: "light" });
    expect(onChange).toHaveBeenCalledWith(expected);
    await waitFor(() => expect(saved).toEqual([expected]));
  });

  it("offers a size for the composer and a size for the chat, separately", () => {
    render(<SettingsMenu {...menuProps()} />);

    expect(screen.getByText("Composer text")).toBeInTheDocument();
    expect(screen.getByText("Chat text")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Small" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Medium" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Large" })).toHaveLength(2);
  });

  it("reports a composer size change without touching the chat size", async () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onChange })} />);

    const [composerLarge] = screen.getAllByRole("button", { name: "Large" });
    await userEvent.click(composerLarge);

    expect(onChange).toHaveBeenCalledWith(
      settings({ composerFontSize: "large", chatFontSize: "medium" }),
    );
  });

  it("reports a chat size change without touching the composer size", async () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onChange })} />);

    const [, chatLarge] = screen.getAllByRole("button", { name: "Large" });
    await userEvent.click(chatLarge);

    expect(onChange).toHaveBeenCalledWith(
      settings({ composerFontSize: "medium", chatFontSize: "large" }),
    );
  });

  it("presses the sizes that are in force", () => {
    render(
      <SettingsMenu
        {...menuProps({ settings: settings({ composerFontSize: "small", chatFontSize: "large" }) })}
      />,
    );

    const small = screen.getAllByRole("button", { name: "Small" });
    const large = screen.getAllByRole("button", { name: "Large" });

    expect(small[0]).toHaveAttribute("aria-pressed", "true");
    expect(small[1]).toHaveAttribute("aria-pressed", "false");
    expect(large[0]).toHaveAttribute("aria-pressed", "false");
    expect(large[1]).toHaveAttribute("aria-pressed", "true");
  });
});
