import { FORMATS, formatShortcutLabel, type FormatId } from "../lib/richFormat";

/** Props for {@link FormatToolbar}. */
export type FormatToolbarProps = {
  activeFormats: ReadonlySet<FormatId>;
  onToggle: (id: FormatId) => void;
};

/**
 * Renders the Markdown formatting buttons.
 *
 * Pointer presses on a button are cancelled so the editor keeps focus.
 *
 * @param props - The armed styles and a toggle handler.
 * @returns The rendered toolbar.
 */
export function FormatToolbar({ activeFormats, onToggle }: FormatToolbarProps) {
  return (
    <div className="format-toolbar">
      {FORMATS.map((format) => {
        const active = activeFormats.has(format.id);
        return (
          <button
            key={format.id}
            type="button"
            className={`format-button glyph-${format.id}${active ? " active" : ""}`}
            title={`${format.label} (${formatShortcutLabel(format.id)})`}
            aria-label={format.label}
            aria-pressed={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onToggle(format.id)}
          >
            {format.glyph}
          </button>
        );
      })}
    </div>
  );
}
