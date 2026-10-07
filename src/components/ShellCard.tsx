import { useState } from "react";

/** Props for {@link ShellCard}. */
export type ShellCardProps = {
  /** The command, without its leading `!`. */
  command: string;
  stdout: string;
  stderr: string;
  code: number | null;
  /** True until the command has finished. */
  running: boolean;
};

/** How many lines of output a collapsed card shows. */
const PREVIEW_LINES = 4;

/**
 * Renders a command run locally behind the `!` prefix.
 *
 * @param props - The command and what it produced.
 * @returns The rendered card.
 */
export function ShellCard({ command, stdout, stderr, code, running }: ShellCardProps) {
  const [open, setOpen] = useState(false);
  const output = [stdout.replace(/\s+$/, ""), stderr.replace(/\s+$/, "")]
    .filter((part) => part.length > 0)
    .join("\n");
  const lines = output.length === 0 ? [] : output.split("\n");
  const hidden = Math.max(0, lines.length - PREVIEW_LINES);
  const shown = open ? lines : lines.slice(0, PREVIEW_LINES);
  const failed = code !== null && code !== 0;

  return (
    <div className={failed ? "shell-card failed" : "shell-card"}>
      <button
        type="button"
        className="shell-summary"
        aria-expanded={open}
        disabled={hidden === 0}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={running ? "tool-status running" : "tool-status"} aria-hidden="true" />
        <span className="shell-prefix">!</span>
        <span className="shell-command">{command}</span>
        {running ? (
          <span className="shell-exit">running…</span>
        ) : (
          failed && <span className="shell-exit">exit {code}</span>
        )}
        {hidden > 0 && (
          <span className="tool-disclosure">{open ? "hide" : `show ${hidden} more`}</span>
        )}
      </button>
      {shown.length > 0 && (
        <button
          type="button"
          className="shell-output"
          aria-label={`Expand ${command} output`}
          disabled={hidden === 0}
          onClick={() => setOpen(true)}
        >
          <pre>
            {shown.join("\n")}
            {!open && hidden > 0 ? "\n…" : ""}
          </pre>
        </button>
      )}
    </div>
  );
}
