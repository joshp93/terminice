import { invoke } from "@tauri-apps/api/core";
import { browserUrl } from "./urls";

/**
 * Opens a URL in the user's own browser.
 *
 * The webview is never allowed to follow a link itself, because doing so would
 * replace the application with the page and leave no way back.
 *
 * @param url - The address to open, with or without its scheme.
 * @returns True when the browser was asked to open it.
 */
export async function openExternal(url: string): Promise<boolean> {
  const target = browserUrl(url);
  if (target.length === 0) return false;
  try {
    await invoke("open_external_url", { url: target });
    return true;
  } catch {
    return false;
  }
}
