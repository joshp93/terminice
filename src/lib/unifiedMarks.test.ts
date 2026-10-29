import { describe, expect, it } from "vitest";
import { unifiedMarks } from "./unifiedMarks";

describe("unifiedMarks", () => {
  it("pairs a removal with the addition that replaced it", () => {
    const marks = unifiedMarks(["@@ -1 +1 @@", "-const a = 1;", "+const a = 2;"]);

    expect(marks.get(1)).toEqual([{ start: 10, end: 11 }]);
    expect(marks.get(2)).toEqual([{ start: 10, end: 11 }]);
  });

  it("leaves context lines unmarked", () => {
    const marks = unifiedMarks(["@@ -1,2 +1,2 @@", " unchanged", "-old", "+new"]);
    expect(marks.has(1)).toBe(false);
  });

  it("gives an unpaired removal no marks", () => {
    const marks = unifiedMarks(["@@ -1,3 +1,1 @@", " kept", "-gone", "-also gone"]);
    expect(marks.size).toBe(0);
  });

  it("pairs a longer block against the shorter one, in order", () => {
    const marks = unifiedMarks(["-a", "-b", "+A"]);
    expect(marks.get(0)).toEqual([{ start: 0, end: 1 }]);
    expect(marks.get(2)).toEqual([{ start: 0, end: 1 }]);
    expect(marks.has(1)).toBe(false);
  });

  it("stops pairing at a new hunk", () => {
    const marks = unifiedMarks(["@@ -1 +1 @@", "-a", "@@ -9 +9 @@", "+b"]);
    expect(marks.size).toBe(0);
  });
});
