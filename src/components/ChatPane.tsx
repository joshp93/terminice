import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { ToolCard } from "./ToolCard";
import type { ChatEntry, ChatState } from "../types";

/** Props for {@link ChatPane}. */
export type ChatPaneProps = {
  state: ChatState;
  status: string;
};

/**
 * Renders the chat transcript.
 *
 * Scrolls to the newest content as entries arrive.
 *
 * @param props - The chat state and a status label.
 * @returns The rendered chat pane.
 */
export function ChatPane({ state, status }: ChatPaneProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [state.entries, state.streaming]);

  return (
    <section className="pane">
      <header className="pane-header">
        <span className="pane-title">Claude</span>
        <span className="pane-status">{status}</span>
      </header>
      <div className="transcript">
        {state.entries.map((entry) => (
          <TranscriptItem key={entry.id} entry={entry} />
        ))}
        {state.streaming.length > 0 && (
          <div className="bubble assistant streaming">
            <MessageBubble text={state.streaming} />
          </div>
        )}
        {state.busy && state.streaming.length === 0 && <div className="working">Working…</div>}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function TranscriptItem({ entry }: { entry: ChatEntry }) {
  switch (entry.role) {
    case "tool":
      return (
        <ToolCard
          name={entry.name}
          detail={entry.detail}
          input={entry.input}
          result={entry.result}
          status={entry.status}
          hooks={entry.hooks}
        />
      );
    case "notice":
      return <div className="notice">{entry.text}</div>;
    case "error":
      return <div className="error-banner">{entry.text}</div>;
    default:
      return (
        <div className={`bubble ${entry.role}`}>
          <MessageBubble text={entry.text} preserveLineBreaks={entry.role === "user"} />
        </div>
      );
  }
}
