import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetTauriMock } from "./tauriMock";

afterEach(() => {
  cleanup();
  resetTauriMock();
});

/**
 * jsdom implements neither of these, and CodeMirror reaches for both when it
 * measures a line. Without them the composer throws on mount rather than
 * failing a meaningful assertion.
 */
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/**
 * jsdom does not implement this at all, and both the transcript pane and the
 * slash menu scroll the highlighted row into view from a layout effect, so
 * without it any test that renders either of them throws on mount.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

/**
 * CodeMirror measures a range while it lays a line out, inside a frame
 * callback. jsdom has no such method, and the throw happens off the test's own
 * stack, so it surfaces as an unhandled error that leaves the run dirty.
 */
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as typeof cancelAnimationFrame;
}
