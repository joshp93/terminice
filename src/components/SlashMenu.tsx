import { useLayoutEffect, useRef } from "react";
import { useHoverIntent } from "../hooks/useHoverIntent";
import type { MenuEntry } from "../lib/slashMenu";

/** Props for {@link SlashMenu}. */
export type SlashMenuProps = {
  /** The entries at the level being shown. */
  entries: MenuEntry[];
  /** Index of the highlighted entry. */
  highlight: number;
  /** The parent entry's label, when a submenu is open. */
  parentLabel: string | null;
  /** Whether the menu renders above its anchor rather than below. */
  placeAbove: boolean;
  onHighlight: (index: number) => void;
  onChoose: (entry: MenuEntry) => void;
};

/**
 * Renders the slash menu.
 *
 * @param props - The entries to show and the interaction callbacks.
 * @returns The rendered menu.
 */
export function SlashMenu({
  entries,
  highlight,
  parentLabel,
  placeAbove,
  onHighlight,
  onChoose,
}: SlashMenuProps) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const hover = useHoverIntent(onHighlight);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a rebuilt entry list scrolls its highlighted row back into view even when the index has not moved.
  useLayoutEffect(() => {
    const item = listRef.current?.children[highlight];
    if (item instanceof HTMLElement) item.scrollIntoView({ block: "nearest" });
  }, [highlight, entries]);

  return (
    <div className={placeAbove ? "slash-menu above" : "slash-menu below"} role="listbox">
      {parentLabel !== null && (
        <div className="slash-menu-header">
          <span className="slash-menu-parent">{parentLabel}</span>
          <span className="slash-menu-back">esc to go back</span>
        </div>
      )}
      <ul className="slash-menu-list" ref={listRef}>
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              role="option"
              aria-selected={index === highlight}
              className={index === highlight ? "slash-item active" : "slash-item"}
              onMouseMove={hover(index)}
              onClick={() => onChoose(entry)}
            >
              <span className="slash-label">
                {entry.label}
                {entry.selected && <span className="slash-current">current</span>}
              </span>
              {entry.detail.length > 0 && <span className="slash-detail">{entry.detail}</span>}
              {entry.hint.length > 0 && <span className="slash-hint">{entry.hint}</span>}
            </button>
          </li>
        ))}
        {entries.length === 0 && <li className="slash-empty">No matching command</li>}
      </ul>
    </div>
  );
}
