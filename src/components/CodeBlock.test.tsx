import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPIED_FOR_MS, CodeBlock } from "./CodeBlock";

/** A clipboard that records what it was given. */
function stubClipboard(writeText = vi.fn(async () => undefined)): {
  writeText: ReturnType<typeof vi.fn>;
  breakIt: () => void;
} {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return {
    writeText,
    breakIt: () => writeText.mockRejectedValueOnce(new Error("the clipboard refused")),
  };
}

/** Lets the two-second timer fire, and flushes what it changed. */
async function waitOutTheTick(ms = COPIED_FOR_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const button = (): HTMLElement => screen.getByRole("button");
const copied = (): boolean => button().classList.contains("copied");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

/** Renders one block of code, as the Markdown renderer draws it. */
function renderBlock(code = "const x = 1") {
  return render(
    <CodeBlock code={code}>
      <code>
        <span className="hljs-keyword">const</span> x = 1
      </code>
    </CodeBlock>,
  );
}

describe("CodeBlock", () => {
  it("draws the code it was given", () => {
    const { container } = renderBlock();

    expect(container.querySelector("pre code")?.textContent).toBe("const x = 1");
  });

  it("copies the code", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const clipboard = stubClipboard();
    renderBlock("const x = 1");

    await user.click(button());

    expect(clipboard.writeText).toHaveBeenCalledWith("const x = 1");
  });

  /// The renderer ends a block with a newline so it lays out as its own line,
  /// and a paste that carries a stray newline into a shell is a second command
  /// waiting to be run.
  it("copies the code without the newline the renderer added", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const clipboard = stubClipboard();
    renderBlock("const x = 1\n");

    await user.click(button());

    expect(clipboard.writeText).toHaveBeenCalledWith("const x = 1");
  });

  /// Only the renderer's own newline comes off: a block whose last line is
  /// blank keeps the line it has.
  it("keeps a blank last line the code actually has", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const clipboard = stubClipboard();
    renderBlock("one\n\n");

    await user.click(button());

    expect(clipboard.writeText).toHaveBeenCalledWith("one\n");
  });

  /// The tick is the whole of the report: the button says what it did, and the
  /// code that was copied is what it says it copied.
  it("turns into a tick when the copy worked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubClipboard();
    renderBlock();

    expect(copied()).toBe(false);
    await user.click(button());

    expect(copied()).toBe(true);
    expect(button()).toHaveAccessibleName("Copied");
  });

  it("goes back to offering a copy two seconds later", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubClipboard();
    renderBlock();

    await user.click(button());
    expect(copied()).toBe(true);

    await waitOutTheTick();

    expect(copied()).toBe(false);
    expect(button()).toHaveAccessibleName("Copy code");
  });

  /// A tick that did not copy anything would be a lie about the one thing the
  /// button exists to say.
  it("claims nothing when the copy was refused", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const clipboard = stubClipboard();
    clipboard.breakIt();
    renderBlock();

    await user.click(button());

    expect(copied()).toBe(false);
    expect(button()).toHaveAccessibleName("Copy code");
  });

  /// A second press gets its own two seconds rather than the remainder of the
  /// first, so the tick does not vanish the moment it appears.
  it("gives a second press its own two seconds", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubClipboard();
    renderBlock();

    await user.click(button());
    await waitOutTheTick(COPIED_FOR_MS - 100);
    await user.click(button());
    await waitOutTheTick(200);

    expect(copied()).toBe(true);

    await waitOutTheTick();

    expect(copied()).toBe(false);
  });
});
