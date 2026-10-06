import { useCallback, useEffect, useRef, useState } from "react";
import { createComposer, type ComposerHandle, type ComposerStatus } from "../lib/createComposer";
import { subscribeToFileDrops } from "../lib/fileDrops";
import type { FormatId } from "../lib/richFormat";
import type { ListKind } from "../lib/listMarkers";
import { FormatToolbar } from "./FormatToolbar";

/** Props for {@link Composer}. */
export type ComposerProps = {
  /** Whether a bare Enter sends. Evaluated on each keypress. */
  submitsOnEnter: () => boolean;
  onSend: (text: string) => void;
};

const PLACEHOLDER = "Message Claude — Enter sends, Shift+Enter for a new line";

const INITIAL_STATUS: ComposerStatus = {
  formats: new Map(),
  listKind: null,
  inCodeBlock: false,
};

/**
 * Renders the composer and its formatting toolbar.
 *
 * Markers left open are closed before the message is sent.
 *
 * @param props - The Enter behaviour and the send handler.
 * @returns The rendered composer.
 */
export function Composer({ submitsOnEnter, onSend }: ComposerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ComposerHandle | null>(null);
  const sendRef = useRef(onSend);
  const submitsRef = useRef(submitsOnEnter);
  const [status, setStatus] = useState<ComposerStatus>(INITIAL_STATUS);

  useEffect(() => {
    sendRef.current = onSend;
  }, [onSend]);

  useEffect(() => {
    submitsRef.current = submitsOnEnter;
  }, [submitsOnEnter]);

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

  const toggleCodeBlock = useCallback(() => {
    handleRef.current?.toggleCodeBlock();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeToFileDrops((paths) => {
      if (paths.length > 0) handleRef.current?.insertText(paths.join(" "));
    })
      .then((remove) => {
        if (cancelled) remove();
        else unsubscribe = remove;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createComposer({
      parent: host,
      placeholder: PLACEHOLDER,
      onSubmit: () => submit(),
      submitsOnEnter: () => submitsRef.current(),
      onStatusChange: setStatus,
    });
    handleRef.current = handle;
    handle.focus();
    return () => {
      handle.destroy();
      handleRef.current = null;
      setStatus(INITIAL_STATUS);
    };
  }, [submit]);

  return (
    <footer className="composer">
      <FormatToolbar
        status={status}
        onToggleFormat={toggleFormat}
        onToggleList={toggleList}
        onToggleCodeBlock={toggleCodeBlock}
      />
      <div className="composer-row">
        <div className="composer-host" ref={hostRef} />
        <button type="button" className="send" onClick={submit}>
          Send
        </button>
      </div>
    </footer>
  );
}
