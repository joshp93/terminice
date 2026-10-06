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

const CLOSERS = new Set([")", "]", "}", "`", '"', "*", "_"]);

const WORD = /[\p{L}\p{N}_]/u;

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
 * Decides what typing a character should do.
 *
 * A selection is wrapped in the pair. Otherwise the partner is inserted and the
 * caret placed between, or, when the character is already there, the caret
 * steps over it. Asterisks and underscores only pair mid-word, so starting a
 * bullet with `*` still works.
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
    if (WORD.test(after)) return null;
    if ((char === "*" || char === "_") && !WORD.test(before)) return null;
    return { kind: "insert", text: char + closer, caretOffset: 1 };
  }

  if (CLOSERS.has(char) && after === char) {
    return { kind: "skip", caretOffset: 1 };
  }

  return null;
}
