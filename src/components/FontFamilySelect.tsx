import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useHoverIntent } from "../hooks/useHoverIntent";
import {
  availableFontFamilies,
  availableUiFontGroups,
  BUILT_IN_FONT_LABEL,
  BUILT_IN_FONT_VALUE,
  BUILT_IN_UI_FONT_LABEL,
  type FontFamilyGroup,
  monoFontStack,
  uiFontStack,
} from "../lib/fonts";

/** Which set of families a picker offers. */
export type FontFamilyKind = "code" | "app";

/** One list a picker may draw from. */
type FontSource = {
  groups: () => FontFamilyGroup[];
  /** What the picker calls its built-in stack. */
  builtIn: string;
  /** The stack a family is drawn in, which is how a row previews itself. */
  stack: (family: string) => string;
};

/** The sources a picker may draw from. */
const SOURCES: Record<FontFamilyKind, FontSource> = {
  code: {
    groups: () => [{ label: "", families: availableFontFamilies() }],
    builtIn: BUILT_IN_FONT_LABEL,
    stack: monoFontStack,
  },
  app: {
    groups: availableUiFontGroups,
    builtIn: BUILT_IN_UI_FONT_LABEL,
    stack: uiFontStack,
  },
};

/** One selectable row, and where it sits in the whole list. */
type FontRow = { value: string; label: string; index: number };

/**
 * One section of the list, with the rows it holds.
 *
 * Sections are identified by where they sit rather than by what they are
 * called. The head section and an unlabelled group are both called nothing —
 * the code list is one unlabelled group under an unlabelled head — and two
 * sections sharing a name is not two sections being the same one.
 */
type FontSection = { label: string; rows: FontRow[] };

/** Props for {@link FontFamilySelect}. */
export type FontFamilySelectProps = {
  /** Which list to offer: the code families, or everything the app may use. */
  kind: FontFamilyKind;
  /** What the family applies to, used as the control's accessible name. */
  label: string;
  /** The chosen family, or an empty string for the built-in stack. */
  value: string;
  onChange: (value: string) => void;
};

/**
 * Builds the sections the list shows, numbering the rows as it goes.
 *
 * A family that has been chosen but is no longer installed is put beside the
 * built-in stack, so opening the settings never looks as though the choice was
 * lost — and it is numbered with everything else, because it can be chosen
 * again.
 *
 * @param groups - The sections of installed families.
 * @param builtIn - What the built-in stack is called.
 * @param value - The family in force.
 * @returns The sections to render.
 */
function buildSections(
  groups: readonly FontFamilyGroup[],
  builtIn: string,
  value: string,
): FontSection[] {
  const offered = new Set(groups.flatMap((group) => group.families));
  const head: Omit<FontRow, "index">[] = [{ value: BUILT_IN_FONT_VALUE, label: builtIn }];
  if (value.length > 0 && !offered.has(value)) head.push({ value, label: value });

  let next = 0;
  return [
    { label: "", rows: head },
    ...groups.map((group) => ({
      label: group.label,
      rows: group.families.map((family) => ({ value: family, label: family })),
    })),
  ].map((section) => ({
    label: section.label,
    rows: section.rows.map((row) => ({ ...row, index: next++ })),
  }));
}

/**
 * Renders a font family picker that previews each family in itself.
 *
 * The list is drawn by the application rather than by the browser, because a
 * native `select` will not reliably draw an option in the font that option
 * names — which is the whole point of a font picker — and because how the arrow
 * keys behave inside its popup differs between platforms. Here the arrow keys
 * move through the list and the family changes as they go, whether or not the
 * list is open, so the settings can be cycled through with the keyboard alone.
 * Hovering a row chooses it for the same reason: everything in the list is a
 * preview rather than a proposal.
 *
 * @param props - Which list to offer, the family in force, and a change handler.
 * @returns The rendered control.
 */
export function FontFamilySelect({ kind, label, value, onChange }: FontFamilySelectProps) {
  const { groups: source, builtIn, stack } = SOURCES[kind];
  const groups = useMemo(() => source(), [source]);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const hover = useHoverIntent<string>(onChange);

  const sections = useMemo(() => buildSections(groups, builtIn, value), [groups, builtIn, value]);
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const active = Math.max(
    0,
    rows.findIndex((row) => row.value === value),
  );

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelectorAll(".font-option")[active];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  /**
   * Moves through the list and takes whatever it lands on.
   *
   * @param delta - -1 for the row above, 1 for the row below.
   */
  const step = (delta: number): void => {
    const next = Math.min(rows.length - 1, Math.max(0, active + delta));
    const row = rows[next];
    if (row) onChange(row.value);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      step(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      step(-1);
    }
  };

  return (
    <div className="setting">
      <span className="setting-label">{label}</span>
      <div className="font-picker" ref={rootRef}>
        <button
          type="button"
          className={open ? "font-trigger open" : "font-trigger"}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          style={{ fontFamily: stack(value) }}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={onKeyDown}
        >
          <span className="font-trigger-label">{value.length === 0 ? builtIn : value}</span>
          <span className="font-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {open && (
          <div className="font-list" role="listbox" id={listId} aria-label={label} ref={listRef}>
            {sections.map((section, position) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the sections come from one fixed list per picker and never reorder — only the rows inside them change — and two of them are allowed to be called nothing, so position is the only identity they have.
              <div className="font-section" key={position}>
                {section.label.length > 0 && (
                  <div className="font-section-title">{section.label}</div>
                )}
                {section.rows.map((row) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the trigger keeps the keyboard and moves the highlight with the arrow keys, which is what aria-activedescendant is for — an option is never focused, so a key handler on one could never run.
                  <div
                    key={row.value}
                    id={`${listId}-${row.index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={row.value === value}
                    className={row.value === value ? "font-option active" : "font-option"}
                    style={{ fontFamily: stack(row.value) }}
                    onMouseMove={hover(row.value)}
                    onClick={() => {
                      onChange(row.value);
                      setOpen(false);
                    }}
                  >
                    {row.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
