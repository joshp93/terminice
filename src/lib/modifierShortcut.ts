/**
 * Writes a shortcut the way this platform writes it.
 *
 * The composer's bindings are written as `Mod-…`, which CodeMirror reads as
 * Command on a Mac and Control everywhere else, so anything naming one of them
 * in words has to ask rather than assume.
 *
 * @param key - The key, as it appears after the modifier.
 * @returns A label such as `Ctrl+B` or `⌘B`.
 */
export function modifierShortcut(key: string): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}
