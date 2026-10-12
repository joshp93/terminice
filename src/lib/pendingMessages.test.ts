import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../types";
import { createChatState } from "../types";
import { isPending, pendingMessages } from "./pendingMessages";

const stateWith = (...entries: ChatEntry[]) => ({ ...createChatState(), entries });

const user = (text: string, queued = false): ChatEntry => ({
  id: `user-${text}`,
  role: "user",
  text,
  queued,
});

describe("isPending", () => {
  it("is true for a message the CLI has not picked up", () => {
    expect(isPending(user("hello", true))).toBe(true);
  });

  it("is false for a message that started its own turn", () => {
    expect(isPending(user("hello"))).toBe(false);
  });

  it("is false for anything that is not a message", () => {
    expect(isPending({ id: "a1", role: "assistant", text: "hi" })).toBe(false);
  });
});

describe("pendingMessages", () => {
  it("reports nothing when nothing is waiting", () => {
    expect(pendingMessages(stateWith(user("hello"), user("again")))).toEqual([]);
  });

  it("keeps the waiting messages in the order they were sent", () => {
    const waiting = pendingMessages(
      stateWith(user("first"), user("second", true), user("third", true)),
    );

    expect(waiting.map((entry) => entry.text)).toEqual(["second", "third"]);
  });

  /// They are read out of the transcript rather than out of a list of their own,
  /// which is what lets one drop back into the place it was sent from.
  it("takes them from the transcript, leaving the entry where it was sent", () => {
    const state = stateWith(user("first"), user("second", true), user("third", true));

    pendingMessages(state);

    expect(state.entries).toHaveLength(3);
  });
});
