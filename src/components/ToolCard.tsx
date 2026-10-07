import { useState } from "react";
import type { HookNote } from "../lib/toolResults";

/** Props for {@link ToolCard}. */
export type ToolCardProps = {
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
 * @param text - The full result.
 * @param count - How many lines to keep.
 * @returns The lines to show and how many were held back.
 */
function previewOf(text: string, count: number): { lines: string[]; hidden: number } {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length === 0) return { lines: [], hidden: 0 };
  const lines = trimmed.split("\n");
  return { lines: lines.slice(0, count), hidden: Math.max(0, lines.length - count) };
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
export function ToolCard({ name, detail, input, result, status, hooks }: ToolCardProps) {
  const [open, setOpen] = useState(false);
  const expandable = input.length > 0 || result.length > 0;
  const preview = previewOf(result, PREVIEW_LINES);
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
        onClick={() => setOpen((current) => !current)}
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
        <div
          className={status === "error" ? "tool-preview failed" : "tool-preview"}
          onClick={() => setOpen(true)}
        >
          <pre>
            {preview.lines.join("\n")}
            {preview.hidden > 0 ? "\n…" : ""}
          </pre>
        </div>
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
              <pre className={status === "error" ? "failed" : ""}>{result}</pre>
            </div>
          )}
          {notable.length > 0 && (
            <div className="tool-section">
              <span className="tool-section-title">Hooks</span>
              {notable.map((hook) => (
                <pre key={hook.hookId}>{`${hook.name} → ${hook.outcome}\n${hook.output}`.trim()}</pre>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
