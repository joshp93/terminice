import { listen } from "@tauri-apps/api/event";

/** The event the backend announces a changed settings file with. */
const SETTINGS_CHANGED = "settings-changed";

/**
 * Watches for the settings file being written by something other than this
 * window.
 *
 * The file is shared: the settings menu writes it, and so does anyone with a
 * text editor — a cost rate, a font family. The backend watches it and says so,
 * because it is the half of the application that can see the file at all.
 *
 * A failure to listen is swallowed, as the window controls swallow theirs: a
 * webview with no backend under it — a test, a browser during development — has
 * nothing to watch, and that is not a reason to refuse to render.
 *
 * @param onChange - Called when the file has changed.
 * @returns A function that stops watching.
 */
export function watchSettingsFile(onChange: () => void): () => void {
  let stop: (() => void) | undefined;
  let cancelled = false;

  void listen(SETTINGS_CHANGED, () => onChange())
    .then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    })
    .catch(() => undefined);

  return () => {
    cancelled = true;
    stop?.();
  };
}
