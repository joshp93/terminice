import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Subscribes to files dropped onto the window.
 *
 * Tauri reports drops itself, so the paths arrive absolute and no browser
 * drag events are involved.
 *
 * @param handler - Called with the paths that were dropped.
 * @returns A function that removes the subscription.
 */
export async function subscribeToFileDrops(
  handler: (paths: string[]) => void,
): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop") handler(event.payload.paths);
  });
}
