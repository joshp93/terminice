import { describe, expect, it } from "vitest";
import type { InboundRequest } from "./controlProtocol";
import {
  describeSuggestion,
  type PermissionPrompt,
  type PlanPrompt,
  type Prompt,
  type QuestionPrompt,
  readPrompt,
} from "./dialogModels";

const inbound = (
  subtype: string,
  body: Record<string, unknown>,
  requestId = "req-1",
): InboundRequest => ({ requestId, subtype, request: body });

const asPermission = (prompt: Prompt | null): PermissionPrompt => {
  if (prompt?.kind !== "permission") throw new Error("expected a permission prompt");
  return prompt;
};

const asQuestion = (prompt: Prompt | null): QuestionPrompt => {
  if (prompt?.kind !== "question") throw new Error("expected a question prompt");
  return prompt;
};

const asPlan = (prompt: Prompt | null): PlanPrompt => {
  if (prompt?.kind !== "plan") throw new Error("expected a plan prompt");
  return prompt;
};

describe("describeSuggestion", () => {
  it("returns empty for a suggestion that is not an object", () => {
    expect(describeSuggestion(null)).toBe("");
    expect(describeSuggestion("setMode")).toBe("");
    expect(describeSuggestion([{ type: "setMode" }])).toBe("");
  });

  it("labels each kind of set-mode suggestion", () => {
    expect(describeSuggestion({ type: "setMode", mode: "acceptEdits" })).toBe("Always allow edits");
    expect(describeSuggestion({ type: "setMode", mode: "bypassPermissions" })).toBe(
      "Always allow everything",
    );
    expect(describeSuggestion({ type: "setMode", mode: "plan" })).toBe("Switch to plan mode");
  });

  it("falls back to a generic label for a mode it does not know", () => {
    expect(describeSuggestion({ type: "setMode", mode: "default" })).toBe("Always allow");
    expect(describeSuggestion({ type: "setMode" })).toBe("Always allow");
  });

  it("names the tool an add-rules suggestion covers", () => {
    expect(describeSuggestion({ type: "addRules", rules: [{ toolName: "Bash" }] })).toBe(
      "Always allow Bash",
    );
  });

  it("falls back for add-rules suggestions with no usable tool", () => {
    expect(describeSuggestion({ type: "addRules", rules: [] })).toBe("Always allow");
    expect(describeSuggestion({ type: "addRules", rules: ["Bash"] })).toBe("Always allow");
  });

  it("returns empty for a suggestion type it does not know", () => {
    expect(describeSuggestion({ type: "somethingElse" })).toBe("");
    expect(describeSuggestion({})).toBe("");
  });
});

describe("readPrompt refusals", () => {
  it("refuses an elicitation rather than rendering it", () => {
    expect(readPrompt(inbound("elicitation", { tool_name: "Bash" }))).toBeNull();
  });

  it("refuses an elicitation even when it names a tool we render", () => {
    expect(readPrompt(inbound("elicitation", { tool_name: "ExitPlanMode" }))).toBeNull();
  });
});

describe("readPrompt plan prompts", () => {
  it("reads an ExitPlanMode request", () => {
    const prompt = asPlan(
      readPrompt(
        inbound(
          "can_use_tool",
          { tool_name: "ExitPlanMode", tool_use_id: "tu-1", input: {} },
          "req-9",
        ),
      ),
    );

    expect(prompt).toEqual({
      kind: "plan",
      requestId: "req-9",
      toolName: "ExitPlanMode",
      toolUseId: "tu-1",
      rawInput: {},
      plan: "",
      choices: [
        { id: "allow", label: "Start on this plan" },
        { id: "deny", label: "Keep planning" },
      ],
    });
  });

  it("takes the plan text from the preceding reply", () => {
    const prompt = asPlan(
      readPrompt(
        inbound("can_use_tool", { tool_name: "ExitPlanMode", input: {} }),
        "## Plan\n1. Do the thing",
      ),
    );
    expect(prompt.plan).toBe("## Plan\n1. Do the thing");
  });

  it("ignores any plan text carried in the tool input", () => {
    const prompt = asPlan(
      readPrompt(
        inbound("can_use_tool", { tool_name: "ExitPlanMode", input: { plan: "from input" } }),
      ),
    );
    expect(prompt.plan).toBe("");
  });

  it("falls back to an empty input object when the input is not one", () => {
    const prompt = asPlan(
      readPrompt(inbound("can_use_tool", { tool_name: "ExitPlanMode", input: "nope" })),
    );
    expect(prompt.rawInput).toEqual({});
  });

  it("treats ExitPlanMode as a plan even with a question-shaped input", () => {
    const prompt = asPlan(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "ExitPlanMode",
          input: { questions: [{ question: "Which?" }] },
        }),
      ),
    );
    expect(prompt.kind).toBe("plan");
  });
});

describe("readPrompt question prompts", () => {
  const input = {
    questions: [
      {
        question: "Which database?",
        header: "Database",
        multiSelect: true,
        options: [
          { label: "Postgres", description: "Relational", preview: "CREATE TABLE ..." },
          { label: "SQLite" },
        ],
      },
    ],
  };

  it("reads each question with its options", () => {
    const prompt = asQuestion(
      readPrompt(
        inbound(
          "can_use_tool",
          { tool_name: "AskUserQuestion", tool_use_id: "tu-2", input },
          "req-3",
        ),
      ),
    );

    expect(prompt).toEqual({
      kind: "question",
      requestId: "req-3",
      toolName: "AskUserQuestion",
      toolUseId: "tu-2",
      rawInput: input,
      questions: [
        {
          question: "Which database?",
          header: "Database",
          multiSelect: true,
          options: [
            { label: "Postgres", description: "Relational", preview: "CREATE TABLE ..." },
            { label: "SQLite", description: "", preview: "" },
          ],
        },
      ],
    });
  });

  it("defaults the header, description and preview to empty", () => {
    const prompt = asQuestion(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "AskUserQuestion",
          input: { questions: [{ question: "q", options: [{ label: "a" }] }] },
        }),
      ),
    );

    expect(prompt.questions[0]).toEqual({
      question: "q",
      header: "",
      multiSelect: false,
      options: [{ label: "a", description: "", preview: "" }],
    });
  });

  it("treats multiSelect as false unless it is exactly true", () => {
    const prompt = asQuestion(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "AskUserQuestion",
          input: { questions: [{ question: "q", multiSelect: "yes" }] },
        }),
      ),
    );
    expect(prompt.questions[0].multiSelect).toBe(false);
  });

  it("keeps a question that carries no options", () => {
    const prompt = asQuestion(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "AskUserQuestion",
          input: { questions: [{ question: "q" }] },
        }),
      ),
    );
    expect(prompt.questions[0].options).toEqual([]);
  });

  it("drops options that carry no label", () => {
    const prompt = asQuestion(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "AskUserQuestion",
          input: {
            questions: [
              { question: "q", options: [{ description: "no label" }, { label: "kept" }, "stray"] },
            ],
          },
        }),
      ),
    );
    expect(prompt.questions[0].options).toEqual([{ label: "kept", description: "", preview: "" }]);
  });

  it("drops entries that carry no question text", () => {
    const prompt = asQuestion(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "AskUserQuestion",
          input: { questions: [{ header: "no question" }, { question: "kept" }] },
        }),
      ),
    );
    expect(prompt.questions.map((entry) => entry.question)).toEqual(["kept"]);
  });

  it("carries no permission choices", () => {
    const prompt = asQuestion(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "AskUserQuestion",
          input: { questions: [{ question: "q" }] },
        }),
      ),
    );
    expect("choices" in prompt).toBe(false);
  });

  it("refuses an AskUserQuestion with no usable question", () => {
    const clarify = (input: unknown) =>
      readPrompt(inbound("can_use_tool", { tool_name: "AskUserQuestion", input }));

    expect(clarify({ questions: [] })).toBeNull();
    expect(clarify({ questions: [{ header: "no question" }] })).toBeNull();
    expect(clarify({ questions: "nope" })).toBeNull();
    expect(readPrompt(inbound("can_use_tool", { tool_name: "AskUserQuestion" }))).toBeNull();
  });
});

describe("readPrompt permission prompts", () => {
  it("renders an otherwise unhandled request as allow/deny", () => {
    const prompt = asPermission(
      readPrompt(
        inbound(
          "can_use_tool",
          { tool_name: "Bash", tool_use_id: "tu-3", input: { command: "ls" } },
          "req-4",
        ),
      ),
    );

    expect(prompt).toEqual({
      kind: "permission",
      requestId: "req-4",
      toolName: "Bash",
      title: "ls",
      toolUseId: "tu-3",
      body: '{\n  "command": "ls"\n}',
      rawInput: { command: "ls" },
      choices: [
        { id: "allow", label: "Allow" },
        { id: "deny", label: "Deny" },
      ],
    });
  });

  it("prefers the request's own description as the title", () => {
    const prompt = asPermission(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "Bash",
          description: "Run the tests",
          input: { command: "pnpm test" },
        }),
      ),
    );
    expect(prompt.title).toBe("Run the tests");
  });

  it("summarises a file path when there is no description", () => {
    const prompt = asPermission(
      readPrompt(
        inbound("can_use_tool", { tool_name: "Read", input: { file_path: "src/main.tsx" } }),
      ),
    );
    expect(prompt.title).toBe("src/main.tsx");
  });

  it("summarises only a command's first line", () => {
    const prompt = asPermission(
      readPrompt(
        inbound("can_use_tool", { tool_name: "Bash", input: { command: "ls -la\nmore" } }),
      ),
    );
    expect(prompt.title).toBe("ls -la");
  });

  it("summarises a pattern, a url or a prompt", () => {
    const titleOf = (tool_name: string, input: Record<string, unknown>) =>
      asPermission(readPrompt(inbound("can_use_tool", { tool_name, input }))).title;

    expect(titleOf("Grep", { pattern: "TODO" })).toBe("TODO");
    expect(titleOf("WebFetch", { url: "https://example.com" })).toBe("https://example.com");
    expect(titleOf("Task", { prompt: "Audit the parser" })).toBe("Audit the parser");
  });

  it("falls back to the tool name when the input says nothing", () => {
    const prompt = asPermission(
      readPrompt(inbound("can_use_tool", { tool_name: "Bash", input: {} })),
    );
    expect(prompt.title).toBe("Bash");
  });

  it("leaves the title empty when there is no input at all", () => {
    const prompt = asPermission(readPrompt(inbound("can_use_tool", { tool_name: "Bash" })));
    expect(prompt.title).toBe("");
  });

  it("falls back to an empty input object and body", () => {
    const prompt = asPermission(
      readPrompt(inbound("can_use_tool", { tool_name: "Bash", input: "nope" })),
    );
    expect(prompt.rawInput).toEqual({});
    expect(prompt.body).toBe("{}");
  });

  it("adds an always choice from the first suggestion it can label", () => {
    const suggestion = { type: "setMode", mode: "acceptEdits" };
    const prompt = asPermission(
      readPrompt(
        inbound("can_use_tool", { tool_name: "Edit", permission_suggestions: [suggestion] }),
      ),
    );

    expect(prompt.choices).toEqual([
      { id: "allow", label: "Allow" },
      { id: "always", label: "Always allow edits", permissions: [suggestion] },
      { id: "deny", label: "Deny" },
    ]);
  });

  it("skips suggestions it cannot label", () => {
    const usable = { type: "addRules", rules: [{ toolName: "Bash" }] };
    const prompt = asPermission(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "Bash",
          permission_suggestions: [{ type: "mystery" }, usable],
        }),
      ),
    );

    expect(prompt.choices[1]).toEqual({
      id: "always",
      label: "Always allow Bash",
      permissions: [usable],
    });
  });

  it("has no always choice when nothing can be labelled", () => {
    const prompt = asPermission(
      readPrompt(
        inbound("can_use_tool", {
          tool_name: "Bash",
          permission_suggestions: [{ type: "mystery" }, "stray"],
        }),
      ),
    );
    expect(prompt.choices.map((choice) => choice.id)).toEqual(["allow", "deny"]);
  });

  it("ignores permission_suggestions that is not an array", () => {
    const prompt = asPermission(
      readPrompt(inbound("can_use_tool", { tool_name: "Bash", permission_suggestions: "setMode" })),
    );
    expect(prompt.choices.map((choice) => choice.id)).toEqual(["allow", "deny"]);
  });
});
