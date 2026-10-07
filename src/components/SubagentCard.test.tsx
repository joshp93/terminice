import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../types";
import { ExpansionProvider } from "./ExpansionContext";
import { SubagentCard } from "./SubagentCard";
import { TranscriptItem } from "./TranscriptItem";

type SubagentEntry = Extract<ChatEntry, { role: "subagent" }>;

const entry = (overrides: Partial<SubagentEntry> = {}): SubagentEntry => ({
  id: "sub-1",
  role: "subagent",
  toolUseId: "task-1",
  label: "Explore",
  input: "",
  result: "",
  status: "running",
  entries: [],
  ...overrides,
});

function Harness({ value, children }: { value: SubagentEntry; children?: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <ExpansionProvider value={{ isOpen: () => open, toggle: () => setOpen((current) => !current) }}>
      <SubagentCard entry={value}>{children}</SubagentCard>
    </ExpansionProvider>
  );
}

const summary = () => screen.getByRole("button", { name: /Subagent/ });

describe("SubagentCard", () => {
  it("starts collapsed and reports that to assistive technology", () => {
    render(<Harness value={entry()} />);
    expect(summary()).toHaveAttribute("aria-expanded", "false");
    expect(summary()).toHaveTextContent("show");
  });

  it("names itself and the agent that spawned it", () => {
    render(<Harness value={entry()} />);
    expect(summary()).toHaveTextContent("Subagent");
    expect(summary()).toHaveTextContent("Explore");
  });

  it("omits the label when the spawning call gave none", () => {
    render(<Harness value={entry({ label: "" })} />);
    expect(summary()).toHaveTextContent("Subagent");
    expect(summary()).not.toHaveTextContent("Explore");
  });

  it("reads as starting until its transcript has an entry", () => {
    render(<Harness value={entry()} />);
    expect(summary()).toHaveTextContent("starting…");
  });

  it("does not claim a finished agent is still starting when none of its frames arrived", () => {
    const { container } = render(
      <Harness value={entry({ status: "ok", entries: [], result: "the report" })} />,
    );

    expect(container.querySelector(".subagent-steps")).toHaveTextContent("no steps");
    expect(summary()).not.toHaveTextContent("starting…");
  });

  it("reports no steps for an agent that failed before recording any", () => {
    const { container } = render(<Harness value={entry({ status: "error", entries: [] })} />);
    expect(container.querySelector(".subagent-steps")).toHaveTextContent("no steps");
  });

  it("counts a single step in the singular", () => {
    const { container } = render(
      <Harness value={entry({ entries: [{ id: "child-1", role: "assistant", text: "one" }] })} />,
    );
    expect(container.querySelector(".subagent-steps")).toHaveTextContent("1 step");
  });

  it("counts several steps in the plural", () => {
    const { container } = render(
      <Harness
        value={entry({
          entries: [
            { id: "child-1", role: "assistant", text: "one" },
            { id: "child-2", role: "assistant", text: "two" },
          ],
        })}
      />,
    );
    expect(container.querySelector(".subagent-steps")).toHaveTextContent("2 steps");
  });

  it("marks the agent's status on the dot", () => {
    const { container } = render(<Harness value={entry({ status: "ok" })} />);
    expect(container.querySelector(".tool-status.ok")).not.toBeNull();
  });

  it("marks a failed agent on the dot", () => {
    const { container } = render(<Harness value={entry({ status: "error" })} />);
    expect(container.querySelector(".tool-status.error")).not.toBeNull();
  });

  it("reveals the nested transcript when opened", async () => {
    const user = userEvent.setup();
    render(
      <Harness value={entry({ entries: [{ id: "child-1", role: "assistant", text: "found it" }] })}>
        <TranscriptItem entry={{ id: "child-1", role: "assistant", text: "found it" }} />
      </Harness>,
    );

    expect(screen.queryByText("found it")).toBeNull();
    await user.click(summary());

    expect(summary()).toHaveAttribute("aria-expanded", "true");
    expect(summary()).toHaveTextContent("hide");
    expect(screen.getByText("found it")).toBeInTheDocument();
  });

  it("hides the transcript again when collapsed", async () => {
    const user = userEvent.setup();
    render(
      <Harness value={entry({ entries: [{ id: "child-1", role: "assistant", text: "found it" }] })}>
        <TranscriptItem entry={{ id: "child-1", role: "assistant", text: "found it" }} />
      </Harness>,
    );

    await user.click(summary());
    await user.click(summary());

    expect(summary()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("found it")).toBeNull();
  });

  it("shows the agent's closing report when opened", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        value={entry({
          status: "ok",
          entries: [{ id: "child-1", role: "assistant", text: "one" }],
          result: "all done",
        })}
      >
        <span>child</span>
      </Harness>,
    );

    await user.click(summary());

    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByText("all done")).toBeInTheDocument();
  });

  it("renders no transcript region for an agent that has not spoken", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Harness value={entry()}>
        <span>child</span>
      </Harness>,
    );

    await user.click(summary());

    expect(container.querySelector(".subagent-body")).not.toBeNull();
    expect(container.querySelector(".subagent-transcript")).toBeNull();
    expect(screen.queryByText("child")).toBeNull();
  });

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <Harness value={entry({ entries: [{ id: "child-1", role: "assistant", text: "one" }] })} />,
    );

    await user.tab();
    expect(summary()).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(summary()).toHaveAttribute("aria-expanded", "true");
  });
});
