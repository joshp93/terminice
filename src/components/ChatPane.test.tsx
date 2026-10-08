import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  const transcriptOf = (container: HTMLElement): HTMLElement =>
    container.querySelector(".transcript") as HTMLElement;

  /**
   * Reports a scroll position, which jsdom cannot work out for itself.
   *
   * Everything it measures is zero, so without this the transcript always looks
   * as though it is at the bottom and is scrolled to.
   *
   * @param element - The transcript.
   * @param position - How far down it is scrolled, how tall it is, and how much
   *   of it can be seen.
   */
  function reportScroll(
    element: HTMLElement,
    position: { top: number; height: number; viewport: number },
  ): void {
    Object.defineProperties(element, {
      scrollHeight: { value: position.height, configurable: true },
      clientHeight: { value: position.viewport, configurable: true },
      scrollTop: { value: position.top, writable: true, configurable: true },
    });
    fireEvent.scroll(element);
  }

  const away = (element: HTMLElement): void =>
    reportScroll(element, { top: 0, height: 1000, viewport: 400 });

  const atTheBottom = (element: HTMLElement): void =>
    reportScroll(element, { top: 600, height: 1000, viewport: 400 });

  const userEntry = (id: string): ChatEntry => ({ id, role: "user", text: `said ${id}` });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves the view alone once the reader has scrolled away", () => {
    const frames = captureFrames();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    const { container, rerender } = render(<ChatPane state={stateWith({ streaming: "a" })} />);
    away(transcriptOf(container));

    rerender(<ChatPane state={stateWith({ streaming: "ab" })} />);
    frames.runAll();

    expect(scroll).not.toHaveBeenCalled();
  });

  it("offers a way back to the end once the reader has scrolled away", () => {
    captureFrames();
    const { container } = render(<ChatPane state={stateWith({ entries: [userEntry("u1")] })} />);
    expect(screen.queryByRole("button", { name: "Jump to end" })).toBeNull();

    away(transcriptOf(container));

    expect(screen.getByRole("button", { name: "Jump to end" })).toBeInTheDocument();
  });

  it("goes back to the end when the button is used", async () => {
    const user = userEvent.setup();
    const frames = captureFrames();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    const { container } = render(<ChatPane state={stateWith({ entries: [userEntry("u1")] })} />);
    away(transcriptOf(container));
    frames.runAll();
    scroll.mockClear();

    await user.click(screen.getByRole("button", { name: "Jump to end" }));

    expect(scroll).toHaveBeenCalledWith({ block: "end" });
    expect(screen.queryByRole("button", { name: "Jump to end" })).toBeNull();
  });

  it("follows again once the reader comes back to the bottom", () => {
    const frames = captureFrames();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    const { container, rerender } = render(<ChatPane state={stateWith({ streaming: "a" })} />);
    away(transcriptOf(container));
    rerender(<ChatPane state={stateWith({ streaming: "ab" })} />);
    frames.runAll();
    expect(scroll).not.toHaveBeenCalled();

    atTheBottom(transcriptOf(container));
    rerender(<ChatPane state={stateWith({ streaming: "abc" })} />);
    frames.runAll();

    expect(scroll).toHaveBeenCalledWith({ block: "end" });
  });

  /// Sending is taken as wanting to watch the answer, so it does not leave the
  /// reader stranded above a reply they cannot see.
  it("follows again when a message is sent", () => {
    const frames = captureFrames();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    const { container, rerender } = render(
      <ChatPane state={stateWith({ entries: [userEntry("u1")] })} />,
    );
    away(transcriptOf(container));
    frames.runAll();
    scroll.mockClear();

    rerender(<ChatPane state={stateWith({ entries: [userEntry("u1"), userEntry("u2")] })} />);
    frames.runAll();

    expect(scroll).toHaveBeenCalledWith({ block: "end" });
  });

  it("offers no way back while there is nothing to go back to", () => {
    captureFrames();
    const { container } = render(<ChatPane state={stateWith({})} />);

    away(transcriptOf(container));

    expect(screen.queryByRole("button", { name: "Jump to end" })).toBeNull();
  });
});
