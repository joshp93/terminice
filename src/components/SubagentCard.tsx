import type { ReactNode } from "react";
import { elapsedLabel } from "../lib/elapsedLabel";
import { capForCard } from "../lib/outputLimits";
import type { ChatEntry } from "../types";
import { useExpansion } from "./ExpansionContext";

/** Props for {@link SubagentCard}. */
export type SubagentCardProps = {
  entry: Extract<ChatEntry, { role: "subagent" }>;
  /** The agent's own transcript, rendered only while the card is open. */
  children: ReactNode;
};

/**
 * Summarises how far an agent has got.
 *
 * What can be said depends on what the CLI has said, and the three answers are
 * not equally good. The steps it took are the best, because they are the work
 * itself. Failing that, the numbers the task reports while it runs — calls made
 * and tokens spent — which is the only sign of life a background agent gives
 * between starting and finishing. Failing that, a word for the state it is in:
 * one the CLI has already answered for was started successfully, so it is
 * described as running in the background rather than as still starting minutes
 * later; and one that has finished with no steps recorded says so.
 *
 * @param entry - The subagent card being summarised.
 * @returns A short label for the card's summary line.
 */
function progressLabel(entry: SubagentCardProps["entry"]): string {
  const steps = entry.entries.length;
  if (steps > 0) return `${steps} step${steps === 1 ? "" : "s"}`;

  const progress = entry.progress ?? entry.usage;
  if (progress) {
    const tools = `${progress.toolUses} tool${progress.toolUses === 1 ? "" : "s"}`;
    return `${tools} · ${progress.tokens.toLocaleString()} tokens`;
  }

  if (entry.status !== "running") return "no steps";
  return entry.background === true ? "running in the background…" : "starting…";
}

/**
 * Renders a subagent's conversation, nested inside the call that spawned it.
 *
 * Collapsed by default, like every other card, because a subagent's working is
 * scaffolding around the report it hands back. Opening it reveals what the
 * agent said and did, in order, followed by that report.
 *
 * @param props - The subagent entry and its rendered transcript.
 * @returns The rendered card.
 */
export function SubagentCard({ entry, children }: SubagentCardProps) {
  const { isOpen, toggle } = useExpansion();
  const open = isOpen(entry.id);
  const steps = entry.entries.length;

  return (
    <div className={open ? "subagent-card open" : "subagent-card"}>
      <button
        type="button"
        className="subagent-summary"
        aria-expanded={open}
        onClick={() => toggle(entry.id)}
      >
        <span className={`tool-status ${entry.status}`} aria-hidden="true" />
        <span className="subagent-name">Subagent</span>
        {entry.label.length > 0 && <span className="subagent-label">{entry.label}</span>}
        <span className="subagent-steps">{progressLabel(entry)}</span>
        {entry.status === "running" && entry.elapsedSeconds !== undefined && (
          <span className="subagent-elapsed">{elapsedLabel(entry.elapsedSeconds)}</span>
        )}
        <span className="tool-disclosure">{open ? "hide" : "show"}</span>
      </button>

      {open && (
        <div className="subagent-body">
          {steps > 0 && <div className="subagent-transcript">{children}</div>}
          {entry.result.length > 0 && (
            <div className="tool-section">
              <span className="tool-section-title">Report</span>
              <pre>{capForCard(entry.result)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
