import { asArray, asNumber, asRecord, asText, type Json, prettyJson } from "./json";

/** A hook that ran around a tool call. */
export type HookNote = {
  hookId: string;
  /** The hook's name as the CLI reports it, such as `PreToolUse:Bash`. */
  name: string;
  /** The lifecycle event, such as `PreToolUse`. */
  event: string;
  outcome: string;
  exitCode: number | null;
  /** Whatever the hook printed, which is often why a call was intercepted. */
  output: string;
};

/**
 * Reads a `hook_response` event.
 *
 * @param message - A decoded `system`/`hook_response` line.
 * @returns The note, or null when the line is not one.
 */
export function readHookNote(message: Json): HookNote | null {
  if (asText(message.subtype) !== "hook_response") return null;
  const stdout = asText(message.stdout);
  const stderr = asText(message.stderr);
  const output = asText(message.output);
  return {
    hookId: asText(message.hook_id),
    name: asText(message.hook_name),
    event: asText(message.hook_event),
    outcome: asText(message.outcome) || "unknown",
    exitCode: asNumber(message.exit_code),
    output: output || [stdout, stderr].filter(Boolean).join("\n"),
  };
}

/**
 * The tool name a hook's matcher refers to.
 *
 * @param hookName - A name such as `PreToolUse:Bash`.
 * @returns The matcher when the hook is tool-scoped, otherwise an empty string.
 */
export function hookMatcher(hookName: string): string {
  const colon = hookName.indexOf(":");
  return colon < 0 ? "" : hookName.slice(colon + 1);
}

/**
 * Joins the text of a tool result's content.
 *
 * @param content - A string, or an array of content blocks.
 * @returns The concatenated text.
 */
export function readResultText(content: unknown): string {
  if (typeof content === "string") return content;
  return asArray(content)
    .map((block) => {
      const record = asRecord(block);
      if (!record) return "";
      if (asText(record.type) === "text") return asText(record.text);
      return asText(record.content);
    })
    .join("");
}

/**
 * Renders an edit's structured patch as a unified diff.
 *
 * @param patch - The `structuredPatch` array from a tool result.
 * @returns The diff, or an empty string when there are no hunks.
 */
function renderPatch(patch: unknown): string {
  const hunks = asArray(patch).flatMap((entry): string[] => {
    const hunk = asRecord(entry);
    if (!hunk) return [];
    const lines = asArray(hunk.lines).map(asText);
    if (lines.length === 0) return [];
    const header = `@@ -${asNumber(hunk.oldStart) ?? 0},${asNumber(hunk.oldLines) ?? 0} +${
      asNumber(hunk.newStart) ?? 0
    },${asNumber(hunk.newLines) ?? 0} @@`;
    return [header, ...lines];
  });

  return hunks.join("\n");
}

/**
 * Renders a tool's result for the expanded card.
 *
 * Where the CLI supplies a structured result it is used, because it is richer
 * than the text handed to the model.
 *
 * @param toolName - The tool that ran.
 * @param toolUseResult - The structured result, when the CLI sent one.
 * @param fallback - The plain text of the result.
 * @returns The body to display.
 */
export function describeToolResult(
  toolName: string,
  toolUseResult: unknown,
  fallback: string,
): string {
  const structured = asRecord(toolUseResult);
  if (!structured) return fallback;

  if (toolName === "Bash" || toolName === "PowerShell") {
    const stdout = asText(structured.stdout);
    const stderr = asText(structured.stderr);
    const parts: string[] = [];
    if (stdout) parts.push(stdout.replace(/\n$/, ""));
    if (stderr) parts.push(`--- stderr ---\n${stderr.replace(/\n$/, "")}`);
    if (structured.interrupted === true) parts.push("--- interrupted ---");
    return parts.join("\n") || fallback;
  }

  if (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit") {
    const gitDiff = asRecord(structured.gitDiff);
    const patch = asText(gitDiff?.patch) || renderPatch(structured.structuredPatch);
    if (patch) return patch;
  }

  return fallback || prettyJson(toolUseResult);
}
