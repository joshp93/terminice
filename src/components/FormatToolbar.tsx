import type { ComposerStatus } from "../lib/createComposer";
import type { ListKind } from "../lib/listMarkers";
import type { StyleState } from "../lib/markdownSpans";
import { FORMATS, type FormatId, formatShortcutLabel, quoteShortcutLabel } from "../lib/richFormat";

/** Props for {@link FormatToolbar}. */
export type FormatToolbarProps = {
  status: ComposerStatus;
  onToggleFormat: (id: FormatId) => void;
  onToggleList: (kind: ListKind) => void;
  onToggleQuote: () => void;
  onToggleCodeBlock: () => void;
  /** Whether the composer is showing the preview instead of the editor. */
  previewing: boolean;
  onTogglePreview: () => void;
};

const LISTS: readonly { kind: ListKind; label: string; glyph: string }[] = [
  { kind: "bullet", label: "Bulleted list", glyph: "•" },
  { kind: "ordered", label: "Numbered list", glyph: "1." },
];

function stateClass(state: StyleState): string {
  return state === "off" ? "" : ` ${state}`;
}

/**
 * Renders the Markdown formatting, code and list buttons.
 *
 * A button shows a third, indeterminate appearance when only part of the
 * selection carries its style. Pointer presses are cancelled so the editor
 * keeps focus.
 *
 * The preview sits apart from the rest, at the far end of the row: everything
 * else changes the text, and this changes what is being looked at.
 *
 * @param props - The composer status and the toggle handlers.
 * @returns The rendered toolbar.
 */
export function FormatToolbar({
  status,
  onToggleFormat,
  onToggleList,
  onToggleQuote,
  onToggleCodeBlock,
  previewing,
  onTogglePreview,
}: FormatToolbarProps) {
  return (
    <div className="format-toolbar">
      {FORMATS.map((format) => {
        const state = status.formats.get(format.id) ?? "off";
        return (
          <button
            key={format.id}
            type="button"
            className={`format-button glyph-${format.id}${stateClass(state)}`}
            title={`${format.label} (${formatShortcutLabel(format.id)})`}
            aria-label={format.label}
            aria-pressed={state === "on"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onToggleFormat(format.id)}
          >
            {format.glyph}
          </button>
        );
      })}
      <button
        type="button"
        className={`format-button${status.inCodeBlock ? " on" : ""}`}
        title="Code block"
        aria-label="Code block"
        aria-pressed={status.inCodeBlock}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleCodeBlock}
      >
        {"{ }"}
      </button>
      <span className="format-divider" aria-hidden="true" />
      {LISTS.map((list) => {
        const active = status.listKind === list.kind;
        return (
          <button
            key={list.kind}
            type="button"
            className={active ? "format-button on" : "format-button"}
            title={list.label}
            aria-label={list.label}
            aria-pressed={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onToggleList(list.kind)}
          >
            {list.glyph}
          </button>
        );
      })}
      <button
        type="button"
        className={status.quoted ? "format-button on" : "format-button"}
        title={`Quote (${quoteShortcutLabel()})`}
        aria-label="Quote"
        aria-pressed={status.quoted}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleQuote}
      >
        {">"}
      </button>
      <button
        type="button"
        className={previewing ? "format-button preview-toggle on" : "format-button preview-toggle"}
        title={previewing ? "Return to editing (Esc)" : "Preview the message as Markdown"}
        aria-pressed={previewing}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onTogglePreview}
      >
        {previewing ? "Edit" : "Preview markdown"}
      </button>
    </div>
  );
}
