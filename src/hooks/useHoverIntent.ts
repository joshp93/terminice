import { type MouseEvent, useRef } from "react";

/**
 * Builds hover handlers that only fire on genuine pointer movement.
 *
 * A list can shift under a stationary pointer when it is scrolled, and the
 * browser may report that as movement over whatever is now beneath the cursor.
 * Without this, hovering would hand the selection back to the mouse and undo
 * keyboard navigation a moment after it happened.
 *
 * @param apply - Called with the value under a genuinely moved pointer.
 * @returns A function that builds a hover handler for one value.
 */
export function useHoverIntent<T>(
  apply: (value: T) => void,
): (value: T) => (event: MouseEvent) => void {
  const last = useRef({ x: Number.NaN, y: Number.NaN });

  return (value: T) => (event: MouseEvent) => {
    const moved =
      Number.isNaN(last.current.x) ||
      Math.abs(event.clientX - last.current.x) + Math.abs(event.clientY - last.current.y) >= 4;
    if (!moved) return;
    last.current = { x: event.clientX, y: event.clientY };
    apply(value);
  };
}
