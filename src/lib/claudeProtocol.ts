import { describeToolUse } from "./describeToolUse";
import {
  readNames,
  readPlugins,
} from "./controlProtocol";
import { asArray, asNumber, asRecord, asText, parseJsonLine, prettyJson, type Json } from "./json";
import { nextId } from "./nextId";
import { describeToolResult, hookMatcher, readHookNote, readResultText } from "./toolResults";
import type { ChatEntry, ChatState } from "../types";

function appendEntry(state: ChatState, entry: ChatEntry): ChatState {
  return { ...state, entries: [...state.entries, entry] };
}

/**
 * Joins the text of every `text` block in an Anthropic content-block array.
 *
 * @param content - A content-block array, or a plain string.
 * @returns The concatenated text, or an empty string.
 */
export function readTextBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const record = asRecord(block);
      return record && record.type === "text" ? asText(record.text) : "";
    })
    .join("");
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
 * @returns The updated chat state.
 */
export function withUserMessage(state: ChatState, text: string): ChatState {
  return {
    ...state,
    busy: true,
    entries: [...state.entries, { id: nextId("user"), role: "user", text }],
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
 * Empties the transcript while keeping the session's metadata.
 *
 * @param state - The current chat state.
 * @returns The chat state with no entries.
 */
export function withEmptyTranscript(state: ChatState): ChatState {
  return { ...state, entries: [], streaming: "", busy: false };
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

/**
 * Applies one newline-delimited JSON event from a Claude session.
 *
 * Control messages are handled by the session hook rather than here, because
 * answering them is a side effect rather than a change to the transcript.
 *
 * @param state - The current chat state.
 * @param line - One line of stream-json output.
 * @returns The updated chat state.
 */
export function applyClaudeLine(state: ChatState, line: string): ChatState {
  const message = parseJsonLine(line);
  if (!message) return state;

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
      return applyResultEvent(state, message);
    default:
      return state;
  }
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
    return {
      ...state,
      sessionId: asText(message.session_id) || state.sessionId,
      model: asText(message.model) || state.model,
      permissionMode: asText(message.permissionMode) || state.permissionMode,
      mcpServers: servers.length > 0 ? servers : state.mcpServers,
      plugins: plugins.length > 0 ? plugins : state.plugins,
      skills: skills.length > 0 ? skills : state.skills,
    };
  }

  if (subtype === "hook_response") return attachHook(state, readHookNote(message));

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
    if (status === "idle") return { ...state, busy: false };
  }

  return state;
}

/**
 * Attaches a hook's outcome to the tool call it most likely surrounds.
 *
 * Hook events do not carry a tool-use id, so the call is matched by the hook's
 * own matcher (`PreToolUse:Bash` → `Bash`) against the newest matching call
 * that has not finished. Where nothing matches, a failing hook is surfaced on
 * its own rather than being dropped.
 */
function attachHook(state: ChatState, note: ReturnType<typeof readHookNote>): ChatState {
  if (!note) return state;
  const failed = note.exitCode !== null && note.exitCode !== 0;
  const matcher = hookMatcher(note.name);

  if (matcher) {
    for (let index = state.entries.length - 1; index >= 0; index -= 1) {
      const entry = state.entries[index];
      if (entry.role !== "tool" || entry.name !== matcher) continue;
      const entries = [...state.entries];
      entries[index] = { ...entry, hooks: [...entry.hooks, note] };
      return { ...state, entries };
    }
  }

  if (!failed) return state;
  return appendEntry(state, {
    id: nextId("notice"),
    role: "notice",
    text: `Hook ${note.name} exited ${note.exitCode}${note.output ? `: ${note.output.trim()}` : ""}`,
  });
}

function applyStreamEvent(state: ChatState, message: Json): ChatState {
  const event = asRecord(message.event);
  if (!event || asText(event.type) !== "content_block_delta") return state;
  const delta = asRecord(event.delta);
  if (!delta || asText(delta.type) !== "text_delta") return state;
  const text = asText(delta.text);
  return text.length > 0 ? { ...state, streaming: state.streaming + text } : state;
}

function applyAssistantEvent(state: ChatState, message: Json): ChatState {
  const content = asRecord(message.message)?.content;
  const additions: ChatEntry[] = [];

  const text = readTextBlocks(content);
  if (text.trim().length > 0) {
    additions.push({ id: nextId("assistant"), role: "assistant", text });
  }
  for (const tool of readToolUses(content)) {
    additions.push({
      id: tool.id ? `tool:${tool.id}` : nextId("tool"),
      role: "tool",
      toolUseId: tool.id,
      name: tool.name,
      detail: describeToolUse(tool.name, tool.input),
      input: prettyJson(tool.input ?? {}),
      result: "",
      status: "running",
      hooks: [],
    });
  }

  return { ...state, entries: [...state.entries, ...additions], streaming: "" };
}

function applyUserEvent(state: ChatState, message: Json): ChatState {
  const content = asRecord(message.message)?.content;
  const results = asArray(content)
    .map(asRecord)
    .filter((block): block is Json => block !== null && asText(block.type) === "tool_result");
  if (results.length === 0) return state;

  const entries = [...state.entries];

  for (const block of results) {
    const toolUseId = asText(block.tool_use_id);
    const isError = block.is_error === true;
    const text = readResultText(block.content);
    const index = entries.findIndex(
      (entry) => entry.role === "tool" && entry.toolUseId === toolUseId,
    );
    const existing = index >= 0 ? entries[index] : null;

    if (existing && existing.role === "tool") {
      entries[index] = {
        ...existing,
        result: describeToolResult(existing.name, message.tool_use_result, text),
        status: isError ? "error" : "ok",
      };
      continue;
    }

    entries.push({
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

  return { ...state, entries };
}

function applyResultEvent(state: ChatState, message: Json): ChatState {
  let next = state;
  const additions: ChatEntry[] = [];

  if (message.is_error === true) {
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
    entries: [...state.entries, ...additions, ...denials],
    streaming: "",
    busy: false,
    costUsd: asNumber(message.total_cost_usd) ?? state.costUsd,
  };

  return next;
}
