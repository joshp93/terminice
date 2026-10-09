import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/** What the caret is standing in for, if anything. */
export type VoiceCaretMode = "off" | "listening" | "transcribing";

/** Turns the dictation caret on, and says which of its shapes to draw. */
export const setVoiceCaret = StateEffect.define<VoiceCaretMode>();

/**
 * Three bars standing where the caret was, which move with the voice.
 *
 * The bars are drawn empty and sized entirely in CSS from a `--voice-level`
 * custom property on the composer, so the audio level never has to reach this
 * widget: it is written once to an ancestor element and inherited down. That
 * is the whole reason the meter is a decoration rather than a component.
 */
class VoiceBars extends WidgetType {
  toDOM(): HTMLElement {
    return filled("voice-caret", "i", 3);
  }

  /**
   * Whether the bars can be redrawn in place.
   *
   * There is only ever one set of bars and they hold no state of their own, so
   * a redraw would replace the element the level is animating for no reason.
   *
   * @returns Always true.
   */
  eq(): boolean {
    return true;
  }

  /** Whether the editor should handle events that land on the bars. */
  ignoreEvent(): boolean {
    return true;
  }
}

/** How long a line takes to grow or to shrink, at its shortest and longest. */
const PULSE_MS = { least: 420, most: 900 };

/**
 * Three lines standing in for the words being worked out.
 *
 * The wait after letting go is the one part of dictation with nothing to show
 * for it — the microphone is shut, the text has not arrived, and the composer
 * looks exactly as it did before. This fills it, and it is drawn where the
 * words will land so it reads as the sentence being written rather than as the
 * application being busy.
 */
class Transcribing extends WidgetType {
  toDOM(): HTMLElement {
    const box = filled("voice-transcribing", "i", 3);
    for (const line of box.children) {
      if (!(line instanceof HTMLElement)) continue;

      // Each line runs at its own speed and starts part-way through its own
      // cycle, so the three never fall into step and the group reads as work
      // rather than as a loop. The pace is rolled here rather than written into
      // the stylesheet, so one wait does not look exactly like the next.
      const period = PULSE_MS.least + Math.random() * (PULSE_MS.most - PULSE_MS.least);
      line.style.animationDuration = `${Math.round(period)}ms`;
      line.style.animationDelay = `-${Math.round(Math.random() * period)}ms`;
    }
    return box;
  }

  /** Whether the lines can be redrawn in place, which would re-roll them. */
  eq(): boolean {
    return true;
  }

  /** Whether the editor should handle events that land on the lines. */
  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Builds an empty element with a number of children for CSS to draw.
 *
 * @param className - What the element is.
 * @param child - The tag each child is made of.
 * @param count - How many children it holds.
 * @returns The element, which holds nothing but shape.
 */
function filled(className: string, child: string, count: number): HTMLElement {
  const box = document.createElement("span");
  box.className = className;
  box.setAttribute("aria-hidden", "true");
  for (let index = 0; index < count; index += 1) box.append(document.createElement(child));
  return box;
}

const bars = new VoiceBars();
const lines = new Transcribing();

/**
 * Places the shape at the caret, or nowhere when there is a selection.
 *
 * @param mode - Which shape is being drawn, if any.
 * @param state - The editor's state.
 * @returns The decoration to draw.
 */
function marksFor(mode: VoiceCaretMode, state: EditorState): DecorationSet {
  if (mode === "off") return Decoration.none;

  const range = state.selection.main;
  if (range.from !== range.to) return Decoration.none;

  const widget = mode === "listening" ? bars : lines;
  return Decoration.set([Decoration.widget({ widget, side: 1 }).range(range.head)]);
}

/**
 * Holds the dictation caret while a recording runs, and while its words are
 * being worked out.
 *
 * It is a field rather than a plugin because whether the microphone is open is
 * not something the document knows: it is switched on and off from outside, and
 * in between it has to follow the caret wherever the reader moves it. The marks
 * are derived from the mode on every update rather than kept alongside it, so
 * following the caret is not something that has to be remembered.
 */
export const voiceCaret = StateField.define<VoiceCaretMode>({
  create: () => "off",

  update(mode, transaction) {
    const switched = transaction.effects.find((effect) => effect.is(setVoiceCaret));
    return switched ? switched.value : mode;
  },

  provide: (field) =>
    EditorView.decorations.from(field, (mode) => (view) => marksFor(mode, view.state)),
});
