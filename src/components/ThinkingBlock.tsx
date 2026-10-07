import { useExpansion } from "./ExpansionContext";

/** Props for {@link ThinkingBlock}. */
export type ThinkingBlockProps = {
  /** The entry's id, which is how the pane tracks which blocks are open. */
  id: string;
  /** The reasoning Claude produced before replying. */
  text: string;
};

/**
 * Renders the reasoning behind a reply.
 *
 * Collapsed by default and showing only its opening line, because reasoning is
 * scaffolding rather than the answer. Opening it reveals all of it.
 *
 * @param props - The reasoning to render.
 * @returns The rendered block.
 */
export function ThinkingBlock({ id, text }: ThinkingBlockProps) {
  const { isOpen, toggle } = useExpansion();
  const open = isOpen(id);
  const preview = text.trim().split("\n")[0] ?? "";

  return (
    <div className={open ? "thinking-block open" : "thinking-block"}>
      <button
        type="button"
        className="thinking-summary"
        aria-expanded={open}
        onClick={() => toggle(id)}
      >
        <span className="thinking-label">Thought</span>
        {!open && preview.length > 0 && <span className="thinking-preview">{preview}</span>}
        <span className="thinking-disclosure">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="thinking-body">
          <pre>{text}</pre>
        </div>
      )}
    </div>
  );
}
