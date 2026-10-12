import { describe, expect, it } from "vitest";
import { type UserMessagePlacement, userMessageStep } from "./userMessageStep";

/** A message occupying a 40px band starting `top` pixels below the view's top. */
const at = (id: string, top: number): UserMessagePlacement => ({
  id,
  top,
  bottom: top + 40,
});

const VIEW = 400;

const up = (
  placements: UserMessagePlacement[],
  viewportHeight = VIEW,
  current: string | null = null,
) => userMessageStep({ placements, viewportHeight, direction: -1, current });

const down = (
  placements: UserMessagePlacement[],
  viewportHeight = VIEW,
  current: string | null = null,
) => userMessageStep({ placements, viewportHeight, direction: 1, current });

describe("userMessageStep", () => {
  it("finds nothing at all in a transcript with no messages of its own", () => {
    expect(up([])).toBeNull();
    expect(down([])).toBeNull();
  });

  describe("going up", () => {
    it("takes the nearest message that has scrolled off the top", () => {
      expect(up([at("u1", -600), at("u2", -300), at("u3", 120)])).toBe("u2");
    });

    it("ignores a message that is still partly on screen", () => {
      expect(up([at("u1", -600), at("u2", -20)])).toBe("u1");
    });

    it("counts a message whose last line has just gone past the top", () => {
      expect(up([at("u1", -40)])).toBe("u1");
    });

    /// Nothing past the top means the reader is at the top, so the walk starts
    /// at the newest message rather than not starting at all.
    it("starts at the newest message when nothing has scrolled off", () => {
      expect(up([at("u1", 0), at("u2", 80)])).toBe("u2");
    });
  });

  describe("going down", () => {
    it("takes the nearest message that is entirely below the view", () => {
      expect(down([at("u1", 10), at("u2", 460), at("u3", 700)])).toBe("u2");
    });

    it("ignores a message with its first line on screen", () => {
      expect(down([at("u1", 380), at("u2", 460)])).toBe("u2");
    });

    it("finds nothing when every message is on screen", () => {
      expect(down([at("u1", 10), at("u2", 300)])).toBeNull();
    });
  });

  /// Once the walk has landed somewhere it steps to the message beside it, so
  /// one press moves one message however much of the transcript is on screen.
  describe("stepping", () => {
    const list = [at("u1", -520), at("u2", -40), at("u3", 180), at("u4", 420), at("u5", 640)];

    it("moves up one message from where it landed", () => {
      expect(up(list, VIEW, "u3")).toBe("u2");
      expect(up(list, VIEW, "u2")).toBe("u1");
    });

    it("moves down one message from where it landed", () => {
      expect(down(list, VIEW, "u3")).toBe("u4");
      expect(down(list, VIEW, "u4")).toBe("u5");
    });

    /// The whole point of the cursor: messages already on screen are stepped
    /// through rather than jumped over.
    it("reaches a message that is in the middle of the view", () => {
      const onScreen = [at("u1", 40), at("u2", 120), at("u3", 200)];

      expect(up(onScreen, VIEW, "u3")).toBe("u2");
      expect(up(onScreen, VIEW, "u2")).toBe("u1");
    });

    it("stops at each end of the list", () => {
      expect(up(list, VIEW, "u1")).toBeNull();
      expect(down(list, VIEW, "u5")).toBeNull();
    });

    /// The anchor is the id, not the position, so a transcript that has scrolled
    /// underneath the walk still steps from the right message.
    it("steps from the id it was given, wherever that message now is", () => {
      const moved = list.map((placement) => ({
        ...placement,
        top: placement.top + 1000,
        bottom: placement.bottom + 1000,
      }));

      expect(up(moved, VIEW, "u3")).toBe("u2");
    });

    it("falls back to the geometry when the anchor is not in the list", () => {
      expect(up(list, VIEW, "gone")).toBe("u2");
      expect(down(list, VIEW, "gone")).toBe("u4");
    });
  });
});
