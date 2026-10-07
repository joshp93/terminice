import { invoke, routeInvoke } from "@test/tauriMock";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { runShellCommand } from "./shell";

beforeEach(() => {
  routeInvoke("run_shell_command", () => ({ stdout: "", stderr: "", code: 0 }));
});

describe("runShellCommand", () => {
  it("asks the backend to run the command in the directory", async () => {
    await runShellCommand("ls -la", "D:\\apps");
    expect(invoke).toHaveBeenCalledWith("run_shell_command", {
      command: "ls -la",
      cwd: "D:\\apps",
    });
  });

  it("passes a missing directory straight through", async () => {
    await runShellCommand("pwd", null);
    expect(invoke).toHaveBeenCalledWith("run_shell_command", { command: "pwd", cwd: null });
  });

  it("returns what the command produced", async () => {
    routeInvoke("run_shell_command", () => ({ stdout: "out", stderr: "err", code: 2 }));
    await expect(runShellCommand("thing", null)).resolves.toEqual({
      stdout: "out",
      stderr: "err",
      code: 2,
    });
  });

  it("returns an exit code of null when the command was killed rather than exited", async () => {
    routeInvoke("run_shell_command", () => ({ stdout: "", stderr: "", code: null }));
    await expect(runShellCommand("thing", null)).resolves.toMatchObject({ code: null });
  });

  it("propagates a failure so the caller can show it", async () => {
    routeInvoke("run_shell_command", () => {
      throw new Error("no shell was found");
    });
    await expect(runShellCommand("thing", null)).rejects.toThrow("no shell was found");
  });

  it("returns the output in full, leaving any capping to the caller", async () => {
    const huge = "x".repeat(50_000);
    routeInvoke("run_shell_command", () => ({ stdout: huge, stderr: "", code: 0 }));
    await expect(runShellCommand("cat big.log", null)).resolves.toMatchObject({ stdout: huge });
  });
});
