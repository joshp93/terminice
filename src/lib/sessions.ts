import { invoke } from "@tauri-apps/api/core";

/** A past session, as offered by the resume menu. */
export type SessionSummary = {
  id: string;
  /** Last write time, in milliseconds since the epoch. */
  modified: number;
  bytes: number;
  /** The first thing that was asked, for recognition. */
  preview: string;
  /** True when this session is still loaded and can be reattached to. */
  live: boolean;
};

/** One exchange replayed from a stored transcript. */
export type HistoryMessage = {
  role: string;
  text: string;
};

/**
 * Lists past sessions for a working directory.
 *
 * @param cwd - The directory the sessions ran in.
 * @param limit - The most sessions to return.
 * @returns The sessions, newest first.
 */
export async function listSessions(cwd: string, limit: number): Promise<SessionSummary[]> {
  try {
    const sessions = await invoke<Omit<SessionSummary, "live">[]>("list_sessions", { cwd, limit });
    return sessions.map((session) => ({ ...session, live: false }));
  } catch {
    return [];
  }
}

/**
 * Reads what was said in a stored session.
 *
 * @param cwd - The directory the session ran in.
 * @param id - The session id.
 * @param limit - The most recent messages to return.
 * @returns The messages, oldest first.
 */
export async function readSessionHistory(
  cwd: string,
  id: string,
  limit: number,
): Promise<HistoryMessage[]> {
  try {
    return await invoke<HistoryMessage[]>("read_session_history", { cwd, id, limit });
  } catch {
    return [];
  }
}

/**
 * Records that a session is waiting on a decision.
 *
 * Written as soon as the prompt arrives rather than when the session ends, so
 * that a crash or a hard close cannot lose it.
 *
 * @param sessionId - The session holding the prompt.
 * @param tool - The tool it is waiting to run.
 */
export function rememberInterrupted(sessionId: string, tool: string): void {
  if (sessionId.length === 0) return;
  void invoke("remember_interrupted", { sessionId, tool }).catch(() => undefined);
}

/**
 * Forgets that a session was waiting, once the decision has been made.
 *
 * @param sessionId - The session that was waiting.
 */
export function forgetInterrupted(sessionId: string): void {
  if (sessionId.length === 0) return;
  void invoke("forget_interrupted", { sessionId }).catch(() => undefined);
}

/**
 * Reads and clears what a session was waiting on, if anything.
 *
 * @param sessionId - The session to ask about.
 * @returns The tool it was waiting on, or null when there is no record.
 */
export async function takeInterrupted(sessionId: string): Promise<string | null> {
  try {
    return await invoke<string | null>("take_interrupted", { sessionId });
  } catch {
    return null;
  }
}
