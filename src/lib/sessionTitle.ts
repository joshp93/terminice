import type { ChatEntry } from "../types";
import { oneLine } from "./oneLine";

/** What the application is called, which every title begins with. */
const APP_NAME = "terminice";

/** How much of the session's first message fits in a title. */
const TITLE_LIMIT = 60;

/**
 * Names a session by the first thing that was asked of it.
 *
 * The sessions on disk carry no title of their own — only an opaque id — so the
 * opening message is what a reader recognises the session by, and it is the
 * same text the resume menu shows. A session nothing has been asked of yet has
 * no name to take, and is titled by the application alone.
 *
 * @param entries - The transcript entries.
 * @returns The window title.
 */
export function sessionTitle(entries: ChatEntry[]): string {
  const asked = entries.find((entry) => entry.role === "user" && entry.text.trim().length > 0);
  if (asked === undefined || asked.role !== "user") return APP_NAME;
  return `${APP_NAME} - ${oneLine(asked.text, TITLE_LIMIT)}`;
}
