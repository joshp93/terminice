import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../lib/copyText";

/** Props for {@link CodeBlock}. */
export type CodeBlockProps = {
  /** The code as the message wrote it, which is what the button copies. */
  code: string;
  /** The code as the Markdown renderer drew it, highlighting and all. */
  children: ReactNode;
};

/** How long the tick stays up before the button offers to copy again. */
export const COPIED_FOR_MS = 2000;

/**
 * Draws the tick that says the code is on the clipboard.
 *
 * @returns The rendered tick.
 */
function TickGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );
}

/**
 * The code as it goes to the clipboard.
 *
 * The renderer puts a newline after the last line of a block, so that the block
 * lays out as its own line rather than as part of the one above it. The code an
 * author wrote does not end with one, and a paste that carries a stray newline
 * into a shell is a second command waiting to be run — so the one the renderer
 * added comes off. Only one: a block whose own last line is blank keeps it.
 *
 * @param code - The code as the rendered tree holds it.
 * @returns The code to copy.
 */
function codeToCopy(code: string): string {
  return code.endsWith("\n") ? code.slice(0, -1) : code;
}

/**
 * Renders one fenced code block, with a button that copies it.
 *
 * The button says what it did rather than only doing it: a press that worked
 * turns it into a tick for two seconds, which is the whole of the feedback —
 * there is nothing else on screen that could report it. A press that did not
 * work leaves the button as it was, so the tick means the code is on the
 * clipboard and its absence means it is not.
 *
 * The button sits above the code rather than in it, because the code scrolls
 * sideways and a control inside that scroll would leave with it.
 *
 * @param props - The code to copy and the drawing of it.
 * @returns The rendered code block.
 */
export function CodeBlock({ code, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  /**
   * Copies the code, and shows the tick when it worked.
   *
   * The timer is restarted on every press, so a second press gets its own two
   * seconds rather than inheriting the remainder of the first.
   */
  const copy = useCallback(async () => {
    const done = await copyText(codeToCopy(code));
    if (!done) return;

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setCopied(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, COPIED_FOR_MS);
  }, [code]);

  return (
    <div className="code-block">
      <button
        type="button"
        className={copied ? "code-copy copied" : "code-copy"}
        aria-label={copied ? "Copied" : "Copy code"}
        title={copied ? "Copied to the clipboard" : "Copy this code"}
        onClick={() => void copy()}
      >
        {copied ? <TickGlyph /> : "Copy"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
