import { oneLine } from "./oneLine";

/**
 * Reads the description a tool call gave itself.
 *
 * Several tools accept a short sentence saying what the call is for, which is a
 * better title than the command it names. Everything else has no description,
 * and shows its input instead.
 *
 * @param input - The tool input payload.
 * @returns The description as one line, or an empty string when there is none.
 */
export function describeToolDescription(input: unknown): string {
  const record =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  return typeof record.description === "string" ? oneLine(record.description) : "";
}
