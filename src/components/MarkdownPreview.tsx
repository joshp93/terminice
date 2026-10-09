import type { Ref } from "react";
import { MessageBubble } from "./MessageBubble";

/** Props for {@link MarkdownPreview}. */
export type MarkdownPreviewProps = {
  /** The Markdown being written, exactly as it would be sent. */
  text: string;
  /**
   * How tall the composer was, in pixels, so the preview stands in its place
   * rather than moving the window under the reader.
   */
  minHeight: number;
  /** The box itself, which the composer takes the keyboard to as it opens. */
  ref?: Ref<HTMLDivElement>;
  /** Puts the preview away, which Escape does from inside it. */
  onEscape: () => void;
};

/**
 * Renders what the composer holds as it will be rendered once it is sent.
 *
 * The same {@link MessageBubble} the transcript uses is what draws it, so what
 * is on screen here is the message itself rather than a second opinion about
 * it. It is a place to read, not to type: the box takes no keyboard input and
 * the way back is the button that opened it, or Escape.
 *
 * @param props - The Markdown to render and the height to stand at.
 * @returns The rendered preview.
 */
export function MarkdownPreview({ text, minHeight, ref, onEscape }: MarkdownPreviewProps) {
  return (
    <section
      className="composer-preview"
      style={minHeight > 0 ? { minHeight: `${minHeight}px` } : undefined}
      aria-label="Message preview"
      tabIndex={-1}
      ref={ref}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}
    >
      {text.trim().length === 0 ? (
        <p className="preview-empty">There is nothing to preview yet.</p>
      ) : (
        <MessageBubble text={text} preserveLineBreaks />
      )}
    </section>
  );
}
