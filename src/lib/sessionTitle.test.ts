import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../types";
import { sessionTitle } from "./sessionTitle";

const user = (text: string): ChatEntry => ({ id: "u1", role: "user", text });
const assistant = (text: string): ChatEntry => ({ id: "a1", role: "assistant", text });

describe("sessionTitle", () => {
  it("names the session by the first thing that was asked", () => {
    expect(sessionTitle([user("fix the queue indicator"), assistant("on it")])).toBe(
      "terminice - fix the queue indicator",
    );
  });

  /// A session starts with no messages at all, and a resumed one can open with
  /// the agent's own words, so the first *question* is what names it.
  it("is the application alone before anything has been asked", () => {
    expect(sessionTitle([])).toBe("terminice");
    expect(sessionTitle([assistant("hello")])).toBe("terminice");
  });

  it("takes the first message even when a later one would read better", () => {
    expect(sessionTitle([user("first"), user("second")])).toBe("terminice - first");
  });

  /// A title has to fit a taskbar, and a message written over several lines is
  /// named by its first one.
  it("shortens a long message and stops at the first line", () => {
    const long = `${"a".repeat(200)}\nsecond line`;

    const title = sessionTitle([user(long)]);

    expect(title.startsWith("terminice - aaa")).toBe(true);
    expect(title).not.toContain("second line");
    expect(title.length).toBeLessThanOrEqual("terminice - ".length + 60);
  });

  it("passes over a message with nothing in it", () => {
    expect(sessionTitle([user("   "), user("the real question")])).toBe(
      "terminice - the real question",
    );
  });
});
