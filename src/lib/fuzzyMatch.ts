/**
 * Fuzzy matching for the slash menu.
 *
 * Ranking is tiered, best first: exact, prefix, substring, subsequence, then
 * progressively looser fallbacks. The loose tiers exist because the menu is a
 * shortcut, not a search box — mistyping `/compact` as `/cimpct` should still
 * offer it, and `/cmp` should offer both `/compact` and `/mcp`.
 */

const TIER = {
  exact: 0,
  prefix: 1_000,
  substring: 2_000,
  subsequence: 3_000,
  anyOrder: 4_000,
  distance: 5_000,
} as const;

/**
 * Measures how well `query` matches `text` as an ordered subsequence.
 *
 * @param query - The lower-cased query.
 * @param text - The lower-cased candidate.
 * @returns A penalty proportional to the characters skipped, or null when the
 *   query is not a subsequence.
 */
function subsequencePenalty(query: string, text: string): number | null {
  let index = 0;
  let penalty = 0;
  let previous = -1;

  for (const character of query) {
    const found = text.indexOf(character, index);
    if (found < 0) return null;
    if (previous >= 0) penalty += found - previous - 1;
    previous = found;
    index = found + 1;
  }

  return penalty + (text.length - query.length);
}

/**
 * Whether every character of `query` appears in `text`, in any order.
 *
 * Each occurrence is spent as it is matched, so a query that repeats a
 * character needs the text to repeat it too.
 *
 * @param query - The lower-cased query.
 * @param text - The lower-cased candidate.
 * @returns True when the query's characters are a multiset subset of the text.
 */
function hasCharactersOf(query: string, text: string): boolean {
  const remaining = new Map<string, number>();
  for (const character of text) {
    remaining.set(character, (remaining.get(character) ?? 0) + 1);
  }

  for (const character of query) {
    const available = remaining.get(character) ?? 0;
    if (available === 0) return false;
    remaining.set(character, available - 1);
  }

  return true;
}

/**
 * The Levenshtein distance between two strings.
 *
 * @param a - The first string.
 * @param b - The second string.
 * @returns The number of single-character edits separating them.
 */
function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const carried = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      diagonal = carried;
    }
  }

  return previous[b.length];
}

/**
 * Scores one candidate string against a query.
 *
 * @param query - The lower-cased query, without a leading slash.
 * @param candidate - The lower-cased candidate, without a leading slash.
 * @returns A rank where lower is closer, or null when there is no match.
 */
export function scoreCandidate(query: string, candidate: string): number | null {
  if (query.length === 0) return TIER.exact;

  if (candidate === query) return TIER.exact;

  if (candidate.startsWith(query)) {
    return TIER.prefix + (candidate.length - query.length);
  }

  const substring = candidate.indexOf(query);
  if (substring >= 0) {
    return TIER.substring + substring * 4 + (candidate.length - query.length);
  }

  const subsequence = subsequencePenalty(query, candidate);
  if (subsequence !== null) return TIER.subsequence + subsequence;
  if (candidate.length <= 4 && query.length <= 4 && subsequencePenalty(candidate, query) !== null) {
    return TIER.subsequence + 60;
  }

  const distance = editDistance(query, candidate);
  const tolerance = query.length <= 4 ? 1 : 2;
  if (distance <= tolerance) return TIER.distance + distance * 10;

  if (hasCharactersOf(query, candidate)) {
    return TIER.anyOrder + (candidate.length - query.length);
  }

  return null;
}

/**
 * The names a query is scored against, so namespaced commands match on their
 * own name as well as their namespace.
 *
 * @param name - A command name, without a leading slash.
 * @returns The full name followed by its trailing segment.
 */
function candidatesFor(name: string): string[] {
  const colon = name.lastIndexOf(":");
  return colon >= 0 ? [name, name.slice(colon + 1)] : [name];
}

/**
 * Ranks items by how closely their name matches a query.
 *
 * Items that do not match at all are dropped. Ties break on name length and
 * then alphabetically, so the ordering is stable as the query grows.
 *
 * @param items - The items to filter.
 * @param query - The raw query, with or without a leading slash.
 * @param nameOf - Reads an item's name.
 * @returns The matching items, closest first.
 */
export function rankByMatch<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): T[] {
  const needle = query.trim().replace(/^\//, "").toLowerCase().trim();
  if (needle.length === 0) return [...items];

  const scored: { item: T; score: number; name: string }[] = [];
  for (const item of items) {
    const name = nameOf(item);
    let best: number | null = null;
    for (const candidate of candidatesFor(name.toLowerCase())) {
      const score = scoreCandidate(needle, candidate);
      if (score !== null && (best === null || score < best)) best = score;
    }
    if (best !== null) scored.push({ item, score: best, name });
  }

  scored.sort(
    (a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name),
  );
  return scored.map((entry) => entry.item);
}
