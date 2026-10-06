import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { MONO_FONT_STACK } from "./fonts";

/** A composer view and the operations the UI needs from it. */
export type ComposerHandle = {
  focus: () => void;
  getText: () => string;
  clear: () => void;
  destroy: () => void;
};

/** Options accepted by {@link createComposer}. */
export type ComposerOptions = {
  parent: HTMLElement;
  placeholder: string;
  onSubmit: () => void;
};

const theme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: "13.5px",
  },
  ".cm-content": {
    fontFamily: MONO_FONT_STACK,
    padding: "10px 12px",
    caretColor: "#7dd3a0",
  },
  ".cm-line": { padding: "0" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.55" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "#7dd3a0" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#2c3440" },
});

/**
 * Creates a Markdown-aware composer that emits on Enter.
 *
 * Shift+Enter inserts a newline; Enter runs `onSubmit`.
 *
 * @param options - Container, placeholder text, and the submit handler.
 * @returns A handle exposing the composer and its lifecycle operations.
 */
export function createComposer(options: ComposerOptions): ComposerHandle {
  const submitKeymap = Prec.highest(
    keymap.of([
      {
        key: "Enter",
        run: () => {
          options.onSubmit();
          return true;
        },
      },
    ]),
  );

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        history(),
        markdown(),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        placeholder(options.placeholder),
        submitKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        theme,
      ],
    }),
  });

  return {
    focus: () => view.focus(),
    getText: () => view.state.doc.toString(),
    clear: () =>
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } }),
    destroy: () => view.destroy(),
  };
}
