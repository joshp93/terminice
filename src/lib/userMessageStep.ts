/** Where one of the user's messages sits relative to the visible transcript. */
export type UserMessagePlacement = {
  /** The transcript entry's id. */
  id: string;
  /** Distance from the top of the visible area to the message's own top. */
  top: number;
  /** Distance from the top of the visible area to the message's bottom. */
  bottom: number;
};

/**
 * Chooses which of the user's messages the keyboard should land on next.
 *
 * Once the walk has landed on something it steps to the message beside it, so
 * every message is reached by one press each — including the ones already on
 * screen, which the press before it is what brought there. What that needs is
 * where the walk was: `current` is the message the last press landed on, and the
 * caller forgets it as soon as the reader scrolls, which is what makes a press
 * after scrolling start from what is on screen instead.
 *
 * Without that anchor the answer comes from the geometry. Going up lands on the
 * nearest message whose last line has gone past the top of the view; going down,
 * the nearest whose first line is past the bottom. What is already on screen is
 * never the answer — and a transcript with nothing past the top is one the reader
 * is at the top of, so the message to go back to is the newest one, which is what
 * lets a walk start at all.
 *
 * @param input - Where the messages are, how tall the view is, which way to move,
 *   and which message the walk is standing on.
 * @returns The id of the message to land on, or null when there is nothing that
 *   way.
 */
export function userMessageStep(input: {
  placements: UserMessagePlacement[];
  viewportHeight: number;
  direction: -1 | 1;
  current: string | null;
}): string | null {
  const { placements, viewportHeight, direction, current } = input;

  const anchor = current === null ? -1 : placements.findIndex((entry) => entry.id === current);
  if (anchor >= 0) {
    const next = placements[anchor + direction];
    return next ? next.id : null;
  }

  if (direction < 0) {
    let found: string | null = null;
    for (const placement of placements) {
      if (placement.bottom <= 0) found = placement.id;
    }
    return found ?? placements.at(-1)?.id ?? null;
  }

  for (const placement of placements) {
    if (placement.top >= viewportHeight) return placement.id;
  }

  return null;
}
