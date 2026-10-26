import { channels, invoke, lastChannel, routeInvoke, sessionChannel } from "@test/tauriMock";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { MAX_DISPLAY_OUTPUT } from "../lib/outputLimits";
import type { ChatEntry } from "../types";
import { useClaudeChat } from "./useClaudeChat";

const CWD = "D:\\apps\\terminice";

/** Every line the app has written to a session, already decoded. */
function sentLines(): Array<Record<string, unknown>> {
  return invoke.mock.calls
    .filter(([command]) => command === "send_claude_line")
    .map(([, args]) => JSON.parse((args as { line: string }).line) as Record<string, unknown>);
}

/** The most recent line of a given type, or undefined. */
function lastSent(type: string): Record<string, unknown> | undefined {
  return sentLines()
    .filter((line) => line.type === type)
    .pop();
}

/** Every control request the app has sent, by subtype. */
function sentRequests(subtype: string): Array<Record<string, unknown>> {
  return sentLines()
    .filter((line) => line.type === "control_request")
    .map((line) => line.request as Record<string, unknown>)
    .filter((request) => request?.subtype === subtype);
}

/** The request id of the newest control request of a given subtype. */
function requestIdOf(subtype: string): string {
  const request = sentRequests(subtype).pop();
  if (!request) throw new Error(`no ${subtype} request was sent`);
  const line = sentLines()
    .filter(
      (entry) =>
        entry.type === "control_request" &&
        (entry.request as { subtype: string }).subtype === subtype,
    )
    .pop();
  return line?.request_id as string;
}

/** Delivers one streamed event to the session the app started. */
function emit(message: unknown): void {
  act(() => {
    sessionChannel().emit({ kind: "line", line: JSON.stringify(message) });
  });
}

/** Answers a control request the app sent. */
function reply(subtype: string, response: unknown): void {
  emit({
    type: "control_response",
    response: { subtype: "success", request_id: requestIdOf(subtype), response },
  });
}

const entries = (list: ChatEntry[], role: ChatEntry["role"]): ChatEntry[] =>
  list.filter((entry) => entry.role === role);

/** Delivers one event from the local command the app started. */
function emitShell(event: {
  kind: "stdout" | "stderr" | "exit";
  chunk?: string;
  code?: number | null;
  stopped?: boolean;
}): void {
  act(() => {
    lastChannel()?.emit(event);
  });
}

/** A command that has finished, with everything it printed already delivered. */
function finishShell(): void {
  emitShell({ kind: "exit", code: 0, stopped: false });
}

/** Mounts the hook and waits for the first session to be running. */
async function mount(cwd: string | null = CWD) {
  const view = renderHook(() => useClaudeChat(cwd));
  if (cwd === null) return view;
  await waitFor(() => expect(view.result.current.status).toBe("running"));
  return view;
}

/** Replaces the `start_claude` route so later spawns can be held open. */
function holdLaterSpawns(): { release: (id: string) => void; calls: () => number } {
  let calls = 0;
  const waiting: Array<(id: string) => void> = [];
  routeInvoke("start_claude", () => {
    calls += 1;
    if (calls === 1) return "session-a";
    return new Promise<string>((resolve) => waiting.push(resolve));
  });
  return { release: (id) => waiting.shift()?.(id), calls: () => calls };
}

beforeEach(() => {
  let spawns = 0;
  routeInvoke("start_claude", () => {
    spawns += 1;
    return `session-${String.fromCharCode(96 + spawns)}`;
  });
  routeInvoke("send_claude_line", () => null);
  routeInvoke("close_claude", () => null);
  routeInvoke("list_sessions", () => []);
  routeInvoke("read_session_replay", () => []);
  routeInvoke("take_interrupted", () => null);
  routeInvoke("remember_interrupted", () => null);
  routeInvoke("forget_interrupted", () => null);
  routeInvoke("run_shell_command", () => ({ stdout: "", stderr: "", code: 0 }));
});

describe("mounting", () => {
  it("stays inert until a directory is known", async () => {
    const view = await mount(null);
    expect(invoke).not.toHaveBeenCalledWith("start_claude", expect.anything());
    expect(view.result.current.state.entries).toEqual([]);
  });

  it("starts a session and becomes active", async () => {
    const view = await mount();
    expect(view.result.current.status).toBe("running");
    expect(channels).toHaveLength(1);
  });

  it("hands the session the directory it was given", async () => {
    await mount();
    const call = invoke.mock.calls.find(([command]) => command === "start_claude");
    expect(call?.[1]).toMatchObject({ cwd: CWD, resume: null });
  });

  it("handshakes without waiting to be asked", async () => {
    await mount();
    expect(sentRequests("initialize")).toHaveLength(1);
  });

  it("shows a failed start rather than an empty session", async () => {
    routeInvoke("start_claude", () => {
      throw new Error("no claude on PATH");
    });
    const view = renderHook(() => useClaudeChat(CWD));

    await waitFor(() => expect(view.result.current.status).toBe("unavailable"));
    expect(entries(view.result.current.state.entries, "error")).toHaveLength(1);
  });

  it("closes every session when it unmounts", async () => {
    const view = await mount();
    view.unmount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("close_claude", { id: "session-a" }));
  });
});

describe("the initialize handshake", () => {
  it("records the catalogue the CLI answers with", async () => {
    const view = await mount();
    reply("initialize", {
      commands: [{ name: "doctor", description: "Check things", argumentHint: "" }],
      current_permission_mode: "plan",
    });

    await waitFor(() => expect(view.result.current.state.catalogue).not.toBeNull());
    expect(view.result.current.state.permissionMode).toBe("plan");
  });

  it("asks for the context reading and the MCP list", async () => {
    await mount();
    reply("initialize", {});
    await waitFor(() => expect(sentRequests("get_context_usage")).toHaveLength(1));
    expect(sentRequests("mcp_status")).toHaveLength(1);
  });

  it("reports a rejected handshake as a notice", async () => {
    const view = await mount();
    act(() => {
      sessionChannel().emit({
        kind: "line",
        line: JSON.stringify({
          type: "control_response",
          response: { subtype: "error", request_id: requestIdOf("initialize"), error: "bad" },
        }),
      });
    });

    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "notice")).toHaveLength(1),
    );
  });

  it("reads the model from the context reading, not from the value asked for", async () => {
    const view = await mount();
    reply("initialize", {});
    reply("get_context_usage", {
      totalTokens: 10,
      maxTokens: 100,
      percentage: 10,
      model: "claude-sonnet-5-5",
    });

    await waitFor(() => expect(view.result.current.state.model).toBe("claude-sonnet-5-5"));
  });

  it("recovers a prompt the CLI was still holding", async () => {
    const view = await mount();
    act(() => {
      sessionChannel().emit({
        kind: "line",
        line: JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestIdOf("initialize"),
            response: {},
            pending_permission_requests: [
              {
                type: "control_request",
                request_id: "held-1",
                request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } },
              },
            ],
          },
        }),
      });
    });

    await waitFor(() => expect(view.result.current.prompt).not.toBeNull());
    expect(view.result.current.prompt?.toolName).toBe("Bash");
  });
});

describe("sending a message", () => {
  it("records the message and writes it to the session", async () => {
    const view = await mount();
    act(() => view.result.current.send("hello"));

    await waitFor(() => expect(entries(view.result.current.state.entries, "user")).toHaveLength(1));
    expect(lastSent("user")).toMatchObject({
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
  });

  it("ignores an empty message", async () => {
    const view = await mount();
    act(() => view.result.current.send("   "));
    expect(lastSent("user")).toBeUndefined();
  });

  it("holds locally run command output back until the next message", async () => {
    const view = await mount();
    routeInvoke("run_shell_command", () => null);

    act(() => view.result.current.runShell("ls"));
    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "shell")).toHaveLength(1),
    );

    emitShell({ kind: "stdout", chunk: "total 0" });
    finishShell();
    await waitFor(() => {
      const [shell] = entries(view.result.current.state.entries, "shell");
      expect(shell?.role === "shell" && shell.running).toBe(false);
    });

    expect(lastSent("user")).toBeUndefined();

    act(() => view.result.current.send("what is here?"));

    await waitFor(() => expect(lastSent("user")).toBeDefined());
    const payload = (lastSent("user") as { message: { content: Array<{ text: string }> } }).message
      .content[0].text;

    expect(payload).toContain("<bash-input> ls</bash-input>");
    expect(payload).toContain("<bash-stdout>total 0</bash-stdout>");
    expect(payload).toContain("<bash-exit-code>0</bash-exit-code>");
    expect(payload.endsWith("what is here?")).toBe(true);
  });

  it("does not carry command output into a session started afterwards", async () => {
    const view = await mount();
    routeInvoke("run_shell_command", () => null);

    act(() => view.result.current.runShell("ls"));
    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "shell")).toHaveLength(1),
    );
    emitShell({ kind: "stdout", chunk: "leftover" });
    finishShell();
    await waitFor(() => {
      const [shell] = entries(view.result.current.state.entries, "shell");
      expect(shell?.role === "shell" && shell.running).toBe(false);
    });

    act(() => view.result.current.startNew());
    await waitFor(() => expect(view.result.current.status).toBe("running"));

    act(() => view.result.current.send("fresh"));

    await waitFor(() => expect(lastSent("user")).toBeDefined());
    const payload = (lastSent("user") as { message: { content: Array<{ text: string }> } }).message
      .content[0].text;
    expect(payload).toBe("fresh");
  });
});

describe("running a local command", () => {
  it("keeps the whole output for the transcript and caps only what the model is given", async () => {
    const view = await mount();
    const huge = "x".repeat(31_000);
    routeInvoke("run_shell_command", () => null);

    act(() => view.result.current.runShell("cat big.log"));
    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "shell")).toHaveLength(1),
    );
    emitShell({ kind: "stdout", chunk: huge });
    finishShell();
    await waitFor(() => {
      const [shell] = entries(view.result.current.state.entries, "shell");
      expect(shell?.role === "shell" && shell.running).toBe(false);
    });

    const [shell] = entries(view.result.current.state.entries, "shell");
    expect(shell.role === "shell" && shell.stdout).toBe(huge);

    act(() => view.result.current.send("done"));
    await waitFor(() => expect(lastSent("user")).toBeDefined());

    const payload = (lastSent("user") as { message: { content: Array<{ text: string }> } }).message
      .content[0].text;
    expect(payload).toContain("… output truncated at 30000 bytes");
    expect(payload.length).toBeLessThan(huge.length);
  });

  it("bounds what the transcript keeps when a command floods it", async () => {
    const view = await mount();
    routeInvoke("run_shell_command", () => null);

    act(() => view.result.current.runShell("cat huge.log"));
    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "shell")).toHaveLength(1),
    );
    emitShell({ kind: "stdout", chunk: "x".repeat(MAX_DISPLAY_OUTPUT + 500) });
    finishShell();
    await waitFor(() => {
      const [shell] = entries(view.result.current.state.entries, "shell");
      expect(shell?.role === "shell" && shell.running).toBe(false);
    });

    const [shell] = entries(view.result.current.state.entries, "shell");
    if (shell.role !== "shell") throw new Error("expected a shell entry");
    expect(shell.stdout).toContain("truncated for display");
    expect(shell.stdout.length).toBeLessThan(MAX_DISPLAY_OUTPUT + 200);
  });

  it("caps the transcript and the model independently", async () => {
    const view = await mount();
    routeInvoke("run_shell_command", () => null);

    act(() => view.result.current.runShell("cat huge.log"));
    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "shell")).toHaveLength(1),
    );
    emitShell({ kind: "stdout", chunk: "x".repeat(MAX_DISPLAY_OUTPUT + 500) });
    finishShell();
    await waitFor(() => {
      const [shell] = entries(view.result.current.state.entries, "shell");
      expect(shell?.role === "shell" && shell.running).toBe(false);
    });

    act(() => view.result.current.send("done"));
    await waitFor(() => expect(lastSent("user")).toBeDefined());

    const payload = (lastSent("user") as { message: { content: Array<{ text: string }> } }).message
      .content[0].text;
    expect(payload).toContain("… output truncated at 30000 bytes");
    expect(payload).not.toContain("truncated for display");
  });

  it("shows output while the command is still running", async () => {
    const view = await mount();
    routeInvoke("run_shell_command", () => null);

    act(() => view.result.current.runShell("long"));
    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "shell")).toHaveLength(1),
    );

    emitShell({ kind: "stdout", chunk: "halfway" });

    const [shell] = entries(view.result.current.state.entries, "shell");
    if (shell.role !== "shell") throw new Error("expected a shell entry");
    expect(shell.running).toBe(true);
    expect(shell.stdout).toBe("halfway");

    finishShell();
  });

  it("stops a running command by the name it was started under", async () => {
    const view = await mount();
    routeInvoke("run_shell_command", () => null);
    routeInvoke("stop_shell_command", () => true);

    act(() => view.result.current.runShell("sleep 30"));
    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "shell")).toHaveLength(1),
    );

    const [shell] = entries(view.result.current.state.entries, "shell");
    if (shell.role !== "shell") throw new Error("expected a shell entry");
    act(() => view.result.current.stopShell(shell.id));

    expect(invoke).toHaveBeenCalledWith("stop_shell_command", { id: shell.id });

    emitShell({ kind: "exit", code: null, stopped: true });

    await waitFor(() => {
      const [stopped] = entries(view.result.current.state.entries, "shell");
      if (stopped.role !== "shell") throw new Error("expected a shell entry");
      expect(stopped.running).toBe(false);
      expect(stopped.stopped).toBe(true);
    });
  });

  it("records the exit code of a failing command", async () => {
    const view = await mount();
    routeInvoke("run_shell_command", () => null);

    act(() => view.result.current.runShell("nope"));
    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "shell")).toHaveLength(1),
    );
    emitShell({ kind: "stderr", chunk: "not found" });
    emitShell({ kind: "exit", code: 127, stopped: false });

    await waitFor(() => {
      const [shell] = entries(view.result.current.state.entries, "shell");
      expect(shell?.role === "shell" && shell.code).toBe(127);
    });
  });

  it("records a command that could not be run at all", async () => {
    const view = await mount();
    routeInvoke("run_shell_command", () => {
      throw new Error("no shell was found");
    });

    act(() => view.result.current.runShell("ls"));
    await waitFor(() => {
      const [shell] = entries(view.result.current.state.entries, "shell");
      expect(shell?.role === "shell" && shell.stderr).toContain("no shell was found");
    });
  });

  it("ignores an empty command", async () => {
    const view = await mount();
    act(() => view.result.current.runShell("  "));
    expect(entries(view.result.current.state.entries, "shell")).toHaveLength(0);
  });

  it("runs where the session last reported it was, not where it started", async () => {
    const view = await mount();
    emit({ type: "system", subtype: "init", cwd: "D:\\elsewhere" });

    act(() => view.result.current.runShell("pwd"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("run_shell_command", expect.anything()),
    );
    finishShell();

    const call = invoke.mock.calls.filter(([command]) => command === "run_shell_command").pop();
    expect(call?.[1]).toMatchObject({ cwd: "D:\\elsewhere" });
  });
});

describe("session control", () => {
  it("interrupts and stops the turn locally", async () => {
    const view = await mount();
    act(() => view.result.current.send("go"));
    await waitFor(() => expect(view.result.current.state.busy).toBe(true));

    act(() => view.result.current.interrupt());
    expect(sentRequests("interrupt")).toHaveLength(1);
    expect(view.result.current.state.busy).toBe(false);
  });

  it("reports an interrupt as an interruption rather than as a failure", async () => {
    const view = await mount();
    act(() => view.result.current.send("go"));
    await waitFor(() => expect(view.result.current.state.busy).toBe(true));

    act(() => view.result.current.interrupt());
    emit({ type: "result", is_error: true });

    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "notice")).toHaveLength(1),
    );
    expect(entries(view.result.current.state.entries, "error")).toHaveLength(0);
    const [notice] = entries(view.result.current.state.entries, "notice");
    expect(notice.role === "notice" && notice.text).toBe("You interrupted the turn.");
  });

  it("treats a later failure as a failure, not as the interrupt it followed", async () => {
    const view = await mount();
    act(() => view.result.current.send("go"));
    act(() => view.result.current.interrupt());
    emit({ type: "result", is_error: true });
    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "notice")).toHaveLength(1),
    );

    emit({ type: "result", is_error: true, result: "the model exploded" });

    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "error")).toHaveLength(1),
    );
    const [error] = entries(view.result.current.state.entries, "error");
    expect(error.role === "error" && error.text).toBe("the model exploded");
  });

  it("marks a message sent mid-turn as queued, and unmarks it when the turn ends", async () => {
    const view = await mount();
    act(() => view.result.current.send("first"));
    await waitFor(() => expect(view.result.current.state.busy).toBe(true));

    act(() => view.result.current.send("second"));
    await waitFor(() => expect(entries(view.result.current.state.entries, "user")).toHaveLength(2));

    const waiting = entries(view.result.current.state.entries, "user");
    expect(waiting[0].role === "user" && waiting[0].queued).toBe(false);
    expect(waiting[1].role === "user" && waiting[1].queued).toBe(true);

    emit({ type: "result" });

    await waitFor(() => {
      const settled = entries(view.result.current.state.entries, "user");
      expect(settled[1].role === "user" && settled[1].queued).toBe(false);
    });
  });

  /// Stopping a turn releases what was queued behind it — the CLI takes the
  /// message up as it stops — so the mark has to come off there too. Left on,
  /// the row would still read "Queued" for a message the agent is already
  /// answering, and the message would be missing from the transcript meanwhile.
  it("unmarks a queued message when the turn is stopped", async () => {
    const view = await mount();
    act(() => view.result.current.send("first"));
    await waitFor(() => expect(view.result.current.state.busy).toBe(true));

    act(() => view.result.current.send("second"));
    await waitFor(() => expect(entries(view.result.current.state.entries, "user")).toHaveLength(2));

    act(() => view.result.current.interrupt());

    const settled = entries(view.result.current.state.entries, "user");
    expect(settled[1].role === "user" && settled[1].queued).toBe(false);
    expect(view.result.current.state.busy).toBe(false);
  });

  it("switches the model and then re-reads the context", async () => {
    const view = await mount();
    act(() => view.result.current.setModel("opus"));

    await waitFor(() => expect(sentRequests("set_model")).toHaveLength(1));
    expect(sentRequests("set_model")[0]).toMatchObject({ model: "opus" });

    reply("set_model", {});
    await waitFor(() => expect(sentRequests("get_context_usage").length).toBeGreaterThan(0));
  });

  it("reports a model switch the CLI refused", async () => {
    const view = await mount();
    act(() => view.result.current.setModel("nope"));
    await waitFor(() => expect(sentRequests("set_model")).toHaveLength(1));

    act(() => {
      sessionChannel().emit({
        kind: "line",
        line: JSON.stringify({
          type: "control_response",
          response: {
            subtype: "error",
            request_id: requestIdOf("set_model"),
            error: "unknown model",
          },
        }),
      });
    });

    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "notice")).toHaveLength(1),
    );
  });

  it("switches the permission mode and records what the CLI accepted", async () => {
    const view = await mount();
    act(() => view.result.current.setPermissionMode("plan"));
    await waitFor(() => expect(sentRequests("set_permission_mode")).toHaveLength(1));

    reply("set_permission_mode", {});
    await waitFor(() => expect(view.result.current.state.permissionMode).toBe("plan"));
  });

  it("cycles the permission mode through the list the CLI accepts", async () => {
    const view = await mount();
    act(() => view.result.current.cyclePermissionMode());
    await waitFor(() => expect(sentRequests("set_permission_mode")).toHaveLength(1));
    expect(sentRequests("set_permission_mode")[0]).toMatchObject({ mode: "plan" });
  });

  it("adds a local notice", async () => {
    const view = await mount();
    act(() => view.result.current.notice("heads up"));
    expect(entries(view.result.current.state.entries, "notice")).toHaveLength(1);
  });

  it("re-reads the MCP list on demand", async () => {
    const view = await mount();
    const before = sentRequests("mcp_status").length;
    act(() => view.result.current.refreshMcp());
    expect(sentRequests("mcp_status").length).toBe(before + 1);
  });
});

describe("answers to control requests", () => {
  const permissionRequest = {
    type: "control_request",
    request_id: "req-1",
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      input: { command: "rm -rf /" },
      description: "Run a command",
    },
  };

  it("queues a prompt the CLI is waiting on", async () => {
    const view = await mount();
    emit(permissionRequest);

    await waitFor(() => expect(view.result.current.prompt).not.toBeNull());
    expect(view.result.current.prompt?.kind).toBe("permission");
  });

  it("does not queue the same request twice", async () => {
    const view = await mount();
    emit(permissionRequest);
    await waitFor(() => expect(view.result.current.prompt).not.toBeNull());
    emit(permissionRequest);
    expect(view.result.current.prompt?.requestId).toBe("req-1");
    expect(sentRequests("can_use_tool")).toHaveLength(0);
  });

  it("answers with an allow, echoing the input the CLI sent", async () => {
    const view = await mount();
    emit(permissionRequest);
    await waitFor(() => expect(view.result.current.prompt).not.toBeNull());

    act(() => view.result.current.resolve({ kind: "permission", choice: "allow" }));

    await waitFor(() => expect(lastSent("control_response")).toBeDefined());
    const response = (lastSent("control_response") as { response: { response: unknown } }).response
      .response as Record<string, unknown>;
    expect(response.behavior).toBe("allow");
    expect(response.updatedInput).toEqual({ command: "rm -rf /" });
    expect(view.result.current.prompt).toBeNull();
  });

  it("answers with a denial that tells the model why", async () => {
    const view = await mount();
    emit(permissionRequest);
    await waitFor(() => expect(view.result.current.prompt).not.toBeNull());

    act(() => view.result.current.resolve({ kind: "permission", choice: "deny" }));

    await waitFor(() => expect(lastSent("control_response")).toBeDefined());
    const response = (lastSent("control_response") as { response: { response: unknown } }).response
      .response as Record<string, unknown>;
    expect(response.behavior).toBe("deny");
  });

  it("refuses the request when the card is dismissed, so Claude has to ask again", async () => {
    const view = await mount();
    emit(permissionRequest);
    await waitFor(() => expect(view.result.current.prompt).not.toBeNull());

    act(() => view.result.current.resolve({ kind: "dismiss" }));

    await waitFor(() => expect(lastSent("control_response")).toBeDefined());
    const response = (lastSent("control_response") as { response: { response: unknown } }).response
      .response as Record<string, unknown>;
    expect(response.behavior).toBe("deny");
    expect(String(response.message)).toContain("clarify");
    expect(view.result.current.prompt).toBeNull();
  });

  it("refuses a request it cannot render rather than leaving the CLI blocked", async () => {
    const view = await mount();
    emit({
      type: "control_request",
      request_id: "req-elicitation",
      request: { subtype: "elicitation", tool_name: "Whatever" },
    });

    await waitFor(() => expect(lastSent("control_response")).toBeDefined());
    const response = (lastSent("control_response") as { response: { response: unknown } }).response
      .response as Record<string, unknown>;
    expect(response.behavior).toBe("deny");
    expect(view.result.current.prompt).toBeNull();
  });

  it("takes the plan from the reply that preceded the approval, not the call's input", async () => {
    const view = await mount();
    emit({
      type: "assistant",
      message: { content: [{ type: "text", text: "Here is my plan: do the thing." }] },
    });
    emit({
      type: "control_request",
      request_id: "req-plan",
      request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", input: {} },
    });

    await waitFor(() => expect(view.result.current.prompt?.kind).toBe("plan"));
    const prompt = view.result.current.prompt;
    expect(prompt?.kind === "plan" && prompt.plan).toBe("Here is my plan: do the thing.");
  });
});

describe("stepping off a session", () => {
  it("does not leave a parked session able to swallow input", async () => {
    const held = holdLaterSpawns();
    const view = await mount();

    emit({
      type: "control_request",
      request_id: "req-parked",
      request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } },
    });
    await waitFor(() => expect(view.result.current.prompt).not.toBeNull());

    act(() => view.result.current.startNew());
    await waitFor(() => expect(held.calls()).toBe(2));

    const before = sentLines().length;
    act(() => view.result.current.send("this must go nowhere"));

    expect(sentLines().length).toBe(before);
    expect(entries(view.result.current.state.entries, "user")).toHaveLength(0);

    held.release("session-b");
  });

  it("spawns a replacement when starting a new session", async () => {
    const view = await mount();
    act(() => view.result.current.startNew());

    await waitFor(() =>
      expect(invoke.mock.calls.filter(([command]) => command === "start_claude")).toHaveLength(2),
    );
    expect(view.result.current.status).toBe("running");
  });

  it("reattaches to a parked session instead of restarting it", async () => {
    const view = await mount();
    emit({ type: "system", subtype: "init", session_id: "live-1" });
    emit({
      type: "control_request",
      request_id: "req-parked",
      request: { subtype: "can_use_tool", tool_name: "Bash", input: {} },
    });
    await waitFor(() => expect(view.result.current.prompt).not.toBeNull());

    act(() => view.result.current.startNew());
    await waitFor(() => expect(view.result.current.status).toBe("running"));

    const spawnsBefore = invoke.mock.calls.filter(([command]) => command === "start_claude").length;
    act(() => view.result.current.resume("live-1"));

    expect(invoke.mock.calls.filter(([command]) => command === "start_claude")).toHaveLength(
      spawnsBefore,
    );
  });
});

describe("a turn that goes quiet", () => {
  /// The reader decides when a session is dead. Nothing here interrupts one for
  /// being silent, however long it stays that way — a build, a test run or a
  /// long search is silent for as long as it takes, and a session that has
  /// genuinely wedged is the reader's call and not a timer's.
  it("is never interrupted for producing nothing", async () => {
    const view = await mount();
    vi.useFakeTimers();

    act(() => view.result.current.send("hello"));
    act(() => vi.advanceTimersByTime(3_600_000));
    vi.useRealTimers();

    expect(sentRequests("interrupt")).toHaveLength(0);
    expect(entries(view.result.current.state.entries, "notice")).toHaveLength(0);
  });
});

describe("streamed events", () => {
  it("shows text as it streams and folds it into an entry when the message lands", async () => {
    const view = await mount();
    emit({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
    });
    await waitFor(() => expect(view.result.current.state.streaming).toBe("Hi"));

    emit({ type: "assistant", message: { content: [{ type: "text", text: "Hi" }] } });

    await waitFor(() => {
      expect(view.result.current.state.streaming).toBe("");
      expect(entries(view.result.current.state.entries, "assistant")).toHaveLength(1);
    });
  });

  it("ends the turn and records the cost when the result arrives", async () => {
    const view = await mount();
    emit({ type: "result", total_cost_usd: 0.5 });

    await waitFor(() => expect(view.result.current.state.costUsd).toBe(0.5));
    expect(view.result.current.state.busy).toBe(false);
  });

  it("reports a session that exited badly", async () => {
    const view = await mount();
    emit({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
    act(() => {
      sessionChannel().emit({ kind: "exit", code: 1 });
    });

    await waitFor(() => expect(view.result.current.status).toBe("closed (1)"));
    expect(entries(view.result.current.state.entries, "error")).toHaveLength(1);
  });

  it("ignores stderr rather than showing it as transcript", async () => {
    const view = await mount();
    act(() => {
      sessionChannel().emit({ kind: "stderr", line: "warning: something" });
    });
    expect(view.result.current.state.entries).toHaveLength(0);
  });
});

describe("the resume list", () => {
  it("offers the transcripts for this directory", async () => {
    routeInvoke("list_sessions", () => [
      { id: "old-1", modified: 5, bytes: 10, preview: "earlier" },
    ]);
    const view = await mount();

    await waitFor(() => expect(view.result.current.resumable).toHaveLength(1));
    expect(view.result.current.resumable[0].id).toBe("old-1");
    expect(view.result.current.resumable[0].live).toBe(false);
  });

  it("replays the transcript when resuming a stored session", async () => {
    routeInvoke("read_session_replay", () => [
      { type: "user", message: { content: [{ type: "text", text: "old question" }] } },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "out" }] },
      },
    ]);
    const view = await mount();

    act(() => view.result.current.resume("old-1"));

    await waitFor(() =>
      expect(invoke.mock.calls.some(([command]) => command === "read_session_replay")).toBe(true),
    );
    await waitFor(() => expect(entries(view.result.current.state.entries, "user")).toHaveLength(1));
    expect(entries(view.result.current.state.entries, "tool")).toHaveLength(1);
  });

  it("survives a session list that cannot be read", async () => {
    routeInvoke("list_sessions", () => {
      throw new Error("no such directory");
    });
    const view = await mount();
    expect(view.result.current.resumable).toEqual([]);
  });
});

describe("file suggestions", () => {
  it("resolves the paths the CLI offers", async () => {
    const view = await mount();
    const promise = view.result.current.suggestFiles("App");
    await waitFor(() => expect(sentRequests("file_suggestions")).toHaveLength(1));
    reply("file_suggestions", {
      cwd: CWD,
      suggestions: [{ path: `${CWD}\\src\\App.tsx` }],
    });

    await expect(promise).resolves.toEqual(["src\\App.tsx"]);
  });

  it("asks for the query in the separators the session's paths use", async () => {
    const view = await mount();
    const promise = view.result.current.suggestFiles("apps/terminice");
    await waitFor(() => expect(sentRequests("file_suggestions")).toHaveLength(1));

    expect(sentRequests("file_suggestions")[0]).toMatchObject({ query: "apps\\terminice" });

    reply("file_suggestions", { cwd: CWD, suggestions: [] });
    await expect(promise).resolves.toEqual([]);
  });

  it("resolves empty when the CLI refuses", async () => {
    const view = await mount();
    const promise = view.result.current.suggestFiles("App");
    await waitFor(() => expect(sentRequests("file_suggestions")).toHaveLength(1));

    act(() => {
      sessionChannel().emit({
        kind: "line",
        line: JSON.stringify({
          type: "control_response",
          response: {
            subtype: "error",
            request_id: requestIdOf("file_suggestions"),
            error: "no index",
          },
        }),
      });
    });

    await expect(promise).resolves.toEqual([]);
  });
});

describe("taking a message back out of the queue", () => {
  /** Sends one message, waits for the turn to start, then queues a second. */
  async function queueSecond(view: Awaited<ReturnType<typeof mount>>) {
    act(() => view.result.current.send("first"));
    await waitFor(() => expect(view.result.current.state.busy).toBe(true));
    act(() => view.result.current.send("second"));
    await waitFor(() => expect(entries(view.result.current.state.entries, "user")).toHaveLength(2));
    return entries(view.result.current.state.entries, "user")[1];
  }

  it("sends every message under a uuid of its own", async () => {
    const view = await mount();
    act(() => view.result.current.send("first"));
    await waitFor(() => expect(view.result.current.state.busy).toBe(true));
    act(() => view.result.current.send("second"));
    await waitFor(() => expect(entries(view.result.current.state.entries, "user")).toHaveLength(2));

    const [first, second] = sentLines().filter((line) => line.type === "user");

    expect(first.uuid).toEqual(expect.any(String));
    expect(second.uuid).not.toBe(first.uuid);
  });

  it("asks the CLI to drop a waiting message, naming it by that uuid", async () => {
    const view = await mount();
    const queued = await queueSecond(view);
    const uuid = (
      sentLines()
        .filter((line) => line.type === "user")
        .pop() as { uuid: string }
    ).uuid;

    act(() => view.result.current.unqueue(queued.id));

    await waitFor(() => expect(sentRequests("cancel_async_message")).toHaveLength(1));
    expect(sentRequests("cancel_async_message")[0]).toMatchObject({ message_uuid: uuid });
  });

  it("drops the message from the transcript once the CLI says it is gone", async () => {
    const view = await mount();
    const queued = await queueSecond(view);

    act(() => view.result.current.unqueue(queued.id));
    await waitFor(() => expect(sentRequests("cancel_async_message")).toHaveLength(1));
    reply("cancel_async_message", { cancelled: true });

    await waitFor(() => expect(entries(view.result.current.state.entries, "user")).toHaveLength(1));
    expect(entries(view.result.current.state.entries, "user")[0]).toMatchObject({ text: "first" });
  });

  it("keeps a message the CLI had already taken, and settles it", async () => {
    const view = await mount();
    const queued = await queueSecond(view);

    act(() => view.result.current.unqueue(queued.id));
    await waitFor(() => expect(sentRequests("cancel_async_message")).toHaveLength(1));
    reply("cancel_async_message", { cancelled: false });

    await waitFor(() => {
      const [, second] = entries(view.result.current.state.entries, "user");
      expect(second.role === "user" && second.queued).toBe(false);
    });
    expect(entries(view.result.current.state.entries, "user")).toHaveLength(2);
  });

  it("says so when the CLI will not take it back", async () => {
    const view = await mount();
    const queued = await queueSecond(view);

    act(() => view.result.current.unqueue(queued.id));
    await waitFor(() => expect(sentRequests("cancel_async_message")).toHaveLength(1));

    act(() => {
      sessionChannel().emit({
        kind: "line",
        line: JSON.stringify({
          type: "control_response",
          response: {
            subtype: "error",
            request_id: requestIdOf("cancel_async_message"),
            error: "too late",
          },
        }),
      });
    });

    await waitFor(() =>
      expect(entries(view.result.current.state.entries, "notice")).toHaveLength(1),
    );
    expect(entries(view.result.current.state.entries, "user")).toHaveLength(2);
  });
});
