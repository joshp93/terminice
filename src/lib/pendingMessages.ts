import type { ChatEntry, ChatState } from "../types";

/**
 * Whether a message is still waiting for the CLI to pick it up.
 *
 * A message sent while a turn was already running carries the mark until that
 * turn ends, because the CLI says nothing about taking one up. While the mark is
 * on, the message has not joined the conversation yet.
 *
 * @param entry - The transcript entry to test.
 * @returns True while the message is waiting.
 */
export function isPending(entry: ChatEntry): entry is Extract<ChatEntry, { role: "user" }> {
  return entry.role === "user" && entry.queued === true;
}

/**
 * The messages waiting to be read, in the order they were sent.
 *
 * They are read out of the transcript rather than out of a queue of their own,
 * so that where they are shown can change without where they *belong* changing:
 * the entry keeps the index it was appended at, and drops back into that place
 * the moment the mark comes off.
 *
 * @param state - The session's chat state.
 * @returns The waiting messages, oldest first.
 */
export function pendingMessages(state: ChatState): Extract<ChatEntry, { role: "user" }>[] {
  return state.entries.filter(isPending);
}
