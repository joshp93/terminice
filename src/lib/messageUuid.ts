/**
 * A uuid for a message, so the CLI can be asked to drop it again.
 *
 * The CLI identifies a message it is holding in its queue by the uuid the
 * message was sent with, and compares it as an exact string. That is the whole
 * reason one is sent: without it a queued message cannot be named, and so cannot
 * be taken back before it runs.
 *
 * @returns A version 4 uuid.
 */
export function messageUuid(): string {
  return crypto.randomUUID();
}
