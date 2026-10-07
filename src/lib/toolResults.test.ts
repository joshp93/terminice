import { describe, expect, it } from "vitest";
import { describeToolResult, hookMatcher, readHookNote, readResultText } from "./toolResults";

describe("hookMatcher", () => {
  it("reads the matcher out of a scoped hook name", () => {
    expect(hookMatcher("PreToolUse:Bash")).toBe("Bash");
  });

  it("keeps everything after the first colon", () => {
    expect(hookMatcher("PreToolUse:mcp:server")).toBe("mcp:server");
  });

  it("returns empty for an unscoped hook", () => {
    expect(hookMatcher("SessionStart")).toBe("");
  });
});

describe("readHookNote", () => {
  it("reads a hook response", () => {
    const note = readHookNote({
      subtype: "hook_response",
      hook_id: "h1",
      hook_name: "PreToolUse:Bash",
      hook_event: "PreToolUse",
      outcome: "blocked",
      exit_code: 2,
      output: "not allowed",
    });

    expect(note).toEqual({
      hookId: "h1",
      name: "PreToolUse:Bash",
      event: "PreToolUse",
      outcome: "blocked",
      exitCode: 2,
      output: "not allowed",
    });
  });

  it("rejects a line that is not a hook response", () => {
    expect(readHookNote({ subtype: "init" })).toBeNull();
  });

  it("falls back to stdout and stderr when there is no output field", () => {
    const note = readHookNote({ subtype: "hook_response", stdout: "out", stderr: "err" });
    expect(note?.output).toBe("out\nerr");
  });

  it("reports an unknown outcome when the CLI gives none", () => {
    expect(readHookNote({ subtype: "hook_response" })?.outcome).toBe("unknown");
  });
});

describe("readResultText", () => {
  it("keeps a plain string result", () => {
    expect(readResultText("done")).toBe("done");
  });

  it("joins text blocks", () => {
    expect(
      readResultText([
        { type: "text", text: "one " },
        { type: "text", text: "two" },
      ]),
    ).toBe("one two");
  });

  it("reads a nested content field", () => {
    expect(readResultText([{ type: "image", content: "ignored-text" }])).toBe("ignored-text");
  });

  it("skips entries that are not objects", () => {
    expect(readResultText(["stray", { type: "text", text: "kept" }])).toBe("kept");
  });

  it("returns empty for a non-string, non-array", () => {
    expect(readResultText(null)).toBe("");
  });
});

describe("describeToolResult", () => {
  it("prefers the plain text when there is nothing structured", () => {
    expect(describeToolResult("Bash", undefined, "plain")).toBe("plain");
  });

  it("splits stdout and stderr for Bash", () => {
    const result = describeToolResult("Bash", { stdout: "out\n", stderr: "err\n" }, "plain");
    expect(result).toBe("out\n--- stderr ---\nerr");
  });

  it("notes an interrupted command", () => {
    const result = describeToolResult("Bash", { stdout: "out", interrupted: true }, "plain");
    expect(result).toContain("--- interrupted ---");
  });

  it("falls back when a Bash result is empty", () => {
    expect(describeToolResult("Bash", { stdout: "", stderr: "" }, "plain")).toBe("plain");
  });

  it("handles PowerShell the same way as Bash", () => {
    expect(describeToolResult("PowerShell", { stdout: "out" }, "plain")).toBe("out");
  });

  it("uses the git diff for an edit when the CLI supplies one", () => {
    const result = describeToolResult("Edit", { gitDiff: { patch: "@@ -1 +1 @@" } }, "plain");
    expect(result).toBe("@@ -1 +1 @@");
  });

  it("renders a structured patch for an edit", () => {
    const result = describeToolResult(
      "Edit",
      {
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ["-a", "+b"] },
        ],
      },
      "plain",
    );
    expect(result).toBe("@@ -1,1 +1,2 @@\n-a\n+b");
  });

  it("ignores an empty patch and falls back", () => {
    expect(describeToolResult("Edit", { structuredPatch: [] }, "plain")).toBe("plain");
  });

  it("pretty-prints an unknown structured result when there is no text", () => {
    expect(describeToolResult("TodoWrite", { todos: [] }, "")).toBe('{\n  "todos": []\n}');
  });
});
