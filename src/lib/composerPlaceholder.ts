import type { EnterBehaviour } from "../types";
import { modifierShortcut } from "./modifierShortcut";

/** What the composer is currently set up to do. */
export type PlaceholderState = {
  /** What a bare Enter key does. */
  enterBehaviour: EnterBehaviour;
  /** Whether the microphone and the model are ready to dictate. */
  dictates: boolean;
};

/**
 * Writes the hint the composer shows while it is empty.
 *
 * The composer is the one part of the window whose keys can be changed from
 * under the reader — Enter can be made to insert a newline, and the space bar
 * can be made to dictate — so the hint names what those keys do *now* rather
 * than what they do by default. A hint that contradicts the settings is worse
 * than no hint at all.
 *
 * @param state - The settings that decide what the keys do.
 * @returns The placeholder text.
 */
export function composerPlaceholder(state: PlaceholderState): string {
  const entering =
    state.enterBehaviour === "send"
      ? `Enter sends, Shift+Enter for a new line`
      : `Enter for a new line, ${modifierShortcut("Enter")} sends`;

  const parts = [
    "/ for commands",
    state.dictates ? "hold space to dictate" : null,
    entering,
  ].filter((part): part is string => part !== null);

  return `Message Claude — ${parts.join(", ")}`;
}
