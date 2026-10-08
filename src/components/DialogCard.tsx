import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
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

const NOTES_HINT = "press n for notes";
const MOVING_HINT = "↑↓ to move, Enter to choose · esc to dismiss";
const TICKING_HINT = "↑↓ to move, Enter or space to tick · esc to dismiss";

/**
 * The extra row a single-select question offers, alongside its own options.
 *
 * Picking it is what opens the box for answering in your own words, so the row
 * is selected and navigated exactly like a suggested option and only the answer
 * box sets it apart.
 */
const CUSTOM_LABEL = "Type your own response";

/** One row of a question: a suggested option, or the row for a typed answer. */
type QuestionRow = {
  label: string;
  description: string;
  preview: string;
  /** True for the row that stands in for an answer of the reader's own. */
  typed: boolean;
};

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
 * The rows a question offers, in the order the keyboard walks them.
 *
 * A single-select question gets one more row than the CLI sent it: the option
 * to answer in the reader's own words. A multi-select question does not, because
 * its answers are ticked and sent together, so there is nothing to replace.
 *
 * @param question - The question to lay out.
 * @returns The suggested options, then the free-text row when there is one.
 */
function rowsForQuestion(question: QuestionModel): QuestionRow[] {
  const rows: QuestionRow[] = question.options.map((option) => ({ ...option, typed: false }));
  if (!question.multiSelect) {
    rows.push({ label: CUSTOM_LABEL, description: "", preview: "", typed: true });
  }
  return rows;
}

/**
 * The answer to one question.
 *
 * The free-text row stands in for an answer rather than annotating a suggested
 * one, so when it is the row that was picked, what was typed is the answer —
 * and an empty box is no answer at all.
 *
 * @param chosen - The labels ticked or picked.
 * @param typed - What was typed into the free-text box.
 * @returns The answer, or an empty string when the question has none yet.
 */
function answerFor(chosen: string[], typed: string): string {
  if (chosen.includes(CUSTOM_LABEL)) return typed.trim();
  return chosen.join(", ");
}

/**
 * The question whose box for a typed answer belongs on screen.
 *
 * The box follows the row the way an option's notes do: it is open while the
 * free-text row is the row the keyboard is on, so it needs no key to reach, and
 * it closes the moment the keyboard moves away. What was typed is kept, so
 * coming back finds it again.
 *
 * @param focus - The row the keyboard is on.
 * @param questions - The card's questions.
 * @returns The question, or null when no box belongs on screen.
 */
function typedQuestion(focus: FocusTarget, questions: QuestionModel[]): QuestionModel | null {
  if (focus.kind !== "option") return null;
  const question = questions[focus.question];
  if (!question) return null;
  return rowsForQuestion(question)[focus.option]?.typed === true ? question : null;
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
 * Beside its suggested options, a single-select question offers one more row:
 * an answer in the reader's own words. Reaching it opens the box for that answer
 * in the same pane the notes use, without needing a key, and the box closes
 * again as soon as the keyboard leaves the row — the same way an option's notes
 * behave. Either box takes the keyboard as it opens, so it can be typed into
 * straight away; the arrow keys still move the option on from inside it, which
 * the card's own handler does once the box has been blurred. The row must hold
 * at least one character before the card can be sent, and whatever has been
 * typed is kept per question, so moving down the list and back does not lose it.
 *
 * The pane belongs to the row the keyboard is on, not to the row the pointer is
 * over. Running the mouse down the list lights each row up as it passes — that
 * is what `:hover` is for — but the pane stays where it was, so the notes for
 * the option being considered cannot be replaced by the notes of an option that
 * merely happened to be crossed on the way to the button.
 *
 * Escape closes the card without answering, which leaves the tool call refused
 * so Claude has to ask again rather than acting on a guess.
 *
 * @param props - The prompt to render and the resolution callback.
 * @returns The rendered card.
 */
export function DialogCard({ prompt, onResolve }: DialogCardProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<FocusTarget>(() =>
    prompt.kind === "question"
      ? { kind: "option", question: 0, option: 0 }
      : { kind: "choice", index: 0 },
  );
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const customRef = useRef<HTMLTextAreaElement | null>(null);
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const hover = useHoverIntent(setFocus);

  const questions: QuestionModel[] = prompt.kind === "question" ? prompt.questions : [];
  const choices: PermissionChoice[] = prompt.kind === "question" ? [] : prompt.choices;

  const answered = questions.every(
    (question) =>
      answerFor(selections[question.question] ?? [], custom[question.question] ?? "").length > 0,
  );
  const needsSubmit = questions.some((question) => question.multiSelect);

  const targets = useMemo<FocusTarget[]>(() => {
    if (prompt.kind !== "question") {
      return choices.map((_, index) => ({ kind: "choice", index }) as FocusTarget);
    }
    const rows: FocusTarget[] = [];
    questions.forEach((question, questionNumber) => {
      rowsForQuestion(question).forEach((_, optionNumber) => {
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
    if (!question || !option) return null;
    return { question, option };
  }, [focus, questions]);

  const notesId = focusedOption
    ? notesKey(focusedOption.question.question, focusedOption.option.label)
    : null;
  const notesOpen = notesId !== null && revealed.has(notesId);
  const notesValue = notesId !== null ? (notes[notesId] ?? "") : "";

  const customQuestion = typedQuestion(focus, questions);
  const customOpen = customQuestion !== null;
  const customValue = customQuestion ? (custom[customQuestion.question] ?? "") : "";
  const paneOpen = customOpen || notesOpen;

  // Whichever box is on screen takes the keyboard, so it can be typed into
  // without reaching for the mouse first, and it takes it again whenever it
  // comes to belong to another row. Keying the notes on `notesOpen` alone was
  // not enough: two options whose notes are both open leave the box where it is
  // as the keyboard moves between them, so nothing closed and reopened to bring
  // the caret back and the box sat there unfocused. Focusing a box that already
  // has the caret does nothing, so following the subject costs nothing while it
  // is being typed into.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is what the effect follows rather than something it reads — the box coming to belong to another row is exactly the event that has to put the caret back.
  useEffect(() => {
    if (notesOpen) notesRef.current?.focus();
  }, [notesOpen, notesId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: as above, for the box that answers in the reader's own words.
  useEffect(() => {
    if (customOpen) customRef.current?.focus();
  }, [customOpen, customQuestion?.question]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a rebuilt row list has to bring its settled row back into view even when the index is unchanged.
  useEffect(() => {
    rowRefs.current[settledIndex]?.scrollIntoView({ block: "nearest" });
  }, [settledIndex, targets]);

  /**
   * Sends the collected answers back to the CLI.
   *
   * @param chosen - The selected labels, by question.
   * @param recorded - The notes, by question and option.
   * @param typed - The responses written by hand, by question.
   */
  const resolveQuestions = (
    chosen: Record<string, string[]>,
    recorded: Record<string, string>,
    typed: Record<string, string>,
  ): void => {
    const answers: Record<string, string> = {};
    const annotations: Record<string, { notes?: string }> = {};

    for (const question of questions) {
      const labels = chosen[question.question] ?? [];
      const answer = answerFor(labels, typed[question.question] ?? "");
      if (answer.length === 0) continue;
      answers[question.question] = answer;
      const note = labels
        .map((label) => recorded[notesKey(question.question, label)] ?? "")
        .filter((entry) => entry.length > 0)
        .join("\n");
      if (note.length > 0) annotations[question.question] = { notes: note };
    }

    onResolve({ kind: "question", answers, annotations });
  };

  /**
   * Sends whatever is answered, once every question has an answer.
   *
   * Picking a suggested option and typing an answer both come through here, so
   * neither can send a card with another question still blank.
   *
   * @param chosen - The selected labels, by question.
   * @param typed - The responses written by hand, by question.
   */
  const resolveIfComplete = (
    chosen: Record<string, string[]>,
    typed: Record<string, string>,
  ): void => {
    const complete = questions.every(
      (entry) => answerFor(chosen[entry.question] ?? [], typed[entry.question] ?? "").length > 0,
    );
    if (complete) resolveQuestions(chosen, notes, typed);
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
    if (!question) return;
    const row = rowsForQuestion(question)[optionNumber];
    if (!row) return;

    const current = selections[question.question] ?? [];
    const next =
      question.multiSelect && current.includes(row.label)
        ? current.filter((entry) => entry !== row.label)
        : question.multiSelect
          ? [...current, row.label]
          : [row.label];

    const updated = { ...selections, [question.question]: next };
    setSelections(updated);
    // The row just chosen is the row the pane beside the list belongs to, so
    // choosing from the pointer brings the pane to it as the keyboard does.
    setFocus({ kind: "option", question: questionNumber, option: optionNumber });
    if (question.multiSelect) return;

    // Picking a suggested option abandons whatever had been typed, so only one
    // of the two is ever the answer.
    const updatedTyped = row.typed ? custom : { ...custom, [question.question]: "" };
    if (!row.typed) setCustom(updatedTyped);

    resolveIfComplete(updated, updatedTyped);
  };

  const chooseChoice = (index: number): void => {
    const choice = choices[index];
    if (!choice) return;
    if (prompt.kind === "plan") {
      onResolve({ kind: "plan", choice: choice.id === "deny" ? "revise" : "approve" });
      return;
    }
    onResolve({ kind: "permission", choice: choice.id, permissions: choice.permissions });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      /**
       * Moves to a neighbouring row.
       *
       * @param delta - -1 for the row above, 1 for the row below.
       * @returns True when there was somewhere to move to.
       */
      const step = (delta: number): boolean => {
        const next = Math.min(Math.max(settledIndex + delta, 0), targets.length - 1);
        const target = targets[next];
        if (!target || next === settledIndex) return false;
        setFocus(target);
        return true;
      };

      const writingCustom = event.target === customRef.current;
      if (writingCustom || event.target === notesRef.current) {
        const box = writingCustom ? customRef.current : notesRef.current;

        if (event.key === "Escape") {
          box?.blur();
          event.preventDefault();
          return;
        }
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          if (focus.kind === "option") {
            if (writingCustom) resolveIfComplete(selections, custom);
            else chooseOption(focus.question, focus.option);
          }
          return;
        }
        const forward = event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey);
        const backward = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey);
        if (forward || backward) {
          event.preventDefault();
          event.stopPropagation();
          // Left in the box when there is no other row to move to: blurring it
          // would put the caret nowhere and leave a box on screen that looks
          // ready to type into and is not.
          if (step(forward ? 1 : -1)) box?.blur();
        }
        return;
      }

      if (event.key === "Escape") {
        onResolve({ kind: "dismiss" });
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        step(1);
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
        step(-1);
        event.preventDefault();
        return;
      }
      if ((event.key === "n" || event.key === "N") && notesId !== null) {
        setRevealed((current) => new Set(current).add(notesId));
        event.preventDefault();
        return;
      }

      // Space ticks a box as Enter does. It is confined to multi-select, where
      // there is a box to tick: on a single-select row a stray space would
      // otherwise answer the question.
      if (event.key === " " && focus.kind === "option") {
        const question = questions[focus.question];
        if (question?.multiSelect === true) {
          event.preventDefault();
          chooseOption(focus.question, focus.option);
        }
        return;
      }

      if (event.key !== "Enter") return;

      event.preventDefault();
      if (focus.kind === "choice") {
        chooseChoice(focus.index);
        return;
      }
      if (focus.kind === "submit") {
        if (answered) resolveQuestions(selections, notes, custom);
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
    <div className={paneOpen ? "dialog-card with-notes" : "dialog-card"}>
      <div className="dialog-options" style={{ flexBasis: paneOpen ? "50%" : "100%" }}>
        {prompt.kind === "permission" && (
          <>
            <div className="dialog-question-header">
              <span className="dialog-chip">{prompt.toolName}</span>
              <span className="dialog-question-text">{prompt.title || "wants to run"}</span>
              <span className="dialog-kind">needs approval</span>
            </div>

            <CollapsibleText
              text={prompt.body}
              expanded={expanded}
              onToggle={() => setExpanded((current) => !current)}
            />

            <ChoiceList
              choices={choices}
              settledIndex={settledIndex}
              hover={hover}
              onChoose={chooseChoice}
              registerRow={(index, node) => {
                rowRefs.current[index] = node;
              }}
            />

            <div className="dialog-footer">
              <span className="dialog-hint">↑↓ to move, Enter to choose · esc to dismiss</span>
            </div>
          </>
        )}

        {prompt.kind === "plan" && (
          <>
            <div className="dialog-question-header">
              <span className="dialog-chip">Plan</span>
              <span className="dialog-question-text">
                Claude has finished planning and is waiting to start
              </span>
              <span className="dialog-kind">needs approval</span>
            </div>

            <CollapsibleText
              text={prompt.plan || "The plan was not included in the reply that preceded this."}
              expanded={expanded}
              onToggle={() => setExpanded((current) => !current)}
              variant="plan"
            />

            <ChoiceList
              choices={choices}
              settledIndex={settledIndex}
              hover={hover}
              onChoose={chooseChoice}
              registerRow={(index, node) => {
                rowRefs.current[index] = node;
              }}
            />

            <div className="dialog-footer">
              <span className="dialog-hint">
                ↑↓ to move, Enter to choose · esc to dismiss · keeping planning stays in plan mode
              </span>
            </div>
          </>
        )}

        {prompt.kind === "question" &&
          questions.map((question, questionNumber) => (
            <div className="dialog-question" key={question.question}>
              <div className="dialog-question-header">
                {question.header.length > 0 && (
                  <span className="dialog-chip">{question.header}</span>
                )}
                <span className="dialog-question-text">{question.question}</span>
                <span className="dialog-kind">
                  {question.multiSelect ? "choose any" : "choose one"}
                </span>
              </div>
              <ul className="dialog-list">
                {rowsForQuestion(question).map((row, optionNumber) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  const selected = (selections[question.question] ?? []).includes(row.label);
                  const hasNotes = (notes[notesKey(question.question, row.label)] ?? "").length > 0;
                  const needsAnswer =
                    row.typed && selected && (custom[question.question] ?? "").trim().length === 0;

                  return (
                    <li key={row.label}>
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
                        onClick={() => chooseOption(questionNumber, optionNumber)}
                      >
                        {question.multiSelect && (
                          <span className={selected ? "tick filled" : "tick"} aria-hidden="true" />
                        )}
                        <span className="dialog-option-body">
                          <span className="dialog-option-label">
                            {row.label}
                            {hasNotes && <span className="note-dot" title="Has notes" />}
                          </span>
                          {row.description.length > 0 && (
                            <span className="dialog-option-description">{row.description}</span>
                          )}
                          {needsAnswer && (
                            <span className="dialog-option-description">
                              Write an answer below to use this
                            </span>
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
              "green-button",
              answered ? "" : "disabled",
              focus.kind === "submit" ? "focused" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-disabled={!answered}
            onMouseMove={hover({ kind: "submit" })}
            onClick={() => {
              if (answered) resolveQuestions(selections, notes, custom);
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
              {notesId !== null
                ? `${NOTES_HINT} · esc to dismiss`
                : needsSubmit
                  ? TICKING_HINT
                  : MOVING_HINT}
            </span>
          </div>
        )}
      </div>

      {paneOpen && (
        <div className="dialog-notes">
          {customQuestion && (
            <>
              <div className="dialog-notes-header">
                <span className="dialog-notes-title">{customQuestion.question}</span>
                <span className="dialog-notes-hint">Enter sends · at least one character</span>
              </div>
              <textarea
                ref={customRef}
                className="dialog-notes-input"
                value={customValue}
                placeholder="Answer in your own words…"
                aria-label={`Your own answer to ${customQuestion.question}`}
                onChange={(event) => {
                  const text = event.target.value;
                  setCustom((current) => ({ ...current, [customQuestion.question]: text }));
                  setSelections((current) => ({
                    ...current,
                    [customQuestion.question]: [CUSTOM_LABEL],
                  }));
                }}
              />
            </>
          )}

          {notesOpen && (
            <>
              <div className="dialog-notes-header">
                <span className="dialog-notes-title">{focusedOption?.option.label}</span>
                <span className="dialog-notes-hint">Enter sends · Ctrl+Enter for a new line</span>
              </div>
              <textarea
                ref={notesRef}
                className="dialog-notes-input"
                value={notesValue}
                placeholder="Add notes for this choice…"
                aria-label={`Notes for ${focusedOption?.option.label ?? "this choice"}`}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [notesId]: event.target.value }))
                }
              />
            </>
          )}
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

/** Props for {@link CollapsibleText}. */
type CollapsibleTextProps = {
  text: string;
  expanded: boolean;
  onToggle: () => void;
  /** Names what the text is, so a plan does not read as a tool input. */
  variant?: "plan";
};

/**
 * Renders a long block of text, trimmed until the reader asks for all of it.
 *
 * @param props - The text, whether it is expanded, and how to toggle it.
 * @returns The rendered block.
 */
function CollapsibleText({ text, expanded, onToggle, variant }: CollapsibleTextProps) {
  const lines = text.split("\n").length;
  return (
    <div className={variant ? `dialog-code ${variant}` : "dialog-code"}>
      <pre>{collapsedBody(text, expanded)}</pre>
      {lines > COLLAPSED_LINES && (
        <button type="button" className="dialog-code-toggle" onClick={onToggle}>
          {expanded ? "Hide" : `Show all ${lines} lines`}
        </button>
      )}
    </div>
  );
}

/** Props for {@link ChoiceList}. */
type ChoiceListProps = {
  choices: PermissionChoice[];
  /** The index of the row the keyboard is on. */
  settledIndex: number;
  hover: (value: FocusTarget) => (event: MouseEvent) => void;
  onChoose: (index: number) => void;
  registerRow: (index: number, node: HTMLButtonElement | null) => void;
};

/**
 * Renders a card's buttons as a list the keyboard can walk.
 *
 * @param props - The choices and the handlers behind them.
 * @returns The rendered list.
 */
function ChoiceList({ choices, settledIndex, hover, onChoose, registerRow }: ChoiceListProps) {
  return (
    <ul className="dialog-list">
      {choices.map((choice, index) => (
        <li key={choice.id}>
          <button
            type="button"
            ref={(node) => registerRow(index, node)}
            className={[
              "dialog-option",
              index === settledIndex ? "focused" : "",
              choice.id === "deny" ? "negative" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseMove={hover({ kind: "choice", index })}
            onClick={() => onChoose(index)}
          >
            <span className="dialog-option-body">
              <span className="dialog-option-label">{choice.label}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
