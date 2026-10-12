import { oneLine } from "../lib/oneLine";
import type { ChatEntry } from "../types";

/** Props for {@link PendingMessages}. */
export type PendingMessagesProps = {
  /** The messages the running turn has not picked up yet. */
  messages: Extract<ChatEntry, { role: "user" }>[];
  /** Takes one back out of the queue before it runs, by its entry id. */
  onUnqueue: (id: string) => void;
};

/**
 * Renders the messages a running turn has not picked up yet.
 *
 * They wait here rather than in the transcript because they have not joined the
 * conversation: the CLI gives no signal for taking a message up, so the mark
 * comes off when the turn that was already running ends. Shown in the transcript
 * they would take a place in the chat that the conversation has not reached —
 * and then be shuffled down the pane, a row at a time, by a turn that is not
 * answering them.
 *
 * Each one carries a way to take it back. The message is named by the uuid it
 * was sent under, so a row that has none — a replayed message, or one the CLI
 * raised itself — has nothing to offer and is drawn without it.
 *
 * @param props - The waiting messages and how to take one back.
 * @returns The waiting messages, or nothing when there are none.
 */
export function PendingMessages({ messages, onUnqueue }: PendingMessagesProps) {
  if (messages.length === 0) return null;

  return (
    <div className="pending">
      {messages.map((message) => {
        const summary = oneLine(message.text);
        return (
          <div className="pending-row" key={message.id}>
            <p className="pending-message">
              <span className="queued-badge">Queued</span>
              <span className="pending-text">{summary}</span>
            </p>
            {message.messageUuid !== undefined && (
              <button
                type="button"
                className="pending-dismiss"
                aria-label={`Take "${summary}" back out of the queue`}
                onClick={() => onUnqueue(message.id)}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
