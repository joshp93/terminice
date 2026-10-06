import type { RefObject } from "react";

/** Props for {@link TerminalPane}. */
export type TerminalPaneProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  status: string;
  active: boolean;
};

/**
 * Renders the pane that a terminal view fills.
 *
 * The pane stays mounted while hidden so the shell keeps running and the
 * terminal keeps a measurable size; only its visibility changes.
 *
 * @param props - The container ref, a status label, and whether it is shown.
 * @returns The rendered terminal pane.
 */
export function TerminalPane({ containerRef, status, active }: TerminalPaneProps) {
  return (
    <section className={active ? "pane terminal-pane" : "pane terminal-pane inactive"}>
      <header className="pane-header">
        <span className="pane-title">Terminal</span>
        <span className="pane-status">{status}</span>
      </header>
      <div className="terminal-host" ref={containerRef} />
    </section>
  );
}
