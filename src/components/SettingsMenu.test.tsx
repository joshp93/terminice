import { fakeVoice } from "@test/fakeVoice";
import { routeInvoke } from "@test/tauriMock";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_FONT_SIZE,
  DEFAULT_COMPOSER_FONT_SIZE,
  FONT_SIZE_STEP,
} from "../lib/fontSize";
import { availableFontFamilies } from "../lib/fonts";
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
  voice: fakeVoice(),
  ...overrides,
});

/** The button that opens one of the font pickers. */
const trigger = (label: string): HTMLElement => screen.getByRole("combobox", { name: label });

/**
 * The family a step through the code list would land on.
 *
 * Read from the list the picker offers rather than written down, so the test
 * says what the step does rather than what the order happens to be.
 *
 * @param family - The family the picker is on.
 * @param delta - 1 for the family below it, -1 for the one above.
 * @returns The family the step lands on.
 */
function neighbourOf(family: string, delta: number): string {
  const families = availableFontFamilies();
  return families[families.indexOf(family) + delta];
}

/**
 * Opens a picker and returns the rows it offers.
 *
 * @param label - The picker to open.
 * @returns The rows, in the order they are shown.
 */
async function openOptions(label: string): Promise<HTMLElement[]> {
  await userEvent.click(trigger(label));
  return screen.getAllByRole("option");
}

/**
 * Opens a picker and takes one of the families it offers.
 *
 * @param label - The picker to open.
 * @param family - The family to choose.
 */
async function chooseFont(label: string, family: string): Promise<void> {
  const option = (await openOptions(label)).find((row) => row.textContent === family);
  if (!option) throw new Error(`${family} is not offered by ${label}`);
  await userEvent.click(option);
}

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
    expect(screen.getByRole("button", { name: "Larger Composer text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Larger Chat text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smaller Composer text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smaller Chat text" })).toBeInTheDocument();
  });

  it("shows the size each is currently set to", () => {
    render(
      <SettingsMenu
        {...menuProps({ settings: settings({ composerFontSize: 15, chatFontSize: 12.5 }) })}
      />,
    );

    expect(screen.getByText("15px")).toBeInTheDocument();
    expect(screen.getByText("12.5px")).toBeInTheDocument();
  });

  it("reports a composer size change without touching the chat size", async () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onChange })} />);

    await userEvent.click(screen.getByRole("button", { name: "Larger Composer text" }));

    expect(onChange).toHaveBeenCalledWith(
      settings({ composerFontSize: DEFAULT_COMPOSER_FONT_SIZE + FONT_SIZE_STEP }),
    );
  });

  it("reports a chat size change without touching the composer size", async () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onChange })} />);

    await userEvent.click(screen.getByRole("button", { name: "Smaller Chat text" }));

    expect(onChange).toHaveBeenCalledWith(
      settings({ chatFontSize: DEFAULT_CHAT_FONT_SIZE - FONT_SIZE_STEP }),
    );
  });

  it("puts each size back to the default it was designed at", async () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...menuProps({ settings: settings({ chatFontSize: 20 }), onChange })} />);

    await userEvent.click(screen.getByRole("button", { name: "Reset Chat text" }));

    expect(onChange).toHaveBeenCalledWith(settings({ chatFontSize: DEFAULT_CHAT_FONT_SIZE }));
  });

  it("offers nothing to restore when a size is already the default", () => {
    render(<SettingsMenu {...menuProps()} />);

    expect(screen.getByRole("button", { name: "Reset Composer text" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset Chat text" })).toBeDisabled();
  });

  it("reports a code font change, leaving the sizes alone", async () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onChange })} />);

    await chooseFont("Code font", "Hack");

    expect(onChange).toHaveBeenCalledWith(settings({ fontFamily: "Hack" }));
  });

  it("reports an app font change, leaving the code font alone", async () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onChange })} />);

    await chooseFont("App font", "Georgia");

    expect(onChange).toHaveBeenCalledWith(settings({ appFontFamily: "Georgia" }));
  });

  it("starts both families on their built-in stack", () => {
    render(<SettingsMenu {...menuProps()} />);

    expect(trigger("Code font")).toHaveTextContent("Built-in (Nerd Font first)");
    expect(trigger("App font")).toHaveTextContent("Built-in (Segoe UI first)");
  });

  it("shows the family in force", () => {
    render(<SettingsMenu {...menuProps({ settings: settings({ appFontFamily: "Georgia" }) })} />);

    expect(trigger("App font")).toHaveTextContent("Georgia");
  });

  it("offers monospace families for code and interface faces for the app", async () => {
    render(<SettingsMenu {...menuProps()} />);

    const code = await openOptions("Code font");
    const app = await openOptions("App font");

    expect(code.map((option) => option.textContent)).toContain("Hack");
    expect(app.map((option) => option.textContent)).toContain("Segoe UI");
    expect(code.map((option) => option.textContent)).not.toContain("Segoe UI");
  });

  it("draws every option in the family it names, which is what the list is for", async () => {
    render(<SettingsMenu {...menuProps()} />);

    const options = await openOptions("Code font");
    const hack = options.find((option) => option.textContent === "Hack");

    expect(hack?.style.fontFamily).toContain("Hack");
    expect(options[0]?.style.fontFamily).toContain("MesloLGLDZ Nerd Font Mono");
  });

  it("shows which section a family came from", async () => {
    render(<SettingsMenu {...menuProps()} />);

    await openOptions("App font");

    expect(screen.getByText("Interface")).toBeInTheDocument();
    expect(screen.getByText("Code and Nerd Fonts")).toBeInTheDocument();
  });

  it("offers a Nerd Font for the app as well as for code", async () => {
    render(<SettingsMenu {...menuProps()} />);

    const app = await openOptions("App font");

    expect(app.map((option) => option.textContent)).toContain("JetBrainsMono Nerd Font");
  });

  it("reports a Nerd Font chosen for the app", async () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onChange })} />);

    await chooseFont("App font", "JetBrainsMono Nerd Font");

    expect(onChange).toHaveBeenCalledWith(settings({ appFontFamily: "JetBrainsMono Nerd Font" }));
  });

  it("changes the family on each arrow press, without waiting to be opened", async () => {
    const onChange = vi.fn();
    render(
      <SettingsMenu {...menuProps({ settings: settings({ fontFamily: "Hack" }), onChange })} />,
    );

    trigger("Code font").focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(onChange).toHaveBeenCalledWith(settings({ fontFamily: neighbourOf("Hack", 1) }));
  });

  it("changes the family on each arrow press with the list open", async () => {
    const onChange = vi.fn();
    render(
      <SettingsMenu {...menuProps({ settings: settings({ fontFamily: "Hack" }), onChange })} />,
    );

    await userEvent.click(trigger("Code font"));
    await userEvent.keyboard("{ArrowUp}");

    expect(onChange).toHaveBeenCalledWith(settings({ fontFamily: neighbourOf("Hack", -1) }));
  });

  it("stops at the ends of the list rather than wrapping round", async () => {
    const onChange = vi.fn();
    const first = availableFontFamilies()[0];
    render(
      <SettingsMenu {...menuProps({ settings: settings({ fontFamily: first }), onChange })} />,
    );

    // The built-in stack sits above the first family, so one press up reaches it.
    trigger("Code font").focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenCalledWith(settings({ fontFamily: "" }));

    onChange.mockClear();
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenCalledWith(settings({ fontFamily: "" }));
  });

  it("takes the hovered family as it is passed over, so the list is a preview", async () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...menuProps({ onChange })} />);

    const options = await openOptions("App font");
    const georgia = options.find((option) => option.textContent === "Georgia");

    fireEvent.mouseMove(georgia as HTMLElement, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(georgia as HTMLElement, { clientX: 40, clientY: 10 });

    expect(onChange).toHaveBeenCalledWith(settings({ appFontFamily: "Georgia" }));
  });

  it("keeps a family that is no longer offered rather than rewriting the choice", async () => {
    render(
      <SettingsMenu
        {...menuProps({ settings: settings({ fontFamily: "A Family That Is Not Installed" }) })}
      />,
    );

    expect(trigger("Code font")).toHaveTextContent("A Family That Is Not Installed");

    const options = await openOptions("Code font");
    expect(options.map((option) => option.textContent)).toContain("A Family That Is Not Installed");
  });
});
