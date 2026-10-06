/** What typing a character should do about pairing. */
export type PairPlan =
  | { kind: "insert"; text: string; caretOffset: number }
  | { kind: "skip"; caretOffset: number };

const OPENERS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "`": "`",
  '"': '"',
  "*": "*",
  _: "_",
};

const CLOSERS = new Set([")", "]", "`", '"', "*", "_"]);

const WORD = /[\p{L}\p{N}_]/u;

/**
 * Decides whether a typed character should bring its partner with it.
 *
 * Asterisks and underscores only pair mid-word, so starting a bullet with `*`
 * still works. A closing character directly before its twin moves over it
 * instead of doubling it up.
 *
 * @param input - The typed character and its immediate neighbours.
 * @returns What to insert, or null to insert the character plainly.
 */
export function planAutoPair(input: {
  char: string;
  before: string;
  after: string;
}): PairPlan | null {
  const { char, before, after } = input;

  if (char in OPENERS) {
    const closer = OPENERS[char];
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
