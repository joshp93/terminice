import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * The window this renderer is in.
 *
 * Read through one place because every control below has to survive being
 * rendered outside Tauri — in a test, or in a browser during development —
 * where there is no window to ask.
 *
 * @returns The window, or null when there is not one.
 */
function currentWindow(): ReturnType<typeof getCurrentWindow> | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/**
 * Minimises the window.
 *
 * @returns Nothing; a failure is swallowed, since a control that does nothing
 *   is not worth a message the reader cannot act on.
 */
export async function minimiseWindow(): Promise<void> {
  try {
    await currentWindow()?.minimize();
  } catch {
    return;
  }
}

/**
 * Maximises the window, or restores it when it is already maximised.
 *
 * @returns Nothing; a failure is swallowed.
 */
export async function toggleMaximiseWindow(): Promise<void> {
  try {
    await currentWindow()?.toggleMaximize();
  } catch {
    return;
  }
}

/**
 * Closes the window, which is what ends the application.
 *
 * @returns Nothing; a failure is swallowed.
 */
export async function closeWindow(): Promise<void> {
  try {
    await currentWindow()?.close();
  } catch {
    return;
  }
}

/**
 * Names the window.
 *
 * The name is what the taskbar, the window switcher and the system menu show,
 * since the window draws no caption of its own to show it in.
 *
 * @param title - The title to give it.
 * @returns Nothing; a failure is swallowed.
 */
export async function setWindowTitle(title: string): Promise<void> {
  try {
    await currentWindow()?.setTitle(title);
  } catch {
    return;
  }
}

/**
 * Reads whether the window is maximised.
 *
 * @returns True when it is, and false when it is not or cannot be asked.
 */
export async function windowIsMaximised(): Promise<boolean> {
  try {
    return (await currentWindow()?.isMaximized()) ?? false;
  } catch {
    return false;
  }
}

/**
 * Watches for the window being maximised, restored or moved between screens.
 *
 * The bar's own control has to say what pressing it will do, so it follows the
 * window rather than assuming the state it left it in: a window maximised by
 * double-clicking the bar, or by a keyboard shortcut, would otherwise still be
 * offering to maximise itself.
 *
 * @param onChange - Called whenever the window's size or position changes.
 * @returns A function that stops watching.
 */
export function watchWindowResize(onChange: () => void): () => void {
  const window_ = currentWindow();
  if (!window_) return () => undefined;

  let stop: (() => void) | undefined;
  let cancelled = false;
  void window_
    .onResized(() => onChange())
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
