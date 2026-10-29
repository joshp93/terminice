import { describe, expect, it } from "vitest";
import { toolFilePath } from "./toolFilePath";

describe("toolFilePath", () => {
  it("reads the file an edit named", () => {
    expect(toolFilePath('{"file_path":"D:\\\\apps\\\\App.tsx","old_string":"a"}')).toBe(
      "D:\\apps\\App.tsx",
    );
  });

  it("accepts the other fields that can name a file", () => {
    expect(toolFilePath('{"path":"src/main.ts"}')).toBe("src/main.ts");
    expect(toolFilePath('{"notebook_path":"notes.ipynb"}')).toBe("notes.ipynb");
  });

  it("prefers the file an edit names over a bare path", () => {
    expect(toolFilePath('{"file_path":"one.ts","path":"two.ts"}')).toBe("one.ts");
  });

  it("answers nothing for input that names no file", () => {
    expect(toolFilePath('{"command":"ls"}')).toBeNull();
    expect(toolFilePath("{}")).toBeNull();
    expect(toolFilePath("not json")).toBeNull();
    expect(toolFilePath("")).toBeNull();
  });
});
