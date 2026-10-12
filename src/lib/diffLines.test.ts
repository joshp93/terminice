import { describe, expect, it } from "vitest";
import { diffLineKind, looksLikePatch } from "./diffLines";

const PATCH = "@@ -1,3 +1,3 @@\n unchanged\n-removed\n+added";

describe("looksLikePatch", () => {
  it("recognises a patch by its hunk header", () => {
    expect(looksLikePatch(PATCH)).toBe(true);
  });

  it("is false for ordinary output", () => {
    expect(looksLikePatch("total 12\ndrwxr-xr-x  3 josh")).toBe(false);
  });

  /// Output is only a patch if it says so. A line that happens to begin with a
  /// marker is a line of something else.
  it("is false for output that merely begins with a marker", () => {
    expect(looksLikePatch("- just a hyphen\n+ and a plus")).toBe(false);
  });
});

describe("diffLineKind", () => {
  it("reads an addition and a removal from their markers", () => {
    expect(diffLineKind("+added")).toBe("addition");
    expect(diffLineKind("-removed")).toBe("removal");
  });

  it("leaves a context line plain", () => {
    expect(diffLineKind(" unchanged")).toBe("plain");
    expect(diffLineKind("@@ -1,3 +1,3 @@")).toBe("plain");
  });

  /// git names the file above each hunk. Those lines say nothing about what
  /// changed, so they are not drawn as changes.
  it("leaves the lines that name the file plain", () => {
    expect(diffLineKind("--- a/src/app.ts")).toBe("plain");
    expect(diffLineKind("+++ b/src/app.ts")).toBe("plain");
  });

  it("leaves an empty line plain", () => {
    expect(diffLineKind("")).toBe("plain");
  });
});
