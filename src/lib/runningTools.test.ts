import { describe, expect, it } from "vitest";
import type { ChatEntry, ChatState } from "../types";
import { createChatState } from "../types";
import { runningGroups } from "./runningTools";

const stateWith = (...entries: ChatEntry[]): ChatState => ({ ...createChatState(), entries });

const tool = (
  status: "running" | "ok" | "error",
  overrides: Partial<Extract<ChatEntry, { role: "tool" }>> = {},
): Extract<ChatEntry, { role: "tool" }> => ({
  id: `tool-${status}`,
  role: "tool",
  toolUseId: "t1",
  name: "Bash",
  description: "",
  detail: "pnpm test",
  input: "{}",
  result: "",
  status,
  hooks: [],
  ...overrides,
});

const shell = (running: boolean): Extract<ChatEntry, { role: "shell" }> => ({
  id: `shell-${running}`,
  role: "shell",
  command: "ls",
  stdout: "",
  stderr: "",
  code: running ? null : 0,
  running,
});

const subagent = (
  status: "running" | "ok" | "error",
): Extract<ChatEntry, { role: "subagent" }> => ({
  id: `sub-${status}`,
  role: "subagent",
  toolUseId: "t2",
  label: "Explore",
  input: "{}",
  result: "",
  status,
  entries: [],
});

describe("runningGroups", () => {
  const kinds = (state: ChatState): string[] => runningGroups(state).map((group) => group.kind);

  it("reports nothing for a session that has done nothing", () => {
    expect(runningGroups(createChatState())).toEqual([]);
  });

  it("counts the agents that are still working", () => {
    const state = stateWith(
      { ...subagent("running"), id: "a1" },
      { ...subagent("running"), id: "a2" },
      subagent("ok"),
    );

    expect(runningGroups(state)).toEqual([
      {
        kind: "agent",
        label: "2 agents running",
        items: [
          { id: "a1", label: "Explore" },
          { id: "a2", label: "Explore" },
        ],
      },
    ]);
  });

  it("says one agent rather than one agents", () => {
    expect(runningGroups(stateWith(subagent("running")))[0]?.label).toBe("1 agent running");
  });

  it("counts a tool that runs a shell as a shell", () => {
    const state = stateWith(tool("running", { id: "t1", name: "Bash", detail: "pnpm test" }));

    expect(runningGroups(state)).toEqual([
      {
        kind: "shell",
        label: "1 shell running",
        items: [{ id: "t1", label: "Bash · pnpm test" }],
      },
    ]);
  });

  it("counts a local command as a shell too", () => {
    const state = stateWith(shell(true));

    expect(runningGroups(state)[0]).toEqual({
      kind: "shell",
      label: "1 shell running",
      items: [{ id: "shell-true", label: "!ls" }],
    });
  });

  it("counts the other tools as tools", () => {
    const state = stateWith(
      tool("running", { id: "t1", name: "Read", detail: "src/App.tsx" }),
      tool("running", { id: "t2", name: "Grep", detail: "query" }),
    );

    expect(runningGroups(state)).toEqual([
      {
        kind: "tool",
        label: "2 tools running",
        items: [
          { id: "t1", label: "Read · src/App.tsx" },
          { id: "t2", label: "Grep · query" },
        ],
      },
    ]);
  });

  it("falls back to the tool's name when it has no detail", () => {
    expect(runningGroups(stateWith(tool("running", { detail: "" })))[0]?.items[0]?.label).toBe(
      "Bash",
    );
  });

  it("leaves out what has finished", () => {
    const state = stateWith(tool("ok"), tool("error"), subagent("ok"), shell(false));

    expect(runningGroups(state)).toEqual([]);
  });

  it("keeps the groups in a fixed order however the entries are arranged", () => {
    const state = stateWith(
      tool("running", { id: "t1", name: "Read", detail: "x" }),
      shell(true),
      subagent("running"),
    );

    expect(kinds(state)).toEqual(["agent", "shell", "tool"]);
  });

  it("does not look inside a subagent, whose own calls are its own business", () => {
    const nested: ChatEntry = { ...subagent("running"), id: "a1", entries: [tool("running")] };

    expect(runningGroups(stateWith(nested))).toEqual([
      { kind: "agent", label: "1 agent running", items: [{ id: "a1", label: "Explore" }] },
    ]);
  });

  it("ignores entries that are not work", () => {
    const talking = stateWith(
      { id: "u1", role: "user", text: "hi" },
      { id: "a1", role: "assistant", text: "hello" },
    );

    expect(runningGroups(talking)).toEqual([]);
  });
});
