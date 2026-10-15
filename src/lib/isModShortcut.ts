/** The part of a keyboard event a modifier shortcut is read from. */
type ModKeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/**
 * Reads a `Mod+…` shortcut off a keyboard event.
 *
 * `Mod` is Command on a Mac and Control everywhere else, which is what
 * CodeMirror means by it and what the shortcut list is written in, so a
 * binding handled outside the editor has to ask the same question the editor
 * asks. A modifier the shortcut does not name is a refusal rather than a match:
 * `Ctrl+Shift+P` is a different keypress from `Ctrl+P`, and the two are told
 * apart here rather than by whichever handler happens to run first.
 *
 * @param event - The keyboard event.
 * @param key - The key, without its modifier — `p`, `m`.
 * @returns True when the event is that shortcut.
 */
export function isModShortcut(event: ModKeyEvent, key: string): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.key.toLowerCase() === key.toLowerCase();
}
