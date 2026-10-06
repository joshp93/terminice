import { describeToolUse } from "./describeToolUse";
import { nextId } from "./nextId";
import type { ChatEntry, ChatState } from "../types";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null ? (value as Json) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseLine(line: string): Json | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

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
 * @returns Each tool name paired with its raw input.
 */
export function readToolUses(content: unknown): Array<{ name: string; input: unknown }> {
  if (!Array.isArray(content)) return [];
  const uses: Array<{ name: string; input: unknown }> = [];
  for (const block of content) {
    const record = asRecord(block);
    if (record && record.type === "tool_use") {
      uses.push({ name: asText(record.name), input: record.input });
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
 * Applies one newline-delimited JSON event from a Claude session.
 *
 * @param state - The current chat state.
 * @param line - One line of stream-json output.
 * @returns The updated chat state.
 */
export function applyClaudeLine(state: ChatState, line: string): ChatState {
  const message = parseLine(line);
  if (!message) return state;

  switch (asText(message.type)) {
    case "system":
      return applySystemEvent(state, message);
    case "stream_event":
      return applyStreamEvent(state, message);
    case "assistant":
      return applyAssistantEvent(state, message);
    case "result":
      return applyResultEvent(state, message);
    case "control_request":
      return appendEntry(state, {
        id: nextId("notice"),
        role: "notice",
        text: "Claude is waiting for a permission decision. Answer it in the terminal pane for now.",
      });
    default:
      return state;
  }
}

function applySystemEvent(state: ChatState, message: Json): ChatState {
  if (asText(message.subtype) !== "init") return state;
  return {
    ...state,
    sessionId: asText(message.session_id) || state.sessionId,
    model: asText(message.model) || state.model,
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

function applyAssistantEvent(state: ChatState, message: Json): ChatState {
  const content = asRecord(message.message)?.content;
  const additions: ChatEntry[] = [];

  const text = readTextBlocks(content);
  if (text.trim().length > 0) {
    additions.push({ id: nextId("assistant"), role: "assistant", text });
  }
  for (const tool of readToolUses(content)) {
    additions.push({
      id: nextId("tool"),
      role: "tool",
      name: tool.name,
      detail: describeToolUse(tool.name, tool.input),
    });
  }

  return { ...state, entries: [...state.entries, ...additions], streaming: "" };
}

function applyResultEvent(state: ChatState, message: Json): ChatState {
  const costUsd =
    typeof message.total_cost_usd === "number" ? message.total_cost_usd : state.costUsd;
  const additions: ChatEntry[] = [];

  if (message.is_error === true) {
    additions.push({
      id: nextId("error"),
      role: "error",
      text: asText(message.result) || "The turn ended with an error.",
    });
  }

  return {
    ...state,
    entries: [...state.entries, ...additions],
    streaming: "",
    busy: false,
    costUsd,
  };
}
