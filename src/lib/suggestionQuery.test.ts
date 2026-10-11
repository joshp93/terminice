import { describe, expect, it } from "vitest";
import { suggestionQuery } from "./suggestionQuery";

const WINDOWS = "D:\\apps\\terminice";
const POSIX = "/home/joshu/terminice";

describe("suggestionQuery on a session running on Windows", () => {
  it("writes a forward slash as the separator the paths use", () => {
    expect(suggestionQuery("src/lib.ts", WINDOWS)).toBe("src\\lib.ts");
  });

  it("leaves a backward slash alone", () => {
    expect(suggestionQuery("src\\lib.ts", WINDOWS)).toBe("src\\lib.ts");
  });

  it("rewrites every separator in the query", () => {
    expect(suggestionQuery("apps/terminice/src", WINDOWS)).toBe("apps\\terminice\\src");
  });

  it("collapses a run of separators into one", () => {
    expect(suggestionQuery("apps//terminice", WINDOWS)).toBe("apps\\terminice");
  });
});

describe("suggestionQuery on a session running elsewhere", () => {
  it("leaves a forward slash alone", () => {
    expect(suggestionQuery("src/lib.ts", POSIX)).toBe("src/lib.ts");
  });

  it("writes a backward slash as the separator the paths use", () => {
    expect(suggestionQuery("src\\lib.ts", POSIX)).toBe("src/lib.ts");
  });
});

describe("suggestionQuery otherwise", () => {
  it("leaves a query with no separator in it untouched", () => {
    expect(suggestionQuery("App", WINDOWS)).toBe("App");
    expect(suggestionQuery("App", POSIX)).toBe("App");
  });

  it("leaves the case of the query alone", () => {
    expect(suggestionQuery("Src/App.TSX", WINDOWS)).toBe("Src\\App.TSX");
  });

  it("answers with an empty query when it was given one", () => {
    expect(suggestionQuery("", WINDOWS)).toBe("");
  });

  it("falls back to the forward slash when no directory is known", () => {
    expect(suggestionQuery("src\\lib.ts", null)).toBe("src/lib.ts");
  });
});
