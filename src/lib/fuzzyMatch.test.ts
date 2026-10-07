import { describe, expect, it } from "vitest";
import { rankByMatch, scoreCandidate } from "./fuzzyMatch";

const names = [
  "compact",
  "mcp",
  "config",
  "context",
  "clear",
  "model",
  "cost",
  "commit",
  "codemirror",
];

const rank = (query: string, items: string[] = names) => rankByMatch(items, query, (item) => item);

describe("scoreCandidate", () => {
  it("ranks an exact match best", () => {
    expect(scoreCandidate("compact", "compact")).toBe(0);
  });

  it("ranks a prefix above a substring", () => {
    const prefix = scoreCandidate("comp", "compact") as number;
    const substring = scoreCandidate("omp", "compact") as number;
    expect(prefix).toBeLessThan(substring);
  });

  it("ranks a substring above a subsequence", () => {
    const substring = scoreCandidate("omp", "compact") as number;
    const subsequence = scoreCandidate("cmp", "compact") as number;
    expect(substring).toBeLessThan(subsequence);
  });

  it("prefers the shorter candidate inside the same tier", () => {
    const short = scoreCandidate("co", "cost") as number;
    const long = scoreCandidate("co", "compact") as number;
    expect(short).toBeLessThan(long);
  });

  it("matches a subsequence that skips characters", () => {
    expect(scoreCandidate("cmp", "compact")).not.toBeNull();
  });

  it("tolerates a single typo in a short query", () => {
    expect(scoreCandidate("modl", "model")).not.toBeNull();
  });

  it("tolerates two typos in a longer query", () => {
    expect(scoreCandidate("cimpct", "compact")).not.toBeNull();
  });

  it("rejects a query that is nothing like the candidate", () => {
    expect(scoreCandidate("zzzz", "compact")).toBeNull();
  });

  it("requires a repeated query character to be repeated in the candidate", () => {
    expect(scoreCandidate("cmpp", "compact")).toBeNull();
  });

  it("still matches when the repetition is present", () => {
    expect(scoreCandidate("comm", "commit")).not.toBeNull();
  });

  it("matches characters that appear in any order", () => {
    expect(scoreCandidate("pmc", "mcp")).not.toBeNull();
  });
});

describe("rankByMatch", () => {
  it("returns everything for an empty query", () => {
    expect(rank("")).toEqual(names);
  });

  it("returns everything for a query that is only a slash", () => {
    expect(rank("/")).toEqual(names);
  });

  it("ignores a leading slash, case and surrounding space", () => {
    expect(rank("  /CoMp  ")[0]).toBe("compact");
  });

  it("drops candidates that do not match at all", () => {
    expect(rank("zzzz")).toEqual([]);
  });

  it("ranks the closest candidate first", () => {
    expect(rank("comp")[0]).toBe("compact");
  });

  it("offers both /compact and /mcp for cmp", () => {
    expect(rank("cmp")).toEqual(["compact", "mcp"]);
  });

  it("still offers /compact for the mistyping the module documents", () => {
    expect(rank("cimpct")).toContain("compact");
  });

  it("breaks ties on name length, then alphabetically", () => {
    expect(rank("co", ["cost", "commit", "compact"])).toEqual(["cost", "commit", "compact"]);
  });

  it("matches the trailing segment of a namespaced name", () => {
    expect(rank("bsh", ["plugin:bash", "other"])).toEqual(["plugin:bash"]);
  });

  it("matches a namespaced name on its full form too", () => {
    expect(rank("plugin", ["plugin:bash", "other"])).toEqual(["plugin:bash"]);
  });

  it("returns a fresh array rather than the caller's", () => {
    const items = ["a", "b"];
    expect(rankByMatch(items, "", (item) => item)).not.toBe(items);
  });

  it("keeps the original items, not their names", () => {
    const items = [{ name: "compact" }, { name: "mcp" }];
    expect(rankByMatch(items, "cmp", (item) => item.name)).toEqual([items[0], items[1]]);
  });
});
