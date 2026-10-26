/**
 * Writes a duration as the short label a running card shows.
 *
 * Seconds are enough for a tool that just started, and minutes and hours are
 * there for one that has been left running. The smaller unit keeps two digits so
 * the label does not change width every ten seconds.
 *
 * @param seconds - How long the tool has been running.
 * @returns A label such as `12s`, `1m 05s` or `2h 03m`.
 */
export function elapsedLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
