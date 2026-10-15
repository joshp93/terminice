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
  withTurnOver,
  withUserMessage,
} from "./claudeProtocol";
import type { Json } from "./json";
import { runningGroups } from "./runningTools";

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

  /// A turn can end without ever producing a `result` — the process exits, the
  /// CLI reports itself idle, a failure is recorded from outside the stream. A
  /// message left waiting through one of those is one the reader can neither see
  /// in the transcript nor reach with the arrow keys, because a message with no
  /// row is a message the walk cannot land on.
  it("comes off when a failure ends the turn", () => {
    const waiting = withUserMessage(createChatState(), "second", true);

    expect(queued(withError(waiting, "the process went away"))).toEqual([false]);
  });

  it("comes off when the CLI reports itself idle", () => {
    const waiting = withUserMessage(createChatState(), "second", true);

    const state = apply(waiting, { type: "system", subtype: "status", status: "idle" });

    expect(queued(state)).toEqual([false]);
    expect(state.busy).toBe(false);
  });

  it("comes off when a turn is closed out directly", () => {
    const waiting = withUserMessage(createChatState(), "second", true);

    const over = withTurnOver(waiting);

    expect(queued(over)).toEqual([false]);
    expect(over.busy).toBe(false);
    expect(over.streaming).toBe("");
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

  /// An agent started in the background is answered the moment it is started —
  /// "Async agent launched successfully" — and then works for minutes. Reading
  /// that acknowledgement as the agent's outcome is what used to drop it out of
  /// the tracker below the composer while it was still running.
  it("keeps a background agent running through the acknowledgement that started it", () => {
    const state = apply(withAgent(), {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "task-1", content: "ack" }] },
      tool_use_result: { isAsync: true, status: "async_launched", agentId: "a1" },
    });

    const agent = entriesOf(state, "subagent")[0];
    expect(agent.role === "subagent" && agent.status).toBe("running");
    expect(agent.role === "subagent" && agent.result).toBe("");
    expect(runningGroups(state).map((group) => group.kind)).toEqual(["agent"]);
  });

  /// Two calls made in parallel share one frame, and that frame carries no
  /// structured result at all — so the acknowledgement's own wording is what
  /// tells it apart from an agent's report there.
  it("keeps it running when the acknowledgement shares a frame with another result", () => {
    const state = apply(withAgent(), {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "task-1",
            content: "Async agent launched successfully. (This tool result is internal metadata.)",
          },
          { type: "tool_result", tool_use_id: "other", content: "output" },
        ],
      },
    });

    const agent = entriesOf(state, "subagent")[0];
    expect(agent.role === "subagent" && agent.status).toBe("running");
  });

  /// The CLI reports the end of a task itself, naming the call the agent was
  /// started by — which is the only thing that ends a background agent, since
  /// its call was answered before it did any work.
  it("ends a background agent on the task the CLI says has finished", () => {
    const started = apply(withAgent(), {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "task-1", content: "ack" }] },
      tool_use_result: { isAsync: true, status: "async_launched" },
    });

    const state = apply(started, {
      type: "system",
      subtype: "task_notification",
      task_id: "a1",
      tool_use_id: "task-1",
      status: "completed",
      summary: 'Agent "Explore" finished',
      usage: { total_tokens: 24_945, tool_uses: 4, duration_ms: 5692 },
    });

    const agent = entriesOf(state, "subagent")[0];
    expect(agent.role === "subagent" && agent.status).toBe("ok");
    expect(agent.role === "subagent" && agent.result).toBe('Agent "Explore" finished');
    expect(agent.role === "subagent" && agent.usage?.toolUses).toBe(4);
    expect(runningGroups(state)).toEqual([]);
  });

  it("ends one on the update that came before the notification", () => {
    const state = apply(withAgent(), {
      type: "system",
      subtype: "task_updated",
      task_id: "a1",
      tool_use_id: "task-1",
      patch: { status: "completed", end_time: 1 },
    });

    const agent = entriesOf(state, "subagent")[0];
    expect(agent.role === "subagent" && agent.status).toBe("ok");
  });

  it("records a background agent that failed as having failed", () => {
    const state = apply(withAgent(), {
      type: "system",
      subtype: "task_notification",
      tool_use_id: "task-1",
      status: "failed",
      summary: "it broke",
    });

    const agent = entriesOf(state, "subagent")[0];
    expect(agent.role === "subagent" && agent.status).toBe("error");
    expect(agent.role === "subagent" && agent.result).toBe("it broke");
  });

  /// A task started in the background is one whose work outlives the call that
  /// started it, which is what the card's own line has to say.
  it("marks an agent the CLI started in the background", () => {
    const state = apply(withAgent(), {
      type: "system",
      subtype: "task_started",
      task_id: "a1",
      tool_use_id: "task-1",
      description: "Explore",
      is_backgrounded: true,
    });

    const agent = entriesOf(state, "subagent")[0];
    expect(agent.role === "subagent" && agent.background).toBe(true);
    expect(agent.role === "subagent" && agent.status).toBe("running");
    expect(runningGroups(state).map((group) => group.kind)).toEqual(["agent"]);
  });

  /// What a running task reports about itself is the only sign of life a
  /// background agent gives, so it is kept while it works.
  it("records what a running task has done so far", () => {
    const state = apply(withAgent(), {
      type: "system",
      subtype: "task_progress",
      task_id: "a1",
      tool_use_id: "task-1",
      usage: { total_tokens: 24_894, tool_uses: 3, duration_ms: 3951 },
      last_tool_name: "Read",
    });

    const agent = entriesOf(state, "subagent")[0];
    expect(agent.role === "subagent" && agent.progress).toEqual({
      tokens: 24_894,
      toolUses: 3,
      durationMs: 3951,
      lastTool: "Read",
    });
    expect(agent.role === "subagent" && agent.status).toBe("running");
  });

  /// A task the app never saw the call for has no card to report to.
  it("ignores a task event for a call it never saw", () => {
    const state = withAgent();

    expect(
      apply(state, { type: "system", subtype: "task_notification", tool_use_id: "gone" }),
    ).toBe(state);
  });

  /// A watcher reports on itself with no call behind it, so there is no card to
  /// finish and the frame is left to mean whatever it otherwise would.
  it("leaves a report about no call alone", () => {
    const state = withAgent();
    const notified = apply(state, {
      type: "user",
      attachment: {
        type: "queued_command",
        prompt:
          "<task-notification>\n<task-id>b0n</task-id>\n<summary>Monitor expired</summary></task-notification>",
      },
    });

    expect(notified).toBe(state);
  });

  /// A background agent's spawning call was answered before it did any work, so
  /// its frames arrive under the agent's own id rather than the call's. The
  /// acknowledgement names it, and that is what makes the card findable.
  it("files a background agent's frames under the agent's own id", () => {
    const started = apply(withAgent(), {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "task-1", content: "ack" }] },
      tool_use_result: { isAsync: true, status: "async_launched", agentId: "agent-7" },
    });

    const state = apply(started, {
      type: "assistant",
      parent_tool_use_id: "agent-7",
      message: { content: [{ type: "text", text: "looking at it" }] },
    });

    const [agent] = entriesOf(state, "subagent");
    expect(agent.role === "subagent" && agent.entries).toHaveLength(1);
    expect(entriesOf(state, "assistant")).toHaveLength(0);
  });

  /// A frame tagged with an id no card answers to still came from somewhere, and
  /// with one agent running there is only one place it could have come from.
  it("files an unrecognised tag against the only agent running", () => {
    const state = apply(withAgent(), {
      type: "assistant",
      parent_tool_use_id: "some-other-name",
      message: { content: [{ type: "text", text: "still working" }] },
    });

    const [agent] = entriesOf(state, "subagent");
    expect(agent.role === "subagent" && agent.entries).toHaveLength(1);
  });

  /// Two agents running is where that reasoning stops: a mistaken attribution
  /// would read as something the other agent said, which is worse than a frame
  /// that is not shown.
  it("drops a frame it cannot place when several agents are running", () => {
    const second = apply(withAgent(), {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "task-2", name: "Task", input: { description: "Other" } },
        ],
      },
    });

    const state = apply(second, {
      type: "assistant",
      parent_tool_use_id: "some-other-name",
      message: { content: [{ type: "text", text: "unplaceable" }] },
    });

    expect(state).toBe(second);
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

describe("what a session has spent", () => {
  /** One completed assistant message, reporting what the call cost in tokens. */
  const replied = (usage: Json, extra: Json = {}): Json => ({
    type: "assistant",
    message: { content: [{ type: "text", text: "hi" }], usage, ...extra },
  });

  it("counts the tokens of each message as they arrive", () => {
    const once = apply(
      createChatState(),
      replied({
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 5,
      }),
    );

    expect(once.tokens).toEqual({ input: 100, output: 20, cacheRead: 1000, cacheWrite: 5 });

    const twice = apply(once, replied({ input_tokens: 50, output_tokens: 10 }));
    expect(twice.tokens).toEqual({ input: 150, output: 30, cacheRead: 1000, cacheWrite: 5 });
  });

  /// A subagent's calls are billed to the same session, so what it spends is
  /// counted with everything else even though its words go inside its card.
  it("counts a subagent's own calls with the rest of the session", () => {
    const withCall = apply(createChatState(), replied({ input_tokens: 10 }, {}));
    const state = apply(
      {
        ...withCall,
        entries: [
          ...withCall.entries,
          {
            id: "tool:task-1",
            role: "subagent" as const,
            toolUseId: "task-1",
            label: "Explore",
            input: "",
            result: "",
            status: "running" as const,
            entries: [],
          },
        ],
      },
      {
        type: "assistant",
        parent_tool_use_id: "task-1",
        message: {
          content: [{ type: "text", text: "found it" }],
          usage: { input_tokens: 500, output_tokens: 90 },
        },
      },
    );

    expect(state.tokens.input).toBe(510);
    expect(state.tokens.output).toBe(90);
  });

  /// A streamed delta is part of a message that will arrive whole later, and the
  /// count for it is on that message. Counting both would count it twice.
  it("counts nothing for the deltas a message is streamed in", () => {
    const state = apply(createChatState(), {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "h" } },
    });

    expect(state.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("takes the CLI's word for it that the model cannot be priced", () => {
    const state = apply(createChatState(), {
      type: "result",
      total_cost_usd: 1.77,
      has_unknown_model_cost: true,
    });

    expect(state.costUnknown).toBe(true);
    expect(state.costUsd).toBe(1.77);
  });

  it("keeps saying so once the CLI has", () => {
    const flagged = apply(createChatState(), { type: "result", has_unknown_model_cost: true });

    expect(apply(flagged, { type: "result", total_cost_usd: 2 }).costUnknown).toBe(true);
  });
});

describe("a mode the session changed without being asked", () => {
  /// Claude enters plan mode itself, and the CLI reports that on a frame of its
  /// own rather than in a reply to anything — which the header's button has to
  /// follow, since a mode that is only read back from what the host asked for
  /// goes stale the moment the agent changes it.
  it("follows the mode the CLI reports on its own frame", () => {
    const state = apply(createChatState(), { type: "permission-mode", permissionMode: "plan" });

    expect(state.permissionMode).toBe("plan");
  });

  it("reads the mode under either spelling of the field", () => {
    expect(
      apply(createChatState(), { type: "system", permission_mode: "acceptEdits" }).permissionMode,
    ).toBe("acceptEdits");
  });

  /// The frame is read for a mode and then goes on to mean whatever it meant:
  /// a frame that both changed the mode and did something else does both.
  it("does not swallow the rest of the frame", () => {
    const state = apply(createChatState(), {
      type: "assistant",
      permissionMode: "plan",
      message: { content: [{ type: "text", text: "here is my plan" }] },
    });

    expect(state.permissionMode).toBe("plan");
    expect(entriesOf(state, "assistant")).toHaveLength(1);
  });

  /// A subagent's frames are not the session's: they are filed inside the card
  /// of the agent they came from, and the mode is not the agent's to change.
  it("leaves the mode alone for a frame from inside an agent", () => {
    const withAgent = apply(createChatState(), {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "task-1", name: "Task", input: {} }] },
    });

    const state = apply(withAgent, {
      type: "assistant",
      parent_tool_use_id: "task-1",
      permissionMode: "plan",
      message: { content: [{ type: "text", text: "working" }] },
    });

    expect(state.permissionMode).toBe("default");
  });

  it("says nothing when the frame carries no mode", () => {
    const state = createChatState();

    expect(apply(state, { type: "result" })).not.toBe(state);
    expect(apply(createChatState(), { type: "keep_alive" })).toEqual(state);
  });
});
