import { memo } from "react";
import type { ChatEntry } from "../types";
import { MessageBubble } from "./MessageBubble";
import { ShellCard } from "./ShellCard";
import { SubagentCard } from "./SubagentCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./ToolCard";

/** Props for {@link TranscriptItem}. */
export type TranscriptItemProps = {
  entry: ChatEntry;
};

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
export const TranscriptItem = memo(function TranscriptItem({ entry }: TranscriptItemProps) {
  switch (entry.role) {
    case "tool":
      return (
        <ToolCard
          id={entry.id}
          name={entry.name}
          detail={entry.detail}
          input={entry.input}
          result={entry.result}
          status={entry.status}
          hooks={entry.hooks}
        />
      );
    case "subagent":
      return (
        <SubagentCard entry={entry}>
          {entry.entries.map((child) => (
            <TranscriptItem key={child.id} entry={child} />
          ))}
        </SubagentCard>
      );
    case "notice":
      return <div className="notice">{entry.text}</div>;
    case "thinking":
      return <ThinkingBlock id={entry.id} text={entry.text} />;
    case "shell":
      return (
        <ShellCard
          id={entry.id}
          command={entry.command}
          stdout={entry.stdout}
          stderr={entry.stderr}
          code={entry.code}
          running={entry.running}
        />
      );
    case "error":
      return <div className="error-banner">{entry.text}</div>;
    case "user":
      return (
        <div className="bubble user">
          {entry.queued === true && <span className="queued-badge">Queued</span>}
          <MessageBubble text={entry.text} preserveLineBreaks />
        </div>
      );
    default:
      return (
        <div className={`bubble ${entry.role}`}>
          <MessageBubble text={entry.text} preserveLineBreaks={false} />
        </div>
      );
  }
});
