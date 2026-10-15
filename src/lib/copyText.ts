/**
 * Puts text on the clipboard.
 *
 * A refusal is answered rather than raised: a copy button that cannot copy is
 * worth nothing, but it is not worth a message either — the reader sees the
 * confirmation they were waiting for not appear, and the button's own label
 * says why in the tooltip.
 *
 * @param text - The text to copy.
 * @returns True when it reached the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
