import { useEffect, useRef, useState } from "react";
import { CogIcon } from "./CogIcon";
import { SegmentedChoice } from "./SegmentedChoice";
import type { Settings } from "../types";

/** Props for {@link SettingsMenu}. */
export type SettingsMenuProps = {
  settings: Settings;
  onChange: (settings: Settings) => void;
};

/**
 * Renders the settings dropdown.
 *
 * Closes on Escape or on a click outside the panel.
 *
 * @param props - The current settings and a change handler.
 * @returns The rendered menu.
 */
export function SettingsMenu({ settings, onChange }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="settings" ref={rootRef}>
      <button
        type="button"
        className={open ? "settings-trigger active" : "settings-trigger"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen((current) => !current)}
      >
        <CogIcon />
      </button>
      {open && (
        <div className="settings-panel" role="dialog" aria-label="Settings">
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
