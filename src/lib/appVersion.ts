import { invoke } from "@tauri-apps/api/core";

/**
 * Reads the version of the running build.
 *
 * @returns The version Tauri compiled into the application.
 * @throws When the backend cannot be asked.
 */
export async function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}
