import type { ChatState } from "../types";

/**
 * Whether a tool call has started and not yet reported back.
 *
 * A session waiting on a tool is silent by design: the model is not generating,
 * so nothing at all is streamed for as long as the tool runs. That is the same
 * kind of silence as a CLI waiting on the user, and anything watching for a
 * wedged session has to treat it the same way — otherwise a test run or a build
 * is interrupted part-way through for the crime of taking a while.
 *
 * A subagent counts as well: it is still working until it hands back its report,
 * and its own tool calls are inside it rather than beside it.
 *
 * @param state - The session's chat state.
 * @returns True while any tool call, or any subagent, is still running.
 */
export function hasRunningTool(state: ChatState): boolean {
  return state.entries.some(
    (entry) =>
      (entry.role === "tool" && entry.status === "running") ||
      (entry.role === "subagent" && entry.status === "running"),
  );
}
