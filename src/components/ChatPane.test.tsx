import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatEntry, type ChatState, createChatState } from "../types";
import { ChatPane } from "./ChatPane";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const toolEntry = (id: string, name: string): ChatEntry => ({
  id,
  role: "tool",
  toolUseId: id,
  name,
  detail: name.toLowerCase(),
  input: '{"a":1}',
  result: "out",
  status: "ok",
  hooks: [],
});

const stateWith = (overrides: Partial<ChatState>): ChatState => ({
  ...createChatState(),
  ...overrides,
});

const summaryFor = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("ChatPane", () => {
  it("shows the placeholder before anything has been said", () => {
    const { container } = render(<ChatPane state={stateWith({})} />);
    expect(screen.getByText("Do you like my nice green jacket?")).toBeInTheDocument();
    expect(container.querySelector(".transcript.empty")).not.toBeNull();
  });

  it("offers no expand-all control while there is nothing to expand", () => {
    render(<ChatPane state={stateWith({})} />);
    expect(screen.queryByRole("button", { name: /Expand all/ })).toBeNull();
  });

  it("renders the transcript rows once entries exist", () => {
    render(<ChatPane state={stateWith({ entries: [{ id: "u1", role: "user", text: "hi" }] })} />);
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.queryByText("Do you like my nice green jacket?")).toBeNull();
  });

  it("offers an expand-all control once there are entries", () => {
    render(<ChatPane state={stateWith({ entries: [toolEntry("t1", "Bash")] })} />);
    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
  });

  it("opens every card when expand all is used", async () => {
    const user = userEvent.setup();
    render(<ChatPane state={stateWith({ entries: [toolEntry("t1", "Bash")] })} />);

    await user.click(screen.getByRole("button", { name: "Expand all" }));

    expect(screen.getByRole("button", { name: "Collapse all" })).toBeInTheDocument();
    expect(summaryFor("Bash")).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses every card again", async () => {
    const user = userEvent.setup();
    render(<ChatPane state={stateWith({ entries: [toolEntry("t1", "Bash")] })} />);

    await user.click(screen.getByRole("button", { name: "Expand all" }));
    await user.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
    expect(summaryFor("Bash")).toHaveAttribute("aria-expanded", "false");
  });

  it("covers an entry that arrives after expand all was used", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ChatPane state={stateWith({ entries: [toolEntry("t1", "Bash")] })} />,
    );

    await user.click(screen.getByRole("button", { name: "Expand all" }));
    rerender(
      <ChatPane
        state={stateWith({ entries: [toolEntry("t1", "Bash"), toolEntry("t2", "Read")] })}
      />,
    );

    expect(summaryFor("Read")).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps an individually collapsed card shut under expand all", async () => {
    const user = userEvent.setup();
    render(<ChatPane state={stateWith({ entries: [toolEntry("t1", "Bash")] })} />);

    await user.click(screen.getByRole("button", { name: "Expand all" }));
    await user.click(summaryFor("Bash"));

    expect(summaryFor("Bash")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows streamed text as it arrives", () => {
    const { container } = render(
      <ChatPane state={stateWith({ streaming: "partial answer", busy: true })} />,
    );
    expect(screen.getByText("partial answer")).toBeInTheDocument();
    expect(container.querySelector(".bubble.assistant.streaming")).not.toBeNull();
  });

  it("shows a working indicator rather than a blank pane while busy", () => {
    render(<ChatPane state={stateWith({ busy: true })} />);
    expect(screen.getByText("Working…")).toBeInTheDocument();
  });

  it("counts the reasoning tokens while the turn runs", () => {
    render(<ChatPane state={stateWith({ busy: true, thinkingTokens: 1500 })} />);
    expect(screen.getByText("Thinking… 1,500 tokens")).toBeInTheDocument();
  });

  it("prefers the streamed text to the working indicator", () => {
    render(<ChatPane state={stateWith({ busy: true, streaming: "typing", thinkingTokens: 10 })} />);
    expect(screen.getByText("typing")).toBeInTheDocument();
    expect(screen.queryByText(/Working…/)).toBeNull();
    expect(screen.queryByText(/Thinking…/)).toBeNull();
  });

  it("shows no working indicator once the turn has ended", () => {
    render(<ChatPane state={stateWith({})} />);
    expect(screen.queryByText("Working…")).toBeNull();
  });

  it("leaves the compaction bar to the composer rather than the transcript", () => {
    render(<ChatPane state={stateWith({ compacting: true, busy: true })} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("following the newest content", () => {
  /** Captures the frames the pane asks for, so they can be run by hand. */
  function captureFrames() {
    const pending = new Map<number, () => void>();
    const cancelled: number[] = [];
    let next = 0;

    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      next += 1;
      pending.set(next, callback as () => void);
      return next;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((handle) => {
      cancelled.push(handle);
      pending.delete(handle);
    });

    return {
      count: () => next,
      cancelled,
      runAll: () => {
        for (const [handle, run] of [...pending]) {
          pending.delete(handle);
          run();
        }
      },
    };
  }

  it("measures the transcript once for a burst of streamed text, not once per token", () => {
    const frames = captureFrames();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    const { rerender } = render(<ChatPane state={stateWith({ streaming: "a" })} />);
    rerender(<ChatPane state={stateWith({ streaming: "ab" })} />);
    rerender(<ChatPane state={stateWith({ streaming: "abc" })} />);

    expect(frames.count()).toBe(1);
    expect(scroll).not.toHaveBeenCalled();

    frames.runAll();

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: "end" });
  });

  it("scrolls again once the next frame comes round", () => {
    const frames = captureFrames();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    const { rerender } = render(<ChatPane state={stateWith({ streaming: "a" })} />);
    frames.runAll();

    rerender(<ChatPane state={stateWith({ streaming: "ab" })} />);
    frames.runAll();

    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("cancels a frame it no longer needs when it unmounts", () => {
    const frames = captureFrames();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    const { unmount } = render(<ChatPane state={stateWith({ streaming: "a" })} />);
    expect(frames.count()).toBe(1);

    unmount();

    expect(frames.cancelled).toEqual([1]);
    frames.runAll();
    expect(scroll).not.toHaveBeenCalled();
  });
});
