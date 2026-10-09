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

/** The kinds of work the tracker reports on. */
export type RunningKind = "agent" | "shell" | "tool";

/** One thing the session is waiting on, as the tracker menu lists it. */
export type RunningItem = {
  /** The transcript entry's id, which is what a jump to it is asked for by. */
  id: string;
  /** What the row says. */
  label: string;
};

/** Everything running of one kind, with the line the tracker shows for it. */
export type RunningGroup = {
  kind: RunningKind;
  /** The whole line, such as "2 shells running". */
  label: string;
  items: RunningItem[];
};

/** Tools that are a shell by another name, so they are counted as one. */
const SHELL_TOOLS = ["Bash", "BashOutput", "KillShell"];

/** How each kind is named, for one and for several. */
const NOUNS: Record<RunningKind, { one: string; many: string }> = {
  agent: { one: "agent", many: "agents" },
  shell: { one: "shell", many: "shells" },
  tool: { one: "tool", many: "tools" },
};

/** The order the groups are shown in, longest-running work first. */
const ORDER: readonly RunningKind[] = ["agent", "shell", "tool"];

/**
 * What the session is currently waiting on, grouped by kind.
 *
 * A tool that runs a shell is counted as a shell rather than as a tool, because
 * that is what the reader watching it is waiting for; a local `!` command is one
 * too. Only the top level is read: a subagent's own calls are inside it, and the
 * agent itself is the thing that is running.
 *
 * @param state - The session's chat state.
 * @returns One group per kind that has anything running, in a fixed order.
 */
export function runningGroups(state: ChatState): RunningGroup[] {
  const items: Record<RunningKind, RunningItem[]> = { agent: [], shell: [], tool: [] };

  for (const entry of state.entries) {
    if (entry.role === "subagent") {
      if (entry.status === "running") {
        items.agent.push({ id: entry.id, label: entry.label || "Subagent" });
      }
      continue;
    }

    if (entry.role === "shell") {
      if (entry.running) items.shell.push({ id: entry.id, label: `!${entry.command}` });
      continue;
    }

    if (entry.role !== "tool" || entry.status !== "running") continue;
    const kind: RunningKind = SHELL_TOOLS.includes(entry.name) ? "shell" : "tool";
    items[kind].push({
      id: entry.id,
      label: entry.detail.length > 0 ? `${entry.name} · ${entry.detail}` : entry.name,
    });
  }

  return ORDER.flatMap((kind) => {
    const running = items[kind];
    if (running.length === 0) return [];
    const noun = running.length === 1 ? NOUNS[kind].one : NOUNS[kind].many;
    return [{ kind, label: `${running.length} ${noun} running`, items: running }];
  });
}
