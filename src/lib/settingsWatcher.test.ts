import { afterEach, describe, expect, it, vi } from "vitest";

/** The event bridge the watcher listens on, with the handler it was given. */
const tauri = vi.hoisted(() => ({
  listen: vi.fn(async (_event: string, handler: () => void) => {
    tauri.handler = handler;
    return tauri.unlisten;
  }),
  unlisten: vi.fn(),
  handler: null as null | (() => void),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

const { watchSettingsFile } = await import("./settingsWatcher");

afterEach(() => {
  vi.clearAllMocks();
  tauri.handler = null;
});

describe("watchSettingsFile", () => {
  it("listens for the event the backend announces a change with", async () => {
    watchSettingsFile(() => undefined);
    await vi.waitFor(() => expect(tauri.listen).toHaveBeenCalled());

    expect(tauri.listen.mock.calls[0][0]).toBe("settings-changed");
  });

  it("calls back when the file changes", async () => {
    const onChange = vi.fn();
    watchSettingsFile(onChange);
    await vi.waitFor(() => expect(tauri.handler).not.toBeNull());

    tauri.handler?.();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops listening when it is told to", async () => {
    const onChange = vi.fn();
    const stop = watchSettingsFile(onChange);
    await vi.waitFor(() => expect(tauri.handler).not.toBeNull());

    stop();

    expect(tauri.unlisten).toHaveBeenCalledTimes(1);
  });

  /// Stopping before the listener exists still stops it: the promise may not
  /// have resolved when the component goes away.
  it("unlistens if it is stopped before the listener is ready", async () => {
    const stop = watchSettingsFile(() => undefined);
    stop();

    await vi.waitFor(() => expect(tauri.unlisten).toHaveBeenCalledTimes(1));
  });

  /// A browser with no backend under it has nothing to watch, and that is not a
  /// reason for the window to fail to render.
  it("says nothing when there is nothing to listen to", async () => {
    tauri.listen.mockRejectedValueOnce(new Error("no backend"));

    expect(() => watchSettingsFile(() => undefined)).not.toThrow();
    await vi.waitFor(() => expect(tauri.listen).toHaveBeenCalled());
  });
});
