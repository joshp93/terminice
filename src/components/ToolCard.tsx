import { capForCard, clipLine } from "../lib/outputLimits";
import type { HookNote } from "../lib/toolResults";
import { useExpansion } from "./ExpansionContext";

/** Props for {@link ToolCard}. */
export type ToolCardProps = {
  /** The entry's id, which is how the pane tracks which cards are open. */
  id: string;
  name: string;
  /** A one-line summary of the input. */
  detail: string;
  /** The full input, shown when expanded. */
  input: string;
  /** The tool's output, shown when expanded. */
  result: string;
  status: "running" | "ok" | "error";
  /** Hooks that ran around this call, which may have changed what ran. */
  hooks: HookNote[];
};

/** How many lines of output a collapsed card shows. */
const PREVIEW_LINES = 2;

/**
 * Takes the first lines of a result, and counts what is left.
 *
 * Each line is shortened as well as counted, so output written without line
 * breaks in it cannot fill the card by wrapping.
 *
 * @param text - The full result.
 * @param count - How many lines to keep.
 * @returns The lines to show and how many were held back.
 */
function previewOf(text: string, count: number): { lines: string[]; hidden: number } {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length === 0) return { lines: [], hidden: 0 };
  const lines = trimmed.split("\n");
  return {
    lines: lines.slice(0, count).map((line) => clipLine(line)),
    hidden: Math.max(0, lines.length - count),
  };
}

/**
 * Renders a tool call, collapsed to its summary and the start of its output.
 *
 * Collapsed, the command stays visible and so do the first couple of lines the
 * tool printed, so a run is readable without opening anything. Expanding
 * reveals the exact input, the whole output and any hook that ran around it.
 *
 * @param props - The call and its result.
 * @returns The rendered tool card.
 */
export function ToolCard({ id, name, detail, input, result, status, hooks }: ToolCardProps) {
  const { isOpen, toggle } = useExpansion();
  const expandable = input.length > 0 || result.length > 0;
  const open = expandable && isOpen(id);
  const preview = previewOf(result, PREVIEW_LINES);
  const shownResult = open ? capForCard(result) : "";
  const notable = hooks.filter(
    (hook) => (hook.exitCode !== null && hook.exitCode !== 0) || hook.output.trim().length > 0,
  );

  return (
    <div className={open ? "tool-card open" : "tool-card"}>
      <button
        type="button"
        className="tool-summary"
        aria-expanded={open}
        disabled={!expandable}
        onClick={() => toggle(id)}
      >
        <span className={`tool-status ${status}`} aria-hidden="true" />
        <span className="tool-name">{name}</span>
        {detail.length > 0 && <span className="tool-detail">{detail}</span>}
        {expandable && (
          <span className="tool-disclosure">
            {open ? "hide" : preview.hidden > 0 ? `show ${preview.hidden} more` : "show"}
          </span>
        )}
      </button>

      {hooks.length > 0 && (
        <div className="tool-hooks">
          {hooks.map((hook) => (
            <span
              key={hook.hookId}
              className={
                hook.exitCode !== null && hook.exitCode !== 0 ? "hook-chip failed" : "hook-chip"
              }
              title={hook.output}
            >
              {hook.name}
              {hook.exitCode !== null && hook.exitCode !== 0 ? ` · exit ${hook.exitCode}` : ""}
            </span>
          ))}
        </div>
      )}

      {!open && preview.lines.length > 0 && (
        <button
          type="button"
          className={status === "error" ? "tool-preview failed" : "tool-preview"}
          aria-label={`Expand ${name} output`}
          onClick={() => toggle(id)}
        >
          <pre>
            {preview.lines.join("\n")}
            {preview.hidden > 0 ? "\n…" : ""}
          </pre>
        </button>
      )}

      {open && (
        <div className="tool-body">
          {input.length > 0 && (
            <div className="tool-section">
              <span className="tool-section-title">Input</span>
              <pre>{input}</pre>
            </div>
          )}
          {result.length > 0 && (
            <div className="tool-section">
              <span className="tool-section-title">Output</span>
              <pre className={status === "error" ? "failed" : ""}>{shownResult}</pre>
            </div>
          )}
          {notable.length > 0 && (
            <div className="tool-section">
              <span className="tool-section-title">Hooks</span>
              {notable.map((hook) => (
                <pre key={hook.hookId}>
                  {`${hook.name} → ${hook.outcome}\n${hook.output}`.trim()}
                </pre>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
