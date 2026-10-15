import { useEffect, useState } from "react";
import {
  closeWindow,
  minimiseWindow,
  toggleMaximiseWindow,
  watchWindowResize,
  windowIsMaximised,
} from "../lib/windowControls";

/** The Material glyphs the three controls are drawn with. */
const GLYPHS = {
  minimise: "M19 13H5v-2h14v2z",
  maximise:
    "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  restore:
    "M3 5H1v16c0 1.1.9 2 2 2h16v-2H3V5zm18-4H7c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 16H7V3h14v14z",
  close:
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
} as const;

/** Props for {@link MarkGlyph}. */
type GlyphProps = {
  /** Which glyph to draw. */
  path: string;
};

/**
 * Draws one window-control glyph.
 *
 * @param props - The glyph's path data.
 * @returns The rendered glyph.
 */
function MarkGlyph({ path }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Renders the window's own minimise, maximise and close controls.
 *
 * The window carries no decorations of its own — the bar above the transcript
 * is the application's, which is what lets it wear the colour that tells one
 * instance from another — so the three controls every window is expected to
 * have are drawn here. Dragging and double-clicking the bar are Tauri's, asked
 * for by the bar's own `data-tauri-drag-region`; nothing about them is done
 * here.
 *
 * The middle control says what pressing it does rather than what the window is:
 * a maximised window offers to restore itself, which is read from the window
 * rather than remembered, because the bar can also be double-clicked.
 *
 * @returns The rendered controls.
 */
export function WindowControls() {
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    let live = true;
    const read = (): void => {
      void windowIsMaximised().then((isMaximised) => {
        if (live) setMaximised(isMaximised);
      });
    };

    read();
    const stop = watchWindowResize(read);
    return () => {
      live = false;
      stop();
    };
  }, []);

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control"
        aria-label="Minimise"
        title="Minimise"
        onClick={() => void minimiseWindow()}
      >
        <MarkGlyph path={GLYPHS.minimise} />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximised ? "Restore" : "Maximise"}
        title={maximised ? "Restore" : "Maximise"}
        onClick={() => void toggleMaximiseWindow()}
      >
        <MarkGlyph path={maximised ? GLYPHS.restore : GLYPHS.maximise} />
      </button>
      <button
        type="button"
        className="window-control close"
        aria-label="Close"
        title="Close"
        onClick={() => void closeWindow()}
      >
        <MarkGlyph path={GLYPHS.close} />
      </button>
    </div>
  );
}
