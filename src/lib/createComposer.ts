import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { MONO_FONT_STACK } from "./fonts";
import {
  createTypingState,
  formatMarkers,
  planClose,
  planInsertion,
  type FormatId,
  type TypingState,
} from "./richFormat";

/** A composer view and the operations the UI needs from it. */
export type ComposerHandle = {
  focus: () => void;
  getText: () => string;
  clear: () => void;
  setActiveFormats: (formats: readonly FormatId[]) => void;
  closeOpenWord: () => void;
  destroy: () => void;
};

/** Options accepted by {@link createComposer}. */
export type ComposerOptions = {
  parent: HTMLElement;
  placeholder: string;
  onSubmit: () => void;
  /** Whether a bare Enter sends. Evaluated on each keypress. */
  submitsOnEnter: () => boolean;
  /** Whether Markdown wrapping and shortcuts are available. */
  isRichFormatting: () => boolean;
  /** Called when a formatting shortcut is pressed. */
  onToggleFormat: (id: FormatId) => void;
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
  },
  ".cm-line": { padding: "0" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.55" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--selection)" },
  ".cm-placeholder": { color: "var(--text-dim)" },
});

/**
 * Creates a Markdown-aware composer.
 *
 * Enter sends when `submitsOnEnter` allows it and otherwise inserts a newline.
 * With rich formatting enabled, arming a style wraps each subsequently typed
 * word in that style's Markdown markers.
 *
 * @param options - Container, placeholder, and the behaviour callbacks.
 * @returns A handle exposing the composer and its lifecycle operations.
 */
export function createComposer(options: ComposerOptions): ComposerHandle {
  let typing: TypingState = createTypingState();
  let markers = "";

  const closeOpenWord = (view: EditorView): void => {
    const closing = planClose(typing);
    if (closing.length === 0) return;
    const at = view.state.selection.main.head;
    view.dispatch({
      changes: { from: at, insert: closing },
      selection: { anchor: at + closing.length },
    });
    typing = createTypingState();
  };

  const shortcuts = Prec.highest(
    keymap.of([
      {
        key: "Enter",
        run: () => {
          if (!options.submitsOnEnter()) return false;
          options.onSubmit();
          return true;
        },
      },
      {
        key: "Mod-Enter",
        run: () => {
          options.onSubmit();
          return true;
        },
      },
      {
        key: "Mod-b",
        run: () => {
          if (!options.isRichFormatting()) return false;
          options.onToggleFormat("bold");
          return true;
        },
      },
      {
        key: "Mod-i",
        run: () => {
          if (!options.isRichFormatting()) return false;
          options.onToggleFormat("italic");
          return true;
        },
      },
      {
        key: "Mod-e",
        run: () => {
          if (!options.isRichFormatting()) return false;
          options.onToggleFormat("code");
          return true;
        },
      },
      {
        key: "Mod-Shift-x",
        run: () => {
          if (!options.isRichFormatting()) return false;
          options.onToggleFormat("strike");
          return true;
        },
      },
    ]),
  );

  const wrapTypedWords = EditorView.inputHandler.of((view, from, to, text) => {
    if (!options.isRichFormatting()) return false;
    if (from !== to || text.length !== 1) return false;
    const plan = planInsertion(text, markers, typing);
    if (plan.insert === text && plan.state.openMarkers === typing.openMarkers) return false;
    typing = plan.state;
    view.dispatch({
      changes: { from, to, insert: plan.insert },
      selection: { anchor: from + plan.insert.length },
      scrollIntoView: true,
    });
    return true;
  });

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
        shortcuts,
        wrapTypedWords,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        theme,
      ],
    }),
  });

  return {
    focus: () => view.focus(),
    getText: () => view.state.doc.toString(),
    clear: () => {
      typing = createTypingState();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    },
    setActiveFormats: (formats) => {
      markers = formatMarkers(formats);
    },
    closeOpenWord: () => closeOpenWord(view),
    destroy: () => view.destroy(),
  };
}
