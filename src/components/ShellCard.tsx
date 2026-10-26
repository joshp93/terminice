import { capForCard, clipLine } from "../lib/outputLimits";
import { useExpansion } from "./ExpansionContext";
import { LinkifiedText } from "./LinkifiedText";

/** Props for {@link ShellCard}. */
export type ShellCardProps = {
  /** The entry's id, which is how the pane tracks which cards are open. */
  id: string;
  /** The command, without its leading `!`. */
  command: string;
  stdout: string;
  stderr: string;
  code: number | null;
  /** True until the command has finished. */
  running: boolean;
  /** True when the reader stopped it rather than letting it finish. */
  stopped?: boolean;
  /** Stops the command, while it is still running. */
  onStop?: () => void;
};

/** How many lines of output a collapsed card shows. */
const PREVIEW_LINES = 4;

/**
 * Renders a command run locally behind the `!` prefix.
 *
 * @param props - The command and what it produced.
 * @returns The rendered card.
 */
export function ShellCard({
  id,
  command,
  stdout,
  stderr,
  code,
  running,
  stopped = false,
  onStop,
}: ShellCardProps) {
  const { isOpen, toggle } = useExpansion();
  const open = isOpen(id);
  const output = [stdout.replace(/\s+$/, ""), stderr.replace(/\s+$/, "")]
    .filter((part) => part.length > 0)
    .join("\n");
  const lines = output.length === 0 ? [] : output.split("\n");
  const hidden = Math.max(0, lines.length - PREVIEW_LINES);
  const shown = open
    ? capForCard(output)
    : lines
        .slice(0, PREVIEW_LINES)
        .map((line) => clipLine(line))
        .join("\n");
  const failed = code !== null && code !== 0;

  /**
   * Opens the card from the output preview.
   *
   * The preview is a way into the whole output rather than a second control
   * for putting it away, so it only ever opens.
   */
  const revealAll = (): void => {
    if (!open) toggle(id);
  };

  return (
    <div className={failed ? "shell-card failed" : "shell-card"}>
      <div className="shell-header">
        <button
          type="button"
          className="shell-summary"
          aria-expanded={open}
          disabled={lines.length === 0}
          onClick={() => toggle(id)}
        >
          <span className={running ? "tool-status running" : "tool-status"} aria-hidden="true" />
          <span className="shell-prefix">!</span>
          <span className="shell-command">{command}</span>
          {running ? (
            <span className="shell-exit">running…</span>
          ) : stopped ? (
            <span className="shell-exit">stopped</span>
          ) : (
            failed && <span className="shell-exit">exit {code}</span>
          )}
          {lines.length > 0 && (
            <span className="tool-disclosure">
              {open ? "hide" : hidden > 0 ? `show ${hidden} more` : "show"}
            </span>
          )}
        </button>
        {running && onStop && (
          <button type="button" className="shell-stop" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      {shown.length > 0 &&
        (open ? (
          <div className="shell-output open">
            <pre>
              <LinkifiedText text={shown} />
            </pre>
          </div>
        ) : (
          <button
            type="button"
            className="shell-output"
            aria-label={`Expand ${command} output`}
            onClick={revealAll}
          >
            <pre>
              {shown}
              {hidden > 0 ? "\n…" : ""}
            </pre>
          </button>
        ))}
    </div>
  );
}
