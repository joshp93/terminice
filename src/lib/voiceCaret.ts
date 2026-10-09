import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/** Turns the dictation caret on and off. */
export const setVoiceCaret = StateEffect.define<boolean>();

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
    const box = document.createElement("span");
    box.className = "voice-caret";
    box.setAttribute("aria-hidden", "true");
    for (let bar = 0; bar < 3; bar += 1) box.append(document.createElement("i"));
    return box;
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

const bars = new VoiceBars();

/**
 * Places the bars at the caret, or nowhere when there is a selection.
 *
 * @param state - The editor's state.
 * @returns The decoration to draw.
 */
function barsAt(state: EditorState): DecorationSet {
  const range = state.selection.main;
  if (range.from !== range.to) return Decoration.none;
  return Decoration.set([Decoration.widget({ widget: bars, side: 1 }).range(range.head)]);
}

/**
 * Holds the dictation caret while a recording is running.
 *
 * It is a field rather than a plugin because whether the microphone is open is
 * not something the document knows: it is switched on and off from outside, and
 * in between it has to follow the caret wherever the reader moves it.
 */
export const voiceCaret = StateField.define<DecorationSet>({
  create: () => Decoration.none,

  update(decoration, transaction) {
    const switched = transaction.effects.find((effect) => effect.is(setVoiceCaret));
    if (switched) return switched.value ? barsAt(transaction.state) : Decoration.none;
    if (decoration.size === 0) return decoration;
    if (transaction.selection || transaction.docChanged) return barsAt(transaction.state);
    return decoration;
  },

  provide: (field) => EditorView.decorations.from(field),
});
