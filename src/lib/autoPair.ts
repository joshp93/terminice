/** What typing a character should do about pairing. */
export type PairPlan =
  | { kind: "insert"; text: string; caretOffset: number }
  | { kind: "skip"; caretOffset: number }
  | { kind: "surround"; open: string; close: string };

const OPENERS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "`": "`",
  '"': '"',
  "*": "*",
  _: "_",
};

/**
 * Characters that only step the caret over an identical character already
 * there. The emphasis characters are deliberately absent: both are openers
 * above, and the opener branch always answers first.
 */
const CLOSERS = new Set([")", "]", "}", "`", '"']);

/** Characters whose pairing Markdown will not accept around whitespace. */
const TRIMMED = new Set(["*", "_"]);

/**
 * Whether a pair needs its text trimmed of surrounding whitespace.
 *
 * @param open - The opening character.
 * @returns True for the emphasis characters, which Markdown treats specially.
 */
export function pairNeedsTrim(open: string): boolean {
  return TRIMMED.has(open);
}

/**
 * Whether the caret is sitting against a character rather than against a space.
 *
 * @param neighbour - The character on one side of the caret, or an empty string
 *   at the very start or end of the composer.
 * @returns True when there is a character there.
 */
function againstCharacter(neighbour: string): boolean {
  return neighbour.length > 0 && !/\s/.test(neighbour);
}

/**
 * Whether deleting at the caret should take the pair on both sides of it.
 *
 * A partner that was added on the spot is only there because something might
 * be typed between the two, so a backspace with nothing between them takes the
 * pair away rather than leaving a stray bracket behind. The emphasis
 * characters are exempt: they never bring a partner of their own, and the two
 * asterisks of `**bold**` are the opening marker rather than an empty pair.
 *
 * @param before - The character before the caret, or an empty string.
 * @param after - The character after the caret, or an empty string.
 * @returns True when both should go.
 */
export function backspaceRemovesPair(before: string, after: string): boolean {
  const closer = OPENERS[before];
  return closer !== undefined && closer === after && !TRIMMED.has(before);
}

/**
 * Decides what typing a character should do.
 *
 * A selection is wrapped in the pair. Otherwise the partner is inserted and the
 * caret placed between, or, when the character is already there, the caret
 * steps over it.
 *
 * No pair is opened against a character, on either side. Typing `(` in front of
 * an existing word inserts the bracket alone, and typing `` ` `` at the end of
 * one closes a span by hand rather than leaving a second backtick behind. A
 * partner is only ever added where the caret sits against whitespace or the
 * edge of the composer, which is where a pair can be seen to be wanted.
 *
 * The emphasis characters never bring a partner at all: an asterisk is read as
 * content rather than as the start of a pair, so `partOfAName` stays as typed
 * whether it is a bullet, an italic or a literal.
 *
 * @param input - The typed character, its neighbours, and whether text is selected.
 * @returns What to do, or null to insert the character plainly.
 */
export function planAutoPair(input: {
  char: string;
  before: string;
  after: string;
  hasSelection: boolean;
}): PairPlan | null {
  const { char, before, after, hasSelection } = input;

  if (char in OPENERS) {
    const closer = OPENERS[char];
    if (hasSelection) return { kind: "surround", open: char, close: closer };
    if (after === closer) return { kind: "skip", caretOffset: 1 };
    if (againstCharacter(before) || againstCharacter(after)) return null;
    if (TRIMMED.has(char)) return null;
    return { kind: "insert", text: char + closer, caretOffset: 1 };
  }

  if (CLOSERS.has(char) && after === char) {
    return { kind: "skip", caretOffset: 1 };
  }

  return null;
}
