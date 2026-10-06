import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { MONO_FONT_STACK } from "./fonts";
import { planListEnter, planListToggle, readListMarker, type ListKind } from "./listMarkers";
import {
  FORMAT_MARKERS,
  closingMarkers,
  createInlineState,
  planToggle,
  planTypedCharacter,
  type FormatId,
  type InlineState,
} from "./richFormat";

/** Everything the toolbar needs to reflect the composer's current state. */
export type ComposerStatus = {
  inline: InlineState;
  listKind: ListKind | null;
};

/** A composer view and the operations the UI needs from it. */
export type ComposerHandle = {
  focus: () => void;
  getText: () => string;
  clear: () => void;
  toggleFormat: (id: FormatId) => void;
  toggleList: (kind: ListKind) => void;
  closeOpenFormats: () => void;
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
  /** Reports what the toolbar should show. */
  onStatusChange: (status: ComposerStatus) => void;
};

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: "13.5px",
  },
  ".cm-content": {
    fontFamily: MONO_FONT_STACK,
    padding: "10px 12px",
    caretColor: "var(--caret)",
  },
  ".cm-line": { padding: "0" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.55" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--caret)" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--selection)" },
  ".cm-placeholder": { color: "var(--text-dim)" },
});

/**
 * Creates a Markdown-aware composer.
 *
 * Enter sends when `submitsOnEnter` allows it and otherwise inserts a newline,
 * except inside a list item where it continues the list. Formatting is applied
 * by arming a style and then typing, by wrapping a selection, or by the list
 * controls, which act on the current line.
 *
 * @param options - Container, placeholder, and the behaviour callbacks.
 * @returns A handle exposing the composer and its lifecycle operations.
 */
export function createComposer(options: ComposerOptions): ComposerHandle {
  let inline: InlineState = createInlineState();

  const report = (view: EditorView): void => {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const marker = readListMarker(line.text);
    options.onStatusChange({ inline, listKind: marker?.kind ?? null });
  };

  const closeOpenFormats = (view: EditorView): void => {
    const closing = closingMarkers(inline);
    if (closing.length === 0) return;
    const at = view.state.selection.main.head;
    view.dispatch({
      changes: { from: at, insert: closing },
      selection: { anchor: at + closing.length },
    });
    inline = createInlineState();
  };

  const toggleFormat = (view: EditorView, id: FormatId): void => {
    const range = view.state.selection.main;

    if (range.from !== range.to) {
      const markers = FORMAT_MARKERS[id];
      const selected = view.state.sliceDoc(range.from, range.to);
      const insert = markers + selected + markers;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert },
        selection: { anchor: range.from + insert.length },
      });
      report(view);
      return;
    }

    const plan = planToggle(id, inline);
    inline = plan.state;
    if (plan.kind === "close") {
      view.dispatch({
        changes: { from: range.from, insert: plan.insert },
        selection: { anchor: range.from + plan.insert.length },
      });
    }
    report(view);
  };

  const toggleList = (view: EditorView, kind: ListKind): void => {
    const cursor = view.state.selection.main.head;
    const line = view.state.doc.lineAt(cursor);
    const plan = planListToggle(line.text, kind);
    const offset = cursor - line.from;
    view.dispatch({
      changes: { from: line.from, to: line.from + plan.remove, insert: plan.insert },
      selection: { anchor: line.from + Math.max(0, offset - plan.remove) + plan.insert.length },
    });
    report(view);
  };

  const handleEnter = (view: EditorView): boolean => {
    const cursor = view.state.selection.main.head;
    const line = view.state.doc.lineAt(cursor);

    if (options.isRichFormatting()) {
      const plan = planListEnter(line.text);
      if (plan) {
        if (plan.removeMarker > 0) {
          view.dispatch({
            changes: [
              { from: line.from, to: line.from + plan.removeMarker, insert: "" },
              { from: cursor, insert: plan.insert },
            ],
            selection: { anchor: cursor - plan.removeMarker + plan.insert.length },
          });
        } else {
          view.dispatch({
            changes: { from: cursor, insert: plan.insert },
            selection: { anchor: cursor + plan.insert.length },
          });
        }
        report(view);
        return true;
      }
    }

    if (!options.submitsOnEnter()) return false;
    options.onSubmit();
    return true;
  };

  const shortcuts = Prec.highest(
    keymap.of([
      { key: "Enter", run: (view) => handleEnter(view) },
      {
        key: "Mod-Enter",
        run: () => {
          options.onSubmit();
          return true;
        },
      },
      {
        key: "Mod-b",
        run: (view) => {
          if (!options.isRichFormatting()) return false;
          toggleFormat(view, "bold");
          return true;
        },
      },
      {
        key: "Mod-i",
        run: (view) => {
          if (!options.isRichFormatting()) return false;
          toggleFormat(view, "italic");
          return true;
        },
      },
      {
        key: "Mod-e",
        run: (view) => {
          if (!options.isRichFormatting()) return false;
          toggleFormat(view, "code");
          return true;
        },
      },
      {
        key: "Mod-Shift-x",
        run: (view) => {
          if (!options.isRichFormatting()) return false;
          toggleFormat(view, "strike");
          return true;
        },
      },
    ]),
  );

  const wrapTypedCharacters = EditorView.inputHandler.of((view, from, to, text) => {
    if (!options.isRichFormatting()) return false;
    if (from !== to || text.length !== 1) return false;
    const plan = planTypedCharacter(text, inline);
    if (!plan) return false;
    inline = plan.state;
    view.dispatch({
      changes: { from, to, insert: plan.insert },
      selection: { anchor: from + plan.insert.length },
      scrollIntoView: true,
    });
    report(view);
    return true;
  });

  const trackStatus = EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) report(update.view);
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
        wrapTypedCharacters,
        trackStatus,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        editorTheme,
      ],
    }),
  });

  report(view);

  return {
    focus: () => view.focus(),
    getText: () => view.state.doc.toString(),
    clear: () => {
      inline = createInlineState();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    },
    toggleFormat: (id) => toggleFormat(view, id),
    toggleList: (kind) => toggleList(view, kind),
    closeOpenFormats: () => closeOpenFormats(view),
    destroy: () => view.destroy(),
  };
}
