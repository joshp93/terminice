import type { RefObject } from "react";

/** Props for {@link TerminalPane}. */
export type TerminalPaneProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  status: string;
};

/**
 * Renders the pane that a terminal view fills.
 *
 * @param props - The container ref the terminal attaches to, and a status label.
 * @returns The rendered terminal pane.
 */
export function TerminalPane({ containerRef, status }: TerminalPaneProps) {
  return (
    <section className="pane terminal-pane">
      <header className="pane-header">
        <span className="pane-title">Terminal</span>
        <span className="pane-status">{status}</span>
      </header>
      <div className="terminal-host" ref={containerRef} />
    </section>
  );
}
