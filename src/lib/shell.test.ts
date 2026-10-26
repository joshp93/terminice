import type { Channel as TauriChannel } from "@tauri-apps/api/core";
import { Channel, invoke, routeInvoke } from "@test/tauriMock";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { runShellCommand, type ShellEvent, stopShellCommand } from "./shell";

/** A Channel the mocked bridge will drive, typed as the one the app passes. */
const channel = (): TauriChannel<ShellEvent> =>
  new Channel<ShellEvent>() as unknown as TauriChannel<ShellEvent>;

beforeEach(() => {
  routeInvoke("run_shell_command", () => null);
  routeInvoke("stop_shell_command", () => true);
});

describe("runShellCommand", () => {
  it("asks the backend to run the command in the directory, on the channel", async () => {
    const events = channel();
    await runShellCommand("shell-1", "ls -la", "D:\\apps", events);

    expect(invoke).toHaveBeenCalledWith("run_shell_command", {
      id: "shell-1",
      command: "ls -la",
      cwd: "D:\\apps",
      onEvent: events,
    });
  });

  it("passes a missing directory straight through", async () => {
    await runShellCommand("shell-1", "pwd", null, channel());

    expect(invoke).toHaveBeenCalledWith("run_shell_command", {
      id: "shell-1",
      command: "pwd",
      cwd: null,
      onEvent: expect.any(Channel),
    });
  });

  it("propagates a failure so the caller can show it", async () => {
    routeInvoke("run_shell_command", () => {
      throw new Error("no shell was found");
    });

    await expect(runShellCommand("shell-1", "thing", null, channel())).rejects.toThrow(
      "no shell was found",
    );
  });
});

describe("stopShellCommand", () => {
  it("names the command it wants stopped", async () => {
    await expect(stopShellCommand("shell-1")).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledWith("stop_shell_command", { id: "shell-1" });
  });

  it("reports a command that had already finished", async () => {
    routeInvoke("stop_shell_command", () => false);

    await expect(stopShellCommand("shell-1")).resolves.toBe(false);
  });

  it("propagates a failure so the caller can show it", async () => {
    routeInvoke("stop_shell_command", () => {
      throw new Error("the backend is gone");
    });

    await expect(stopShellCommand("shell-1")).rejects.toThrow("the backend is gone");
  });
});
