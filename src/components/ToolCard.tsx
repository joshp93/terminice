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

/**
 * Renders a tool call, collapsed to one line until it is opened.
 *
 * The command is always visible in the summary; expanding reveals the exact
 * input that was sent and everything the tool returned.
 *
 * @param props - The call and its result.
 * @returns The rendered tool card.
 */
export function ToolCard({ name, detail, input, result, status, hooks }: ToolCardProps) {
  const [open, setOpen] = useState(false);
  const expandable = input.length > 0 || result.length > 0;
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
        {expandable && <span className="tool-disclosure">{open ? "hide" : "show"}</span>}
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
