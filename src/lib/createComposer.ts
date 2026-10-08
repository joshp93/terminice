import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  ensureSyntaxTree,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { EditorState, Prec, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { pairNeedsTrim, planAutoPair } from "./autoPair";
import {
  INDENT_UNIT,
  type LineEdit,
  type ListEnterPlan,
  type ListKind,
  parseListLine,
  planIndent,
  planListBackspace,
  planListEnter,
  planListToggle,
  planOutdent,
  readListMarker,
  renumberOrderedLines,
} from "./listMarkers";
import {
  codeBlockText,
  findCodeBlock,
  findStyleNode,
  hasStyleMarkers,
  type StyleState,
  spanOf,
  spansCover,
  stripMarkers,
  styleAppliesAt,
  styleNodesInRange,
  styleStateInRange,
} from "./markdownSpans";
import { parseQuoteLine, planQuoteEnter, planQuoteToggle } from "./quoteMarkers";
import {
  createInlineState,
  disarmFormat,
  FORMAT_MARKERS,
  FORMATS,
  type FormatId,
  type InlineState,
  MARKER_CHARACTERS,
  planTypedCharacter,
  toggleArmedFormat,
  wrapOffsets,
} from "./richFormat";
import { findUrls, urlAt } from "./urls";

/** Everything the toolbar needs to render the composer's current state. */
export type ComposerStatus = {
  /** How each inline style applies at the caret or across the selection. */
  formats: ReadonlyMap<FormatId, StyleState>;
  /** The list kind of the caret's line, if any. */
  listKind: ListKind | null;
  /** Whether the caret's line carries a quote. */
  quoted: boolean;
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
  /** Replaces part of the contents, leaving the caret after what was inserted. */
  replaceRange: (from: number, to: number, text: string) => void;
  clear: () => void;
  insertText: (text: string) => void;
  /** True when the caret is at the very start, with nothing selected. */
  caretAtStart: () => boolean;
  /** True when the caret is at the very end, with nothing selected. */
  caretAtEnd: () => boolean;
  toggleFormat: (id: FormatId) => void;
  toggleList: (kind: ListKind) => void;
  toggleQuote: () => void;
  toggleCodeBlock: () => void;
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
  /** Opens a URL the reader has clicked, when they hold Ctrl or Cmd. */
  onOpenUrl: (url: string) => void;
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

/**
 * Marks every bare URL so it reads as a link while it is being written.
 *
 * The address is found in the text itself rather than in the Markdown tree, so
 * a URL is recognised the moment it is pasted without having to be wrapped in
 * link syntax first.
 *
 * @param view - The editor to inspect.
 * @returns A decoration over each URL in the document.
 */
function urlDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const match of findUrls(view.state.doc.toString())) {
    ranges.push(
      Decoration.mark({
        class: "cm-url",
        attributes: { title: "Ctrl+click to open in your browser" },
      }).range(match.from, match.to),
    );
  }
  return Decoration.set(ranges);
}

const urlMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = urlDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = urlDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "inherit",
    // Read from the document rather than fixed here, so the composer font size
    // setting applies without rebuilding the editor.
    fontSize: "var(--composer-font-size)",
  },
  ".cm-content": {
    // Read from the document rather than fixed here, so a change to the code
    // font applies without rebuilding the editor.
    fontFamily: "var(--font-mono)",
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
      // An armed style shows as on because the mode is on, even though nothing
      // has been written yet.
      if (state === "off" && inline.armed.has(format.id)) state = "on";
      formats.set(format.id, state);
    }

    const line = view.state.doc.lineAt(range.head);
    options.onStatusChange({
      formats,
      listKind: readListMarker(line.text)?.kind ?? null,
      quoted: parseQuoteLine(line.text) !== null,
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

  /**
   * Ends a style at the caret, by moving its closing markers there.
   *
   * The markers move rather than the caret, so the text between the caret and
   * where the style used to end stops carrying it, instead of the reader being
   * pulled out to where the style happens to end.
   *
   * Two things are refused, because moving the markers would change what the
   * Markdown *means* rather than what it covers. A style cannot be made to end
   * inside another style that closes before it — the italic of
   * `***Hello** world*` cannot end before its bold, because the bold is inside
   * it — and the markers cannot be put anywhere they would not close, which is
   * against another marker or against nothing at all.
   *
   * @param view - The editor.
   * @param tree - The document's syntax tree.
   * @param id - The style to end.
   * @param caret - The position the style should end at.
   * @returns True when the markers moved, or were already there.
   */
  const endStyleAtCaret = (view: EditorView, tree: Tree, id: FormatId, caret: number): boolean => {
    const enclosing = findStyleNode(tree.resolveInner(caret, -1), id, caret, caret);
    const span = enclosing ? spanOf(enclosing) : null;
    if (!span) return false;

    const doc = view.state.doc;
    const markers = doc.sliceString(span.closeFrom, span.closeTo);
    if (markers.length === 0) return false;

    // Already ending here, so there is nothing to move: the caret steps out.
    if (caret === span.closeFrom) {
      view.dispatch({ selection: { anchor: span.closeTo } });
      return true;
    }

    if (hasStyleMarkers(tree, caret, span.closeFrom)) return false;

    const before = caret > 0 ? doc.sliceString(caret - 1, caret) : "";
    if (before.length === 0 || /\s/.test(before) || MARKER_CHARACTERS.includes(before)) {
      return false;
    }

    view.dispatch({
      changes: [
        { from: span.closeFrom, to: span.closeTo, insert: "" },
        { from: caret, insert: markers },
      ],
      selection: { anchor: caret + markers.length },
    });
    return true;
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
      replaceRange(
        view,
        from,
        to,
        insert,
        from + markers.length,
        from + markers.length + inner.length,
      );
      return;
    }

    const caret = range.from;

    // Inside a block of this style, the button says where the style should end:
    // the closing markers come to the caret, and everything after it stops
    // carrying the style. The caret is the fixed point, not the markers — with
    // `***Hello** world*` and the caret after the `He`, turning bold off leaves
    // `***He**llo world*`, rather than pulling the caret out to the old end and
    // leaving the `llo world` bold.
    if (styleAppliesAt(tree, id, caret)) {
      if (endStyleAtCaret(view, tree, id, caret)) {
        inline = disarmFormat(id, inline);
        report(view);
      }
      return;
    }

    inline = toggleArmedFormat(id, inline);
    report(view);
  };

  const toggleList = (view: EditorView, kind: ListKind): void => {
    const cursor = view.state.selection.main.head;
    applyLineEdit(view, planListToggle(view.state.doc.lineAt(cursor).text, kind), cursor);
    renumberAround(view, cursor);
    report(view);
  };

  const toggleQuote = (view: EditorView): void => {
    const cursor = view.state.selection.main.head;
    applyLineEdit(view, planQuoteToggle(view.state.doc.lineAt(cursor).text), cursor);
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

  /**
   * Applies what Enter decided to do.
   *
   * @param view - The editor.
   * @param plan - What to write, and how much of the line's start to clear.
   * @param cursor - Where the caret is.
   */
  const applyEnterPlan = (view: EditorView, plan: ListEnterPlan, cursor: number): void => {
    const line = view.state.doc.lineAt(cursor);
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
  };

  /**
   * What Enter does on the caret's line.
   *
   * A list carries on whatever the send setting says, because a list is a thing
   * being written rather than a keypress to be honoured. A quote carries on only
   * when Enter is not the key that sends: with Enter set to send, Enter sends
   * and Shift+Enter is what carries the quote to the next line.
   */
  const handleEnter = (view: EditorView): boolean => {
    const cursor = view.state.selection.main.head;
    const line = view.state.doc.lineAt(cursor);

    const list = planListEnter(line.text);
    if (list) {
      applyEnterPlan(view, list, cursor);
      return true;
    }

    if (options.submitsOnEnter()) {
      options.onSubmit();
      return true;
    }

    const quote = planQuoteEnter(line.text);
    if (!quote) return false;
    applyEnterPlan(view, quote, cursor);
    return true;
  };

  /**
   * Carries a quote on to the next line without sending anything.
   *
   * @param view - The editor.
   * @returns True when the line was quoted and the quote continues.
   */
  const handleShiftEnter = (view: EditorView): boolean => {
    const cursor = view.state.selection.main.head;
    const quote = planQuoteEnter(view.state.doc.lineAt(cursor).text);
    if (!quote) return false;
    applyEnterPlan(view, quote, cursor);
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
      { key: "Shift-Enter", run: (view) => handleShiftEnter(view) },
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
        replaceRange(view, from, to, formatPlan.insert, from + formatPlan.caretOffset);
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

  const openLink = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      if (!event.ctrlKey && !event.metaKey) return false;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const url = position === null ? null : urlAt(view.state.doc.toString(), position);
      if (url === null) return false;
      event.preventDefault();
      options.onOpenUrl(url);
      return true;
    },
  });

  const trackStatus = EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet) return;
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
        urlMarks,
        openLink,
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
    replaceRange: (from, to, text) => {
      replaceRange(view, from, to, text, from + text.length);
      view.focus();
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
    toggleQuote: () => toggleQuote(view),
    toggleCodeBlock: () => toggleCodeBlock(view),
    destroy: () => view.destroy(),
  };
}

function lineEditForPlainLine(line: string, outdent: boolean): LineEdit {
  if (!outdent) return { offset: 0, remove: 0, insert: INDENT_UNIT };
  const match = /^\s+/.exec(line);
  if (!match) return { offset: 0, remove: 0, insert: "" };
  return { offset: 0, remove: Math.min(INDENT_UNIT.length, match[0].length), insert: "" };
}
