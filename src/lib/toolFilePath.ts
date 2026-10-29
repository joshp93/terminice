import { asRecord, asText } from "./json";

/** The input fields a tool names the file it works on with. */
const PATH_FIELDS = ["file_path", "path", "notebook_path"];

/**
 * Reads the file a tool call worked on from its serialised input.
 *
 * An edit's result is rendered from the CLI's `structuredPatch`, which carries
 * hunk headers and no `+++` line naming the file — so the path a diff is drawn
 * in the language of has to come from the call rather than from its output.
 *
 * @param input - The call's input as the card holds it, which is JSON text.
 * @returns The path, or null when the call did not name one.
 */
export function toolFilePath(input: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record) return null;

  for (const field of PATH_FIELDS) {
    const value = asText(record[field]);
    if (value.length > 0) return value;
  }

  return null;
}
