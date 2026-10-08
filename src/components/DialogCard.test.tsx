import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InboundRequest } from "../lib/controlProtocol";
import {
  type PermissionPrompt,
  type PlanPrompt,
  type QuestionModel,
  type QuestionPrompt,
  readPrompt,
} from "../lib/dialogModels";
import { DialogCard } from "./DialogCard";

function supportLayoutMeasurement(): void {
  Element.prototype.scrollIntoView = () => undefined;
}

supportLayoutMeasurement();

const option = (label: string, description = "") => ({ label, description, preview: "" });

function permissionPrompt(overrides: Partial<PermissionPrompt> = {}): PermissionPrompt {
  return {
    kind: "permission",
    requestId: "req-permission",
    toolName: "Bash",
    title: "ls -la",
    toolUseId: "tool-permission",
    body: '{\n  "command": "ls -la"\n}',
    rawInput: { command: "ls -la" },
    choices: [
      { id: "allow", label: "Allow" },
      { id: "always", label: "Always allow Bash", permissions: [{ type: "addRules" }] },
      { id: "deny", label: "Deny" },
    ],
    ...overrides,
  };
}

function questionPrompt(questions: QuestionModel[]): QuestionPrompt {
  return {
    kind: "question",
    requestId: "req-question",
    toolName: "AskUserQuestion",
    toolUseId: "tool-question",
    rawInput: {},
    questions,
  };
}

const singleSelect: QuestionModel[] = [
  {
    question: "Which database?",
    header: "Storage",
    multiSelect: false,
    options: [option("Postgres", "Relational"), option("SQLite", "Embedded")],
  },
];

const multiSelect: QuestionModel[] = [
  {
    question: "Which tools?",
    header: "Tools",
    multiSelect: true,
    options: [option("Bash"), option("Read"), option("Write")],
  },
];

const twoQuestions: QuestionModel[] = [
  {
    question: "First?",
    header: "",
    multiSelect: false,
    options: [option("A1"), option("A2")],
  },
  {
    question: "Second?",
    header: "",
    multiSelect: false,
    options: [option("B1"), option("B2")],
  },
];

const planRequest: InboundRequest = {
  requestId: "req-plan",
  subtype: "can_use_tool",
  request: {
    subtype: "can_use_tool",
    tool_name: "ExitPlanMode",
    tool_use_id: "tool-plan",
    input: { plan: "DECOY sitting in the tool input" },
  },
};

const ASSISTANT_PLAN = "Add the parser first, then the tests.";

function planPrompt(planText: string): PlanPrompt {
  const prompt = readPrompt(planRequest, planText);
  if (prompt?.kind !== "plan") throw new Error("expected a plan prompt");
  return prompt;
}

describe("a permission card", () => {
  it("allows the tool with the allow choice", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={permissionPrompt()} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "permission",
      choice: "allow",
      permissions: undefined,
    });
  });

  it("carries the permission rules an always-allow choice installs", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={permissionPrompt()} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole("button", { name: "Always allow Bash" }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "permission",
      choice: "always",
      permissions: [{ type: "addRules" }],
    });
  });

  it("denies the tool with the deny choice", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={permissionPrompt()} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "permission",
      choice: "deny",
      permissions: undefined,
    });
  });

  it("names the tool and what it would act on", () => {
    render(<DialogCard prompt={permissionPrompt()} onResolve={vi.fn()} />);

    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("ls -la")).toBeInTheDocument();
  });

  it("collapses a long tool input until it is asked for", () => {
    const body = ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n");
    const { container } = render(
      <DialogCard prompt={permissionPrompt({ body })} onResolve={vi.fn()} />,
    );
    const shown = (): string => container.querySelector(".dialog-code pre")?.textContent ?? "";

    expect(shown()).toBe("one\ntwo\nthree\nfour\nfive\nsix");

    fireEvent.click(screen.getByRole("button", { name: "Show all 8 lines" }));

    expect(shown()).toBe(body);
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });
});

describe("keyboard control of a card", () => {
  it("chooses the settled row on Enter", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={permissionPrompt()} onResolve={onResolve} />);

    fireEvent.keyDown(document, { key: "Enter" });

    expect(onResolve).toHaveBeenCalledWith({
      kind: "permission",
      choice: "allow",
      permissions: undefined,
    });
  });

  it("moves the settled row with the arrow keys", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={permissionPrompt()} onResolve={onResolve} />);

    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });

    expect(onResolve).toHaveBeenCalledWith({
      kind: "permission",
      choice: "always",
      permissions: [{ type: "addRules" }],
    });
  });

  it("moves the settled row with Tab, which the card keeps for itself", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={permissionPrompt()} onResolve={onResolve} />);

    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.keyDown(document, { key: "Enter" });

    expect(onResolve).toHaveBeenCalledWith({
      kind: "permission",
      choice: "always",
      permissions: [{ type: "addRules" }],
    });
  });
});

describe("a question card", () => {
  it("answers a single-select question as soon as an option is chosen", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole("button", { name: /Postgres/ }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "question",
      answers: { "Which database?": "Postgres" },
      annotations: {},
    });
  });

  it("waits for the submit button when a question allows several answers", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole("button", { name: "Bash" }));
    fireEvent.click(screen.getByRole("button", { name: "Write" }));

    expect(onResolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "question",
      answers: { "Which tools?": "Bash, Write" },
      annotations: {},
    });
  });

  it("refuses to submit a multi-select question with nothing ticked", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={onResolve} />);

    const submit = screen.getByRole("button", { name: "Choose an option for each question" });
    expect(submit).toHaveClass("disabled");

    fireEvent.click(submit);

    expect(onResolve).not.toHaveBeenCalled();
  });

  it("tells assistive technology that the submit control is inactive", () => {
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Choose an option for each question" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("announces the submit control as active once an option is ticked", () => {
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Bash" }));

    const submit = screen.getByRole("button", { name: "Send answer" });
    expect(submit).toHaveAttribute("aria-disabled", "false");
    expect(submit).not.toHaveClass("disabled");
  });

  it("keeps the submit control focusable, because the arrow keys move onto it", () => {
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Choose an option for each question" }),
    ).not.toBeDisabled();
  });

  it("waits until every question has an answer before resolving", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(twoQuestions)} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole("button", { name: "A1" }));
    expect(onResolve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "B1" }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "question",
      answers: { "First?": "A1", "Second?": "B1" },
      annotations: {},
    });
  });

  it("sends the notes typed for an option along with the answer", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={onResolve} />);

    fireEvent.keyDown(document, { key: "n" });
    fireEvent.change(screen.getByRole("textbox", { name: "Notes for Postgres" }), {
      target: { value: "use the pool" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Postgres/ }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "question",
      answers: { "Which database?": "Postgres" },
      annotations: { "Which database?": { notes: "use the pool" } },
    });
  });

  it("ticks a box with space, as it does with Enter", () => {
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: " " });

    expect(screen.getByRole("button", { name: "Bash" })).toHaveClass("selected");
  });

  it("unticks a box with space as well", () => {
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: " " });
    fireEvent.keyDown(document, { key: " " });

    expect(screen.getByRole("button", { name: "Bash" })).not.toHaveClass("selected");
  });

  it("keeps space out of a single-select question, where it would answer outright", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={onResolve} />);

    fireEvent.keyDown(document, { key: " " });

    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Postgres/ })).not.toHaveClass("selected");
  });

  it("says which question takes several answers and which takes one", () => {
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={vi.fn()} />);

    expect(screen.getByText("choose any")).toBeInTheDocument();
  });
});

describe("answering in your own words", () => {
  const TYPED = "Type your own response";
  const boxFor = (question: string) =>
    screen.getByRole("textbox", { name: `Your own answer to ${question}` });
  const box = () => boxFor("Which database?");
  const typedRow = () => screen.getByRole("button", { name: new RegExp(TYPED) });

  /** Walks the keyboard from the first suggestion down to the typed-answer row. */
  const reachTypedRow = () => {
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
  };

  it("offers it as one more row beside the suggestions the CLI sent", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Postgres/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SQLite/ })).toBeInTheDocument();
    expect(typedRow()).toBeInTheDocument();
  });

  it("wears the same styling as the suggested options", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Postgres/ })).toHaveClass("dialog-option");
    expect(typedRow().className.split(/\s+/)).toEqual(["dialog-option"]);
  });

  it("offers no such row on a multi-select question, which is answered by ticking", () => {
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={vi.fn()} />);

    expect(screen.queryByRole("button", { name: new RegExp(TYPED) })).not.toBeInTheDocument();
  });

  it("leaves the options full width until the row is reached", () => {
    const { container } = render(
      <DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />,
    );

    expect(container.querySelector(".dialog-card")).not.toHaveClass("with-notes");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens its box on reaching the row, with no keypress needed", () => {
    const { container } = render(
      <DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />,
    );

    reachTypedRow();

    expect(box()).toBeInTheDocument();
    expect(container.querySelector(".dialog-card")).toHaveClass("with-notes");
  });

  it("puts the keyboard in the box as it opens, so it can be typed into at once", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);

    reachTypedRow();

    expect(box()).toHaveFocus();
  });

  it("puts the keyboard in the box when the row is clicked rather than reached", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);

    fireEvent.click(typedRow());

    expect(box()).toHaveFocus();
  });

  it("moves the option on from inside the box instead of typing a line into it", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);
    reachTypedRow();
    expect(box()).toHaveFocus();

    fireEvent.keyDown(box(), { key: "ArrowUp" });

    expect(screen.getByRole("button", { name: /SQLite/ })).toHaveClass("focused");
  });

  it("selects the row like any other, as soon as something is typed", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);
    reachTypedRow();

    fireEvent.change(box(), { target: { value: "MySQL" } });

    expect(typedRow()).toHaveClass("selected");
  });

  it("sends what was typed as the answer, not as a note", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={onResolve} />);
    reachTypedRow();

    fireEvent.change(box(), { target: { value: "SQL Server, if you must" } });
    fireEvent.keyDown(box(), { key: "Enter" });

    expect(onResolve).toHaveBeenCalledWith({
      kind: "question",
      answers: { "Which database?": "SQL Server, if you must" },
      annotations: {},
    });
  });

  it("will not send the row while its box is empty", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={onResolve} />);
    reachTypedRow();

    fireEvent.keyDown(document, { key: "Enter" });

    expect(onResolve).not.toHaveBeenCalled();
  });

  it("counts whitespace as no answer at all", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={onResolve} />);
    reachTypedRow();

    fireEvent.change(box(), { target: { value: "   " } });
    fireEvent.keyDown(box(), { key: "Enter" });

    expect(onResolve).not.toHaveBeenCalled();
  });

  it("closes its box as soon as the keyboard leaves the row, like an option's notes", () => {
    const { container } = render(
      <DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />,
    );
    reachTypedRow();
    expect(box()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowUp" });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(container.querySelector(".dialog-card")).not.toHaveClass("with-notes");
  });

  it("leaves its box alone when the pointer moves onto another option", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);
    reachTypedRow();
    expect(box()).toBeInTheDocument();

    fireEvent.mouseMove(screen.getByRole("button", { name: /Postgres/ }), {
      clientX: 40,
      clientY: 40,
    });

    expect(box()).toBeInTheDocument();
  });

  it("opens its box when the row itself is chosen, which is what picking one means", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.click(typedRow());

    expect(box()).toBeInTheDocument();
  });

  it("counts the chosen row as the keyboard's row, so the box stays open", () => {
    const { container } = render(
      <DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />,
    );

    fireEvent.click(typedRow());

    expect(container.querySelector(".dialog-card")).toHaveClass("with-notes");
    expect(typedRow()).toHaveClass("focused");
  });

  it("keeps what was typed while the keyboard moves off the row and back", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);
    reachTypedRow();
    fireEvent.change(box(), { target: { value: "MySQL" } });

    fireEvent.keyDown(document, { key: "ArrowUp" });
    fireEvent.keyDown(document, { key: "ArrowDown" });

    expect(box()).toHaveValue("MySQL");
  });

  it("abandons what was typed once a suggested option is picked", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(twoQuestions)} onResolve={onResolve} />);
    reachTypedRow();
    fireEvent.change(boxFor("First?"), { target: { value: "my own" } });

    fireEvent.click(screen.getByRole("button", { name: "A1" }));
    fireEvent.click(screen.getByRole("button", { name: "B1" }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "question",
      answers: { "First?": "A1", "Second?": "B1" },
      annotations: {},
    });
  });

  it("stands in for a suggested option when it is the row that was picked", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(twoQuestions)} onResolve={onResolve} />);
    reachTypedRow();
    fireEvent.change(boxFor("First?"), { target: { value: "my own" } });

    fireEvent.click(screen.getByRole("button", { name: "B1" }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "question",
      answers: { "First?": "my own", "Second?": "B1" },
      annotations: {},
    });
  });

  it("waits for every question, as picking an option does", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(twoQuestions)} onResolve={onResolve} />);
    reachTypedRow();

    fireEvent.change(boxFor("First?"), { target: { value: "my own" } });
    fireEvent.keyDown(boxFor("First?"), { key: "Enter" });

    expect(onResolve).not.toHaveBeenCalled();
  });

  it("leaves the notes box beside it for the suggested options", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: "n" });

    expect(screen.getByRole("textbox", { name: "Notes for Postgres" })).toBeInTheDocument();
  });

  it("puts the keyboard in the notes box as it opens", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: "n" });

    expect(screen.getByRole("textbox", { name: "Notes for Postgres" })).toHaveFocus();
  });

  it("puts the keyboard back after arrowing out of the box and back", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);
    fireEvent.keyDown(document, { key: "n" });

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes for Postgres" }), {
      key: "ArrowDown",
    });
    fireEvent.keyDown(document, { key: "ArrowUp" });

    expect(screen.getByRole("textbox", { name: "Notes for Postgres" })).toHaveFocus();
  });

  it("moves the option on from inside the notes box, rather than typing a line into it", () => {
    render(<DialogCard prompt={questionPrompt(twoQuestions)} onResolve={vi.fn()} />);
    fireEvent.keyDown(document, { key: "n" });
    const box = screen.getByRole("textbox", { name: "Notes for A1" });
    expect(box).toHaveFocus();

    fireEvent.keyDown(box, { key: "ArrowDown" });

    expect(screen.getByRole("button", { name: "A2" })).toHaveClass("focused");
  });

  it("opens no notes for the typed-answer row, which has none to give", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);
    reachTypedRow();

    fireEvent.keyDown(document, { key: "n" });

    expect(screen.queryByRole("textbox", { name: /^Notes for/ })).not.toBeInTheDocument();
  });
});

describe("which row the notes belong to", () => {
  const notes = (label: string) => screen.queryByRole("textbox", { name: `Notes for ${label}` });

  it("leaves the notes where they are when the pointer crosses another option", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: "n" });
    expect(notes("Postgres")).toBeInTheDocument();

    fireEvent.mouseMove(screen.getByRole("button", { name: /SQLite/ }), {
      clientX: 40,
      clientY: 40,
    });

    expect(notes("Postgres")).toBeInTheDocument();
    expect(notes("SQLite")).not.toBeInTheDocument();
  });

  /// The keyboard is a deliberate move towards an option, so it previews the
  /// notes the way it always has; the pointer is not.
  it("moves the notes with the keyboard", () => {
    render(<DialogCard prompt={questionPrompt(twoQuestions)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: "n" });
    expect(notes("A1")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "n" });

    expect(notes("A2")).toBeInTheDocument();
    expect(notes("A1")).not.toBeInTheDocument();
  });

  /// Two options whose notes are both open leave the pane on screen as the
  /// keyboard moves between them, so nothing closes and reopens to bring the
  /// caret back — the box has to take it as its subject changes.
  it("moves the keyboard with it between two options whose notes are both open", () => {
    render(<DialogCard prompt={questionPrompt(twoQuestions)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: "n" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "n" });
    expect(notes("A2")).toHaveFocus();

    fireEvent.keyDown(notes("A2") as HTMLElement, { key: "ArrowUp" });

    expect(notes("A1")).toHaveFocus();
  });

  it("keeps the caret in the box when there is no other option to move to", () => {
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={vi.fn()} />);
    fireEvent.keyDown(document, { key: "n" });
    const box = screen.getByRole("textbox", { name: "Notes for Postgres" });
    expect(box).toHaveFocus();

    // Postgres is the first row, so there is nothing above it to move to.
    fireEvent.keyDown(box, { key: "ArrowUp" });

    expect(box).toHaveFocus();
  });

  it("puts the keyboard back in the notes when the row is returned to", () => {
    render(<DialogCard prompt={questionPrompt(twoQuestions)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: "n" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(notes("A1")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowUp" });

    expect(notes("A1")).toHaveFocus();
  });

  it("keeps a note against the option it was written for", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(twoQuestions)} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole("button", { name: "A1" }));
    fireEvent.keyDown(document, { key: "n" });
    fireEvent.change(screen.getByRole("textbox", { name: "Notes for A1" }), {
      target: { value: "the first one" },
    });

    fireEvent.click(screen.getByRole("button", { name: "B1" }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "question",
      answers: { "First?": "A1", "Second?": "B1" },
      annotations: { "First?": { notes: "the first one" } },
    });
  });
});

describe("notes on a multi-select question", () => {
  const notes = (label: string) => screen.queryByRole("textbox", { name: `Notes for ${label}` });

  it("offers them, which a ticked answer has as much use for as a picked one", () => {
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: "n" });

    expect(notes("Bash")).toBeInTheDocument();
  });

  it("leaves them alone when the pointer crosses another box", () => {
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={vi.fn()} />);

    fireEvent.keyDown(document, { key: "n" });
    fireEvent.mouseMove(screen.getByRole("button", { name: "Read" }), {
      clientX: 40,
      clientY: 40,
    });

    expect(notes("Bash")).toBeInTheDocument();
  });

  it("sends a note with the box it was written against", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(multiSelect)} onResolve={onResolve} />);

    fireEvent.keyDown(document, { key: "n" });
    fireEvent.change(screen.getByRole("textbox", { name: "Notes for Bash" }), {
      target: { value: "only in the sandbox" },
    });
    fireEvent.keyDown(document, { key: " " });
    fireEvent.click(screen.getByRole("button", { name: /Send answer/ }));

    expect(onResolve).toHaveBeenCalledWith({
      kind: "question",
      answers: { "Which tools?": "Bash" },
      annotations: { "Which tools?": { notes: "only in the sandbox" } },
    });
  });
});

describe("dismissing a card", () => {
  it("resolves a question card with no answer when Escape is pressed", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={onResolve} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onResolve).toHaveBeenCalledWith({ kind: "dismiss" });
  });

  it("resolves a permission card with no decision when Escape is pressed", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={permissionPrompt()} onResolve={onResolve} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onResolve).toHaveBeenCalledWith({ kind: "dismiss" });
  });

  it("leaves the box on the first Escape and dismisses on the second", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={questionPrompt(singleSelect)} onResolve={onResolve} />);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });

    const input = screen.getByRole("textbox", { name: "Your own answer to Which database?" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onResolve).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onResolve).toHaveBeenCalledWith({ kind: "dismiss" });
  });
});

describe("a plan card", () => {
  it("shows the plan from the assistant reply rather than the ExitPlanMode input", () => {
    render(<DialogCard prompt={planPrompt(ASSISTANT_PLAN)} onResolve={vi.fn()} />);

    expect(screen.getByText(ASSISTANT_PLAN)).toBeInTheDocument();
    expect(screen.queryByText("DECOY sitting in the tool input")).not.toBeInTheDocument();
  });

  it("says the plan was absent when nothing preceded the call", () => {
    render(<DialogCard prompt={planPrompt("")} onResolve={vi.fn()} />);

    expect(
      screen.getByText("The plan was not included in the reply that preceded this."),
    ).toBeInTheDocument();
  });

  it("approves the plan with the allow choice", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={planPrompt(ASSISTANT_PLAN)} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole("button", { name: "Start on this plan" }));

    expect(onResolve).toHaveBeenCalledWith({ kind: "plan", choice: "approve" });
  });

  it("sends the plan back for revision with the deny choice", () => {
    const onResolve = vi.fn();
    render(<DialogCard prompt={planPrompt(ASSISTANT_PLAN)} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole("button", { name: "Keep planning" }));

    expect(onResolve).toHaveBeenCalledWith({ kind: "plan", choice: "revise" });
  });
});

describe("readPrompt", () => {
  it("refuses an elicitation it has no card for", () => {
    const request: InboundRequest = { requestId: "r", subtype: "elicitation", request: {} };
    expect(readPrompt(request)).toBeNull();
  });

  it("refuses an AskUserQuestion that carries no questions", () => {
    const request: InboundRequest = {
      requestId: "r",
      subtype: "can_use_tool",
      request: { tool_name: "AskUserQuestion", input: {} },
    };
    expect(readPrompt(request)).toBeNull();
  });

  it("reads AskUserQuestion as a question card rather than a yes-or-no approval", () => {
    const request: InboundRequest = {
      requestId: "r",
      subtype: "can_use_tool",
      request: {
        tool_name: "AskUserQuestion",
        input: { questions: [{ question: "Which?", options: [{ label: "One" }] }] },
      },
    };

    const prompt = readPrompt(request);
    expect(prompt?.kind).toBe("question");
  });

  it("reads the ExitPlanMode input as nothing, since the plan is in the reply", () => {
    const prompt = readPrompt(planRequest, ASSISTANT_PLAN);

    expect(prompt?.kind).toBe("plan");
    if (prompt?.kind !== "plan") throw new Error("expected a plan prompt");
    expect(prompt.plan).toBe(ASSISTANT_PLAN);
  });
});
