import { invoke } from "@tauri-apps/api/core";

/** The levels the application's log understands. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const CONSOLE_SINK: Record<LogLevel, (...data: unknown[]) => void> = {
  trace: console.debug,
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

/**
 * Records a line in the application's log.
 *
 * The backend owns the file and decides what to keep, so this only hands the
 * line over; a development run also prints it, where the terminal is easier to
 * watch than a file that is being appended to. A log that cannot be written is
 * not worth interrupting the window for, which is why the call is fire and
 * forget.
 *
 * @param level - How serious the line is.
 * @param message - The line to record.
 * @returns Nothing.
 */
export function logMessage(level: LogLevel, message: string): void {
  if (import.meta.env.DEV) {
    CONSOLE_SINK[level](`[${level}] ${message}`);
  }
  void invoke("log_message", { level, message }).catch(() => undefined);
}
