import { describe, expect, it } from "vitest";
import { type UserMessagePlacement, userMessageStep } from "./userMessageStep";

/** A message occupying a 40px band starting `top` pixels below the view's top. */
const at = (id: string, top: number): UserMessagePlacement => ({
  id,
  top,
  bottom: top + 40,
});

const VIEW = 400;

const up = (placements: UserMessagePlacement[], viewportHeight = VIEW) =>
  userMessageStep({ placements, viewportHeight, direction: -1 });

const down = (placements: UserMessagePlacement[], viewportHeight = VIEW) =>
  userMessageStep({ placements, viewportHeight, direction: 1 });

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

    it("finds nothing when every message is below the top", () => {
      expect(up([at("u1", 0), at("u2", 80)])).toBeNull();
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

  /// The jump centres what it lands on, so the next press has to move past it
  /// rather than land on it again.
  describe("walking", () => {
    const centred = [at("u1", -520), at("u2", -40), at("u3", 180), at("u4", 420), at("u5", 640)];

    it("carries on upwards past the message that was just centred", () => {
      const landed = up(centred);
      expect(landed).toBe("u2");

      const after = centred.map((placement) =>
        placement.id === landed ? { ...placement, top: 180, bottom: 220 } : placement,
      );

      expect(up(after)).toBe("u1");
    });

    it("carries on downwards past the message that was just centred", () => {
      const landed = down(centred);
      expect(landed).toBe("u4");

      const after = centred.map((placement) =>
        placement.id === landed ? { ...placement, top: 180, bottom: 220 } : placement,
      );

      expect(down(after)).toBe("u5");
    });
  });
});
