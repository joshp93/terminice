import { invoke } from "@tauri-apps/api/core";

/**
 * Reads the messages one session has already been sent.
 *
 * Kept beside the application, under `sessions/<session>/`, so a session's
 * history outlives the window it was typed in.
 *
 * @param session - The session's id.
 * @returns The messages, oldest first.
 * @throws When the history cannot be read.
 */
export async function loadUserHistory(session: string): Promise<string[]> {
  return invoke<string[]>("load_user_history", { session });
}

/**
 * Writes the messages one session has been sent, replacing what was there.
 *
 * @param session - The session's id.
 * @param messages - The messages, oldest first.
 * @throws When the history cannot be written.
 */
export async function saveUserHistory(session: string, messages: readonly string[]): Promise<void> {
  await invoke("save_user_history", { session, messages: [...messages] });
}
