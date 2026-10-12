import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PendingMessages } from "./PendingMessages";

/// `messageUuid: null` builds a message with no uuid at all, which is what a
/// replayed one looks like — as opposed to one merely passed as undefined, which
/// would take the default below.
const message = (id: string, text: string, messageUuid: string | null = `uuid-${id}`) => ({
  id,
  role: "user" as const,
  text,
  queued: true,
  ...(messageUuid === null ? {} : { messageUuid }),
});

function renderPending(messages: ReturnType<typeof message>[]) {
  const onUnqueue = vi.fn();
  const view = render(<PendingMessages messages={messages} onUnqueue={onUnqueue} />);
  return { ...view, onUnqueue };
}

describe("PendingMessages", () => {
  it("renders nothing at all when no message is waiting", () => {
    const { container } = renderPending([]);

    expect(container.firstChild).toBeNull();
  });

  it("shows every waiting message, each with its mark", () => {
    const { container, getByText } = renderPending([
      message("a", "run the tests"),
      message("b", "and again"),
    ]);

    expect(container.querySelectorAll(".pending-message")).toHaveLength(2);
    expect(container.querySelectorAll(".queued-badge")).toHaveLength(2);
    expect(getByText("run the tests")).toBeInTheDocument();
  });

  /// The row has one line to work with, so a message written over several is
  /// summarised rather than allowed to push the composer down the window.
  it("summarises a message that was written over several lines", () => {
    const { container } = renderPending([message("a", "first\nsecond")]);

    expect(container.querySelector(".pending-text")?.textContent).toBe("first");
  });

  it("offers a way to take a waiting message back", async () => {
    const user = userEvent.setup();
    const { getByRole, onUnqueue } = renderPending([message("a", "run the tests")]);

    await user.click(getByRole("button", { name: /back out of the queue/ }));

    expect(onUnqueue).toHaveBeenCalledWith("a");
  });

  it("names the message it would take back, so several rows are told apart", () => {
    const { getAllByRole } = renderPending([message("a", "first"), message("b", "second")]);

    const labels = getAllByRole("button").map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual([
      'Take "first" back out of the queue',
      'Take "second" back out of the queue',
    ]);
  });

  /// A replayed message, or one the CLI raised itself, has no uuid to name it
  /// by, so there is nothing a button could ask for.
  it("offers no way back for a message the app never sent", () => {
    const { container, queryByRole } = renderPending([
      message("a", "from a resumed session", null),
    ]);

    expect(container.querySelector(".pending-message")).not.toBeNull();
    expect(queryByRole("button")).toBeNull();
  });
});
