import type { ChatEntry, ChatState } from "../types";
import { readFastMode, readNames, readPlugins } from "./controlProtocol";
import { describeToolUse } from "./describeToolUse";
import { asArray, asNumber, asRecord, asText, type Json, parseJsonLine, prettyJson } from "./json";
import { nextId } from "./nextId";
import {
  describeToolResult,
  type HookNote,
  hookMatcher,
  readHookNote,
  readResultText,
} from "./toolResults";

function appendEntry(state: ChatState, entry: ChatEntry): ChatState {
  return { ...state, entries: [...state.entries, entry] };
}

/**
 * Joins the field of every content block of one kind.
 *
 * Text and reasoning blocks both carry their body in a field named after their
 * own type — `text` and `thinking` — so one reader covers both.
 *
 * @param content - A content-block array.
 * @param kind - The block type to collect.
 * @returns The concatenated bodies, or an empty string.
 */
function joinBlocks(content: unknown, kind: string): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const record = asRecord(block);
      return record && record.type === kind ? asText(record[kind]) : "";
    })
    .join("");
}

/**
 * Joins the text of every `text` block in an Anthropic content-block array.
 *
 * @param content - A content-block array, or a plain string.
 * @returns The concatenated text, or an empty string.
 */
export function readTextBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  return joinBlocks(content, "text");
}

/**
 * Joins the reasoning in every `thinking` block of an Anthropic content-block
 * array.
 *
 * @param content - A content-block array.
 * @returns The concatenated reasoning, or an empty string.
 */
export function readThinkingBlocks(content: unknown): string {
  return joinBlocks(content, "thinking");
}

/**
 * Finds the last thing Claude said in the transcript.
 *
 * A plan is written as an ordinary reply and the `ExitPlanMode` call that
 * follows carries none of it, so this is where the plan's text is read from.
 *
 * @param state - The current chat state.
 * @returns The most recent assistant text, or an empty string.
 */
export function latestAssistantText(state: ChatState): string {
  for (let index = state.entries.length - 1; index >= 0; index -= 1) {
    const entry = state.entries[index];
    if (entry.role === "assistant" && entry.text.trim().length > 0) return entry.text;
  }
  return "";
}

/**
 * Lists the `tool_use` blocks in an Anthropic content-block array.
 *
 * @param content - A content-block array.
 * @returns Each tool's id, name and raw input.
 */
export function readToolUses(
  content: unknown,
): Array<{ id: string; name: string; input: unknown }> {
  if (!Array.isArray(content)) return [];
  const uses: Array<{ id: string; name: string; input: unknown }> = [];
  for (const block of content) {
    const record = asRecord(block);
    if (record && record.type === "tool_use") {
      uses.push({
        id: asText(record.id),
        name: asText(record.name),
        input: record.input,
      });
    }
  }
  return uses;
}

/**
 * Records a message the user sent and marks the session busy.
 *
 * @param state - The current chat state.
 * @param text - The message text.
 * @param queued - True when a turn was already running, so the CLI has yet to
 *   pick this message up.
 * @returns The updated chat state.
 */
export function withUserMessage(state: ChatState, text: string, queued = false): ChatState {
  return {
    ...state,
    busy: true,
    thinkingTokens: 0,
    suggestion: null,
    entries: [...state.entries, { id: nextId("user"), role: "user", text, queued }],
  };
}

/**
 * Records a failure that did not come from the Claude event stream.
 *
 * @param state - The current chat state.
 * @param text - A description of the failure.
 * @returns The updated chat state.
 */
export function withError(state: ChatState, text: string): ChatState {
  return {
    ...state,
    busy: false,
    streaming: "",
    entries: [...state.entries, { id: nextId("error"), role: "error", text }],
  };
}

/**
 * Records a local notice that did not come from the Claude stream.
 *
 * @param state - The current chat state.
 * @param text - The notice text.
 * @returns The updated chat state.
 */
export function withNotice(state: ChatState, text: string): ChatState {
  return {
    ...state,
    entries: [...state.entries, { id: nextId("notice"), role: "notice", text }],
  };
}

/**
 * Records a local command in the transcript, before it has finished.
 *
 * @param state - The current chat state.
 * @param id - The entry's id, used again to record the result.
 * @param command - The command, without its leading `!`.
 * @returns The updated chat state.
 */
export function withShellCommand(state: ChatState, id: string, command: string): ChatState {
  return {
    ...state,
    entries: [
      ...state.entries,
      { id, role: "shell", command, stdout: "", stderr: "", code: null, running: true },
    ],
  };
}

/**
 * Fills in what a local command produced.
 *
 * @param state - The current chat state.
 * @param id - The entry's id.
 * @param output - What the command printed and the code it exited with.
 * @returns The updated chat state.
 */
export function withShellResult(
  state: ChatState,
  id: string,
  output: { stdout: string; stderr: string; code: number | null },
): ChatState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === id && entry.role === "shell" ? { ...entry, ...output, running: false } : entry,
    ),
  };
}

/**
 * Replaces the transcript with messages replayed from a stored session.
 *
 * @param state - The current chat state.
 * @param messages - The exchanges to show, oldest first.
 * @returns The updated chat state.
 */
export function withHistory(
  state: ChatState,
  messages: Array<{ role: string; text: string }>,
): ChatState {
  const entries: ChatEntry[] = messages.map((message) => ({
    id: nextId(message.role),
    role: message.role === "assistant" ? "assistant" : "user",
    text: message.text,
  }));
  return { ...state, entries, streaming: "", busy: false };
}

/** What the caller knows about an event that the event itself does not say. */
export type ApplyOptions = {
  /** True when this result is the one that answers an interrupt we asked for. */
  interrupted?: boolean;
};

/**
 * Applies one newline-delimited JSON event from a Claude session.
 *
 * Control messages are handled by the session hook rather than here, because
 * answering them is a side effect rather than a change to the transcript.
 *
 * @param state - The current chat state.
 * @param line - One line of stream-json output.
 * @param options - What the caller knows about the event.
 * @returns The updated chat state.
 */
export function applyClaudeLine(
  state: ChatState,
  line: string,
  options: ApplyOptions = {},
): ChatState {
  const message = parseJsonLine(line);
  return message ? applyClaudeMessage(state, message, options) : state;
}

/**
 * Applies one already-decoded event from a Claude session.
 *
 * The hook decodes each line once to look for control messages, so it hands the
 * decoded object on rather than making this parse the same line again.
 *
 * @param state - The current chat state.
 * @param message - The decoded stream-json event.
 * @param options - What the caller knows about the event.
 * @returns The updated chat state.
 */
export function applyClaudeMessage(
  state: ChatState,
  message: Json,
  options: ApplyOptions = {},
): ChatState {
  // Subagent output rides the same stream as everything else and is told apart
  // only by the call it belongs to, so it is routed before anything else can
  // mistake it for the main conversation.
  const parent = asText(message.parent_tool_use_id);
  if (parent) return withSubagentOutput(state, parent, message);

  switch (asText(message.type)) {
    case "system":
      return applySystemEvent(state, message);
    case "stream_event":
      return applyStreamEvent(state, message);
    case "assistant":
      return applyAssistantEvent(state, message);
    case "user":
      return applyUserEvent(state, message);
    case "result":
      return applyResultEvent(state, message, options.interrupted === true);
    case "prompt_suggestion":
      return { ...state, suggestion: asText(message.suggestion) || null };
    default:
      return state;
  }
}

/**
 * Records what a subagent produced, inside the card of the call that spawned it.
 *
 * A subagent's frames carry the `tool_use_id` of its spawning call, so they are
 * filed under that card rather than being interleaved with the main
 * conversation, where they would read as things the main agent said.
 *
 * @param state - The current chat state.
 * @param parentId - The spawning call's tool-use id.
 * @param message - The tagged event.
 * @returns The updated chat state.
 */
function withSubagentOutput(state: ChatState, parentId: string, message: Json): ChatState {
  const index = state.entries.findIndex(
    (entry) => entry.role === "subagent" && entry.toolUseId === parentId,
  );
  const agent = index >= 0 ? state.entries[index] : null;
  if (agent?.role !== "subagent") return state;

  const kind = asText(message.type);
  let inner = agent.entries;

  if (kind === "assistant") {
    const additions = assistantEntries(asRecord(message.message)?.content);
    if (additions.length === 0) return state;
    inner = [...inner, ...additions];
  } else if (kind === "user") {
    inner = withToolResults(inner, message);
  } else if (kind === "system" && asText(message.subtype) === "hook_response") {
    inner = withHook(inner, readHookNote(message));
  } else {
    return state;
  }

  if (inner === agent.entries) return state;
  const entries = [...state.entries];
  entries[index] = { ...agent, entries: inner };
  return { ...state, entries };
}

/** Tools that start an agent rather than doing their own work. */
const SUBAGENT_TOOLS = ["Task", "Agent"];

/**
 * Builds the transcript entry for one tool call.
 *
 * A call that spawns a subagent becomes a card holding that agent's own
 * conversation rather than a leaf, so the two are told apart here and nowhere
 * else.
 *
 * @param tool - The call's id, name and input.
 * @returns The entry to record it as.
 */
function toolEntry(tool: { id: string; name: string; input: unknown }): ChatEntry {
  if (SUBAGENT_TOOLS.includes(tool.name)) {
    return {
      id: tool.id ? `tool:${tool.id}` : nextId("subagent"),
      role: "subagent",
      toolUseId: tool.id,
      label: describeToolUse(tool.name, tool.input) || tool.name,
      input: prettyJson(tool.input ?? {}),
      result: "",
      status: "running",
      entries: [],
    };
  }

  return {
    id: tool.id ? `tool:${tool.id}` : nextId("tool"),
    role: "tool",
    toolUseId: tool.id,
    name: tool.name,
    detail: describeToolUse(tool.name, tool.input),
    input: prettyJson(tool.input ?? {}),
    result: "",
    status: "running",
    hooks: [],
  };
}

/**
 * Turns one completed assistant message into transcript entries.
 *
 * Reasoning is recorded before the reply it produced, which is the order the
 * content blocks arrive in and the order it was thought in.
 *
 * @param content - The message's content-block array.
 * @returns The entries it contributes, which may be none.
 */
function assistantEntries(content: unknown): ChatEntry[] {
  const additions: ChatEntry[] = [];

  const thinking = readThinkingBlocks(content);
  if (thinking.trim().length > 0) {
    additions.push({ id: nextId("thinking"), role: "thinking", text: thinking });
  }

  const text = readTextBlocks(content);
  if (text.trim().length > 0) {
    additions.push({ id: nextId("assistant"), role: "assistant", text });
  }

  for (const tool of readToolUses(content)) additions.push(toolEntry(tool));

  return additions;
}

/**
 * Fills in what the tools in one `user` message produced.
 *
 * `tool_use_result` describes the message rather than any one block, so it is
 * only attached when the message carries a single result. Parallel calls share
 * one message, and giving each of them that one object would show every card
 * the same output and lose the rest.
 *
 * @param entries - The entries to update.
 * @param message - The decoded `user` line.
 * @returns The updated entries, or the same array when it carried no results.
 */
function withToolResults(entries: ChatEntry[], message: Json): ChatEntry[] {
  const content = asRecord(message.message)?.content;
  const results = asArray(content)
    .map(asRecord)
    .filter((block): block is Json => block !== null && asText(block.type) === "tool_result");
  if (results.length === 0) return entries;

  const structured = results.length === 1 ? message.tool_use_result : undefined;
  const next = [...entries];

  for (const block of results) {
    const toolUseId = asText(block.tool_use_id);
    const isError = block.is_error === true;
    const text = readResultText(block.content);
    const index = next.findIndex(
      (entry) =>
        (entry.role === "tool" || entry.role === "subagent") && entry.toolUseId === toolUseId,
    );
    const existing = index >= 0 ? next[index] : null;

    if (existing && existing.role === "tool") {
      next[index] = {
        ...existing,
        result: describeToolResult(existing.name, structured, text),
        status: isError ? "error" : "ok",
      };
      continue;
    }

    if (existing && existing.role === "subagent") {
      next[index] = { ...existing, result: text, status: isError ? "error" : "ok" };
      continue;
    }

    next.push({
      id: nextId("tool"),
      role: "tool",
      toolUseId,
      name: "Tool result",
      detail: "",
      input: "",
      result: text,
      status: isError ? "error" : "ok",
      hooks: [],
    });
  }

  return next;
}

/**
 * Attaches a hook's outcome to the tool call it most likely surrounds.
 *
 * Hook events do not carry a tool-use id, so the call is matched by the hook's
 * own matcher (`PreToolUse:Bash` → `Bash`) against the newest matching call
 * that has not finished. Where nothing matches, a failing hook is surfaced on
 * its own rather than being dropped.
 *
 * @param entries - The entries to update.
 * @param note - The hook that just finished, or null when the line was not one.
 * @returns The updated entries, or the same array when nothing changed.
 */
function withHook(entries: ChatEntry[], note: HookNote | null): ChatEntry[] {
  if (!note) return entries;
  const failed = note.exitCode !== null && note.exitCode !== 0;
  const matcher = hookMatcher(note.name);

  if (matcher) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.role !== "tool" || entry.name !== matcher) continue;
      const next = [...entries];
      next[index] = { ...entry, hooks: [...entry.hooks, note] };
      return next;
    }
  }

  if (!failed) return entries;
  return [
    ...entries,
    {
      id: nextId("notice"),
      role: "notice",
      text: `Hook ${note.name} exited ${note.exitCode}${note.output ? `: ${note.output.trim()}` : ""}`,
    },
  ];
}

/**
 * Records what a payload says about fast mode.
 *
 * Both `initialize` and every result message carry the fields, so whichever
 * arrived most recently is the current answer.
 *
 * @param state - The current chat state.
 * @param payload - The event or response body to read.
 * @returns The updated chat state.
 */
function withFastMode(state: ChatState, payload: Json): ChatState {
  const reading = readFastMode(payload);
  if (!reading) return state;
  if (reading.state === state.fastMode && reading.reason === state.fastModeReason) return state;
  return { ...state, fastMode: reading.state, fastModeReason: reading.reason };
}

function applySystemEvent(state: ChatState, message: Json): ChatState {
  const subtype = asText(message.subtype);

  if (subtype === "init") {
    const servers = asArray(message.mcp_servers).flatMap((entry) => {
      const record = asRecord(entry);
      const name = record ? asText(record.name) : "";
      return name ? [{ name, status: asText(record?.status) || "unknown" }] : [];
    });
    const plugins = readPlugins(message.plugins);
    const skills = readNames(message.skills);
    return withFastMode(
      {
        ...state,
        sessionId: asText(message.session_id) || state.sessionId,
        // The CLI repeats this event when the session's directory changes, so
        // this is what keeps the header's path current.
        cwd: asText(message.cwd) || state.cwd,
        model: asText(message.model) || state.model,
        permissionMode: asText(message.permissionMode) || state.permissionMode,
        mcpServers: servers.length > 0 ? servers : state.mcpServers,
        plugins: plugins.length > 0 ? plugins : state.plugins,
        skills: skills.length > 0 ? skills : state.skills,
      },
      message,
    );
  }

  if (subtype === "hook_response") {
    const entries = withHook(state.entries, readHookNote(message));
    return entries === state.entries ? state : { ...state, entries };
  }

  if (subtype === "permission_denied") {
    return appendEntry(state, {
      id: nextId("notice"),
      role: "notice",
      text: `Permission denied for ${asText(message.tool_name) || "a tool"}.`,
    });
  }

  if (subtype === "status") {
    const status = asText(message.status);
    if (status === "requesting") return { ...state, busy: true };
    if (status === "idle") return { ...state, busy: false, compacting: false };
    if (status === "compacting") return { ...state, busy: true, compacting: true };
  }

  if (subtype === "thinking_tokens") {
    const tokens = asNumber(message.estimated_tokens);
    if (tokens === null || tokens === state.thinkingTokens) return state;
    return { ...state, thinkingTokens: tokens };
  }

  if (subtype === "compact_boundary") return applyCompactBoundary(state, message);

  return state;
}

/**
 * Records the end of a compaction.
 *
 * The CLI reports this as a boundary carrying token counts rather than as a
 * series of progress steps, so this is where the only real figures come from —
 * and it is what the bar is waiting on to disappear.
 */
function applyCompactBoundary(state: ChatState, message: Json): ChatState {
  const metadata = asRecord(message.compact_metadata);
  const before = asNumber(metadata?.pre_tokens) ?? 0;
  const after = asNumber(metadata?.post_tokens) ?? 0;
  const dropped = asNumber(metadata?.cumulative_dropped_tokens) ?? Math.max(0, before - after);

  return {
    ...state,
    busy: false,
    compacting: false,
    entries: [
      ...state.entries,
      {
        id: nextId("notice"),
        role: "notice",
        text: `Compacted: ${before.toLocaleString()} → ${after.toLocaleString()} tokens, ${dropped.toLocaleString()} freed.`,
      },
    ],
  };
}

function applyStreamEvent(state: ChatState, message: Json): ChatState {
  const event = asRecord(message.event);
  if (!event || asText(event.type) !== "content_block_delta") return state;
  const delta = asRecord(event.delta);
  if (!delta || asText(delta.type) !== "text_delta") return state;
  const text = asText(delta.text);
  return text.length > 0 ? { ...state, streaming: state.streaming + text } : state;
}

/**
 * Records the entries one completed assistant message contributes.
 *
 * @param state - The current chat state.
 * @param message - A decoded `assistant` line.
 * @returns The updated chat state.
 */
function applyAssistantEvent(state: ChatState, message: Json): ChatState {
  const additions = assistantEntries(asRecord(message.message)?.content);
  if (additions.length === 0 && state.streaming.length === 0) return state;
  return { ...state, entries: [...state.entries, ...additions], streaming: "" };
}

/**
 * Fills in what the tools in one `user` message produced.
 *
 * @param state - The current chat state.
 * @param message - A decoded `user` line.
 * @returns The updated chat state.
 */
function applyUserEvent(state: ChatState, message: Json): ChatState {
  const entries = withToolResults(state.entries, message);
  return entries === state.entries ? state : { ...state, entries };
}

/**
 * Records the end of a turn.
 *
 * An interrupt is reported as an error by the CLI, but it is not one: the user
 * asked for it, so it is recorded as a notice instead. The CLI says nothing
 * useful in that case, which is what leaves a bare "an error occurred" to be
 * shown otherwise.
 *
 * A turn ending is also what tells the CLI to pick up anything the user sent
 * while it was working, so the queued marks come off here.
 *
 * @param state - The current chat state.
 * @param message - A decoded `result` line.
 * @param interrupted - True when this is the result of an interrupt we asked for.
 * @returns The updated chat state.
 */
function applyResultEvent(state: ChatState, message: Json, interrupted: boolean): ChatState {
  let next = state;
  const additions: ChatEntry[] = [];

  if (interrupted) {
    additions.push({
      id: nextId("notice"),
      role: "notice",
      text: "You interrupted the turn.",
    });
  } else if (message.is_error === true) {
    additions.push({
      id: nextId("error"),
      role: "error",
      text: asText(message.result) || "The turn ended with an error.",
    });
  }

  const denials = asArray(message.permission_denials).flatMap((entry): ChatEntry[] => {
    const record = asRecord(entry);
    const tool = record ? asText(record.tool_name) : "";
    return tool
      ? [
          {
            id: nextId("notice"),
            role: "notice" as const,
            text: `${tool} was denied and did not run.`,
          },
        ]
      : [];
  });

  next = {
    ...state,
    entries: [...withSettledQueue(state.entries), ...additions, ...denials],
    streaming: "",
    busy: false,
    compacting: false,
    thinkingTokens: 0,
    costUsd: asNumber(message.total_cost_usd) ?? state.costUsd,
  };

  return withFastMode(next, message);
}

/**
 * Takes the queued mark off every message waiting to be picked up.
 *
 * @param entries - The transcript entries.
 * @returns The entries, with nothing left marked as queued.
 */
function withSettledQueue(entries: ChatEntry[]): ChatEntry[] {
  return entries.map((entry) =>
    entry.role === "user" && entry.queued === true ? { ...entry, queued: false } : entry,
  );
}
