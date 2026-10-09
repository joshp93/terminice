import { vi } from "vitest";
import type { Voice } from "../hooks/useVoice";

/**
 * A voice session that is idle and has no model, for tests that are not about
 * dictation.
 *
 * @param overrides - The parts of the session this test is about.
 * @returns The voice session to hand to a component.
 */
export function fakeVoice(overrides: Partial<Voice> = {}): Voice {
  return {
    ready: false,
    listening: false,
    status: null,
    downloading: false,
    downloadProgress: null,
    transcript: null,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    download: vi.fn(),
    subscribeToLevel: () => () => undefined,
    ...overrides,
  };
}
