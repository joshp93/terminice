import { describe, expect, it } from "vitest";
import type { PermissionPrompt, Prompt, QuestionPrompt } from "./dialogModels";
import { planOf } from "./planOf";

const plan: Prompt = {
  kind: "plan",
  requestId: "req-1",
  toolName: "ExitPlanMode",
  toolUseId: "tool-1",
  rawInput: {},
  plan: "1. Do the thing\n2. Do the other thing",
  choices: [{ id: "allow", label: "Start on this plan" }],
};

const permission: PermissionPrompt = {
  kind: "permission",
  requestId: "req-2",
  toolName: "Bash",
  title: "Run a command",
  toolUseId: "tool-2",
  body: "{}",
  rawInput: {},
  choices: [{ id: "allow", label: "Allow" }],
};

const question: QuestionPrompt = {
  kind: "question",
  requestId: "req-3",
  toolName: "AskUserQuestion",
  toolUseId: "tool-3",
  rawInput: {},
  questions: [],
};

describe("planOf", () => {
  it("reads the plan and the request it is waiting on", () => {
    expect(planOf(plan)).toEqual({
      requestId: "req-1",
      text: "1. Do the thing\n2. Do the other thing",
    });
  });

  /// Only a plan has a text to read at length, so the other cards ask for
  /// nothing to be shown beside the transcript.
  it("has nothing for the other kinds of prompt", () => {
    expect(planOf(permission)).toBeNull();
    expect(planOf(question)).toBeNull();
  });

  it("has nothing while the session is waiting on nothing", () => {
    expect(planOf(null)).toBeNull();
  });
});
