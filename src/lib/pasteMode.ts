const ENABLE = "\u001b[?2004h";
const DISABLE = "\u001b[?2004l";

/**
 * Tracks whether the foreground program has enabled bracketed paste.
 *
 * Scans for DECSET 2004 toggles and reports the state after the last one, so
 * bracketed paste is only used against programs that asked for it.
 *
 * @param enabled - The state before this chunk.
 * @param chunk - Output received from the terminal.
 * @returns The state after applying every toggle found in `chunk`.
 */
export function updatePasteMode(enabled: boolean, chunk: string): boolean {
  let current = enabled;
  let cursor = 0;
  while (cursor < chunk.length) {
    const on = chunk.indexOf(ENABLE, cursor);
    const off = chunk.indexOf(DISABLE, cursor);
    if (on === -1 && off === -1) break;
    if (off === -1 || (on !== -1 && on < off)) {
      current = true;
      cursor = on + ENABLE.length;
    } else {
      current = false;
      cursor = off + DISABLE.length;
    }
  }
  return current;
}
