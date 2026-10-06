import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { bracketedPaste } from "../lib/bracketedPaste";
import { createTerminal, type TerminalHandle, type TerminalThemeName } from "../lib/createTerminal";
import { updatePasteMode } from "../lib/pasteMode";
import type { TerminalEvent } from "../types";

/** A PTY-backed terminal session bound to a DOM element. */
export type TerminalSession = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  status: string;
  sendText: (text: string) => Promise<void>;
};

/**
 * Owns a terminal session and its view for `cwd`.
 *
 * The PTY is created on mount and closed on unmount, and stays alive while the
 * pane is hidden so commands can be sent to it from either mode. The palette is
 * applied by a separate effect, so changing the theme never restarts the shell.
 *
 * @param cwd - Directory the shell starts in; the hook stays inert until it is set.
 * @param theme - The palette to draw the terminal with.
 * @returns The container ref, a status label, and a text sender.
 */
export function useTerminal(cwd: string | null, theme: TerminalThemeName): TerminalSession {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const sessionRef = useRef<string | null>(null);
  const pasteModeRef = useRef(false);
  const [status, setStatus] = useState("waiting");

  useEffect(() => {
    handleRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!cwd || !container) return;

    let cancelled = false;
    const handle: TerminalHandle = createTerminal(container, theme);
    handleRef.current = handle;
    handle.fit();
    setStatus("starting");

    const events = new Channel<TerminalEvent>();
    events.onmessage = (event) => {
      if (cancelled) return;
      if (event.kind === "data") {
        pasteModeRef.current = updatePasteMode(pasteModeRef.current, event.data);
        handle.write(event.data);
        return;
      }
      setStatus(event.code === null ? "closed" : `closed (${event.code})`);
    };

    handle.onInput((data) => {
      const id = sessionRef.current;
      if (id) void invoke("write_terminal", { id, data }).catch(() => undefined);
    });

    handle.onResize((cols, rows) => {
      const id = sessionRef.current;
      if (id) void invoke("resize_terminal", { id, cols, rows }).catch(() => undefined);
    });

    const observer = new ResizeObserver(() => handle.fit());
    observer.observe(container);

    void invoke<string>("start_terminal", {
      onEvent: events,
      cwd,
      cols: handle.terminal.cols,
      rows: handle.terminal.rows,
    })
      .then((id) => {
        if (cancelled) {
          void invoke("close_terminal", { id }).catch(() => undefined);
          return;
        }
        sessionRef.current = id;
        handle.fit();
        setStatus("running");
      })
      .catch((error: unknown) => setStatus(String(error)));

    return () => {
      cancelled = true;
      observer.disconnect();
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void invoke("close_terminal", { id }).catch(() => undefined);
      handle.dispose();
      handleRef.current = null;
    };
  }, [cwd]);

  const sendText = useCallback(async (text: string) => {
    const id = sessionRef.current;
    if (!id) return;
    const payload = pasteModeRef.current
      ? `${bracketedPaste(text)}\r`
      : `${text.replace(/\r?\n/g, "\r")}\r`;
    await invoke("write_terminal", { id, data: payload });
  }, []);

  return { containerRef, status, sendText };
}
