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
 * A message counts as being above only once its last line has gone past the
 * top of the view, and as below only once its whole height is past the bottom,
 * so what is already on screen is never the answer. That is also what makes a
 * jump repeatable: landing centres the message, which puts it inside the view,
 * so the next press carries on past it rather than landing on it again.
 *
 * @param input - Where the messages are, how tall the view is, and which way to
 *   move through them.
 * @returns The id of the message to land on, or null when there is nothing
 *   that way.
 */
export function userMessageStep(input: {
  placements: UserMessagePlacement[];
  viewportHeight: number;
  direction: -1 | 1;
}): string | null {
  const { placements, viewportHeight, direction } = input;

  if (direction < 0) {
    let found: string | null = null;
    for (const placement of placements) {
      if (placement.bottom <= 0) found = placement.id;
    }
    return found;
  }

  for (const placement of placements) {
    if (placement.top >= viewportHeight) return placement.id;
  }

  return null;
}
