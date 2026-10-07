/**
 * A stand-in for the Tauri IPC bridge.
 *
 * Test files wire it up with a single hoisted call, which must come before the
 * modules under test are imported:
 *
 * ```ts
 * vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));
 * ```
 *
 * Commands are then answered with {@link routeInvoke}, and a Channel the app
 * created is driven with {@link lastChannel}.
 */

import { vi } from "vitest";

/** Every Channel the application constructed, oldest first. */
export const channels: Channel<unknown>[] = [];

/** A stand-in for `tauri::ipc::Channel`. */
export class Channel<T> {
  onmessage: ((message: T) => void) | null = null;

  constructor() {
    channels.push(this as unknown as Channel<unknown>);
  }

  /**
   * Delivers one event to the application.
   *
   * @param message - The event to deliver.
   */
  emit(message: T): void {
    this.onmessage?.(message);
  }
}

type Route = (args: Record<string, unknown>) => unknown;

const routes = new Map<string, Route>();

/** A stand-in for `invoke`. */
export const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
  const route = routes.get(command);
  if (!route) throw new Error(`no route registered for the ${command} command`);
  return route(args ?? {});
});

/**
 * Answers one Tauri command.
 *
 * @param command - The command name the app invokes.
 * @param handler - Produces the value the command resolves with, or throws.
 */
export function routeInvoke(command: string, handler: Route): void {
  routes.set(command, handler);
}

/**
 * Forgets every route and Channel.
 *
 * Call this from `beforeEach`, because Vitest restores mocks between tests.
 */
export function resetTauriMock(): void {
  routes.clear();
  channels.length = 0;
  invoke.mockClear();
}

/**
 * The Channel the application most recently created.
 *
 * @returns The newest Channel, or undefined when none has been made yet.
 */
export function lastChannel(): Channel<unknown> | undefined {
  return channels[channels.length - 1];
}

/**
 * The Channel a `start_claude` call was given.
 *
 * @returns The newest Channel, which is the one the last spawn handed over.
 */
export function sessionChannel<T>(): Channel<T> {
  const channel = lastChannel();
  if (!channel) throw new Error("the app has not created a Channel yet");
  return channel as unknown as Channel<T>;
}
