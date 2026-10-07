import { memo, useEffect, useRef } from "react";
import { EmptyChat } from "./EmptyChat";
import { MessageBubble } from "./MessageBubble";
import { ShellCard } from "./ShellCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./ToolCard";
import type { ChatEntry, ChatState } from "../types";

/** Props for {@link ChatPane}. */
export type ChatPaneProps = {
  state: ChatState;
};

/**
 * Renders the chat transcript.
 *
 * Scrolls to the newest content as entries arrive.
 *
 * @param props - The chat state.
 * @returns The rendered chat pane.
 */
export function ChatPane({ state }: ChatPaneProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  const empty = state.entries.length === 0 && state.streaming.length === 0 && !state.busy;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [state.entries, state.streaming]);

  return (
    <section className="pane">
      <div className={empty ? "transcript empty" : "transcript"}>
        {empty && <EmptyChat />}
        {state.entries.map((entry) => (
          <TranscriptItem key={entry.id} entry={entry} />
        ))}
        {state.streaming.length > 0 && (
          <div className="bubble assistant streaming">
            <MessageBubble text={state.streaming} />
          </div>
        )}
        {state.busy && state.streaming.length === 0 && (
          <div className="working">
            {state.thinkingTokens > 0
              ? `Thinking… ${state.thinkingTokens.toLocaleString()} tokens`
              : "Working…"}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}

/**
 * Renders one row of the transcript.
 *
 * Memoised because the pane re-renders for state that has nothing to do with
 * the rows: the reasoning-token counter ticks several hundred times a turn, and
 * a row that re-renders re-parses the Markdown inside it. An entry object is
 * only replaced when that entry actually changed, so the comparison almost
 * always bails.
 *
 * @param props - The entry to render.
 * @returns The rendered row.
 */
const TranscriptItem = memo(function TranscriptItem({ entry }: { entry: ChatEntry }) {
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
    case "thinking":
      return <ThinkingBlock text={entry.text} />;
    case "shell":
      return (
        <ShellCard
          command={entry.command}
          stdout={entry.stdout}
          stderr={entry.stderr}
          code={entry.code}
          running={entry.running}
        />
      );
    case "error":
      return <div className="error-banner">{entry.text}</div>;
    default:
      return (
        <div className={`bubble ${entry.role}`}>
          <MessageBubble text={entry.text} preserveLineBreaks={entry.role === "user"} />
        </div>
      );
  }
});
