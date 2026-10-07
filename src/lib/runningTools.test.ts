import { describe, expect, it } from "vitest";
import type { ChatEntry, ChatState } from "../types";
import { createChatState } from "../types";
import { hasRunningTool } from "./runningTools";

const stateWith = (...entries: ChatEntry[]): ChatState => ({ ...createChatState(), entries });

const tool = (status: "running" | "ok" | "error"): Extract<ChatEntry, { role: "tool" }> => ({
  id: `tool-${status}`,
  role: "tool",
  toolUseId: "t1",
  name: "Bash",
  detail: "pnpm test",
  input: "{}",
  result: "",
  status,
  hooks: [],
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

describe("hasRunningTool", () => {
  it("is false for a session that has done nothing", () => {
    expect(hasRunningTool(createChatState())).toBe(false);
  });

  it("is true while a tool call is out", () => {
    expect(hasRunningTool(stateWith(tool("running")))).toBe(true);
  });

  it("is false once the tool has reported back", () => {
    expect(hasRunningTool(stateWith(tool("ok")))).toBe(false);
  });

  it("is false for a tool that failed, because it is no longer running either", () => {
    expect(hasRunningTool(stateWith(tool("error")))).toBe(false);
  });

  it("is true while a subagent is still working", () => {
    expect(hasRunningTool(stateWith(subagent("running")))).toBe(true);
  });

  it("is false once the subagent has handed back its report", () => {
    expect(hasRunningTool(stateWith(subagent("ok")))).toBe(false);
  });

  it("is true when any one tool is still out among finished ones", () => {
    expect(hasRunningTool(stateWith(tool("ok"), tool("running"), subagent("ok")))).toBe(true);
  });

  it("ignores entries that are not tool calls", () => {
    const talking = stateWith(
      { id: "u1", role: "user", text: "hi" },
      { id: "a1", role: "assistant", text: "hello" },
      { id: "t1", role: "thinking", text: "hmm" },
      { id: "n1", role: "notice", text: "note" },
      { id: "e1", role: "error", text: "broke" },
    );

    expect(hasRunningTool(talking)).toBe(false);
  });

  it("does not look inside a subagent, whose own calls are its own business", () => {
    const nested: ChatEntry = { ...subagent("ok"), entries: [tool("running")] };
    expect(hasRunningTool(stateWith(nested))).toBe(false);
  });
});
