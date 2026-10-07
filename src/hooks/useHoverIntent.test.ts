import { renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useHoverIntent } from "./useHoverIntent";

/** A mouse event carrying only the two fields the hook reads. */
const move = (clientX: number, clientY: number) => ({ clientX, clientY }) as MouseEvent;

describe("useHoverIntent", () => {
  it("reports the value the first time the pointer is over a row", () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useHoverIntent<string>(apply));

    result.current("first")(move(10, 10));

    expect(apply).toHaveBeenCalledWith("first");
  });

  it("ignores movement too small to be a deliberate hover", () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useHoverIntent<string>(apply));

    result.current("first")(move(10, 10));
    result.current("second")(move(11, 11));

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("first");
  });

  it("reports a row once the pointer has moved far enough", () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useHoverIntent<string>(apply));

    result.current("first")(move(10, 10));
    result.current("second")(move(20, 10));

    expect(apply).toHaveBeenLastCalledWith("second");
  });

  it("treats movement on either axis as movement", () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useHoverIntent<string>(apply));

    result.current("first")(move(10, 10));
    result.current("second")(move(10, 14));

    expect(apply).toHaveBeenLastCalledWith("second");
  });

  it("measures movement from the last hover, not from the first", () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useHoverIntent<string>(apply));

    result.current("first")(move(0, 0));
    result.current("second")(move(4, 0));
    result.current("third")(move(8, 0));

    expect(apply.mock.calls.map(([value]) => value)).toEqual(["first", "second", "third"]);
  });

  it("remembers where the pointer was across renders, so a shifted list does not re-hover", () => {
    const apply = vi.fn();
    const { result, rerender } = renderHook(() => useHoverIntent<string>(apply));

    result.current("first")(move(10, 10));
    rerender();
    result.current("second")(move(11, 10));

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("lets one value's handler report that value every time it moves", () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useHoverIntent<string>(apply));

    const handler = result.current("only");
    handler(move(10, 10));
    handler(move(50, 50));

    expect(apply).toHaveBeenNthCalledWith(1, "only");
    expect(apply).toHaveBeenNthCalledWith(2, "only");
  });
});
