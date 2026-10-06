import { useCallback, useEffect, useRef, useState } from "react";
import { createComposer, type ComposerHandle } from "../lib/createComposer";
import { FormatToolbar } from "./FormatToolbar";
import type { FormatId } from "../lib/richFormat";
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
 * In Claude mode Markdown formatting is available and the text is passed
 * through untouched; in terminal mode the text is forwarded verbatim.
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
  const [activeFormats, setActiveFormats] = useState<ReadonlySet<FormatId>>(new Set());
  const activeFormatsRef = useRef<ReadonlySet<FormatId>>(activeFormats);

  useEffect(() => {
    sendRef.current = onSend;
  }, [onSend]);

  useEffect(() => {
    submitsRef.current = submitsOnEnter;
  }, [submitsOnEnter]);

  const rich = mode === "claude";

  useEffect(() => {
    richRef.current = rich;
  }, [rich]);

  const submit = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.closeOpenWord();
    const text = handle.getText();
    handle.clear();
    if (text.trim().length === 0) return;
    sendRef.current(text);
  }, []);

  const toggleFormat = useCallback((id: FormatId) => {
    handleRef.current?.closeOpenWord();
    const next = new Set(activeFormatsRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    activeFormatsRef.current = next;
    handleRef.current?.setActiveFormats([...next]);
    setActiveFormats(next);
  }, []);

  const toggleRef = useRef(toggleFormat);
  useEffect(() => {
    toggleRef.current = toggleFormat;
  }, [toggleFormat]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createComposer({
      parent: host,
      placeholder: PLACEHOLDERS[mode],
      onSubmit: () => submit(),
      submitsOnEnter: () => submitsRef.current(),
      isRichFormatting: () => richRef.current,
      onToggleFormat: (id) => toggleRef.current(id),
    });
    handleRef.current = handle;
    handle.setActiveFormats([...activeFormatsRef.current]);
    handle.focus();
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [mode, submit]);

  return (
    <footer className="composer">
      <div className="composer-row">
        {rich && <FormatToolbar activeFormats={activeFormats} onToggle={toggleFormat} />}
        <div className="composer-host" ref={hostRef} />
        <button type="button" className="send" onClick={submit}>
          Send
        </button>
      </div>
    </footer>
  );
}
