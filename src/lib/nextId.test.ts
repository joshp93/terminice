import { describe, expect, it } from "vitest";
import { nextId } from "./nextId";

describe("nextId", () => {
  it("uses a default prefix", () => {
    expect(nextId()).toMatch(/^entry-/);
  });

  it("uses the prefix it is given", () => {
    expect(nextId("tool")).toMatch(/^tool-/);
  });

  it("never returns the same value twice", () => {
    const ids = Array.from({ length: 500 }, () => nextId("dup"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps counting up within the same millisecond", () => {
    const first = nextId("count");
    const second = nextId("count");
    expect(first).not.toBe(second);
  });

  it("separates ids of different kinds", () => {
    expect(nextId("user")).not.toBe(nextId("assistant"));
  });
});
