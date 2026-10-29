import { useMemo } from "react";
import type { Segment } from "../lib/highlightPatch";
import type { CharRange } from "../lib/inlineDiff";

/** Props for {@link DiffText}. */
export type DiffTextProps = {
  /** The line's runs, already split by the syntax that colours them. */
  segments: readonly Segment[];
  /** The characters within the line that the edit changed. */
  marks?: readonly CharRange[];
};

/** One piece of the line as it is drawn. */
type Token = { text: string; className?: string; marked: boolean };

/**
 * Splits a highlighted line at the edges of the edited characters.
 *
 * Syntax and the edit are two different ways of colouring the same characters,
 * so they are cut against one another before anything is drawn: a run of code
 * that straddles the edge of an edit becomes one token inside the mark and one
 * outside it, and each keeps the syntax class it had.
 *
 * @param segments - The line's syntax runs.
 * @param marks - The edited characters.
 * @returns The tokens to draw, with adjacent identical ones joined.
 */
function tokenize(segments: readonly Segment[], marks: readonly CharRange[]): Token[] {
  const tokens: Token[] = [];
  let offset = 0;

  const add = (token: Token): void => {
    if (token.text.length === 0) return;
    const last = tokens[tokens.length - 1];
    if (last && last.className === token.className && last.marked === token.marked) {
      last.text += token.text;
      return;
    }
    tokens.push(token);
  };

  for (const segment of segments) {
    let index = 0;
    while (index < segment.text.length) {
      const at = offset + index;
      const inside = marks.find((range) => at >= range.start && at < range.end);
      const next = marks.find((range) => range.start > at);
      const boundary = inside ? inside.end : (next?.start ?? Number.POSITIVE_INFINITY);
      const length = Math.min(segment.text.length - index, boundary - at);

      add({
        text: segment.text.slice(index, index + length),
        className: segment.className,
        marked: Boolean(inside),
      });
      index += length;
    }
    offset += segment.text.length;
  }

  return tokens;
}

/**
 * Draws one line of a patch with both its syntax and its edit.
 *
 * The changed characters carry a `<mark>` of their own, so a line edited by one
 * character shows that character rather than the whole line tinted. The syntax
 * classes are the same ones a fenced code block is drawn with.
 *
 * @param props - The line's runs and the characters that changed.
 * @returns The rendered line.
 */
export function DiffText({ segments, marks = [] }: DiffTextProps) {
  const tokens = useMemo(() => tokenize(segments, marks), [segments, marks]);

  return (
    <>
      {tokens.map((token, index) =>
        token.marked ? (
          <mark
            // biome-ignore lint/suspicious/noArrayIndexKey: a token is identified by where it sits in the line.
            key={index}
            className={token.className ? `diff-mark ${token.className}` : "diff-mark"}
          >
            {token.text}
          </mark>
        ) : token.className ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a token is identified by where it sits in the line.
          <span key={index} className={token.className}>
            {token.text}
          </span>
        ) : (
          token.text
        ),
      )}
    </>
  );
}
