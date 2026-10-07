import { EditorState, Prec } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  ensureSyntaxTree,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { pairNeedsTrim, planAutoPair } from "./autoPair";
import { MONO_FONT_STACK } from "./fonts";
import {
  codeBlockText,
  findCodeBlock,
  findStyleNode,
  spanOf,
  spansCover,
  stripMarkers,
  styleAppliesAt,
  styleNodesInRange,
  styleStateInRange,
  type StyleState,
} from "./markdownSpans";
import {
  INDENT_UNIT,
  parseListLine,
  planIndent,
  planListBackspace,
  planListEnter,
  planListToggle,
  planOutdent,
  readListMarker,
  renumberOrderedLines,
  type LineEdit,
  type ListKind,
} from "./listMarkers";
import {
  FORMATS,
  FORMAT_MARKERS,
  closingMarkers,
  createInlineState,
  planToggle,
  planTypedCharacter,
  wrapOffsets,
  type FormatId,
  type InlineState,
} from "./richFormat";

/** Everything the toolbar needs to render the composer's current state. */
export type ComposerStatus = {
  /** How each inline style applies at the caret or across the selection. */
  formats: ReadonlyMap<FormatId, StyleState>;
  /** The list kind of the caret's line, if any. */
  listKind: ListKind | null;
  /** Whether the caret sits inside a code block. */
  inCodeBlock: boolean;
  /** The composer's current contents, which drives the slash menu. */
  text: string;
  /** The caret's offset, so the menu can tell whether it sits past the slash. */
  caret: number;
};

/** A composer view and the operations the UI needs from it. */
export type ComposerHandle = {
  focus: () => void;
  getText: () => string;
  /** Replaces the contents; the caret lands at the start unless told otherwise. */
  setText: (text: string, caretAtEnd?: boolean) => void;
  clear: () => void;
  insertText: (text: string) => void;
  /** True when the caret is at the very start, with nothing selected. */
  caretAtStart: () => boolean;
  /** True when the caret is at the very end, with nothing selected. */
  caretAtEnd: () => boolean;
  toggleFormat: (id: FormatId) => void;
  toggleList: (kind: ListKind) => void;
  toggleCodeBlock: () => void;
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
  /** Reports what the toolbar should show. */
  onStatusChange: (status: ComposerStatus) => void;
};

const FENCE = "```";

/** The character that turns the composer into a shell. */
const SHELL_PREFIX = "!";

/**
 * Marks the leading `!` so it can be spaced away from the command.
 *
 * @param view - The editor to inspect.
 * @returns A decoration over the prefix, or none when there is not one.
 */
function shellPrefixDecorations(view: EditorView): DecorationSet {
  if (!view.state.doc.toString().startsWith(SHELL_PREFIX)) return Decoration.none;
  return Decoration.set([Decoration.mark({ class: "cm-shell-prefix" }).range(0, 1)]);
}

const shellPrefix = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = shellPrefixDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = shellPrefixDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

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
 * Shifts a position past an edit that replaced one range with another.
 *
 * @param position - The position to map.
 * @param from - Start of the replaced range.
 * @param to - End of the replaced range.
 * @param insertLength - Length of the replacement.
 * @returns The position after the edit.
 */
function mapPosition(position: number, from: number, to: number, insertLength: number): number {
  if (position < from) return position;
  if (position >= to) return position + insertLength - (to - from);
  return from + insertLength;
}

/**
 * Creates a Markdown-aware composer.
 *
 * Enter sends when `submitsOnEnter` allows it and otherwise inserts a newline,
 * except inside a list item where it continues the list. Styling is driven by
 * the syntax tree, so the toolbar reflects the text at the caret or across the
 * selection rather than only a pending toggle.
 *
 * @param options - Container, placeholder, and the behaviour callbacks.
 * @returns A handle exposing the composer and its lifecycle operations.
 */
export function createComposer(options: ComposerOptions): ComposerHandle {
  let inline: InlineState = createInlineState();

  const treeAt = (view: EditorView) =>
    ensureSyntaxTree(view.state, view.state.doc.length, 200) ?? syntaxTree(view.state);

  const report = (view: EditorView): void => {
    const tree = treeAt(view);
    const range = view.state.selection.main;
    const formats = new Map<FormatId, StyleState>();

    for (const format of FORMATS) {
      let state: StyleState =
        range.from === range.to
          ? styleAppliesAt(tree, format.id, range.from)
            ? "on"
            : "off"
          : styleStateInRange(tree, format.id, range.from, range.to);
      if (state === "off" && (inline.armed.has(format.id) || inline.open.has(format.id))) {
        state = "on";
      }
      formats.set(format.id, state);
    }

    const line = view.state.doc.lineAt(range.head);
    options.onStatusChange({
      formats,
      listKind: readListMarker(line.text)?.kind ?? null,
      inCodeBlock: findCodeBlock(tree.resolveInner(range.head, -1)) !== null,
      text: view.state.doc.toString(),
      caret: range.head,
    });
  };

  const replaceRange = (
    view: EditorView,
    from: number,
    to: number,
    insert: string,
    anchor: number,
    head?: number,
  ): void => {
    view.dispatch({
      changes: { from, to, insert },
      selection: head === undefined ? { anchor } : { anchor, head },
    });
    report(view);
  };

  const removeMarks = (
    view: EditorView,
    nodes: readonly SyntaxNode[],
    from: number,
    to: number,
  ): void => {
    const deletions: { from: number; to: number }[] = [];
    for (const node of nodes) {
      const span = spanOf(node);
      if (!span) continue;
      deletions.push({ from: span.openFrom, to: span.openTo });
      deletions.push({ from: span.closeFrom, to: span.closeTo });
    }
    if (deletions.length === 0) return;

    deletions.sort((a, b) => a.from - b.from);
    const shiftBefore = (position: number): number =>
      deletions.reduce(
        (total, deletion) =>
          deletion.to <= position ? total + (deletion.to - deletion.from) : total,
        0,
      );

    view.dispatch({
      changes: deletions.map((deletion) => ({ ...deletion, insert: "" })),
      selection: { anchor: from - shiftBefore(from), head: to - shiftBefore(to) },
    });
  };

  const applyLineEdit = (view: EditorView, edit: LineEdit, cursor: number): void => {
    const line = view.state.doc.lineAt(cursor);
    const from = line.from + edit.offset;
    const to = Math.min(from + edit.remove, line.to);
    view.dispatch({
      changes: { from, to, insert: edit.insert },
      selection: { anchor: mapPosition(cursor, from, to, edit.insert.length) },
    });
    report(view);
  };

  const renumberAround = (view: EditorView, position: number): void => {
    const doc = view.state.doc;
    const lineNumber = doc.lineAt(position).number;

    let start = lineNumber;
    while (start > 1 && parseListLine(doc.line(start - 1).text)) start -= 1;
    let end = lineNumber;
    while (end < doc.lines && parseListLine(doc.line(end + 1).text)) end += 1;

    const texts: string[] = [];
    for (let number = start; number <= end; number += 1) texts.push(doc.line(number).text);
    const renumbered = renumberOrderedLines(texts);
    if (!renumbered) return;

    const changes: { from: number; to: number; insert: string }[] = [];
    for (let number = start; number <= end; number += 1) {
      const line = doc.line(number);
      const next = renumbered[number - start];
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    }
    if (changes.length > 0) view.dispatch({ changes });
  };

  const toggleFormat = (view: EditorView, id: FormatId): void => {
    const range = view.state.selection.main;
    const tree = treeAt(view);

    if (range.from !== range.to) {
      const offsets = wrapOffsets(view.state.sliceDoc(range.from, range.to));
      if (!offsets) {
        report(view);
        return;
      }
      const from = range.from + offsets.start;
      const to = range.from + offsets.end;

      const nodes = styleNodesInRange(tree, id, from, to);
      if (nodes.length > 0 && spansCover(nodes, from, to)) {
        removeMarks(view, nodes, from, to);
        report(view);
        return;
      }

      const markers = FORMAT_MARKERS[id];
      const inner = stripMarkers(nodes, from, to, view.state.sliceDoc(from, to));
      const insert = markers + inner + markers;
      replaceRange(view, from, to, insert, from + markers.length, from + markers.length + inner.length);
      return;
    }

    const caret = range.from;
    const stored = inline.armed.has(id) || inline.open.has(id);

    if (stored) {
      const plan = planToggle(id, inline);
      inline = plan.state;
      if (plan.kind === "close") {
        replaceRange(view, caret, caret, plan.insert, caret + plan.insert.length);
        return;
      }
      report(view);
      return;
    }

    if (styleAppliesAt(tree, id, caret)) {
      const enclosing = findStyleNode(tree.resolveInner(caret, -1), id, caret, caret);
      if (enclosing) {
        removeMarks(view, [enclosing], caret, caret);
        report(view);
        return;
      }
    }

    inline = planToggle(id, inline).state;
    report(view);
  };

  const toggleList = (view: EditorView, kind: ListKind): void => {
    const cursor = view.state.selection.main.head;
    applyLineEdit(view, planListToggle(view.state.doc.lineAt(cursor).text, kind), cursor);
    renumberAround(view, cursor);
    report(view);
  };

  const toggleCodeBlock = (view: EditorView): void => {
    const range = view.state.selection.main;
    const enclosing = findCodeBlock(treeAt(view).resolveInner(range.head, -1));

    if (enclosing) {
      const content = codeBlockText(enclosing);
      if (!content) {
        view.dispatch({ changes: { from: enclosing.from, to: enclosing.to, insert: "" } });
      } else {
        view.dispatch({
          changes: [
            { from: enclosing.from, to: content.from, insert: "" },
            { from: content.to, to: enclosing.to, insert: "" },
          ],
          selection: { anchor: range.head - (content.from - enclosing.from) },
        });
      }
      report(view);
      return;
    }

    const first = view.state.doc.lineAt(range.from);
    const last = view.state.doc.lineAt(range.to);
    const body = view.state.sliceDoc(first.from, last.to);
    replaceRange(
      view,
      first.from,
      last.to,
      `${FENCE}\n${body}\n${FENCE}`,
      range.from + FENCE.length + 1,
      range.to + FENCE.length + 1,
    );
  };

  const closeOpenFormats = (view: EditorView): void => {
    const closing = closingMarkers(inline);
    if (closing.length === 0) return;
    const at = view.state.selection.main.head;
    replaceRange(view, at, at, closing, at + closing.length);
    inline = createInlineState();
  };

  const handleEnter = (view: EditorView): boolean => {
    const cursor = view.state.selection.main.head;
    const line = view.state.doc.lineAt(cursor);

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
      renumberAround(view, view.state.selection.main.head);
      report(view);
      return true;
    }

    if (!options.submitsOnEnter()) return false;
    options.onSubmit();
    return true;
  };

  const handleTab = (view: EditorView, outdent: boolean): boolean => {
    const cursor = view.state.selection.main.head;
    const line = view.state.doc.lineAt(cursor);
    const edit = outdent ? planOutdent(line.text) : planIndent(line.text);
    applyLineEdit(view, edit ?? lineEditForPlainLine(line.text, outdent), cursor);
    return true;
  };

  const handleBackspace = (view: EditorView): boolean => {
    const range = view.state.selection.main;
    if (range.from !== range.to) return false;

    const cursor = range.head;
    const line = view.state.doc.lineAt(cursor);
    const parsed = parseListLine(line.text);
    if (!parsed) return false;

    const markerEnd = line.from + parsed.indent.length + parsed.marker.length + parsed.gap.length;
    if (cursor > markerEnd) return false;

    const edit = planListBackspace(line.text);
    if (!edit) return false;
    applyLineEdit(view, edit, cursor);
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
      { key: "Tab", run: (view) => handleTab(view, false) },
      { key: "Shift-Tab", run: (view) => handleTab(view, true) },
      { key: "Mod-[", run: (view) => handleTab(view, true) },
      { key: "Mod-]", run: (view) => handleTab(view, false) },
      { key: "Backspace", run: (view) => handleBackspace(view) },
      ...(
        [
          ["Mod-b", "bold"],
          ["Mod-i", "italic"],
          ["Mod-e", "code"],
          ["Mod-Shift-x", "strike"],
        ] as const
      ).map(([key, id]) => ({
        key,
        run: (view: EditorView) => {
          toggleFormat(view, id);
          return true;
        },
      })),
    ]),
  );

  const surroundSelection = (view: EditorView, open: string, close: string): boolean => {
    const range = view.state.selection.main;
    const selected = view.state.sliceDoc(range.from, range.to);
    const offsets = pairNeedsTrim(open)
      ? wrapOffsets(selected)
      : { start: 0, end: selected.length };
    if (!offsets) return false;

    const from = range.from + offsets.start;
    const to = range.from + offsets.end;
    const insert = open + view.state.sliceDoc(from, to) + close;
    replaceRange(view, from, to, insert, from + insert.length);
    return true;
  };

  const handleTypedCharacter = EditorView.inputHandler.of((view, from, to, text) => {
    if (text.length !== 1) return false;
    const hasSelection = from !== to;

    if (!hasSelection) {
      const formatPlan = planTypedCharacter(text, inline);
      if (formatPlan) {
        inline = formatPlan.state;
        replaceRange(view, from, to, formatPlan.insert, from + formatPlan.insert.length);
        return true;
      }
    }

    const pairPlan = planAutoPair({
      char: text,
      hasSelection,
      before: from > 0 ? view.state.sliceDoc(from - 1, from) : "",
      after: to < view.state.doc.length ? view.state.sliceDoc(to, to + 1) : "",
    });
    if (!pairPlan) return false;

    if (pairPlan.kind === "surround") {
      return surroundSelection(view, pairPlan.open, pairPlan.close);
    }

    if (pairPlan.kind === "skip") {
      view.dispatch({ selection: { anchor: from + pairPlan.caretOffset } });
      report(view);
      return true;
    }

    replaceRange(view, from, to, pairPlan.text, from + pairPlan.caretOffset);
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
        EditorView.contentAttributes.of({ spellcheck: "true" }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        placeholder(options.placeholder),
        shortcuts,
        handleTypedCharacter,
        trackStatus,
        shellPrefix,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        editorTheme,
      ],
    }),
  });

  report(view);

  return {
    focus: () => view.focus(),
    getText: () => view.state.doc.toString(),
    setText: (text, caretAtEnd = false) => {
      inline = createInlineState();
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: caretAtEnd ? text.length : 0 },
      });
      view.focus();
    },
    clear: () => {
      inline = createInlineState();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    },
    insertText: (text) => {
      const range = view.state.selection.main;
      replaceRange(view, range.from, range.to, text, range.from + text.length);
      view.focus();
    },
    caretAtStart: () => {
      const range = view.state.selection.main;
      return range.from === range.to && range.from === 0;
    },
    caretAtEnd: () => {
      const range = view.state.selection.main;
      return range.from === range.to && range.to === view.state.doc.length;
    },
    toggleFormat: (id) => toggleFormat(view, id),
    toggleList: (kind) => toggleList(view, kind),
    toggleCodeBlock: () => toggleCodeBlock(view),
    closeOpenFormats: () => closeOpenFormats(view),
    destroy: () => view.destroy(),
  };
}

function lineEditForPlainLine(line: string, outdent: boolean): LineEdit {
  if (!outdent) return { offset: 0, remove: 0, insert: INDENT_UNIT };
  const match = /^\s+/.exec(line);
  if (!match) return { offset: 0, remove: 0, insert: "" };
  return { offset: 0, remove: Math.min(INDENT_UNIT.length, match[0].length), insert: "" };
}
