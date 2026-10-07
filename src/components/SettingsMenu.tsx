import { useEffect, useRef } from "react";
import type { Settings } from "../types";
import { CogIcon } from "./CogIcon";
import { SegmentedChoice } from "./SegmentedChoice";

/** Props for {@link SettingsMenu}. */
export type SettingsMenuProps = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Renders the settings dropdown.
 *
 * Closes on Escape or on a click outside the panel. The open state is owned by
 * the caller so the slash menu can open it too.
 *
 * @param props - The current settings, a change handler, and the open state.
 * @returns The rendered menu.
 */
export function SettingsMenu({ settings, onChange, open, onOpenChange }: SettingsMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const controls = (): HTMLElement[] => {
      const panel = panelRef.current;
      if (!panel) return [];
      return Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled])"));
    };

    controls()[0]?.focus();

    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = controls();
      if (focusable.length === 0) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      const next = (current + step + focusable.length) % focusable.length;
      focusable[next]?.focus();
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  return (
    <div className="settings" ref={rootRef}>
      <button
        type="button"
        className={open ? "settings-trigger active" : "settings-trigger"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
        onClick={() => onOpenChange(!open)}
      >
        <CogIcon />
      </button>
      {open && (
        <div
          className="settings-panel"
          role="dialog"
          aria-label="Settings"
          ref={panelRef}
          tabIndex={-1}
        >
          <SegmentedChoice
            label="Enter key"
            value={settings.enterBehaviour}
            options={[
              { value: "send", label: "Sends" },
              { value: "newline", label: "New line" },
            ]}
            onSelect={(enterBehaviour) => onChange({ ...settings, enterBehaviour })}
          />
          <SegmentedChoice
            label="Theme"
            value={settings.theme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onSelect={(theme) => onChange({ ...settings, theme })}
          />
          <p className="settings-note">Settings are stored in ~/.config/terminice-settings.json.</p>
        </div>
      )}
    </div>
  );
}
