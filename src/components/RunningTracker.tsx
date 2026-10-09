import { useEffect, useRef, useState } from "react";
import type { RunningGroup, RunningKind } from "../lib/runningTools";

/** Props for {@link RunningTracker}. */
export type RunningTrackerProps = {
  /** What is running, grouped by kind, in the order they should be shown. */
  groups: RunningGroup[];
  /** Jumps the transcript to one of the entries listed. */
  onReveal: (id: string) => void;
};

/**
 * Lists what the session is waiting on, below the composer.
 *
 * One chip per kind of work, each carrying a mark that pulses for as long as
 * anything in it is still going, so a glance at the bottom of the window says
 * whether the agent is working without having to find the end of the
 * transcript.
 *
 * A kind with a single thing running has nothing to choose between, so its chip
 * goes straight to that entry. A kind with several opens a list to pick from,
 * and each row jumps to its entry the same way.
 *
 * @param props - The groups to show and what a jump is asked of.
 * @returns The rendered tracker, or nothing when the session is idle.
 */
export function RunningTracker({ groups, onReveal }: RunningTrackerProps) {
  const [openKind, setOpenKind] = useState<RunningKind | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const open = openKind === null ? null : (groups.find((group) => group.kind === openKind) ?? null);

  useEffect(() => {
    if (open === null) return;

    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpenKind(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpenKind(null);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  useEffect(() => {
    if (open === null) return;
    menuRef.current?.querySelector("button")?.focus();
  }, [open]);

  // A group that finishes its work, or drops to a single entry, has nothing
  // left to choose between, so the list it opened closes itself.
  useEffect(() => {
    if (openKind === null) return;
    const group = groups.find((entry) => entry.kind === openKind);
    if (!group || group.items.length < 2) setOpenKind(null);
  }, [groups, openKind]);

  if (groups.length === 0) return null;

  return (
    <div className="trackers" ref={rootRef}>
      {groups.map((group) => {
        const only = group.items.length === 1 ? group.items[0] : undefined;
        const expanded = openKind === group.kind;

        return (
          <div className="tracker" key={group.kind}>
            <button
              type="button"
              className={expanded ? "tracker-chip open" : "tracker-chip"}
              aria-haspopup={only ? undefined : "dialog"}
              aria-expanded={only ? undefined : expanded}
              onClick={() => {
                if (only) {
                  setOpenKind(null);
                  onReveal(only.id);
                  return;
                }
                setOpenKind(expanded ? null : group.kind);
              }}
            >
              <span className="tracker-dot" aria-hidden="true" />
              {group.label}
            </button>
            {expanded && !only && (
              <div className="tracker-menu" role="dialog" aria-label={group.label} ref={menuRef}>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="tracker-item"
                    title={item.label}
                    onClick={() => {
                      setOpenKind(null);
                      onReveal(item.id);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
