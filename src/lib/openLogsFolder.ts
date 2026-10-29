import { invoke } from "@tauri-apps/api/core";

/**
 * Opens the folder the application's log is written into.
 *
 * The folder is opened by the operating system rather than drawn in the window,
 * because the point of it is to reach the files the window cannot show.
 *
 * @returns Nothing.
 */
export function openLogsFolder(): void {
  void invoke("open_logs_folder").catch(() => undefined);
}
