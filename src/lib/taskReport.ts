import { asRecord, type Json } from "./json";

/** What a background task's closing notification says. */
export type TaskReport = {
  /** The call that launched the task, which is how its card is found. */
  toolUseId: string;
  /** True when the task ended in failure rather than by finishing. */
  failed: boolean;
  /** The one-line description of what ended. */
  summary: string;
  /** The body the task produced, when the notification carries one. */
  report: string;
};

/** The whole payload, so a notification written over several lines is read whole. */
const NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/;

/** How deep a frame is searched for a notification. */
const MAX_DEPTH = 5;

/**
 * Reads one field out of a notification's body.
 *
 * @param body - The text between the notification's tags.
 * @param tag - The tag to read.
 * @returns What it held, trimmed, or an empty string when it was not there.
 */
function fieldOf(body: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body);
  return match ? match[1].trim() : "";
}

/**
 * Reads what a task notification says about the task that ended.
 *
 * A notification is addressed by the `<tool-use-id>` of the call that started
 * the task, which is the id a card in the transcript is keyed by, so it is what
 * connects the two. One that names no call — an event from a watcher rather
 * than from an agent — is not a report about anything on screen, and reads as
 * nothing here.
 *
 * @param text - A string that may be a task notification.
 * @returns What it says, or null when it is not one about a call.
 */
export function readTaskReport(text: string): TaskReport | null {
  const body = NOTIFICATION.exec(text)?.[1];
  if (body === undefined) return null;

  const toolUseId = fieldOf(body, "tool-use-id");
  if (toolUseId.length === 0) return null;

  return {
    toolUseId,
    failed: fieldOf(body, "status") === "failed",
    summary: fieldOf(body, "summary"),
    report: fieldOf(body, "result"),
  };
}

/**
 * Looks through a decoded value for the first string holding a notification.
 *
 * @param value - The value to search.
 * @param depth - How much further it may descend.
 * @returns The report found, or null.
 */
function searchForReport(value: unknown, depth: number): TaskReport | null {
  if (depth > MAX_DEPTH) return null;
  if (typeof value === "string") {
    return value.includes("<task-notification>") ? readTaskReport(value) : null;
  }

  const record = asRecord(value);
  const nested: unknown[] = record ? Object.values(record) : Array.isArray(value) ? value : [];
  for (const child of nested) {
    const found = searchForReport(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Finds a task notification inside a frame, wherever the CLI put it.
 *
 * The notification arrives in a frame of the CLI's own choosing — its own
 * records file it as an attachment, which is not a message type the stream
 * carries — so the payload is looked for rather than the frame's shape
 * predicted. It names itself, and a frame without the tag costs one string
 * comparison per value, so being wrong about which frame brings it costs
 * nothing.
 *
 * @param frame - Any decoded stream-json frame.
 * @returns The report it carried, or null when it carried none.
 */
export function taskReportIn(frame: Json): TaskReport | null {
  return searchForReport(frame, 0);
}
