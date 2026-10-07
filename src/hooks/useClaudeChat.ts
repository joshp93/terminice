import { useCallback, useEffect, useReducer, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  applyClaudeLine,
  latestAssistantText,
  withError,
  withHistory,
  withNotice,
  withShellCommand,
  withShellResult,
  withUserMessage,
} from "../lib/claudeProtocol";
import {
  allowTool,
  controlRequest,
  controlSuccess,
  denyTool,
  readContextUsage,
  readControlResponse,
  readInboundRequest,
  readInitialize,
  readMcpServers,
  readUsage,
  type ControlEnvelope,
  type InboundRequest,
} from "../lib/controlProtocol";
import { PERMISSION_MODES } from "../lib/claudeConfig";
import { readPrompt, type Prompt, type PromptResolution } from "../lib/dialogModels";
import { asRecord, asText, parseJsonLine, type Json } from "../lib/json";
import { nextId } from "../lib/nextId";
import {
  forgetInterrupted,
  listSessions,
  readSessionHistory,
  rememberInterrupted,
  takeInterrupted,
  type SessionSummary,
} from "../lib/sessions";
import { runShellCommand } from "../lib/shell";
import { createChatState, type ChatState, type ClaudeEvent } from "../types";

/** A loaded Claude session, whether or not it is the one on screen. */
type SessionRecord = {
  backendId: string;
  state: ChatState;
  /** Prompts waiting to be answered, oldest first. */
  prompts: Prompt[];
  status: string;
  /** True when the process is still alive but not on screen. */
  parked: boolean;
  /** How long this session's turn may stay silent before it is interrupted. */
  silenceMs: number;
};

/** The session API the UI consumes. */
export type ClaudeSession = {
  state: ChatState;
  status: string;
  /** The prompt the CLI is waiting on, if any. */
  prompt: Prompt | null;
  /** Sessions the resume menu can offer: loaded ones first, then transcripts. */
  resumable: SessionSummary[];
  send: (text: string) => void;
  runShell: (command: string) => void;
  interrupt: () => void;
  resolve: (resolution: PromptResolution) => void;
  setPermissionMode: (mode: string) => void;
  setModel: (value: string) => void;
  cyclePermissionMode: () => void;
  refreshSessions: () => void;
  refreshMcp: () => void;
  startNew: () => void;
  resume: (id: string) => void;
  notice: (text: string) => void;
};

/**
 * How long a session may produce no output at all before it is interrupted.
 *
 * A silent session is the worst failure mode: the transcript simply stops with
 * no indication why. Real work emits events continuously, so this much total
 * silence means something is wedged — unless the CLI is waiting on the user, in
 * which case silence is exactly what should happen.
 */
const SILENCE_TIMEOUT_MS = 20_000;

/**
 * How long a slash command may stay silent.
 *
 * Commands are given longer because several of them — `/doctor` most of all —
 * do their work before saying anything, and interrupting them would make a
 * working command look broken.
 */
const COMMAND_SILENCE_TIMEOUT_MS = 120_000;

/** How many finished-but-loaded sessions to keep before closing the oldest. */
const MAX_PARKED = 3;

/** How many transcript messages to replay when resuming. */
const HISTORY_LIMIT = 200;

const EMPTY_STATE = createChatState();

/**
 * Owns Claude Code sessions and the control protocol that drives them.
 *
 * A session is a long-lived process. Everything beyond plain messages — the
 * command catalogue, the context reading, permission prompts, questions —
 * travels over the control channel carried by the same stdin and stdout.
 *
 * @param cwd - Directory sessions run in; the hook stays inert until it is set.
 * @returns The active session, and the operations the UI needs.
 */
export function useClaudeChat(cwd: string | null): ClaudeSession {
  const storeRef = useRef(new Map<string, SessionRecord>());
  const activeRef = useRef<string | null>(null);
  const repliesRef = useRef(new Map<string, (envelope: ControlEnvelope) => void>());
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cwdRef = useRef<string | null>(null);
  const transcriptsRef = useRef<SessionSummary[]>([]);
  const handlerRef = useRef<(backendId: string, event: ClaudeEvent) => void>(() => undefined);
  /**
   * Local command output waiting to be handed to Claude.
   *
   * It travels with the next thing the user sends rather than being sent on its
   * own, because a user message starts a turn and running `!ls` should not make
   * Claude reply.
   */
  const shellContextRef = useRef<string[]>([]);
  const [, bump] = useReducer((count: number) => count + 1, 0);

  /** Loads the transcript list for this directory into the resume menu. */
  const loadTranscripts = useCallback(() => {
    const dir = cwdRef.current;
    if (dir === null) return;
    void listSessions(dir, 25).then((sessions) => {
      transcriptsRef.current = sessions;
      bump();
    });
  }, []);

  /**
   * Applies a change to one session's state.
   *
   * Reducers return the state they were handed when an event says nothing about
   * the transcript, and most of a turn's events say nothing — `stream_event`
   * alone fires thousands of times per turn, and nearly all of those are
   * message boundaries rather than text. Writing and re-rendering for those
   * costs the whole pane and changes nothing on screen.
   *
   * @param backendId - The session to change.
   * @param change - Produces the session's new state.
   */
  const patchState = useCallback(
    (backendId: string, change: (state: ChatState) => ChatState) => {
      const store = storeRef.current;
      const record = store.get(backendId);
      if (!record) return;
      const next = change(record.state);
      if (next === record.state) return;
      store.set(backendId, { ...record, state: next });
      bump();
    },
    [],
  );

  /**
   * Writes one message to a session's stdin.
   *
   * @param backendId - The session to write to.
   * @param message - The message to encode.
   */
  const writeLine = useCallback(
    (backendId: string, message: unknown) => {
      void invoke("send_claude_line", { id: backendId, line: JSON.stringify(message) }).catch(
        (error: unknown) => {
          patchState(backendId, (state) => withError(state, String(error)));
        },
      );
    },
    [patchState],
  );

  /**
   * Sends a control request, optionally handling its response.
   *
   * @param backendId - The session to ask.
   * @param body - The request body, including its subtype.
   * @param onReply - Called with the response envelope.
   */
  const request = useCallback(
    (
      backendId: string,
      body: Json & { subtype: string },
      onReply?: (envelope: ControlEnvelope) => void,
    ) => {
      const requestId = nextId("req");
      if (onReply) repliesRef.current.set(requestId, onReply);
      writeLine(backendId, controlRequest(requestId, body));
    },
    [writeLine],
  );

  const clearSilence = useCallback(() => {
    if (silenceRef.current !== null) {
      clearTimeout(silenceRef.current);
      silenceRef.current = null;
    }
  }, []);

  /**
   * Arms the guard that stops a wedged session.
   *
   * The guard stands down while a prompt is outstanding, because a CLI waiting
   * on the user is silent by design rather than by fault.
   *
   * @param backendId - The session to watch.
   */
  const armSilence = useCallback(
    (backendId: string) => {
      clearSilence();
      const record = storeRef.current.get(backendId);
      const timeout = record?.silenceMs ?? SILENCE_TIMEOUT_MS;
      silenceRef.current = setTimeout(() => {
        const current = storeRef.current.get(backendId);
        if (!current || !current.state.busy || current.prompts.length > 0) return;
        request(backendId, { subtype: "interrupt" });
        patchState(backendId, (state) =>
          withNotice(
            { ...state, busy: false, streaming: "" },
            `Claude produced no output for ${Math.round(timeout / 1000)} seconds, so the turn was interrupted. A tool that needs a terminal of its own can only be run outside terminice.`,
          ),
        );
      }, timeout);
    },
    [clearSilence, request, patchState],
  );

  /**
   * Re-reads the CLI's own context breakdown.
   *
   * This is also the authoritative source for the model in use: `set_model`
   * reports nothing back, but the next reading names the model it switched to.
   *
   * @param backendId - The session to ask.
   */
  const askContext = useCallback(
    (backendId: string) => {
      request(backendId, { subtype: "get_context_usage" }, (envelope) => {
        const usage = readContextUsage(envelope.response);
        if (!usage) return;
        patchState(backendId, (state) => ({
          ...state,
          contextUsage: usage,
          model: usage.model || state.model,
        }));
      });
    },
    [request, patchState],
  );

  /**
   * Re-reads the MCP server list.
   *
   * @param backendId - The session to ask.
   */
  const askMcp = useCallback(
    (backendId: string) => {
      request(backendId, { subtype: "mcp_status" }, (envelope) => {
        patchState(backendId, (state) => ({
          ...state,
          mcpServers: readMcpServers(envelope.response),
        }));
      });
    },
    [request, patchState],
  );

  /**
   * Queues a prompt for the user, or refuses it when it cannot be rendered.
   *
   * A request left unanswered hangs the CLI indefinitely, so anything
   * unrecognised is refused explicitly rather than ignored.
   *
   * @param backendId - The session the request came from.
   * @param inbound - The decoded request.
   */
  const enqueuePrompt = useCallback(
    (backendId: string, inbound: InboundRequest) => {
      const store = storeRef.current;
      const record = store.get(backendId);
      if (!record) return;

      const prompt = readPrompt(inbound, latestAssistantText(record.state));

      if (!prompt) {
        writeLine(
          backendId,
          controlSuccess(inbound.requestId, {
            behavior: "deny",
            message: `terminice cannot render a ${inbound.subtype} request.`,
          }),
        );
        return;
      }

      if (record.prompts.some((entry) => entry.requestId === prompt.requestId)) return;
      clearSilence();
      store.set(backendId, { ...record, prompts: [...record.prompts, prompt] });
      rememberInterrupted(record.state.sessionId ?? "", prompt.toolName);
      bump();
    },
    [clearSilence, writeLine],
  );

  /**
   * Runs the `initialize` handshake, which also recovers any prompt the CLI is
   * still holding.
   *
   * @param backendId - The session to handshake with.
   */
  const handshake = useCallback(
    (backendId: string) => {
      request(backendId, { subtype: "initialize" }, (envelope) => {
        if (envelope.subtype === "error") {
          patchState(backendId, (state) =>
            withNotice(state, `Claude rejected the handshake: ${envelope.error}`),
          );
          return;
        }

        const catalogue = readInitialize(envelope.response);
        if (catalogue) {
          patchState(backendId, (state) => ({
            ...state,
            catalogue,
            permissionMode: catalogue.permissionMode || state.permissionMode,
          }));
        }

        for (const entry of [
          ...envelope.pendingPermissionRequests,
          ...envelope.pendingUserDialogRequests,
        ]) {
          const record = asRecord(entry);
          if (!record) continue;
          const inbound = readInboundRequest(record);
          if (inbound) enqueuePrompt(backendId, inbound);
        }

        askContext(backendId);
        askMcp(backendId);
        request(backendId, { subtype: "get_usage" }, (reply) => {
          const usage = readUsage(reply.response);
          if (usage) patchState(backendId, (state) => ({ ...state, costUsd: usage.totalCostUsd }));
        });
      });
    },
    [request, patchState, enqueuePrompt, askContext, askMcp],
  );

  const handleEvent = useCallback(
    (backendId: string, event: ClaudeEvent) => {
      if (event.kind === "stderr") return;

      if (event.kind === "exit") {
        const store = storeRef.current;
        const record = store.get(backendId);
        if (!record) return;
        store.set(backendId, {
          ...record,
          status: event.code === null ? "closed" : `closed (${event.code})`,
          state:
            event.code !== null && event.code !== 0 && record.prompts.length === 0
              ? withError(record.state, `Claude exited with code ${event.code}.`)
              : record.state,
        });
        bump();
        return;
      }

      const record = storeRef.current.get(backendId);
      if (!record) return;
      if (record.state.busy && record.prompts.length === 0) armSilence(backendId);

      const message = parseJsonLine(event.line);
      if (!message) return;

      const response = readControlResponse(message);
      if (response) {
        const reply = repliesRef.current.get(response.requestId);
        if (reply) {
          repliesRef.current.delete(response.requestId);
          reply(response);
        }
        return;
      }

      const inbound = readInboundRequest(message);
      if (inbound) {
        enqueuePrompt(backendId, inbound);
        return;
      }

      patchState(backendId, (state) => applyClaudeLine(state, event.line));

      if (asText(message.type) === "result") {
        clearSilence();
        askContext(backendId);
      }
    },
    [armSilence, clearSilence, enqueuePrompt, patchState, askContext],
  );

  handlerRef.current = handleEvent;

  /**
   * Starts a session process and makes it the active one.
   *
   * @param options - A session id to resume, whether to replay its history, and
   *   whether to report a decision that was lost when the app last closed.
   */
  const spawn = useCallback(
    (options: { resume?: string; replay?: boolean; announceInterrupted?: boolean } = {}) => {
      const dir = cwdRef.current;
      if (dir === null) return;

      // A new process means a new conversation, so output from a local command
      // run in the previous one must not be attached to its first message.
      shellContextRef.current = [];

      const events = new Channel<ClaudeEvent>();
      const buffered: ClaudeEvent[] = [];
      let backendId: string | null = null;

      events.onmessage = (event) => {
        if (backendId === null) buffered.push(event);
        else handlerRef.current(backendId, event);
      };

      void invoke<string>("start_claude", {
        onEvent: events,
        cwd: dir,
        resume: options.resume ?? null,
        permissionMode: null,
      })
        .then((id) => {
          backendId = id;
          storeRef.current.set(id, {
            backendId: id,
            state: createChatState(),
            prompts: [],
            status: "running",
            parked: false,
            silenceMs: SILENCE_TIMEOUT_MS,
          });
          activeRef.current = id;
          bump();
          for (const event of buffered) handlerRef.current(id, event);
          handshake(id);

          if (options.resume && options.replay) {
            void readSessionHistory(dir, options.resume, HISTORY_LIMIT).then((messages) => {
              if (messages.length > 0) patchState(id, (state) => withHistory(state, messages));
            });
          }

          if (options.resume && options.announceInterrupted) {
            void takeInterrupted(options.resume).then((tool) => {
              if (tool === null) return;
              patchState(id, (state) =>
                withNotice(
                  state,
                  `This session was interrupted while a ${tool} approval was waiting. The CLI does not keep an unanswered request across restarts, so tell Claude to carry on and it will ask again.`,
                ),
              );
            });
          }
        })
        .catch((error: unknown) => {
          const id = nextId("failed");
          storeRef.current.set(id, {
            backendId: id,
            state: withError(createChatState(), String(error)),
            prompts: [],
            status: "unavailable",
            parked: false,
            silenceMs: SILENCE_TIMEOUT_MS,
          });
          activeRef.current = id;
          bump();
        });
    },
    [handshake, patchState],
  );

  useEffect(() => {
    if (cwd === null) return;
    cwdRef.current = cwd;
    loadTranscripts();
    spawn();

    return () => {
      clearSilence();
      for (const record of storeRef.current.values()) {
        void invoke("close_claude", { id: record.backendId }).catch(() => undefined);
      }
      storeRef.current.clear();
      activeRef.current = null;
      bump();
    };
  }, [cwd, spawn, loadTranscripts, clearSilence]);

  /**
   * Closes a session's process and forgets it.
   *
   * @param record - The session to close.
   */
  const closeRecord = useCallback((record: SessionRecord) => {
    void invoke("close_claude", { id: record.backendId }).catch(() => undefined);
    storeRef.current.delete(record.backendId);
  }, []);

  /**
   * Steps off the active session, keeping it alive when it is waiting on an
   * answer so that the prompt can be recovered by reattaching.
   */
  const standDown = useCallback(() => {
    const active = activeRef.current;
    if (active === null) return;
    const record = storeRef.current.get(active);
    if (!record) return;

    if (record.prompts.length === 0) {
      closeRecord(record);
      return;
    }

    storeRef.current.set(active, { ...record, parked: true });
    const parked = [...storeRef.current.values()].filter((entry) => entry.parked);
    for (const stale of parked.slice(0, Math.max(0, parked.length - MAX_PARKED))) {
      closeRecord(stale);
    }
  }, [closeRecord]);

  const send = useCallback(
    (text: string) => {
      const active = activeRef.current;
      if (active === null) return;
      const record = storeRef.current.get(active);
      if (!record || record.status !== "running") return;
      if (text.trim().length === 0) return;

      // Local command output goes ahead of what the user wrote, in the wrappers
      // Claude Code itself uses, so the model reads it the way it always has.
      const pending = shellContextRef.current;
      shellContextRef.current = [];
      const payload =
        pending.length === 0 ? text : `${pending.join("\n")}\n\n${text}`;

      storeRef.current.set(active, {
        ...record,
        silenceMs: text.trimStart().startsWith("/")
          ? COMMAND_SILENCE_TIMEOUT_MS
          : SILENCE_TIMEOUT_MS,
      });
      patchState(active, (state) => withUserMessage(state, text));
      writeLine(active, {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: payload }] },
      });
      armSilence(active);
    },
    [patchState, writeLine, armSilence],
  );

  /**
   * Runs a command in the shell, behind the composer's `!` prefix.
   *
   * The command runs here rather than through Claude, and its output is held
   * back until the user next says something — which is what makes it context
   * rather than a prompt.
   *
   * @param command - The command, without its leading `!`.
   */
  const runShell = useCallback(
    (command: string) => {
      const active = activeRef.current;
      if (active === null) return;
      const record = storeRef.current.get(active);
      if (!record || command.trim().length === 0) return;

      const id = nextId("shell");
      patchState(active, (state) => withShellCommand(state, id, command));

      // Run where the session is now, not where it started: if Claude has
      // changed directory, `!pwd` should agree with it.
      const liveCwd = record.state.cwd ?? cwdRef.current;

      void runShellCommand(command, liveCwd)
        .then((output) => {
          patchState(active, (state) => withShellResult(state, id, output));
          shellContextRef.current = [
            ...shellContextRef.current,
            `<bash-input> ${command}</bash-input>`,
            `<bash-stdout>${output.stdout}</bash-stdout><bash-stderr>${output.stderr}</bash-stderr>` +
              `<bash-exit-code>${output.code ?? "unknown"}</bash-exit-code>`,
          ];
        })
        .catch((error: unknown) => {
          patchState(active, (state) =>
            withShellResult(state, id, { stdout: "", stderr: String(error), code: null }),
          );
        });
    },
    [patchState],
  );

  const interrupt = useCallback(() => {
    const active = activeRef.current;
    if (active === null) return;
    clearSilence();
    request(active, { subtype: "interrupt" });
    patchState(active, (state) => ({ ...state, busy: false, streaming: "" }));
  }, [clearSilence, request, patchState]);

  const resolve = useCallback(
    (resolution: PromptResolution) => {
      const active = activeRef.current;
      if (active === null) return;
      const record = storeRef.current.get(active);
      const prompt = record?.prompts[0];
      if (!record || !prompt) return;

      const line = responseFor(prompt, resolution);

      storeRef.current.set(active, {
        ...record,
        prompts: record.prompts.slice(1),
        silenceMs: SILENCE_TIMEOUT_MS,
      });
      if (record.prompts.length === 1) forgetInterrupted(record.state.sessionId ?? "");
      bump();
      writeLine(active, line);
      armSilence(active);
    },
    [writeLine, armSilence],
  );

  const setPermissionMode = useCallback(
    (mode: string) => {
      const active = activeRef.current;
      if (active === null) return;
      request(active, { subtype: "set_permission_mode", mode }, (envelope) => {
        if (envelope.subtype === "error") {
          patchState(active, (state) =>
            withNotice(state, `Could not set the mode: ${envelope.error}`),
          );
          return;
        }
        patchState(active, (state) => ({ ...state, permissionMode: mode }));
      });
    },
    [request, patchState],
  );

  /**
   * Switches the model used for the rest of the session.
   *
   * `set_model` answers with nothing, so the model shown in the header comes
   * from the context reading that follows rather than from the value asked for:
   * the CLI resolves aliases like `sonnet` to whatever that means today.
   *
   * @param value - The model to switch to, as the CLI names it.
   */
  const setModel = useCallback(
    (value: string) => {
      const active = activeRef.current;
      if (active === null) return;
      request(active, { subtype: "set_model", model: value }, (envelope) => {
        if (envelope.subtype === "error") {
          patchState(active, (state) =>
            withNotice(state, `Could not switch model: ${envelope.error}`),
          );
          return;
        }
        askContext(active);
      });
    },
    [request, patchState, askContext],
  );

  const cyclePermissionMode = useCallback(() => {
    const active = activeRef.current;
    const record = active === null ? undefined : storeRef.current.get(active);
    const current = record?.state.permissionMode ?? "default";
    const index = PERMISSION_MODES.indexOf(current as (typeof PERMISSION_MODES)[number]);
    const next = PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length];
    setPermissionMode(next);
  }, [setPermissionMode]);

  const startNew = useCallback(() => {
    standDown();
    spawn();
    loadTranscripts();
  }, [standDown, spawn, loadTranscripts]);

  const resume = useCallback(
    (id: string) => {
      const live = [...storeRef.current.values()].find(
        (record) => record.state.sessionId === id && record.parked,
      );

      if (live) {
        activeRef.current = live.backendId;
        storeRef.current.set(live.backendId, { ...live, parked: false });
        bump();
        handshake(live.backendId);
        return;
      }

      standDown();
      spawn({ resume: id, replay: true, announceInterrupted: true });
    },
    [handshake, spawn, standDown],
  );

  const notice = useCallback(
    (text: string) => {
      const active = activeRef.current;
      if (active === null) return;
      patchState(active, (state) => withNotice(state, text));
    },
    [patchState],
  );

  const refreshMcp = useCallback(() => {
    const active = activeRef.current;
    if (active !== null) askMcp(active);
  }, [askMcp]);

  const active = activeRef.current;
  const record = active === null ? undefined : storeRef.current.get(active);

  const live: SessionSummary[] = [...storeRef.current.values()]
    .filter((entry) => entry.parked && entry.state.sessionId !== null)
    .map((entry) => ({
      id: entry.state.sessionId as string,
      modified: Date.now(),
      bytes: entry.state.entries.length,
      preview: firstUserText(entry.state) || "Session in progress",
      live: true,
    }));

  return {
    state: record?.state ?? EMPTY_STATE,
    status: record?.status ?? "waiting",
    prompt: record?.prompts[0] ?? null,
    resumable: [...live, ...transcriptsRef.current],
    send,
    runShell,
    interrupt,
    resolve,
    setPermissionMode,
    setModel,
    cyclePermissionMode,
    refreshSessions: loadTranscripts,
    refreshMcp,
    startNew,
    resume,
    notice,
  };
}

/**
 * Builds the control response that answers one card.
 *
 * @param prompt - The card being answered.
 * @param resolution - What the user chose.
 * @returns The message to write back to the CLI.
 */
function responseFor(prompt: Prompt, resolution: PromptResolution): unknown {
  if (resolution.kind === "permission") {
    return resolution.choice === "deny"
      ? denyTool(prompt.requestId, "The user denied this tool call.")
      : allowTool(prompt.requestId, prompt.rawInput, resolution.permissions);
  }

  if (resolution.kind === "plan") {
    return resolution.choice === "revise"
      ? denyTool(
          prompt.requestId,
          "The user did not approve this plan. Stay in plan mode and revise it.",
        )
      : allowTool(prompt.requestId, prompt.rawInput);
  }

  return allowTool(prompt.requestId, {
    ...prompt.rawInput,
    answers: resolution.answers,
    annotations: resolution.annotations,
  });
}

/**
 * Finds the first thing the user said in a session.
 *
 * @param state - The session's chat state.
 * @returns The first user message, truncated, or an empty string.
 */
function firstUserText(state: ChatState): string {
  const entry = state.entries.find((item) => item.role === "user");
  return entry && entry.role === "user" ? entry.text.slice(0, 120) : "";
}
