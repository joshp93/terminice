import { Fragment, useEffect, useRef } from "react";
import { shortcutGroups } from "../lib/shortcuts";

/** Props for {@link ShortcutsDialog}. */
export type ShortcutsDialogProps = {
  /** Closes the dialog, from the button, the backdrop or Escape. */
  onClose: () => void;
};

/**
 * Lists every shortcut the application answers to.
 *
 * It is a modal rather than a panel because the list is long enough to need
 * scrolling and to be read, and reading it while the composer still held the
 * keyboard would mean the keys it describes were live under the reader's hands.
 * The keys are grouped by where they work, so a shortcut found here can be
 * trusted where it is used.
 *
 * The close is on a document listener rather than on the backdrop element,
 * which is the same arrangement the settings panel uses: a click handler on a
 * decorative div is the sort of thing the linter is right to complain about.
 *
 * @param props - What to do when the dialog is dismissed.
 * @returns The rendered dialog.
 */
export function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    panel?.focus();

    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (panel && !panel.contains(event.target as Node)) onClose();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = panel ? Array.from(panel.querySelectorAll<HTMLElement>("button")) : [];
      if (controls.length === 0) return;
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      controls[(current + step + controls.length) % controls.length]?.focus();
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  return (
    <div className="shortcuts-backdrop">
      <div
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="shortcuts-head">
          <h2 className="shortcuts-title" id="shortcuts-title">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            className="shortcuts-close"
            aria-label="Close shortcuts"
            title="Close (Esc)"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="shortcuts-groups">
          {shortcutGroups().map((group) => (
            <section className="shortcuts-group" key={group.title}>
              <h3 className="shortcuts-group-title">{group.title}</h3>
              <dl className="shortcuts-list">
                {group.shortcuts.map((shortcut) => (
                  <Fragment key={`${shortcut.keys} ${shortcut.description}`}>
                    <dt className="shortcuts-keys">{shortcut.keys}</dt>
                    <dd className="shortcuts-what">{shortcut.description}</dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
