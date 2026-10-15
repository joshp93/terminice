import type { ChatEntry, ChatState, TaskUsage } from "../types";
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
 * @param messageUuid - The uuid the message was sent under, which is how the CLI
 *   names it if it has to be taken back out of the queue.
 * @returns The updated chat state.
 */
export function withUserMessage(
  state: ChatState,
  text: string,
  queued = false,
  messageUuid?: string,
): ChatState {
  return {
    ...state,
    busy: true,
    thinkingTokens: 0,
    suggestion: null,
    entries: [...state.entries, { id: nextId("user"), role: "user", text, queued, messageUuid }],
  };
}

/**
 * Takes one entry out of the transcript.
 *
 * A message dropped from the CLI's queue never ran and never entered the
 * conversation, so nothing about it belongs in the transcript.
 *
 * @param state - The current chat state.
 * @param id - The entry to remove.
 * @returns The updated chat state.
 */
export function withoutEntry(state: ChatState, id: string): ChatState {
  return { ...state, entries: state.entries.filter((entry) => entry.id !== id) };
}

/**
 * Takes the waiting mark off one message.
 *
 * Used when the CLI has already taken a message into a turn: it is being read,
 * so it has joined the conversation whether or not it could still be dropped.
 *
 * @param state - The current chat state.
 * @param id - The entry to settle.
 * @returns The updated chat state.
 */
export function withSettledMessage(state: ChatState, id: string): ChatState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === id && entry.role === "user" ? { ...entry, queued: false } : entry,
    ),
  };
}

/**
 * Takes the waiting mark off one message, by the uuid it was sent under.
 *
 * That uuid is the only name the CLI knows a message by, so it is what the CLI
 * reports on a message with — see {@link withCommandLifecycle}. A message the
 * app did not send has no uuid, and so cannot be addressed here.
 *
 * @param state - The current chat state.
 * @param commandUuid - The uuid the message was sent under.
 * @returns The updated chat state.
 */
export function withSettledUuid(state: ChatState, commandUuid: string): ChatState {
  const waiting = (entry: ChatEntry): entry is Extract<ChatEntry, { role: "user" }> =>
    entry.role === "user" && entry.queued === true && entry.messageUuid === commandUuid;
  if (!state.entries.some(waiting)) return state;

  return {
    ...state,
    entries: state.entries.map((entry) => (waiting(entry) ? { ...entry, queued: false } : entry)),
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
  const over = withTurnOver(state);
  return {
    ...over,
    entries: [...over.entries, { id: nextId("error"), role: "error", text }],
  };
}

/**
 * Ends a turn that nothing else is going to end.
 *
 * A turn normally ends with a `result`, and a `result` is what settles the queue
 * of messages sent while it ran. Some turn ends never produce one — the process
 * exits, the CLI reports itself idle, a failure is recorded from outside the
 * event stream — and a message left carrying the mark is one the reader can
 * neither see in the transcript nor reach with the keyboard, because a message
 * that is not drawn is not there to be jumped to. So whatever ends a turn
 * settles the queue along with it.
 *
 * @param state - The current chat state.
 * @returns The state with the turn over and nothing left waiting.
 */
export function withTurnOver(state: ChatState): ChatState {
  return {
    ...state,
    busy: false,
    streaming: "",
    entries: withSettledQueue(state.entries),
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

  // A session's mode can change without being asked for: Claude enters plan mode
  // itself, and the CLI reports that on a frame of its own rather than in a reply
  // to anything. It is read from the frame rather than from a frame type,
  // because the type it arrives under is the CLI's to choose — and it is applied
  // to whatever the frame then means, rather than in place of it, so a frame
  // that both changed the mode and did something else still does both.
  const mode = asText(message.permissionMode) || asText(message.permission_mode);
  const next =
    mode.length > 0 && mode !== state.permissionMode ? { ...state, permissionMode: mode } : state;

  switch (asText(message.type)) {
    case "system":
      return applySystemEvent(next, message);
    case "stream_event":
      return applyStreamEvent(next, message);
    case "assistant":
      return applyAssistantEvent(next, message);
    case "user":
      return applyUserEvent(next, message);
    case "result":
      return applyResultEvent(next, message, options.interrupted === true);
    case "prompt_suggestion":
      return { ...next, suggestion: asText(message.suggestion) || null };
    case "command_lifecycle":
      return withCommandLifecycle(next, message);
    default:
      return next;
  }
}

/**
 * Applies the CLI's own account of a message the host sent.
 *
 * A message sent while a turn was running is queued, and the CLI says so itself
 * rather than leaving it to be inferred: these frames are addressed by the uuid
 * the message was sent under — the same uuid the app mints so a message can be
 * taken back out of the queue — and carry one of three states.
 *
 * `queued` is where a message waits, and nothing is done with it: the app marks
 * the message as waiting the moment it sends it, so that the reader sees it
 * straight away, and a confirmation arriving a moment later has nothing to add.
 *
 * `started` is the acknowledgement that exists nowhere else, and it is what the
 * badge has been waiting for. Measured on the stream: it arrives with the tool
 * result of the call that was running when the message was queued, which is
 * where the CLI takes a queued message up — so it comes as the agent reads the
 * message rather than when the turn it joined finishes, which can be minutes
 * later. Without it a message the model was already answering sat labelled
 * "Queued", and missing from the transcript, for the rest of the turn.
 *
 * `completed` closes the message out, which matters only when its `started` was
 * missed — a session reattached mid-turn, say.
 *
 * @param state - The current chat state.
 * @param message - A decoded `command_lifecycle` line.
 * @returns The updated chat state.
 */
function withCommandLifecycle(state: ChatState, message: Json): ChatState {
  const commandUuid = asText(message.command_uuid);
  const lifecycle = asText(message.state);
  if (commandUuid.length === 0) return state;
  if (lifecycle !== "started" && lifecycle !== "completed") return state;

  return withSettledUuid(state, commandUuid);
}

/**
 * Finds the card a tagged frame belongs to.
 *
 * A frame from an agent is tagged with the call that spawned it, and the CLI
 * also names the agent itself when it starts one — and which of the two arrives
 * on a frame is the CLI's choice, so a card answers to both rather than one
 * being predicted. An agent started in the background is the case that needs
 * this: its spawning call was answered before it did any work, so its frames
 * are tagged with the agent rather than with the call.
 *
 * When neither name matches and exactly one agent is running, that agent is
 * taken as the owner: a frame tagged with an id no card answers to still came
 * from somewhere, and with a single agent running there is only one place it
 * could have come from. Two agents running is where that reasoning stops, and a
 * frame is dropped rather than filed against the wrong one — an attributed
 * guess would read as something the other agent said.
 *
 * @param entries - The transcript entries.
 * @param parentId - The id the frame was tagged with.
 * @returns The index of the card, or -1 when there is not one.
 */
function agentCardFor(entries: ChatEntry[], parentId: string): number {
  const named = entries.findIndex(
    (entry) =>
      entry.role === "subagent" && (entry.toolUseId === parentId || entry.agentId === parentId),
  );
  if (named >= 0) return named;

  const running = entries.flatMap((entry, at) =>
    entry.role === "subagent" && entry.status === "running" ? [at] : [],
  );
  return running.length === 1 ? running[0] : -1;
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
  const index = agentCardFor(state.entries, parentId);
  const agent = index >= 0 ? state.entries[index] : null;
  if (agent?.role !== "subagent") return state;

  const kind = asText(message.type);
  let inner = agent.entries;
  let counted = state;

  if (kind === "assistant") {
    // A subagent's own calls are billed to the same session, so what it spends
    // is counted with everything else even though its words are filed inside
    // the card.
    counted = withSpentTokens(state, message);
    const additions = assistantEntries(asRecord(message.message)?.content);
    if (additions.length === 0) return counted;
    inner = [...inner, ...additions];
  } else if (kind === "user") {
    inner = withToolResults(inner, message);
  } else if (kind === "system" && asText(message.subtype) === "hook_response") {
    inner = withHook(inner, readHookNote(message));
  } else {
    return state;
  }

  if (inner === agent.entries) return counted;
  const entries = [...counted.entries];
  entries[index] = { ...agent, entries: inner };
  return { ...counted, entries };
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
      // An agent started in the background is answered the moment it has been
      // started, so this result says nothing about the agent itself. Its card
      // stays running until the task reports, which is the only thing that says
      // the work is over — and until then the tracker below the composer is
      // right to keep showing it as something being waited on. What the
      // acknowledgement does carry is the agent's own id, which is the other
      // name its frames can arrive under.
      if (isLaunchAcknowledgement(structured, text)) {
        const agentId = launchedAgentId(structured);
        if (agentId.length > 0) next[index] = { ...existing, agentId };
        continue;
      }
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
 * Whether a tool result is the CLI acknowledging that an agent was started.
 *
 * The structured field is the answer whenever the frame carries one result,
 * which is the ordinary case. A frame holding the results of two calls made in
 * parallel carries no structured field at all, so the acknowledgement's own
 * wording is the fallback — the same sentence in every one of them, and the
 * only thing that tells those results apart from an agent's report.
 *
 * @param structured - The message's structured result, when it has one.
 * @param text - The result's text.
 * @returns True when the result is a launch acknowledgement.
 */
function isLaunchAcknowledgement(structured: unknown, text: string): boolean {
  const record = asRecord(structured);
  if (record?.isAsync === true && asText(record.status) === "async_launched") return true;
  return text.includes("Async agent launched successfully");
}

/**
 * The agent's own id, as the acknowledgement names it.
 *
 * @param structured - The message's structured result, when it has one.
 * @returns The id, or an empty string when the acknowledgement named none.
 */
function launchedAgentId(structured: unknown): string {
  return asText(asRecord(structured)?.agentId);
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
    if (status === "idle") return { ...withTurnOver(state), compacting: false };
    if (status === "compacting") return { ...state, busy: true, compacting: true };
  }

  if (subtype === "thinking_tokens") {
    const tokens = asNumber(message.estimated_tokens);
    if (tokens === null || tokens === state.thinkingTokens) return state;
    return { ...state, thinkingTokens: tokens };
  }

  if (subtype === "compact_boundary") return applyCompactBoundary(state, message);

  if (TASK_SUBTYPES.includes(subtype)) {
    const entries = withTaskEvent(state.entries, subtype, message);
    return entries === state.entries ? state : { ...state, entries };
  }

  return state;
}

/**
 * The system events that report on a task an agent was started for.
 *
 * Verified against the CLI's own stream, which sends all five: a task is
 * announced with `task_started`, reports its numbers while it runs with
 * `task_progress`, and is closed by `task_updated` and `task_notification` —
 * both of which name the call the agent was started by, which is what a card is
 * keyed by. `background_tasks_changed` carries the list of what is running in
 * the background, which is the same story told whole; it is not read here
 * because a card is what the tracker shows.
 */
const TASK_SUBTYPES = ["task_started", "task_progress", "task_updated", "task_notification"];

/**
 * Applies one report about a task to the card of the call that started it.
 *
 * A background agent is the reason this exists: its call is answered the moment
 * it is started, and then nothing else on the stream says whether it is still
 * working — the agent's own frames are inside its card, and the report it hands
 * back arrives as a turn of the main conversation. These events are the CLI
 * saying so itself, and they are the only thing that ends a background card.
 *
 * @param entries - The transcript entries.
 * @param subtype - The task event's subtype.
 * @param message - The decoded event.
 * @returns The entries, or the same array when no card was found.
 */
function withTaskEvent(entries: ChatEntry[], subtype: string, message: Json): ChatEntry[] {
  const toolUseId = asText(message.tool_use_id);
  const index = entries.findIndex(
    (entry) => entry.role === "subagent" && entry.toolUseId === toolUseId,
  );
  const agent = index >= 0 ? entries[index] : null;
  if (agent?.role !== "subagent" || toolUseId.length === 0) return entries;

  const next = [...entries];
  const finished = subtype === "task_updated" || subtype === "task_notification";
  if (finished) {
    const patch = asRecord(message.patch);
    const status = asText(message.status) || asText(patch?.status);
    next[index] = {
      ...agent,
      status: status === "failed" ? "error" : "ok",
      // What the CLI says about the ending, which is all it gives here: the
      // agent's own report is handed to the model rather than to this stream.
      result: agent.result.length > 0 ? agent.result : asText(message.summary).trim(),
      usage: readTaskUsage(message) ?? agent.usage,
      progress: undefined,
    };
    return next;
  }

  next[index] = {
    ...agent,
    // A task started in the background is one whose call has been answered and
    // whose work goes on, which is what the card's own line says about it.
    background: agent.background === true || message.is_backgrounded === true,
    usage: readTaskUsage(message) ?? agent.usage,
    progress:
      subtype === "task_progress" ? (readTaskProgress(message) ?? undefined) : agent.progress,
  };
  return next;
}

/**
 * Reads the token and tool counts a task reported.
 *
 * @param message - A task event.
 * @returns What it spent, or null when it reported nothing.
 */
function readTaskUsage(message: Json): TaskUsage | null {
  const usage = asRecord(message.usage);
  if (!usage) return null;
  return {
    tokens: asNumber(usage.total_tokens) ?? 0,
    toolUses: asNumber(usage.tool_uses) ?? 0,
    durationMs: asNumber(usage.duration_ms) ?? 0,
  };
}

/**
 * Reads what a running task is doing now.
 *
 * @param message - A `task_progress` event.
 * @returns The reading, or null when it carried none.
 */
function readTaskProgress(message: Json): TaskUsage | null {
  const usage = readTaskUsage(message);
  if (!usage) return null;
  return { ...usage, lastTool: asText(message.last_tool_name) };
}

/**
 * Records the end of a compaction.
 *
 * The CLI reports this as a boundary carrying token counts rather than as a
 * series of progress steps, so this is where the only real figures come from —
 * and it is what the bar is waiting on to disappear.
 *
 * A compaction is a turn of its own, so it is also where anything sent while it
 * ran stops being queued: the CLI takes those messages next, and a message that
 * is being answered must not still be labelled as waiting.
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
      ...withSettledQueue(state.entries),
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
  const counted = withSpentTokens(state, message);
  const additions = assistantEntries(asRecord(message.message)?.content);
  if (additions.length === 0 && counted.streaming.length === 0) return counted;
  return { ...counted, entries: [...counted.entries, ...additions], streaming: "" };
}

/**
 * Adds what one completed assistant message spent to the session's total.
 *
 * The tokens are on the message's own `usage`, which is the count for the call
 * that produced it — the `result` frame's usage is the last call's alone, and
 * the streamed deltas carry none at all, so a completed message is the one
 * place a token can be counted from exactly once. A model the CLI cannot price
 * is costed from these, which is why they are kept rather than only read.
 *
 * @param state - The current chat state.
 * @param message - A decoded `assistant` line.
 * @returns The state with the message's tokens added.
 */
function withSpentTokens(state: ChatState, message: Json): ChatState {
  const usage = asRecord(asRecord(message.message)?.usage);
  if (!usage) return state;

  return {
    ...state,
    tokens: {
      input: state.tokens.input + (asNumber(usage.input_tokens) ?? 0),
      output: state.tokens.output + (asNumber(usage.output_tokens) ?? 0),
      cacheRead: state.tokens.cacheRead + (asNumber(usage.cache_read_input_tokens) ?? 0),
      cacheWrite: state.tokens.cacheWrite + (asNumber(usage.cache_creation_input_tokens) ?? 0),
    },
  };
}

/**
 * Reads whether the CLI has said it cannot price the model in use.
 *
 * @param message - A decoded frame that may carry the flag.
 * @returns True when the CLI has said so.
 */
function readUnknownCost(message: Json): boolean {
  return message.has_unknown_model_cost === true || message.hasUnknownModelCost === true;
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
    costUnknown: readUnknownCost(message) || state.costUnknown,
  };

  return withFastMode(next, message);
}

/**
 * Takes the queued mark off every message waiting to be picked up.
 *
 * Called wherever a turn ends, whether that is an ordinary turn or a
 * compaction, because that is what tells the CLI to take what was sent while it
 * was busy.
 *
 * @param entries - The transcript entries.
 * @returns The entries, with nothing left marked as queued.
 */
function withSettledQueue(entries: ChatEntry[]): ChatEntry[] {
  const waiting = (entry: ChatEntry): boolean => entry.role === "user" && entry.queued === true;
  // Handed back as it came when nothing was waiting, so a turn ending with
  // nothing queued does not hand the pane a new array to re-render.
  if (!entries.some(waiting)) return entries;
  return entries.map((entry) =>
    entry.role === "user" && entry.queued === true ? { ...entry, queued: false } : entry,
  );
}
