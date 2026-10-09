import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatEntry, type ChatState, createChatState } from "../types";
import { ChatPane } from "./ChatPane";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const userEntry = (id: string): ChatEntry => ({ id, role: "user", text: `said ${id}` });

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

  it("shows the compaction bar in the transcript while a compaction runs", () => {
    render(<ChatPane state={stateWith({ compacting: true, busy: true })} />);
    expect(screen.getByRole("progressbar")).toHaveAccessibleName("Compacting…");
  });

  it("names the size being summarised when the context reading is known", () => {
    render(
      <ChatPane
        state={stateWith({
          compacting: true,
          busy: true,
          contextUsage: {
            categories: [],
            totalTokens: 24000,
            maxTokens: 200000,
            percentage: 12,
            model: "claude-sonnet-5-5",
          },
        })}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAccessibleName("Compacting 24,000 tokens…");
  });

  it("stands the compaction bar where the summary will be written", () => {
    const { container } = render(
      <ChatPane state={stateWith({ entries: [userEntry("u1")], compacting: true, busy: true })} />,
    );
    const rows = Array.from(container.querySelectorAll(".transcript-row, .progress"));
    expect(rows.map((row) => row.className)).toEqual(["transcript-row", "progress"]);
  });

  it("shows the working indicator rather than the bar once the compaction is over", () => {
    render(<ChatPane state={stateWith({ busy: true })} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Working…")).toBeInTheDocument();
  });
});

describe("jumping to an entry", () => {
  const rowFor = (container: HTMLElement, id: string): HTMLElement => {
    const row = container.querySelector(`.transcript-row[data-entry-id="${id}"]`);
    if (!(row instanceof HTMLElement)) throw new Error(`no row for ${id}`);
    return row;
  };

  const reveal = (id: string, seq = 1) => ({ id, seq });

  it("opens the card it was asked for", () => {
    render(
      <ChatPane state={stateWith({ entries: [toolEntry("t1", "Bash")] })} reveal={reveal("t1")} />,
    );
    expect(summaryFor("Bash")).toHaveAttribute("aria-expanded", "true");
  });

  it("brings it to the middle of the pane", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = render(
      <ChatPane state={stateWith({ entries: [toolEntry("t1", "Bash")] })} reveal={reveal("t1")} />,
    );

    expect(scroll).toHaveBeenCalledWith({ block: "center" });
    expect(scroll.mock.instances[0]).toBe(rowFor(container, "t1"));
  });

  it("lights it up", () => {
    const { container } = render(
      <ChatPane state={stateWith({ entries: [toolEntry("t1", "Bash")] })} reveal={reveal("t1")} />,
    );
    expect(rowFor(container, "t1")).toHaveClass("flash");
  });

  it("stops lighting it once the flash has been seen", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ChatPane
          state={stateWith({ entries: [toolEntry("t1", "Bash")] })}
          reveal={reveal("t1")}
        />,
      );
      expect(rowFor(container, "t1")).toHaveClass("flash");

      act(() => vi.advanceTimersByTime(5000));

      expect(rowFor(container, "t1")).not.toHaveClass("flash");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves every other row alone", () => {
    const { container } = render(
      <ChatPane
        state={stateWith({ entries: [toolEntry("t1", "Bash"), toolEntry("t2", "Read")] })}
        reveal={reveal("t1")}
      />,
    );
    expect(rowFor(container, "t2")).not.toHaveClass("flash");
    expect(summaryFor("Read")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a shell card too", () => {
    const shell: ChatEntry = {
      id: "s1",
      role: "shell",
      command: "ls",
      stdout: "a\nb\nc\nd\ne",
      stderr: "",
      code: 0,
      running: false,
    };
    render(<ChatPane state={stateWith({ entries: [shell] })} reveal={reveal("s1")} />);

    expect(screen.getByRole("button", { name: /^!ls/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("asks again for the same entry when the request is repeated", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { rerender } = render(
      <ChatPane
        state={stateWith({ entries: [toolEntry("t1", "Bash")] })}
        reveal={reveal("t1", 1)}
      />,
    );
    scroll.mockClear();

    rerender(
      <ChatPane
        state={stateWith({ entries: [toolEntry("t1", "Bash")] })}
        reveal={reveal("t1", 2)}
      />,
    );

    expect(scroll).toHaveBeenCalledWith({ block: "center" });
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

describe("walking through the user's own messages", () => {
  const VIEW = 400;
  const ROW = 40;

  /** A stand-in rectangle, since jsdom has no layout of its own. */
  const rect = (top: number, bottom: number): DOMRect =>
    ({
      top,
      bottom,
      height: bottom - top,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  /**
   * Says where each row is, which jsdom cannot work out for itself.
   *
   * The top of the transcript is the zero every other measurement is taken
   * against, so a row at a negative top has scrolled out of sight above it.
   */
  function place(container: HTMLElement, tops: number[]): void {
    const scroller = container.querySelector(".transcript") as HTMLElement;
    Object.defineProperty(scroller, "clientHeight", { value: VIEW, configurable: true });
    scroller.getBoundingClientRect = () => rect(0, VIEW);

    const rows = [...container.querySelectorAll<HTMLElement>(".transcript-row")];
    rows.forEach((row, index) => {
      const top = tops[index] ?? 0;
      row.getBoundingClientRect = () => rect(top, top + ROW);
    });
  }

  const pressCtrlArrow = (key: "ArrowUp" | "ArrowDown"): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", {
      key,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    return event;
  };

  const flashOn = (container: HTMLElement): string | null =>
    container.querySelector(".transcript-row.flash")?.getAttribute("data-entry-id") ?? null;

  const said = (...ids: string[]): ChatEntry[] => ids.map(userEntry);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("goes up to the nearest message that has scrolled out of sight", () => {
    const { container } = render(
      <ChatPane state={stateWith({ entries: said("u1", "u2", "u3") })} />,
    );
    place(container, [-500, -100, 120]);

    pressCtrlArrow("ArrowUp");

    expect(flashOn(container)).toBe("u2");
  });

  it("goes down to the nearest message that is entirely below the view", () => {
    const { container } = render(
      <ChatPane state={stateWith({ entries: said("u1", "u2", "u3") })} />,
    );
    place(container, [10, 460, 700]);

    pressCtrlArrow("ArrowDown");

    expect(flashOn(container)).toBe("u2");
  });

  it("brings the message it lands on into the middle of the pane", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = render(<ChatPane state={stateWith({ entries: said("u1") })} />);
    place(container, [-500]);

    pressCtrlArrow("ArrowUp");

    expect(scroll).toHaveBeenCalledWith({ block: "center" });
  });

  it("leaves out everything that is not the user's own message", () => {
    const { container } = render(
      <ChatPane
        state={stateWith({
          entries: [toolEntry("t1", "Bash"), ...said("u1"), toolEntry("t2", "Read"), ...said("u2")],
        })}
      />,
    );
    place(container, [-500, -100, -80, 120]);

    pressCtrlArrow("ArrowUp");

    expect(flashOn(container)).toBe("u1");
  });

  it("stays put when there is nothing that way", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = render(<ChatPane state={stateWith({ entries: said("u1") })} />);
    place(container, [10]);

    const event = pressCtrlArrow("ArrowUp");

    expect(flashOn(container)).toBeNull();
    expect(scroll).not.toHaveBeenCalledWith({ block: "center" });
    expect(event.defaultPrevented).toBe(false);
  });

  it("takes the keypress, so the composer never also answers it", () => {
    const { container } = render(<ChatPane state={stateWith({ entries: said("u1") })} />);
    place(container, [-500]);

    const event = pressCtrlArrow("ArrowUp");

    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a bare arrow to whatever has the keyboard", () => {
    const { container } = render(<ChatPane state={stateWith({ entries: said("u1") })} />);
    place(container, [-500]);

    const event = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(flashOn(container)).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it("takes Command on a Mac as well as Control", () => {
    const { container } = render(<ChatPane state={stateWith({ entries: said("u1") })} />);
    place(container, [-500]);

    const event = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(flashOn(container)).toBe("u1");
  });
});
