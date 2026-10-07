import { describe, expect, it } from "vitest";
import { describeToolUse } from "./describeToolUse";

describe("describeToolUse", () => {
  it("shows the command for Bash", () => {
    expect(describeToolUse("Bash", { command: "pnpm test" })).toBe("pnpm test");
  });

  it("shows the file path for the file tools", () => {
    for (const name of ["Read", "Write", "Edit"]) {
      expect(describeToolUse(name, { file_path: "src/main.tsx" })).toBe("src/main.tsx");
    }
  });

  it("shows a notebook path for NotebookEdit", () => {
    expect(describeToolUse("NotebookEdit", { notebook_path: "notes.ipynb" })).toBe("notes.ipynb");
  });

  it("shows the pattern for Glob and Grep", () => {
    expect(describeToolUse("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
    expect(describeToolUse("Grep", { pattern: "TODO" })).toBe("TODO");
  });

  it("shows the url for WebFetch", () => {
    expect(describeToolUse("WebFetch", { url: "https://example.com" })).toBe("https://example.com");
  });

  it("shows the query for WebSearch", () => {
    expect(describeToolUse("WebSearch", { query: "tauri ipc" })).toBe("tauri ipc");
  });

  it("shows the description for the subagent tools", () => {
    expect(describeToolUse("Task", { description: "Audit the parser" })).toBe("Audit the parser");
    expect(describeToolUse("Agent", { description: "Audit the parser" })).toBe("Audit the parser");
  });
});

describe("describeToolUse fallbacks", () => {
  it("returns empty for an unknown tool", () => {
    expect(describeToolUse("TodoWrite", { todos: [] })).toBe("");
  });

  it("returns empty when the expected key is missing", () => {
    expect(describeToolUse("Bash", {})).toBe("");
    expect(describeToolUse("Read", {})).toBe("");
  });

  it("falls through an empty string to the next candidate key", () => {
    expect(describeToolUse("Read", { file_path: "", notebook_path: "n.ipynb" })).toBe("n.ipynb");
  });

  it("ignores a value that is not a string", () => {
    expect(describeToolUse("Bash", { command: 42 })).toBe("");
    expect(describeToolUse("WebSearch", { query: null })).toBe("");
  });

  it("returns empty for input that is not an object", () => {
    expect(describeToolUse("Bash", null)).toBe("");
    expect(describeToolUse("Bash", undefined)).toBe("");
    expect(describeToolUse("Bash", "ls")).toBe("");
  });
});

describe("describeToolUse truncation", () => {
  it("keeps the first line of a multi-line command", () => {
    expect(describeToolUse("Bash", { command: "ls -la\nrm -rf /" })).toBe("ls -la");
  });

  it("trims surrounding whitespace", () => {
    expect(describeToolUse("Bash", { command: "  pnpm test  " })).toBe("pnpm test");
  });

  it("leaves a detail at the length limit untouched", () => {
    const command = "a".repeat(80);
    expect(describeToolUse("Bash", { command })).toBe(command);
  });

  it("clips a longer detail and marks it with an ellipsis", () => {
    const command = "a".repeat(81);
    const detail = describeToolUse("Bash", { command });
    expect(detail).toBe(`${"a".repeat(79)}…`);
    expect(detail).toHaveLength(80);
  });
});
