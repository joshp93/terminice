/**
 * Rewrites what was typed after an `@` into the query the file index matches.
 *
 * The index holds the session's own paths, so a separator written the other way
 * round matches nothing at all: on Windows `src/lib` offers no file while
 * `src\lib` offers the one beside it. Every separator in the query is therefore
 * written the way the session's paths are, which is read off the directory the
 * session is running in rather than off the running platform, since the two
 * agree and the directory is the one the answers will be relative to.
 *
 * @param query - What has been typed after the `@`.
 * @param cwd - The directory the session is running in, if it has reported one.
 * @returns The query, with each run of separators written as one of the session's.
 */
export function suggestionQuery(query: string, cwd: string | null): string {
  const separator = cwd?.includes("\\") ? "\\" : "/";
  return query.replace(/[\\/]+/g, separator);
}
