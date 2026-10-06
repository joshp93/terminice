import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  ensureSyntaxTree,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { MONO_FONT_STACK } from "./fonts";
import {
  findStyleNode,
  formatsAtPosition,
  planUnwrap,
  styleNodesInRange,
} from "./markdownSpans";
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

/** Everything the toolbar needs to render the composer's current state. */
export type ComposerStatus = {
  /** Styles that apply at the caret, from the text or from a pending toggle. */
  formats: ReadonlySet<FormatId>;
  /** The list kind of the caret's line, if any. */
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
 * except inside a list item where it continues the list. Formatting is driven
 * by the syntax tree, so the toolbar reflects the text at the caret as well as
 * any pending toggle.
 *
 * @param options - Container, placeholder, and the behaviour callbacks.
 * @returns A handle exposing the composer and its lifecycle operations.
 */
export function createComposer(options: ComposerOptions): ComposerHandle {
  let inline: InlineState = createInlineState();

  const treeAt = (view: EditorView) =>
    ensureSyntaxTree(view.state, view.state.doc.length, 200) ?? syntaxTree(view.state);

  const report = (view: EditorView): void => {
    const position = view.state.selection.main.head;
    const formats = formatsAtPosition(treeAt(view).resolveInner(position, -1));
    for (const id of inline.armed) formats.add(id);
    for (const id of inline.open) formats.add(id);
    const line = view.state.doc.lineAt(position);
    options.onStatusChange({
      formats,
      listKind: readListMarker(line.text)?.kind ?? null,
    });
  };

  const removeMarks = (
    view: EditorView,
    nodes: readonly SyntaxNode[],
    from: number,
    to: number,
  ): void => {
    const plan = planUnwrap(nodes, from, to);
    if (!plan) return;
    view.dispatch({
      changes: plan.deletions.map((deletion) => ({ ...deletion, insert: "" })),
      selection: { anchor: plan.anchor, head: plan.head },
    });
  };

  const toggleFormat = (view: EditorView, id: FormatId): void => {
    const range = view.state.selection.main;

    if (range.from !== range.to) {
      const nodes = styleNodesInRange(treeAt(view), id, range.from, range.to);
      if (nodes.length > 0) {
        removeMarks(view, nodes, range.from, range.to);
      } else {
        const markers = FORMAT_MARKERS[id];
        const selected = view.state.sliceDoc(range.from, range.to);
        const insert = markers + selected + markers;
        view.dispatch({
          changes: { from: range.from, to: range.to, insert },
          selection: { anchor: range.from + insert.length },
        });
      }
      report(view);
      return;
    }

    const caret = range.from;

    if (inline.armed.has(id) || inline.open.has(id)) {
      const plan = planToggle(id, inline);
      inline = plan.state;
      if (plan.kind === "close") {
        view.dispatch({
          changes: { from: caret, insert: plan.insert },
          selection: { anchor: caret + plan.insert.length },
        });
      }
      report(view);
      return;
    }

    const enclosing = findStyleNode(treeAt(view).resolveInner(caret, -1), id, caret, caret);
    if (enclosing) {
      removeMarks(view, [enclosing], caret, caret);
      report(view);
      return;
    }

    inline = planToggle(id, inline).state;
    report(view);
  };

  const toggleList = (view: EditorView, kind: ListKind): void => {
    const cursor = view.state.selection.main.head;
    const line = view.state.doc.lineAt(cursor);
    const plan = planListToggle(line.text, kind);
    const offset = cursor - line.from;
    view.dispatch({
      changes: { from: line.from, to: line.from + plan.remove, insert: plan.insert },
      selection: {
        anchor: line.from + Math.max(0, offset - plan.remove) + plan.insert.length,
      },
    });
    report(view);
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

  const trackStatus = EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet) return;

    const closing = closingMarkers(inline);
    if (update.docChanged && closing.length > 0) {
      const head = update.state.selection.main.head;
      const typed =
        head >= closing.length ? update.state.sliceDoc(head - closing.length, head) : "";
      if (typed === closing) {
        inline = { armed: inline.armed, open: new Set() };
      }
    }

    report(update.view);
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
