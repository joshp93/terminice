import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { characterWidth } from "../lib/characterWidth";
import { fitsSideBySide, splitLineWidth } from "../lib/splitDiff";

/** What the card has to work with: how wide it is, and how wide a character is. */
type Measured = {
  width: number;
  character: number;
};

const NOTHING_MEASURED: Measured = { width: 0, character: 0 };

/**
 * Whether a patch should be drawn as two columns in this card.
 *
 * Measured from the card rather than from the window: what a diff gets is the
 * width the card ended up with, inside a pane that gives way to a dialog, a
 * larger font or a narrower window. Every patch is measured on its own, so one
 * of long lines can fall back to a single column while the next, of short ones,
 * still gets two.
 *
 * The measurement is taken again whenever the card is resized — a pointer
 * dragging the window edge re-renders nothing — and after every render as well,
 * because turning the chat font size up changes how much room the same lines
 * need without changing how wide the card is.
 *
 * @param lines - The lines of the patch.
 * @param enabled - Whether the reader wants two columns at all.
 * @returns The ref to put on the container, and whether to draw two columns.
 */
export function useSideBySideDiff(
  lines: readonly string[],
  enabled: boolean,
): { ref: RefObject<HTMLDivElement | null>; split: boolean } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<Measured>(NOTHING_MEASURED);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const next: Measured = {
      width: element.getBoundingClientRect().width,
      character: characterWidth(element),
    };
    // Handing back the state it already has when nothing moved keeps a drag on
    // the window edge from re-rendering on every pixel of it.
    setMeasured((current) =>
      current.width === next.width && current.character === next.character ? current : next,
    );
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(measure);

  const longest = splitLineWidth(lines);
  const split =
    enabled &&
    longest !== null &&
    fitsSideBySide({
      available: measured.width,
      longest,
      characterWidth: measured.character,
    });

  return { ref, split };
}
