import { invoke } from "@tauri-apps/api/core";
import { createDefaultSettings, type Settings } from "../types";

/**
 * Reads the persisted settings.
 *
 * Falls back to defaults when the file is absent or malformed, matching what
 * the Rust side does, so a broken settings file cannot stop the app loading.
 *
 * @returns The stored settings, or defaults.
 */
export async function loadSettings(): Promise<Settings> {
  try {
    return await invoke<Settings>("load_settings");
  } catch {
    return createDefaultSettings();
  }
}

/**
 * Writes the settings to `~/.config/terminice-settings.json`.
 *
 * @param settings - The settings to persist.
 * @returns Nothing, once the write has completed.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  await invoke("save_settings", { settings });
}
