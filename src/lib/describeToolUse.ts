import { oneLine } from "./oneLine";

/**
 * Summarises a tool call's input for display.
 *
 * @param name - The tool name reported by Claude.
 * @param input - The tool input payload.
 * @returns A short human-readable detail, or an empty string when unknown.
 */
export function describeToolUse(name: string, input: unknown): string {
  const record =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};

  const read = (...keys: string[]): string => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) return oneLine(value);
    }
    return "";
  };

  switch (name) {
    case "Bash":
      return read("command");
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return read("file_path", "notebook_path");
    case "Glob":
    case "Grep":
      return read("pattern");
    case "WebFetch":
      return read("url");
    case "WebSearch":
      return read("query");
    case "Task":
    case "Agent":
      return read("description");
    default:
      return "";
  }
}
