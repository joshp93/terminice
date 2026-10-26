import { MessageBubble } from "./MessageBubble";

/** Props for {@link ContextSummary}. */
export type ContextSummaryProps = {
  /** The summary a compaction wrote. */
  text: string;
};

/**
 * Renders a compaction summary as a block of its own.
 *
 * The summary replaces the messages it condensed, so it is not a message the
 * reader sent and should not look like one. It folds away because a summary is
 * long, and a reader who is following the conversation wants the place it
 * happened rather than the whole of it.
 *
 * @param props - The summary text.
 * @returns The rendered summary block.
 */
export function ContextSummary({ text }: ContextSummaryProps) {
  return (
    <details className="context-summary">
      <summary className="context-summary-title">Context summary</summary>
      <div className="context-summary-body">
        <MessageBubble text={text} />
      </div>
    </details>
  );
}
