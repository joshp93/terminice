import { useCallback, useEffect, useRef, useState } from "react";
import { createComposer, type ComposerHandle, type ComposerStatus } from "../lib/createComposer";
import { createInlineState, type FormatId } from "../lib/richFormat";
import type { ListKind } from "../lib/listMarkers";
import { FormatToolbar } from "./FormatToolbar";
import type { PaneMode } from "../types";

/** Props for {@link Composer}. */
export type ComposerProps = {
  mode: PaneMode;
  /** Whether a bare Enter sends. Evaluated on each keypress. */
  submitsOnEnter: () => boolean;
  onSend: (text: string) => void;
};

const PLACEHOLDERS: Record<PaneMode, string> = {
  claude: "Message Claude — Enter sends, Shift+Enter for a new line",
  terminal: "Send to the terminal",
};

/**
 * Renders the composer for the active pane.
 *
 * In Claude mode Markdown formatting is available; in terminal mode the text is
 * forwarded verbatim. Any markers left open are closed before sending.
 *
 * @param props - The active mode, Enter behaviour, and send handler.
 * @returns The rendered composer.
 */
export function Composer({ mode, submitsOnEnter, onSend }: ComposerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ComposerHandle | null>(null);
  const sendRef = useRef(onSend);
  const submitsRef = useRef(submitsOnEnter);
  const richRef = useRef(mode === "claude");
  const [status, setStatus] = useState<ComposerStatus>({
    inline: createInlineState(),
    listKind: null,
  });

  const rich = mode === "claude";

  useEffect(() => {
    sendRef.current = onSend;
  }, [onSend]);

  useEffect(() => {
    submitsRef.current = submitsOnEnter;
  }, [submitsOnEnter]);

  useEffect(() => {
    richRef.current = rich;
  }, [rich]);

  const submit = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.closeOpenFormats();
    const text = handle.getText();
    handle.clear();
    if (text.trim().length === 0) return;
    sendRef.current(text);
  }, []);

  const toggleFormat = useCallback((id: FormatId) => {
    handleRef.current?.toggleFormat(id);
  }, []);

  const toggleList = useCallback((kind: ListKind) => {
    handleRef.current?.toggleList(kind);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createComposer({
      parent: host,
      placeholder: PLACEHOLDERS[mode],
      onSubmit: () => submit(),
      submitsOnEnter: () => submitsRef.current(),
      isRichFormatting: () => richRef.current,
      onStatusChange: setStatus,
    });
    handleRef.current = handle;
    handle.focus();
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [mode, submit]);

  return (
    <footer className="composer">
      <div className="composer-row">
        {rich && (
          <FormatToolbar
            status={status}
            onToggleFormat={toggleFormat}
            onToggleList={toggleList}
          />
        )}
        <div className="composer-host" ref={hostRef} />
        <button type="button" className="send" onClick={submit}>
          Send
        </button>
      </div>
    </footer>
  );
}
