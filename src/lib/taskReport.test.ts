import { describe, expect, it } from "vitest";
import { readTaskReport, taskReportIn } from "./taskReport";

/** A notification as the CLI writes it, with the tags the caller cares about. */
function notification(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([tag, text]) => `<${tag}>${text}</${tag}>`)
    .join("\n");
  return `<task-notification>\n${body}\n</task-notification>`;
}

const finished = notification({
  "task-id": "add6f1ff8d9a07f04",
  "tool-use-id": "call_01_nXXAMFV5Mfan4Uv4czh08898",
  status: "completed",
  summary: 'Agent "Review preview fidelity" finished',
  result: "Here is what I found.",
});

describe("readTaskReport", () => {
  it("reads the call a finished task is reported against", () => {
    expect(readTaskReport(finished)).toEqual({
      toolUseId: "call_01_nXXAMFV5Mfan4Uv4czh08898",
      failed: false,
      summary: 'Agent "Review preview fidelity" finished',
      report: "Here is what I found.",
    });
  });

  it("reads a failure as a failure", () => {
    const failed = notification({
      "tool-use-id": "call_1",
      status: "failed",
      summary: "it broke",
    });

    expect(readTaskReport(failed)?.failed).toBe(true);
  });

  /// The report is written over many lines, and reading it must not stop at the
  /// first one.
  it("keeps a report that runs over several lines", () => {
    const words = notification({ "tool-use-id": "call_1", result: "one\ntwo\nthree" });

    expect(readTaskReport(words)?.report).toBe("one\ntwo\nthree");
  });

  /// A notification with no result of its own says so by leaving it out, which
  /// is not the same as having nothing to report.
  it("reads a notification that carries no report", () => {
    const bare = notification({ "tool-use-id": "call_1", summary: "done" });

    expect(readTaskReport(bare)?.report).toBe("");
    expect(readTaskReport(bare)?.summary).toBe("done");
  });

  /// Watchers and other tasks report on themselves with no call behind them, so
  /// there is nothing in the transcript for one to belong to.
  it("ignores a notification that names no call", () => {
    const watcher = notification({ "task-id": "b0npcee7o", summary: "Monitor expired" });

    expect(readTaskReport(watcher)).toBeNull();
  });

  it("ignores anything that is not a notification", () => {
    expect(readTaskReport("just a tool result")).toBeNull();
    expect(readTaskReport("<task-notification>unclosed")).toBeNull();
  });
});

describe("taskReportIn", () => {
  it("finds a notification in a content block", () => {
    const frame = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: finished }] },
    };

    expect(taskReportIn(frame)?.toolUseId).toBe("call_01_nXXAMFV5Mfan4Uv4czh08898");
  });

  it("finds one carried as an attachment, which is a type the stream does not have", () => {
    const frame = {
      type: "user",
      attachment: { type: "queued_command", prompt: finished },
    };

    expect(taskReportIn(frame)?.toolUseId).toBe("call_01_nXXAMFV5Mfan4Uv4czh08898");
  });

  it("says nothing about a frame that carries none", () => {
    expect(
      taskReportIn({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
    ).toBeNull();
    expect(taskReportIn({ type: "result" })).toBeNull();
  });
});
