import type { ReactNode } from "react";
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
 * An agent whose frames were never forwarded records no steps at all, so an
 * empty transcript only means "starting" while the agent is still running —
 * once it has finished, saying so would be wrong.
 *
 * @param entry - The subagent card being summarised.
 * @returns A short label for the card's summary line.
 */
function progressLabel(entry: SubagentCardProps["entry"]): string {
  const steps = entry.entries.length;
  if (steps > 0) return `${steps} step${steps === 1 ? "" : "s"}`;
  return entry.status === "running" ? "starting…" : "no steps";
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
