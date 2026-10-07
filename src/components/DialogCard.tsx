import { useEffect, useMemo, useRef, useState } from "react";
import { useHoverIntent } from "../hooks/useHoverIntent";
import type {
  PermissionChoice,
  Prompt,
  PromptResolution,
  QuestionModel,
} from "../lib/dialogModels";

/** Props for {@link DialogCard}. */
export type DialogCardProps = {
  prompt: Prompt;
  onResolve: (resolution: PromptResolution) => void;
};

/** A row the keyboard can land on. */
type FocusTarget =
  | { kind: "option"; question: number; option: number }
  | { kind: "choice"; index: number }
  | { kind: "submit" };

const NOTES_HINT = "press n to show notes";

/**
 * Keys an option's notes by the question and option it belongs to.
 *
 * @param question - The question text.
 * @param label - The option's label.
 * @returns A stable key for the notes map.
 */
function notesKey(question: string, label: string): string {
  return `${question}\u0000${label}`;
}

/**
 * Positions of rows that are equal.
 *
 * @param a - One row.
 * @param b - Another row.
 * @returns True when both refer to the same row.
 */
function sameTarget(a: FocusTarget, b: FocusTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "choice" && b.kind === "choice") return a.index === b.index;
  if (a.kind === "option" && b.kind === "option") {
    return a.question === b.question && a.option === b.option;
  }
  return a.kind === "submit";
}

/**
 * Renders a question or permission card in place of the composer.
 *
 * Multi-select questions use a filled or outlined box per option and are sent
 * with the button at the foot of the card; single-select questions use buttons
 * and resolve as soon as every question has an answer. Pressing `n` on a
 * single-select option reveals a notes pane beside it, and those notes travel
 * with the answer.
 *
 * @param props - The prompt to render and the resolution callback.
 * @returns The rendered card.
 */
export function DialogCard({ prompt, onResolve }: DialogCardProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<FocusTarget>(() =>
    prompt.kind === "permission"
      ? { kind: "choice", index: 0 }
      : { kind: "option", question: 0, option: 0 },
  );
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const hover = useHoverIntent(setFocus);

  const questions: QuestionModel[] = prompt.kind === "question" ? prompt.questions : [];
  const choices: PermissionChoice[] = prompt.kind === "permission" ? prompt.choices : [];

  const answered = questions.every((question) => (selections[question.question] ?? []).length > 0);
  const needsSubmit = questions.some((question) => question.multiSelect);

  const targets = useMemo<FocusTarget[]>(() => {
    if (prompt.kind === "permission") {
      return choices.map((_, index) => ({ kind: "choice", index }) as FocusTarget);
    }
    const rows: FocusTarget[] = [];
    questions.forEach((question, questionNumber) => {
      question.options.forEach((_, optionNumber) => {
        rows.push({ kind: "option", question: questionNumber, option: optionNumber });
      });
    });
    if (needsSubmit) rows.push({ kind: "submit" });
    return rows;
  }, [prompt.kind, choices, questions, needsSubmit]);

  const focusIndex = targets.findIndex((target) => sameTarget(target, focus));
  const settledIndex = focusIndex < 0 ? 0 : focusIndex;

  const focusedOption = useMemo(() => {
    if (focus.kind !== "option") return null;
    const question = questions[focus.question];
    const option = question?.options[focus.option];
    if (!question || !option || question.multiSelect) return null;
    return { question, option };
  }, [focus, questions]);

  const notesId = focusedOption
    ? notesKey(focusedOption.question.question, focusedOption.option.label)
    : null;
  const notesOpen = notesId !== null && revealed.has(notesId);
  const notesValue = notesId !== null ? (notes[notesId] ?? "") : "";

  useEffect(() => {
    if (notesOpen) notesRef.current?.focus();
  }, [notesOpen]);

  useEffect(() => {
    rowRefs.current[settledIndex]?.scrollIntoView({ block: "nearest" });
  }, [settledIndex, targets]);

  /**
   * Sends the collected answers back to the CLI.
   *
   * @param chosen - The selected labels, by question.
   * @param recorded - The notes, by question and option.
   */
  const resolveQuestions = (
    chosen: Record<string, string[]>,
    recorded: Record<string, string>,
  ): void => {
    const answers: Record<string, string> = {};
    const annotations: Record<string, { notes?: string }> = {};

    for (const question of questions) {
      const labels = chosen[question.question] ?? [];
      if (labels.length === 0) continue;
      answers[question.question] = labels.join(", ");
      const note = labels
        .map((label) => recorded[notesKey(question.question, label)] ?? "")
        .filter((entry) => entry.length > 0)
        .join("\n");
      if (note.length > 0) annotations[question.question] = { notes: note };
    }

    onResolve({ kind: "question", answers, annotations });
  };

  /**
   * Selects an option.
   *
   * A single-select answer resolves the card once every question has one; a
   * multi-select answer waits for the button, since ticking one box is rarely
   * the whole answer.
   *
   * @param questionNumber - Which question is being answered.
   * @param optionNumber - Which option was chosen.
   */
  const chooseOption = (questionNumber: number, optionNumber: number): void => {
    const question = questions[questionNumber];
    const label = question?.options[optionNumber]?.label ?? "";
    if (!question || !label) return;

    const current = selections[question.question] ?? [];
    const next =
      question.multiSelect && current.includes(label)
        ? current.filter((entry) => entry !== label)
        : question.multiSelect
          ? [...current, label]
          : [label];

    const updated = { ...selections, [question.question]: next };
    setSelections(updated);

    if (!question.multiSelect && questions.every((entry) => (updated[entry.question] ?? []).length > 0)) {
      resolveQuestions(updated, notes);
    }
  };

  const chooseChoice = (index: number): void => {
    const choice = choices[index];
    if (!choice) return;
    onResolve({ kind: "permission", choice: choice.id, permissions: choice.permissions });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target === notesRef.current) {
        if (event.key === "Escape") {
          notesRef.current?.blur();
          event.preventDefault();
          return;
        }
        // The notes pane is part of the answer, so Enter answers rather than
        // starting a new line. That holds whatever the composer is set to do;
        // the setting is about the composer, not about this.
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          if (focus.kind === "option") chooseOption(focus.question, focus.option);
        }
        return;
      }

      const move = (delta: number): void => {
        const next = Math.min(Math.max(settledIndex + delta, 0), targets.length - 1);
        const target = targets[next];
        if (target) setFocus(target);
      };

      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        move(1);
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
        move(-1);
        event.preventDefault();
        return;
      }
      if ((event.key === "n" || event.key === "N") && notesId !== null) {
        setRevealed((current) => new Set(current).add(notesId));
        event.preventDefault();
        return;
      }
      if (event.key !== "Enter") return;

      event.preventDefault();
      if (focus.kind === "choice") {
        chooseChoice(focus.index);
        return;
      }
      if (focus.kind === "submit") {
        if (answered) resolveQuestions(selections, notes);
        return;
      }
      chooseOption(focus.question, focus.option);
    };

    // Captured on the document so the card wins over the composer, which is
    // still mounted behind it holding whatever had been typed.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });

  let rowIndex = -1;

  return (
    <div className={notesOpen ? "dialog-card with-notes" : "dialog-card"}>
      <div className="dialog-options" style={{ flexBasis: notesOpen ? "50%" : "100%" }}>
        {prompt.kind === "permission" && (
          <>
            <div className="dialog-question-header">
              <span className="dialog-chip">{prompt.toolName}</span>
              <span className="dialog-question-text">{prompt.title || "wants to run"}</span>
              <span className="dialog-kind">needs approval</span>
            </div>

            <div className="dialog-code">
              <pre>{collapsedBody(prompt.body, expanded)}</pre>
              {prompt.body.split("\n").length > COLLAPSED_LINES && (
                <button
                  type="button"
                  className="dialog-code-toggle"
                  onClick={() => setExpanded((current) => !current)}
                >
                  {expanded ? "Hide" : `Show all ${prompt.body.split("\n").length} lines`}
                </button>
              )}
            </div>

            <ul className="dialog-list">
              {choices.map((choice, index) => (
                <li key={choice.id}>
                  <button
                    type="button"
                    ref={(node) => {
                      rowRefs.current[index] = node;
                    }}
                    className={[
                      "dialog-option",
                      index === settledIndex ? "focused" : "",
                      choice.id === "deny" ? "negative" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseMove={hover({ kind: "choice", index })}
                    onClick={() => chooseChoice(index)}
                  >
                    <span className="dialog-option-body">
                      <span className="dialog-option-label">{choice.label}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="dialog-footer">
              <span className="dialog-hint">↑↓ to move, Enter to choose</span>
            </div>
          </>
        )}

        {prompt.kind === "question" &&
          questions.map((question, questionNumber) => (
            <div className="dialog-question" key={question.question}>
              <div className="dialog-question-header">
                {question.header.length > 0 && <span className="dialog-chip">{question.header}</span>}
                <span className="dialog-question-text">{question.question}</span>
                <span className="dialog-kind">
                  {question.multiSelect ? "choose any" : "choose one"}
                </span>
              </div>
              <ul className="dialog-list">
                {question.options.map((option, optionNumber) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  const selected = (selections[question.question] ?? []).includes(option.label);
                  const hasNotes =
                    (notes[notesKey(question.question, option.label)] ?? "").length > 0;

                  return (
                    <li key={option.label}>
                      <button
                        type="button"
                        ref={(node) => {
                          rowRefs.current[index] = node;
                        }}
                        className={[
                          "dialog-option",
                          selected ? "selected" : "",
                          index === settledIndex ? "focused" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onMouseMove={hover({
                          kind: "option",
                          question: questionNumber,
                          option: optionNumber,
                        })}
                        onClick={() => chooseOption(questionNumber, optionNumber)}
                      >
                        {question.multiSelect && (
                          <span className={selected ? "tick filled" : "tick"} aria-hidden="true" />
                        )}
                        <span className="dialog-option-body">
                          <span className="dialog-option-label">
                            {option.label}
                            {hasNotes && <span className="note-dot" title="Has notes" />}
                          </span>
                          {option.description.length > 0 && (
                            <span className="dialog-option-description">{option.description}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

        {prompt.kind === "question" && needsSubmit && (
          <button
            type="button"
            ref={(node) => {
              rowRefs.current[rowIndex + 1] = node;
            }}
            className={[
              "dialog-option",
              "submit-answer",
              answered ? "" : "disabled",
              focus.kind === "submit" ? "focused" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseMove={hover({ kind: "submit" })}
            onClick={() => {
              if (answered) resolveQuestions(selections, notes);
            }}
          >
            <span className="dialog-option-body">
              <span className="dialog-option-label">
                {answered ? "Send answer" : "Choose an option for each question"}
              </span>
            </span>
          </button>
        )}

        {prompt.kind === "question" && (
          <div className="dialog-footer">
            <span className="dialog-hint">
              {notesId !== null ? NOTES_HINT : "↑↓ to move, Enter to choose"}
            </span>
          </div>
        )}
      </div>

      {notesOpen && (
        <div className="dialog-notes">
          <div className="dialog-notes-header">
            <span className="dialog-notes-title">{focusedOption?.option.label}</span>
            <span className="dialog-notes-hint">Enter sends · Ctrl+Enter for a new line</span>
          </div>
          <textarea
            ref={notesRef}
            className="dialog-notes-input"
            value={notesValue}
            placeholder="Add notes for this choice…"
            onChange={(event) =>
              setNotes((current) => ({ ...current, [notesId]: event.target.value }))
            }
          />
        </div>
      )}
    </div>
  );
}

/** How many lines a permission body shows before it is worth collapsing. */
const COLLAPSED_LINES = 6;

/**
 * Trims a permission body to its first lines unless it has been expanded.
 *
 * @param body - The formatted tool input.
 * @param expanded - Whether the reader asked for all of it.
 * @returns The text to display.
 */
function collapsedBody(body: string, expanded: boolean): string {
  const lines = body.split("\n");
  if (expanded || lines.length <= COLLAPSED_LINES) return body;
  return lines.slice(0, COLLAPSED_LINES).join("\n");
}
