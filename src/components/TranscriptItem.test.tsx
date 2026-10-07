import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../types";
import { ExpansionProvider } from "./ExpansionContext";
import { TranscriptItem } from "./TranscriptItem";

const renderEntry = (entry: ChatEntry) => {
  const { container } = render(
    <ExpansionProvider value={{ isOpen: () => false, toggle: () => undefined }}>
      <TranscriptItem entry={entry} />
    </ExpansionProvider>,
  );
  return container;
};

describe("TranscriptItem", () => {
  it("renders a user message as a user bubble", () => {
    const container = renderEntry({ id: "u1", role: "user", text: "hello there" });
    expect(container.querySelector(".bubble.user")).toHaveTextContent("hello there");
  });

  it("keeps a user's own newlines, which is what they typed", () => {
    const container = renderEntry({ id: "u1", role: "user", text: "one\ntwo" });
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("marks a message the CLI has not picked up yet", () => {
    const container = renderEntry({ id: "u1", role: "user", text: "second", queued: true });
    expect(container.querySelector(".queued-badge")).toHaveTextContent("Queued");
  });

  it("marks nothing on a message that has already been picked up", () => {
    const container = renderEntry({ id: "u1", role: "user", text: "first" });
    expect(container.querySelector(".queued-badge")).toBeNull();
  });

  it("renders an assistant message as an assistant bubble", () => {
    const container = renderEntry({ id: "a1", role: "assistant", text: "the answer" });
    expect(container.querySelector(".bubble.assistant")).toHaveTextContent("the answer");
  });

  it("folds an assistant's single newline, as Markdown would", () => {
    const container = renderEntry({ id: "a1", role: "assistant", text: "one\ntwo" });
    expect(container.querySelectorAll("br")).toHaveLength(0);
    expect(screen.getByText("one two")).toBeInTheDocument();
  });

  it("renders reasoning through the thinking block", () => {
    renderEntry({ id: "t1", role: "thinking", text: "because" });
    expect(screen.getByRole("button", { name: /Thought/ })).toBeInTheDocument();
  });

  it("renders a tool call through the tool card", () => {
    renderEntry({
      id: "tool-1",
      role: "tool",
      toolUseId: "t1",
      name: "Bash",
      detail: "ls",
      input: "",
      result: "",
      status: "ok",
      hooks: [],
    });
    expect(screen.getByRole("button", { name: /Bash/ })).toHaveTextContent("ls");
  });

  it("renders a subagent call through the subagent card", () => {
    renderEntry({
      id: "sub-1",
      role: "subagent",
      toolUseId: "task-1",
      label: "Explore",
      input: "",
      result: "",
      status: "running",
      entries: [],
    });
    expect(screen.getByRole("button", { name: /Subagent/ })).toHaveTextContent("Explore");
  });

  it("renders a shell command through the shell card", () => {
    renderEntry({
      id: "shell-1",
      role: "shell",
      command: "pwd",
      stdout: "",
      stderr: "",
      code: 0,
      running: false,
    });
    expect(screen.getByRole("button", { name: /pwd/ })).toHaveTextContent("!pwd");
  });

  it("renders a notice as a notice", () => {
    const container = renderEntry({ id: "n1", role: "notice", text: "heads up" });
    expect(container.querySelector(".notice")).toHaveTextContent("heads up");
  });

  it("renders an error as an error banner", () => {
    const container = renderEntry({ id: "e1", role: "error", text: "it broke" });
    expect(container.querySelector(".error-banner")).toHaveTextContent("it broke");
  });
});
