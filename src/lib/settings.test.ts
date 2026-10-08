import { invoke, routeInvoke } from "@test/tauriMock";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { createDefaultSettings } from "../types";
import { loadSettings, saveSettings } from "./settings";

beforeEach(() => {
  routeInvoke("load_settings", () => createDefaultSettings());
  routeInvoke("save_settings", () => null);
});

describe("loadSettings", () => {
  it("returns what the backend stored", async () => {
    routeInvoke("load_settings", () => ({ enterBehaviour: "newline", theme: "light" }));
    await expect(loadSettings()).resolves.toEqual({ enterBehaviour: "newline", theme: "light" });
  });

  it("falls back to the defaults when the file cannot be read", async () => {
    routeInvoke("load_settings", () => {
      throw new Error("malformed settings file");
    });
    await expect(loadSettings()).resolves.toEqual(createDefaultSettings());
  });

  it("asks for the settings with no arguments", async () => {
    await loadSettings();
    expect(invoke).toHaveBeenCalledWith("load_settings");
  });
});

describe("saveSettings", () => {
  it("writes the settings through to the backend", async () => {
    const settings = {
      enterBehaviour: "newline",
      theme: "light",
      composerFontSize: 15,
      chatFontSize: 13,
      fontFamily: "JetBrainsMono Nerd Font",
      appFontFamily: "Georgia",
    } as const;

    await saveSettings({ ...settings });

    expect(invoke).toHaveBeenCalledWith("save_settings", { settings: { ...settings } });
  });

  it("propagates a write failure so the caller can report it", async () => {
    routeInvoke("save_settings", () => {
      throw new Error("disk is full");
    });
    await expect(saveSettings(createDefaultSettings())).rejects.toThrow("disk is full");
  });
});
