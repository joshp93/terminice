import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RunningGroup } from "../lib/runningTools";
import { RunningTracker } from "./RunningTracker";

const agents = (count: number): RunningGroup => ({
  kind: "agent",
  label: `${count} ${count === 1 ? "agent" : "agents"} running`,
  items: Array.from({ length: count }, (_, index) => ({
    id: `a${index + 1}`,
    label: `Agent ${index + 1}`,
  })),
});

const shells = (count: number): RunningGroup => ({
  kind: "shell",
  label: `${count} ${count === 1 ? "shell" : "shells"} running`,
  items: Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    label: `command ${index + 1}`,
  })),
});

function renderTracker(groups: RunningGroup[]) {
  const onReveal = vi.fn();
  const view = render(<RunningTracker groups={groups} onReveal={onReveal} />);
  return { onReveal, ...view };
}

describe("RunningTracker", () => {
  it("shows nothing at all while the session is idle", () => {
    const { container } = renderTracker([]);
    expect(container.querySelector(".trackers")).toBeNull();
  });

  it("counts what is running, one chip per kind", () => {
    renderTracker([agents(2), shells(1)]);
    expect(screen.getByText("2 agents running")).toBeInTheDocument();
    expect(screen.getByText("1 shell running")).toBeInTheDocument();
  });

  it("marks each chip with a dot that pulses", () => {
    const { container } = renderTracker([agents(1)]);
    const dot = container.querySelector(".tracker-dot");
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-hidden", "true");
  });
});

describe("a chip with one thing running", () => {
  it("goes straight to it rather than offering a choice", async () => {
    const user = userEvent.setup();
    const { onReveal } = renderTracker([agents(1)]);

    await user.click(screen.getByRole("button", { name: /1 agent running/ }));

    expect(onReveal).toHaveBeenCalledWith("a1");
  });

  it("offers no menu, because there is nothing to choose between", async () => {
    const user = userEvent.setup();
    renderTracker([agents(1)]);

    await user.click(screen.getByRole("button", { name: /1 agent running/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("a chip with several things running", () => {
  it("lists them instead of jumping to one", async () => {
    const user = userEvent.setup();
    const { onReveal } = renderTracker([agents(3)]);

    await user.click(screen.getByRole("button", { name: /3 agents running/ }));

    expect(onReveal).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "3 agents running" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agent 2" })).toBeInTheDocument();
  });

  it("jumps to the one that is picked", async () => {
    const user = userEvent.setup();
    const { onReveal } = renderTracker([agents(3)]);
    await user.click(screen.getByRole("button", { name: /3 agents running/ }));

    await user.click(screen.getByRole("button", { name: "Agent 3" }));

    expect(onReveal).toHaveBeenCalledWith("a3");
  });

  it("closes the list once something has been picked", async () => {
    const user = userEvent.setup();
    renderTracker([agents(3)]);
    await user.click(screen.getByRole("button", { name: /3 agents running/ }));

    await user.click(screen.getByRole("button", { name: "Agent 1" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("puts the list away on a second press", async () => {
    const user = userEvent.setup();
    renderTracker([agents(3)]);

    await user.click(screen.getByRole("button", { name: /3 agents running/ }));
    await user.click(screen.getByRole("button", { name: /3 agents running/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderTracker([agents(3)]);
    await user.click(screen.getByRole("button", { name: /3 agents running/ }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the reader clicks away from it", async () => {
    const user = userEvent.setup();
    const { container } = renderTracker([agents(3)]);
    await user.click(screen.getByRole("button", { name: /3 agents running/ }));

    await user.click(document.body);

    expect(container.querySelector(".tracker-menu")).toBeNull();
  });

  it("closes itself when the group drops to a single entry", async () => {
    const user = userEvent.setup();
    const { rerender, onReveal } = renderTracker([agents(3)]);
    await user.click(screen.getByRole("button", { name: /3 agents running/ }));

    rerender(<RunningTracker groups={[agents(1)]} onReveal={onReveal} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes itself when the work finishes", async () => {
    const user = userEvent.setup();
    const { rerender, onReveal } = renderTracker([agents(3)]);
    await user.click(screen.getByRole("button", { name: /3 agents running/ }));

    rerender(<RunningTracker groups={[]} onReveal={onReveal} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves the keyboard into the list it just opened", async () => {
    const user = userEvent.setup();
    renderTracker([agents(3)]);

    await user.click(screen.getByRole("button", { name: /3 agents running/ }));

    expect(screen.getByRole("button", { name: "Agent 1" })).toHaveFocus();
  });
});
