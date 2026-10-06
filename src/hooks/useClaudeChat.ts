import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { applyClaudeLine, withError, withNotice, withUserMessage } from "../lib/claudeProtocol";
import { createChatState, type ChatState, type ClaudeEvent } from "../types";

/** A Claude Code session driven over the stream-json protocol. */
export type ClaudeSession = {
  state: ChatState;
  status: string;
  send: (text: string) => Promise<void>;
  notice: (text: string) => void;
};

const STDERR_HISTORY = 20;

/**
 * Owns a long-lived Claude session for `cwd`.
 *
 * One process serves every turn; it is closed when the hook unmounts.
 *
 * @param cwd - Directory the session runs in; the hook stays inert until it is set.
 * @returns The chat state, a status label, and a message sender.
 */
export function useClaudeChat(cwd: string | null): ClaudeSession {
  const sessionRef = useRef<string | null>(null);
  const stderrRef = useRef<string[]>([]);
  const [state, setState] = useState<ChatState>(createChatState);
  const [status, setStatus] = useState("waiting");

  useEffect(() => {
    if (!cwd) return;

    let cancelled = false;
    const events = new Channel<ClaudeEvent>();
    events.onmessage = (event) => {
      if (cancelled) return;
      if (event.kind === "line") {
        setState((current) => applyClaudeLine(current, event.line));
        return;
      }
      if (event.kind === "stderr") {
        stderrRef.current = [...stderrRef.current.slice(-(STDERR_HISTORY - 1)), event.line];
        return;
      }
      const detail = stderrRef.current.at(-1) ?? "";
      if (event.code !== null && event.code !== 0) {
        setState((current) =>
          withError(current, detail || `Claude exited with code ${event.code}.`),
        );
      }
      setStatus(event.code === null ? "closed" : `closed (${event.code})`);
    };

    void invoke<string>("start_claude", { onEvent: events, cwd })
      .then((id) => {
        if (cancelled) {
          void invoke("close_claude", { id }).catch(() => undefined);
          return;
        }
        sessionRef.current = id;
        setStatus("running");
      })
      .catch((error: unknown) => {
        setStatus("unavailable");
        setState((current) => withError(current, String(error)));
      });

    return () => {
      cancelled = true;
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void invoke("close_claude", { id }).catch(() => undefined);
    };
  }, [cwd]);

  const send = useCallback(async (text: string) => {
    const id = sessionRef.current;
    if (!id) return;

    setState((current) => withUserMessage(current, text));

    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    });

    try {
      await invoke("send_claude_line", { id, line });
    } catch (error: unknown) {
      setState((current) => withError(current, String(error)));
    }
  }, []);

  const notice = useCallback((text: string) => {
    setState((current) => withNotice(current, text));
  }, []);

  return { state, status, send, notice };
}
