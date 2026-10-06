import { useCallback, useEffect, useRef } from "react";
import { createComposer, type ComposerHandle } from "../lib/createComposer";
import type { ComposerTarget } from "../types";

/** Props for {@link Composer}. */
export type ComposerProps = {
  target: ComposerTarget;
  onTargetChange: (target: ComposerTarget) => void;
  onSend: (text: string) => void;
};

const PLACEHOLDER = "Write a message — Enter to send, Shift+Enter for a new line";

/**
 * Renders the rich-text composer and the switch that chooses its destination.
 *
 * Empty submissions are ignored; the editor is cleared before sending.
 *
 * @param props - The active target, a target setter, and the send handler.
 * @returns The rendered composer.
 */
export function Composer({ target, onTargetChange, onSend }: ComposerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ComposerHandle | null>(null);
  const sendRef = useRef(onSend);

  useEffect(() => {
    sendRef.current = onSend;
  }, [onSend]);

  const submit = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const text = handle.getText();
    if (text.trim().length === 0) return;
    handle.clear();
    sendRef.current(text);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createComposer({ parent: host, placeholder: PLACEHOLDER, onSubmit: submit });
    handleRef.current = handle;
    handle.focus();
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [submit]);

  return (
    <footer className="composer">
      <div className="composer-target">
        <button
          type="button"
          className={target === "claude" ? "chip active" : "chip"}
          onClick={() => onTargetChange("claude")}
        >
          Claude
        </button>
        <button
          type="button"
          className={target === "terminal" ? "chip active" : "chip"}
          onClick={() => onTargetChange("terminal")}
        >
          Terminal
        </button>
      </div>
      <div className="composer-host" ref={hostRef} />
      <button type="button" className="send" onClick={submit}>
        Send
      </button>
    </footer>
  );
}
