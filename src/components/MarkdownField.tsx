import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { codeTint, editorTheme, urlMarks } from "../lib/createComposer";

/** What a {@link MarkdownField} exposes to the card that owns it. */
export type MarkdownFieldHandle = {
  /** Puts the keyboard in the field. */
  focus: () => void;
  /** Takes the keyboard out of the field. */
  blur: () => void;
};

/** Props for {@link MarkdownField}. */
export type MarkdownFieldProps = {
  /**
   * The text the field starts with.
   *
   * The editor owns its text after that, so a caller that needs to replace it
   * remounts the field — which is what the card's subject-keyed boxes do.
   */
  initialValue: string;
  /** Called with the whole text after every edit. */
  onChange: (value: string) => void;
  /** The hint shown while the field is empty. */
  placeholder: string;
  /** What the field is for, which names it for assistive technology. */
  label: string;
  /** Which box this is, so the card's key handler can tell them apart. */
  field: "custom" | "notes";
};

/**
 * A small Markdown-aware text box.
 *
 * It uses the composer's own language, highlighting and code tint, so what is
 * written in an answer reads the same as what is written in the composer —
 * without the composer's toolbar, menus or send behaviour.
 */
export const MarkdownField = forwardRef<MarkdownFieldHandle, MarkdownFieldProps>(
  function MarkdownField({ initialValue, onChange, placeholder: hint, label, field }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // biome-ignore lint/correctness/useExhaustiveDependencies: the editor is built once from the text the field was mounted with; the card changes that by remounting it under a new key.
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: initialValue,
          extensions: [
            history(),
            markdown(),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": label }),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            placeholder(hint),
            urlMarks,
            codeTint,
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              onChangeRef.current(update.state.doc.toString());
            }),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            editorTheme,
          ],
        }),
      });

      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => viewRef.current?.focus(),
        blur: () => viewRef.current?.contentDOM.blur(),
      }),
      [],
    );

    return <div className="dialog-notes-input" data-dialog-field={field} ref={hostRef} />;
  },
);
