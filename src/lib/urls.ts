/**
 * Matches a bare URL in prose.
 *
 * A URL is taken to run until whitespace or a character that cannot appear in
 * one unescaped — angle brackets, quotes and backticks — which is what stops it
 * swallowing the markup around it when the text it sits in is Markdown or HTML.
 */
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Punctuation that may belong to the URL but is more often the sentence's. */
const SENTENCE_PUNCTUATION = ".,;:!?'\"";

/** Closing characters whose opening partner has to appear for them to be kept. */
const CLOSING_PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** One URL found in a piece of text, and where it sits in it. */
export type UrlMatch = {
  /** Offset of the first character. */
  from: number;
  /** Offset just past the last character. */
  to: number;
  /** The URL as written, trimmed of punctuation that was not part of it. */
  url: string;
};

/**
 * Counts how many times a character appears in the first `end` characters.
 *
 * @param text - The text to search.
 * @param char - The character to count.
 * @param end - How far into the text to look.
 * @returns The number of occurrences.
 */
function countUpTo(text: string, char: string, end: number): number {
  let total = 0;
  for (let index = 0; index < end; index += 1) {
    if (text[index] === char) total += 1;
  }
  return total;
}

/**
 * Drops the punctuation a URL has picked up from the sentence around it.
 *
 * A closing bracket is kept when the URL opened one of its own, so a link that
 * genuinely ends inside brackets — a Wikipedia article, say — survives intact.
 *
 * @param url - The matched text.
 * @returns The URL without its trailing sentence punctuation.
 */
export function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1];
    if (SENTENCE_PUNCTUATION.includes(char)) {
      end -= 1;
      continue;
    }
    const opener = CLOSING_PAIRS[char];
    if (opener && countUpTo(url, opener, end) < countUpTo(url, char, end)) {
      end -= 1;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

/**
 * Finds every bare URL in a piece of text.
 *
 * @param text - The text to search.
 * @returns The URLs and their offsets, in the order they appear.
 */
export function findUrls(text: string): UrlMatch[] {
  const found: UrlMatch[] = [];
  URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const url = trimUrl(match[0]);
    if (url.length === 0) continue;
    found.push({ from: start, to: start + url.length, url });
  }
  return found;
}

/**
 * Finds the URL a caret or pointer sits in.
 *
 * @param text - The text to search.
 * @param position - The offset to look at.
 * @returns The URL covering that offset, or null when there is none.
 */
export function urlAt(text: string, position: number): string | null {
  const match = findUrls(text).find((entry) => position >= entry.from && position <= entry.to);
  return match ? match.url : null;
}

/**
 * Whether a URL is one this application is willing to hand to a browser.
 *
 * Only the two web schemes are accepted, so a link in model output cannot ask
 * the operating system to run a local file or a custom protocol handler.
 *
 * @param value - The URL to test.
 * @returns True when the URL is an `http` or `https` address.
 */
export function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * Turns a written URL into one a browser can be given.
 *
 * @param url - The URL as written, which may be missing its scheme.
 * @returns The URL with a scheme, or an empty string when it is not acceptable.
 */
export function browserUrl(url: string): string {
  const trimmed = url.trim();
  const withScheme = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  return isExternalUrl(withScheme) ? withScheme : "";
}
