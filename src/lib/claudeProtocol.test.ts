import { describe, expect, it } from "vitest";
import { type ChatEntry, type ChatState, createChatState } from "../types";
import {
  applyClaudeLine,
  applyClaudeMessage,
  latestAssistantText,
  readTextBlocks,
  readThinkingBlocks,
  readToolUses,
  withError,
  withHistory,
  withNotice,
  withShellCommand,
  withShellResult,
  withUserMessage,
} from "./claudeProtocol";
import type { Json } from "./json";

/** Applies one event, as the session hook does with a decoded line. */
const apply = (state: ChatState, message: Json): ChatState => applyClaudeMessage(state, message);

/** Applies one raw line, as a replayed transcript would. */
const applyLine = (state: ChatState, line: string): ChatState => applyClaudeLine(state, line);

const entriesOf = (state: ChatState, role: ChatEntry["role"]): ChatEntry[] =>
  state.entries.filter((entry) => entry.role === role);

/** A state holding one running tool call, so it can be paired with a result. */
const stateWithToolCalls = (...calls: Array<{ id: string; name: string }>): ChatState =>
  calls.reduce(
    (state, call) =>
      apply(state, {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: call.id, name: call.name, input: { command: "ls" } }],
        },
      }),
    createChatState(),
  );

describe("readTextBlocks", () => {
  it("joins every text block", () => {
    expect(
      readTextBlocks([
        { type: "text", text: "one " },
        { type: "thinking", thinking: "ignored" },
        { type: "text", text: "two" },
      ]),
    ).toBe("one two");
  });

  it("passes a plain string through", () => {
    expect(readTextBlocks("already text")).toBe("already text");
  });

  it("returns empty for content that is neither", () => {
    expect(readTextBlocks(null)).toBe("");
    expect(readTextBlocks(42)).toBe("");
  });

  it("skips entries that are not objects", () => {
    expect(readTextBlocks(["stray", { type: "text", text: "kept" }])).toBe("kept");
  });
});

describe("readThinkingBlocks", () => {
  it("joins every thinking block, which a text-only reader would discard", () => {
    expect(
      readThinkingBlocks([
        { type: "thinking", thinking: "step one " },
        { type: "text", text: "ignored" },
        { type: "thinking", thinking: "step two" },
      ]),
    ).toBe("step one step two");
  });

  it("returns empty when there is no reasoning", () => {
    expect(readThinkingBlocks([{ type: "text", text: "hi" }])).toBe("");
  });
});

describe("readToolUses", () => {
  it("reads each call's id, name and input", () => {
    expect(
      readToolUses([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
    ).toEqual([{ id: "t1", name: "Bash", input: { command: "ls" } }]);
  });

  it("ignores blocks that are not tool calls", () => {
    expect(readToolUses([{ type: "text", text: "hi" }])).toEqual([]);
  });

  it("returns empty for content that is not an array", () => {
    expect(readToolUses(null)).toEqual([]);
  });
});

describe("latestAssistantText", () => {
  it("finds the most recent thing Claude said", () => {
    const state = withHistory(createChatState(), [
      { role: "assistant", text: "first" },
      { role: "user", text: "question" },
      { role: "assistant", text: "second" },
    ]);
    expect(latestAssistantText(state)).toBe("second");
  });

  it("skips an empty assistant reply", () => {
    const state = withHistory(createChatState(), [
      { role: "assistant", text: "real" },
      { role: "assistant", text: "   " },
    ]);
    expect(latestAssistantText(state)).toBe("real");
  });

  it("returns empty when nothing has been said", () => {
    expect(latestAssistantText(createChatState())).toBe("");
  });
});

describe("withUserMessage", () => {
  it("records the message and marks the session busy", () => {
    const state = withUserMessage(createChatState(), "hello");
    expect(entriesOf(state, "user")).toHaveLength(1);
    expect(state.busy).toBe(true);
  });

  it("clears a suggestion the user has now overtaken", () => {
    const withSuggestion = apply(createChatState(), {
      type: "prompt_suggestion",
      suggestion: "try this",
    });
    expect(withUserMessage(withSuggestion, "hello").suggestion).toBeNull();
  });
});

describe("withError", () => {
  it("records an error and stops the turn", () => {
    const state = withError({ ...createChatState(), busy: true, streaming: "half" }, "it broke");
    expect(entriesOf(state, "error")).toHaveLength(1);
    expect(state.busy).toBe(false);
    expect(state.streaming).toBe("");
  });
});

describe("withNotice", () => {
  it("records a notice without changing the turn's state", () => {
    const state = withNotice({ ...createChatState(), busy: true }, "note");
    expect(entriesOf(state, "notice")).toHaveLength(1);
    expect(state.busy).toBe(true);
  });
});

describe("withShellCommand and withShellResult", () => {
  it("records a running command", () => {
    const state = withShellCommand(createChatState(), "shell-1", "ls");
    const [entry] = entriesOf(state, "shell");
    expect(entry.role === "shell" && entry.running).toBe(true);
    expect(entry.role === "shell" && entry.command).toBe("ls");
  });

  it("fills in the result for the matching command only", () => {
    const first = withShellCommand(createChatState(), "shell-1", "ls");
    const both = withShellCommand(first, "shell-2", "pwd");
    const done = withShellResult(both, "shell-2", { stdout: "out", stderr: "", code: 0 });

    const shells = entriesOf(done, "shell");
    expect(shells[0].role === "shell" && shells[0].running).toBe(true);
    expect(shells[1].role === "shell" && shells[1].running).toBe(false);
    expect(shells[1].role === "shell" && shells[1].stdout).toBe("out");
  });

  it("changes nothing when the id is unknown", () => {
    const state = withShellCommand(createChatState(), "shell-1", "ls");
    const after = withShellResult(state, "nope", { stdout: "x", stderr: "", code: 0 });
    expect(after.entries).toEqual(state.entries);
  });
});

describe("withHistory", () => {
  it("replaces the transcript with the replayed messages", () => {
    const seeded = withUserMessage(createChatState(), "live");
    const state = withHistory(seeded, [
      { role: "user", text: "old question" },
      { role: "assistant", text: "old answer" },
    ]);

    expect(state.entries).toHaveLength(2);
    expect(state.entries[0].role).toBe("user");
    expect(state.busy).toBe(false);
  });
});

describe("applyClaudeLine", () => {
  it("ignores a line that is not JSON", () => {
    const state = createChatState();
    expect(applyLine(state, "not json")).toBe(state);
  });

  it("ignores a line that decodes to something other than an object", () => {
    const state = createChatState();
    expect(applyLine(state, "[1]")).toBe(state);
  });

  it("applies a well-formed line", () => {
    const state = applyLine(
      createChatState(),
      JSON.stringify({ type: "result", total_cost_usd: 1 }),
    );
    expect(state.costUsd).toBe(1);
  });

  it("ignores a message type it does not handle", () => {
    const state = createChatState();
    expect(apply(state, { type: "something_new" })).toBe(state);
  });
});

describe("prompt suggestions", () => {
  it("records a suggestion", () => {
    expect(
      apply(createChatState(), { type: "prompt_suggestion", suggestion: "next" }).suggestion,
    ).toBe("next");
  });

  it("clears the suggestion when the CLI sends none", () => {
    const withOne = apply(createChatState(), { type: "prompt_suggestion", suggestion: "next" });
    expect(apply(withOne, { type: "prompt_suggestion" }).suggestion).toBeNull();
  });
});

describe("system/init", () => {
  it("records the session, directory, model and permission mode", () => {
    const state = apply(createChatState(), {
      type: "system",
      subtype: "init",
      session_id: "s1",
      cwd: "D:\\apps",
      model: "sonnet",
      permissionMode: "plan",
    });

    expect(state.sessionId).toBe("s1");
    expect(state.cwd).toBe("D:\\apps");
    expect(state.model).toBe("sonnet");
    expect(state.permissionMode).toBe("plan");
  });

  it("takes the new directory when the CLI reports a change", () => {
    const first = apply(createChatState(), { type: "system", subtype: "init", cwd: "D:\\apps" });
    const moved = apply(first, { type: "system", subtype: "init", cwd: "D:\\other" });
    expect(moved.cwd).toBe("D:\\other");
  });

  it("keeps what it already knew when a later init omits a field", () => {
    const first = apply(createChatState(), {
      type: "system",
      subtype: "init",
      model: "sonnet",
      permissionMode: "plan",
    });
    const second = apply(first, { type: "system", subtype: "init", cwd: "D:\\apps" });

    expect(second.model).toBe("sonnet");
    expect(second.permissionMode).toBe("plan");
  });

  it("records MCP servers, plugins and skills", () => {
    const state = apply(createChatState(), {
      type: "system",
      subtype: "init",
      mcp_servers: [{ name: "files", status: "connected" }],
      plugins: [{ name: "core", version: "1.0.0" }],
      skills: ["code-review"],
    });

    expect(state.mcpServers).toEqual([{ name: "files", status: "connected" }]);
    expect(state.plugins[0].name).toBe("core");
    expect(state.skills).toEqual(["code-review"]);
  });

  it("keeps the known lists when a later init reports none", () => {
    const first = apply(createChatState(), {
      type: "system",
      subtype: "init",
      mcp_servers: [{ name: "files", status: "connected" }],
    });
    const second = apply(first, { type: "system", subtype: "init", mcp_servers: [] });
    expect(second.mcpServers).toEqual([{ name: "files", status: "connected" }]);
  });

  it("reads fast mode from the same event", () => {
    const state = apply(createChatState(), {
      type: "system",
      subtype: "init",
      fast_mode_state: "cooldown",
      fast_mode_disabled_reason: "preference",
    });

    expect(state.fastMode).toBe("cooldown");
    expect(state.fastModeReason).toBe("preference");
  });
});

describe("system/status", () => {
  it("marks the session busy when a turn is requested", () => {
    expect(
      apply(createChatState(), { type: "system", subtype: "status", status: "requesting" }).busy,
    ).toBe(true);
  });

  it("marks the session idle, and clears a compaction in progress", () => {
    const state = apply(
      { ...createChatState(), busy: true, compacting: true },
      {
        type: "system",
        subtype: "status",
        status: "idle",
      },
    );

    expect(state.busy).toBe(false);
    expect(state.compacting).toBe(false);
  });

  it("marks a compaction without pretending it is progress", () => {
    const state = apply(createChatState(), {
      type: "system",
      subtype: "status",
      status: "compacting",
    });

    expect(state.compacting).toBe(true);
    expect(state.busy).toBe(true);
  });

  it("ignores a status it does not know", () => {
    const state = { ...createChatState(), busy: true };
    expect(apply(state, { type: "system", subtype: "status", status: "something" }).busy).toBe(
      true,
    );
  });
});

describe("system/thinking_tokens", () => {
  it("records the running estimate", () => {
    const state = apply(createChatState(), {
      type: "system",
      subtype: "thinking_tokens",
      estimated_tokens: 120,
    });
    expect(state.thinkingTokens).toBe(120);
  });

  it("leaves the state alone when the count has not moved", () => {
    const state = { ...createChatState(), thinkingTokens: 120 };
    expect(
      apply(state, { type: "system", subtype: "thinking_tokens", estimated_tokens: 120 }),
    ).toBe(state);
  });

  it("leaves the state alone when the count is not a number", () => {
    const state = { ...createChatState(), thinkingTokens: 5 };
    expect(
      apply(state, { type: "system", subtype: "thinking_tokens", estimated_tokens: "120" }),
    ).toBe(state);
  });
});

describe("system/compact_boundary", () => {
  it("reports what the compaction freed", () => {
    const state = apply(
      { ...createChatState(), busy: true, compacting: true },
      {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { pre_tokens: 1000, post_tokens: 200, cumulative_dropped_tokens: 800 },
      },
    );

    const [notice] = entriesOf(state, "notice");
    expect(notice.role === "notice" && notice.text).toContain("800");
    expect(state.busy).toBe(false);
    expect(state.compacting).toBe(false);
  });

  it("works out the drop itself when the CLI does not report one", () => {
    const state = apply(createChatState(), {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { pre_tokens: 1000, post_tokens: 250 },
    });

    expect(entriesOf(state, "notice")[0].role === "notice").toBe(true);
    expect((entriesOf(state, "notice")[0] as { text: string }).text).toContain("750");
  });
});

describe("system/permission_denied", () => {
  it("names the tool that was refused", () => {
    const state = apply(createChatState(), {
      type: "system",
      subtype: "permission_denied",
      tool_name: "Write",
    });
    expect((entriesOf(state, "notice")[0] as { text: string }).text).toContain("Write");
  });

  it("still records a refusal that names no tool", () => {
    const state = apply(createChatState(), { type: "system", subtype: "permission_denied" });
    expect(entriesOf(state, "notice")).toHaveLength(1);
  });
});

describe("system/hook_response", () => {
  it("attaches a hook to the tool call it surrounds", () => {
    const state = apply(stateWithToolCalls({ id: "t1", name: "Bash" }), {
      type: "system",
      subtype: "hook_response",
      hook_name: "PreToolUse:Bash",
      hook_event: "PreToolUse",
      exit_code: 0,
    });

    const [tool] = entriesOf(state, "tool");
    expect(tool.role === "tool" && tool.hooks).toHaveLength(1);
  });

  it("attaches to the newest unfinished matching call", () => {
    const state = apply(
      stateWithToolCalls({ id: "t1", name: "Bash" }, { id: "t2", name: "Bash" }),
      {
        type: "system",
        subtype: "hook_response",
        hook_name: "PreToolUse:Bash",
        exit_code: 0,
      },
    );

    const tools = entriesOf(state, "tool");
    expect(tools[0].role === "tool" && tools[0].hooks).toHaveLength(0);
    expect(tools[1].role === "tool" && tools[1].hooks).toHaveLength(1);
  });

  it("surfaces a failing hook that matches no call", () => {
    const state = apply(createChatState(), {
      type: "system",
      subtype: "hook_response",
      hook_name: "SessionStart",
      exit_code: 2,
      output: "boom",
    });

    expect(entriesOf(state, "notice")).toHaveLength(1);
    expect((entriesOf(state, "notice")[0] as { text: string }).text).toContain("boom");
  });

  it("drops a passing hook that matches no call, rather than cluttering the transcript", () => {
    const state = createChatState();
    expect(
      apply(state, {
        type: "system",
        subtype: "hook_response",
        hook_name: "SessionStart",
        exit_code: 0,
      }),
    ).toBe(state);
  });
});

describe("stream_event", () => {
  it("appends streamed text as it arrives", () => {
    const first = apply(createChatState(), {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "He" } },
    });
    const second = apply(first, {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "llo" } },
    });

    expect(second.streaming).toBe("Hello");
  });

  it("ignores anything that is not a text delta", () => {
    const state = { ...createChatState(), streaming: "kept" };
    expect(apply(state, { type: "stream_event", event: { type: "message_start" } }).streaming).toBe(
      "kept",
    );
    expect(
      apply(state, {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "input_json_delta" } },
      }).streaming,
    ).toBe("kept");
  });

  it("ignores an event with no body", () => {
    const state = createChatState();
    expect(apply(state, { type: "stream_event" })).toBe(state);
  });
});

describe("assistant", () => {
  it("records reasoning before the reply it produced", () => {
    const state = apply(createChatState(), {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "why" },
          { type: "text", text: "answer" },
        ],
      },
    });

    expect(state.entries.map((entry) => entry.role)).toEqual(["thinking", "assistant"]);
  });

  it("turns each tool call into a card that starts out running", () => {
    const state = stateWithToolCalls({ id: "t1", name: "Bash" });
    const [tool] = entriesOf(state, "tool");
    expect(tool.role === "tool" && tool.status).toBe("running");
    expect(tool.role === "tool" && tool.result).toBe("");
  });

  it("summarises the call's input for the collapsed card", () => {
    const state = stateWithToolCalls({ id: "t1", name: "Bash" });
    const [tool] = entriesOf(state, "tool");
    expect(tool.role === "tool" && tool.detail).toBe("ls");
  });

  it("makes a subagent call a card holding its own transcript", () => {
    const state = apply(createChatState(), {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Task", input: { description: "Explore" } }],
      },
    });

    const [agent] = entriesOf(state, "subagent");
    expect(agent.role === "subagent" && agent.entries).toEqual([]);
    expect(agent.role === "subagent" && agent.label).toBe("Explore");
  });

  it("treats the Agent tool the same as Task", () => {
    const state = apply(createChatState(), {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: {} }] },
    });
    expect(entriesOf(state, "subagent")).toHaveLength(1);
  });

  it("stops streaming once the finished message lands", () => {
    const streaming = apply(createChatState(), {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
    });
    const finished = apply(streaming, {
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    });

    expect(finished.streaming).toBe("");
    expect(entriesOf(finished, "assistant")).toHaveLength(1);
  });

  it("leaves the state alone for a message with nothing in it", () => {
    const state = createChatState();
    expect(apply(state, { type: "assistant", message: { content: [] } })).toBe(state);
  });

  it("still clears streaming for an empty message that followed one", () => {
    const streaming = { ...createChatState(), streaming: "partial" };
    expect(apply(streaming, { type: "assistant", message: { content: [] } }).streaming).toBe("");
  });
});

describe("user tool results", () => {
  it("pairs a result with its call by id", () => {
    const state = apply(stateWithToolCalls({ id: "t1", name: "Bash" }), {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "output" }] },
    });

    const [tool] = entriesOf(state, "tool");
    expect(tool.role === "tool" && tool.result).toBe("output");
    expect(tool.role === "tool" && tool.status).toBe("ok");
  });

  it("marks a failed result as an error", () => {
    const state = apply(stateWithToolCalls({ id: "t1", name: "Bash" }), {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", content: "bad", is_error: true }],
      },
    });

    expect((entriesOf(state, "tool")[0] as { status: string }).status).toBe("error");
  });

  it("uses the structured result when the message carries exactly one", () => {
    const state = apply(stateWithToolCalls({ id: "t1", name: "Bash" }), {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "plain" }] },
      tool_use_result: { stdout: "rich stdout" },
    });

    expect((entriesOf(state, "tool")[0] as { result: string }).result).toBe("rich stdout");
  });

  it("keeps each parallel call's own output rather than sharing one structured result", () => {
    const state = apply(
      stateWithToolCalls({ id: "t1", name: "Bash" }, { id: "t2", name: "Bash" }),
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "first output" },
            { type: "tool_result", tool_use_id: "t2", content: "second output" },
          ],
        },
        tool_use_result: { stdout: "only one of these" },
      },
    );

    const tools = entriesOf(state, "tool");
    expect((tools[0] as { result: string }).result).toBe("first output");
    expect((tools[1] as { result: string }).result).toBe("second output");
  });

  it("records a result whose call was never seen as its own card", () => {
    const state = apply(createChatState(), {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "unseen", content: "orphan" }] },
    });

    const [tool] = entriesOf(state, "tool");
    expect(tool.role === "tool" && tool.result).toBe("orphan");
    expect(tool.role === "tool" && tool.name).toBe("Tool result");
  });

  it("leaves the state alone when the message carries no results", () => {
    const state = createChatState();
    expect(apply(state, { type: "user", message: { content: [] } })).toBe(state);
    expect(
      apply(state, { type: "user", message: { content: [{ type: "text", text: "hi" }] } }),
    ).toBe(state);
  });
});

describe("result", () => {
  it("ends the turn and records the cost", () => {
    const state = apply(
      { ...createChatState(), busy: true, streaming: "x" },
      {
        type: "result",
        total_cost_usd: 0.25,
      },
    );

    expect(state.busy).toBe(false);
    expect(state.streaming).toBe("");
    expect(state.costUsd).toBe(0.25);
    expect(state.thinkingTokens).toBe(0);
  });

  it("keeps the cost it already knew when the result reports none", () => {
    const state = apply({ ...createChatState(), costUsd: 1.5 }, { type: "result" });
    expect(state.costUsd).toBe(1.5);
  });

  it("records a turn that ended in an error", () => {
    const state = apply(createChatState(), {
      type: "result",
      is_error: true,
      result: "rate limited",
    });
    expect((entriesOf(state, "error")[0] as { text: string }).text).toBe("rate limited");
  });

  it("falls back to a generic message for an error with no text", () => {
    const state = apply(createChatState(), { type: "result", is_error: true });
    expect(entriesOf(state, "error")).toHaveLength(1);
  });

  it("lists each tool that was denied", () => {
    const state = apply(createChatState(), {
      type: "result",
      permission_denials: [{ tool_name: "Write" }, { tool_name: "Bash" }, {}],
    });

    expect(entriesOf(state, "notice")).toHaveLength(2);
  });

  it("reads fast mode from the result, which can change mid-session", () => {
    const state = apply(createChatState(), { type: "result", fast_mode_state: "on" });
    expect(state.fastMode).toBe("on");
  });

  it("clears a compaction that was still showing", () => {
    const state = apply({ ...createChatState(), compacting: true }, { type: "result" });
    expect(state.compacting).toBe(false);
  });
});

describe("an interrupted turn", () => {
  it("is recorded as a notice, because the reader asked for it", () => {
    const state = applyClaudeMessage(
      { ...createChatState(), busy: true, streaming: "half" },
      { type: "result", is_error: true },
      { interrupted: true },
    );

    expect(entriesOf(state, "error")).toHaveLength(0);
    const [notice] = entriesOf(state, "notice");
    expect(notice.role === "notice" && notice.text).toBe("You interrupted the turn.");
  });

  it("ends the turn like any other result", () => {
    const state = applyClaudeMessage(
      { ...createChatState(), busy: true },
      { type: "result" },
      { interrupted: true },
    );

    expect(state.busy).toBe(false);
    expect(state.streaming).toBe("");
  });

  it("is not assumed when nothing asked for one", () => {
    const state = apply(createChatState(), { type: "result", is_error: true, result: "it broke" });

    expect(entriesOf(state, "notice")).toHaveLength(0);
    expect((entriesOf(state, "error")[0] as { text: string }).text).toBe("it broke");
  });

  it("still shows the CLI's own words when it supplied none of its own", () => {
    const state = applyClaudeMessage(
      createChatState(),
      { type: "result", is_error: true },
      { interrupted: false },
    );

    expect((entriesOf(state, "error")[0] as { text: string }).text).toBe(
      "The turn ended with an error.",
    );
  });
});

describe("the queued mark", () => {
  const queued = (state: ChatState): boolean[] =>
    entriesOf(state, "user").map((entry) => entry.role === "user" && entry.queued === true);

  it("is set on a message sent while a turn was already running", () => {
    expect(queued(withUserMessage(createChatState(), "second", true))).toEqual([true]);
  });

  it("is absent from a message that started the turn", () => {
    expect(queued(withUserMessage(createChatState(), "first"))).toEqual([false]);
  });

  it("comes off every waiting message once the turn ends", () => {
    const waiting = withUserMessage(withUserMessage(createChatState(), "first"), "second", true);
    expect(queued(waiting)).toEqual([false, true]);

    expect(queued(apply(waiting, { type: "result" }))).toEqual([false, false]);
  });

  /// A compaction is a turn in its own right: the CLI takes whatever was sent
  /// while it ran as soon as it finishes, so the label must not outlive it.
  it("comes off when a compaction ends, because that turn has finished", () => {
    const compacting: ChatState = {
      ...withUserMessage(createChatState(), "second", true),
      busy: true,
      compacting: true,
    };

    const state = apply(compacting, { type: "system", subtype: "compact_boundary" });

    expect(queued(state)).toEqual([false]);
    expect(state.compacting).toBe(false);
  });

  it("survives everything that is not the end of a turn", () => {
    const waiting = withUserMessage(createChatState(), "second", true);
    const streamed = apply(waiting, {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "…" } },
    });

    expect(queued(streamed)).toEqual([true]);
  });

  it("leaves other roles untouched", () => {
    const state = apply(
      apply(createChatState(), {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      }),
      { type: "result" },
    );

    expect(entriesOf(state, "assistant")).toHaveLength(1);
  });
});

describe("subagent output", () => {
  const withAgent = (): ChatState =>
    apply(createChatState(), {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "task-1", name: "Task", input: { description: "Explore" } },
        ],
      },
    });

  it("files a subagent's reply inside its own card", () => {
    const state = apply(withAgent(), {
      type: "assistant",
      parent_tool_use_id: "task-1",
      message: { content: [{ type: "text", text: "found it" }] },
    });

    const [agent] = entriesOf(state, "subagent");
    expect(agent.role === "subagent" && agent.entries).toHaveLength(1);
    expect(entriesOf(state, "assistant")).toHaveLength(0);
  });

  it("pairs a subagent's tool results with its own calls", () => {
    const withCall = apply(withAgent(), {
      type: "assistant",
      parent_tool_use_id: "task-1",
      message: { content: [{ type: "tool_use", id: "sub-tool", name: "Bash", input: {} }] },
    });
    const withResult = apply(withCall, {
      type: "user",
      parent_tool_use_id: "task-1",
      message: { content: [{ type: "tool_result", tool_use_id: "sub-tool", content: "done" }] },
    });

    const agent = entriesOf(withResult, "subagent")[0];
    if (agent.role !== "subagent") throw new Error("expected a subagent card");
    expect(agent.entries[0].role === "tool" && agent.entries[0].result).toBe("done");
  });

  it("attaches a subagent's hooks to its own calls", () => {
    const withCall = apply(withAgent(), {
      type: "assistant",
      parent_tool_use_id: "task-1",
      message: { content: [{ type: "tool_use", id: "sub-tool", name: "Bash", input: {} }] },
    });
    const withHook = apply(withCall, {
      type: "system",
      subtype: "hook_response",
      parent_tool_use_id: "task-1",
      hook_name: "PreToolUse:Bash",
      exit_code: 0,
    });

    const agent = entriesOf(withHook, "subagent")[0];
    if (agent.role !== "subagent") throw new Error("expected a subagent card");
    expect(agent.entries[0].role === "tool" && agent.entries[0].hooks).toHaveLength(1);
  });

  it("records the subagent's closing report, which arrives untagged on the main stream", () => {
    const state = apply(withAgent(), {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "task-1", content: "report" }] },
    });

    const agent = entriesOf(state, "subagent")[0];
    expect(agent.role === "subagent" && agent.result).toBe("report");
    expect(agent.role === "subagent" && agent.status).toBe("ok");
  });

  it("ignores output tagged with a call it never saw", () => {
    const state = withAgent();
    expect(
      apply(state, { type: "assistant", parent_tool_use_id: "gone", message: { content: [] } }),
    ).toBe(state);
  });

  it("leaves the state alone for a tagged event type it does not file", () => {
    const state = withAgent();
    expect(apply(state, { type: "result", parent_tool_use_id: "task-1" })).toBe(state);
  });
});
