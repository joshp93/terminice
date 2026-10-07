import { describe, expect, it } from "vitest";
import { createChatState, createDefaultSettings } from "./types";

describe("createChatState", () => {
  it("starts with nothing known about a session", () => {
    const state = createChatState();
    expect(state.entries).toEqual([]);
    expect(state.streaming).toBe("");
    expect(state.sessionId).toBeNull();
    expect(state.cwd).toBeNull();
    expect(state.model).toBeNull();
    expect(state.catalogue).toBeNull();
    expect(state.contextUsage).toBeNull();
  });

  it("starts idle, with nothing to report", () => {
    const state = createChatState();
    expect(state.busy).toBe(false);
    expect(state.compacting).toBe(false);
    expect(state.thinkingTokens).toBe(0);
    expect(state.costUsd).toBeNull();
    expect(state.suggestion).toBeNull();
  });

  it("starts asking for permission", () => {
    expect(createChatState().permissionMode).toBe("default");
  });

  it("starts with fast mode off, and no reason for it", () => {
    const state = createChatState();
    expect(state.fastMode).toBe("off");
    expect(state.fastModeReason).toBeNull();
  });

  it("starts with nothing loaded", () => {
    const state = createChatState();
    expect(state.mcpServers).toEqual([]);
    expect(state.plugins).toEqual([]);
    expect(state.skills).toEqual([]);
  });

  it("gives every state its own collections, so one session cannot change another", () => {
    const first = createChatState();
    const second = createChatState();

    first.entries.push({ id: "x", role: "user", text: "hi" });
    first.skills.push("code-review");

    expect(second.entries).toEqual([]);
    expect(second.skills).toEqual([]);
  });
});

describe("createDefaultSettings", () => {
  it("sends on Enter, starts dark, and puts both font sizes in the middle", () => {
    expect(createDefaultSettings()).toEqual({
      enterBehaviour: "send",
      theme: "dark",
      composerFontSize: "medium",
      chatFontSize: "medium",
    });
  });

  it("returns a fresh object each time", () => {
    expect(createDefaultSettings()).not.toBe(createDefaultSettings());
  });
});
