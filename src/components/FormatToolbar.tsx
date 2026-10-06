import { FORMATS, formatShortcutLabel, isFormatActive, type FormatId } from "../lib/richFormat";
import type { ComposerStatus } from "../lib/createComposer";
import type { ListKind } from "../lib/listMarkers";

/** Props for {@link FormatToolbar}. */
export type FormatToolbarProps = {
  status: ComposerStatus;
  onToggleFormat: (id: FormatId) => void;
  onToggleList: (kind: ListKind) => void;
};

const LISTS: readonly { kind: ListKind; label: string; glyph: string }[] = [
  { kind: "bullet", label: "Bulleted list", glyph: "•" },
  { kind: "ordered", label: "Numbered list", glyph: "1." },
];

/**
 * Renders the Markdown formatting and list buttons.
 *
 * Pointer presses are cancelled so the editor keeps focus.
 *
 * @param props - The composer status and the two toggle handlers.
 * @returns The rendered toolbar.
 */
export function FormatToolbar({ status, onToggleFormat, onToggleList }: FormatToolbarProps) {
  return (
    <div className="format-toolbar">
      {FORMATS.map((format) => {
        const active = isFormatActive(status.inline, format.id);
        return (
          <button
            key={format.id}
            type="button"
            className={`format-button glyph-${format.id}${active ? " active" : ""}`}
            title={`${format.label} (${formatShortcutLabel(format.id)})`}
            aria-label={format.label}
            aria-pressed={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onToggleFormat(format.id)}
          >
            {format.glyph}
          </button>
        );
      })}
      <span className="format-divider" aria-hidden="true" />
      {LISTS.map((list) => {
        const active = status.listKind === list.kind;
        return (
          <button
            key={list.kind}
            type="button"
            className={active ? "format-button active" : "format-button"}
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
    </div>
  );
}
