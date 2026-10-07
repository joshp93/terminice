import { invoke, routeInvoke } from "@test/tauriMock";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import {
  forgetInterrupted,
  listSessions,
  readSessionHistory,
  rememberInterrupted,
  takeInterrupted,
} from "./sessions";

beforeEach(() => {
  routeInvoke("list_sessions", () => []);
  routeInvoke("read_session_history", () => []);
  routeInvoke("remember_interrupted", () => null);
  routeInvoke("forget_interrupted", () => null);
  routeInvoke("take_interrupted", () => null);
});

describe("listSessions", () => {
  it("marks every stored session as not live", async () => {
    routeInvoke("list_sessions", () => [{ id: "a", modified: 1, bytes: 2, preview: "hello" }]);

    await expect(listSessions("D:\\apps", 25)).resolves.toEqual([
      { id: "a", modified: 1, bytes: 2, preview: "hello", live: false },
    ]);
  });

  it("asks for the directory and the limit", async () => {
    await listSessions("D:\\apps", 25);
    expect(invoke).toHaveBeenCalledWith("list_sessions", { cwd: "D:\\apps", limit: 25 });
  });

  it("returns nothing when the directory cannot be read", async () => {
    routeInvoke("list_sessions", () => {
      throw new Error("no such directory");
    });
    await expect(listSessions("D:\\nope", 25)).resolves.toEqual([]);
  });
});

describe("readSessionHistory", () => {
  it("returns the replayed messages", async () => {
    routeInvoke("read_session_history", () => [{ role: "user", text: "hi" }]);
    await expect(readSessionHistory("D:\\apps", "a", 200)).resolves.toEqual([
      { role: "user", text: "hi" },
    ]);
  });

  it("asks for the session and the limit", async () => {
    await readSessionHistory("D:\\apps", "a", 200);
    expect(invoke).toHaveBeenCalledWith("read_session_history", {
      cwd: "D:\\apps",
      id: "a",
      limit: 200,
    });
  });

  it("returns nothing when the transcript cannot be read", async () => {
    routeInvoke("read_session_history", () => {
      throw new Error("unreadable transcript");
    });
    await expect(readSessionHistory("D:\\apps", "a", 200)).resolves.toEqual([]);
  });
});

describe("rememberInterrupted", () => {
  it("records the prompt as soon as it arrives", () => {
    rememberInterrupted("session-1", "Bash");
    expect(invoke).toHaveBeenCalledWith("remember_interrupted", {
      sessionId: "session-1",
      tool: "Bash",
    });
  });

  it("records nothing for a session that has no id yet", () => {
    rememberInterrupted("", "Bash");
    expect(invoke).not.toHaveBeenCalledWith("remember_interrupted", expect.anything());
  });

  it("swallows a failure, because losing the note is not worth an error", async () => {
    routeInvoke("remember_interrupted", () => {
      throw new Error("cannot write");
    });
    expect(() => rememberInterrupted("session-1", "Bash")).not.toThrow();
    await Promise.resolve();
  });
});

describe("forgetInterrupted", () => {
  it("clears the record once the decision is made", () => {
    forgetInterrupted("session-1");
    expect(invoke).toHaveBeenCalledWith("forget_interrupted", { sessionId: "session-1" });
  });

  it("does nothing for a session that has no id yet", () => {
    forgetInterrupted("");
    expect(invoke).not.toHaveBeenCalledWith("forget_interrupted", expect.anything());
  });

  it("swallows a failure", async () => {
    routeInvoke("forget_interrupted", () => {
      throw new Error("cannot write");
    });
    expect(() => forgetInterrupted("session-1")).not.toThrow();
    await Promise.resolve();
  });
});

describe("takeInterrupted", () => {
  it("returns the tool the session was waiting on", async () => {
    routeInvoke("take_interrupted", () => "Write");
    await expect(takeInterrupted("session-1")).resolves.toBe("Write");
  });

  it("returns null when there is no record", async () => {
    await expect(takeInterrupted("session-1")).resolves.toBeNull();
  });

  it("returns null when the record cannot be read", async () => {
    routeInvoke("take_interrupted", () => {
      throw new Error("unreadable");
    });
    await expect(takeInterrupted("session-1")).resolves.toBeNull();
  });
});
