import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { MONO_FONT_STACK } from "./fonts";

/** Which palette the terminal is drawn with. */
export type TerminalThemeName = "dark" | "light";

const DARK_THEME: ITheme = {
  background: "#131519",
  foreground: "#d6dae1",
  cursor: "#7dd3a0",
  cursorAccent: "#131519",
  selectionBackground: "#2c3440",
  black: "#1b1e24",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#c8ccd4",
  brightBlack: "#5c6370",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#e5c07b",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
};

const LIGHT_THEME: ITheme = {
  background: "#fcfcfd",
  foreground: "#2b2f36",
  cursor: "#1f7a4d",
  cursorAccent: "#fcfcfd",
  selectionBackground: "#cfe0f5",
  black: "#24292f",
  red: "#c0392b",
  green: "#1f7a4d",
  yellow: "#8a6100",
  blue: "#1f6feb",
  magenta: "#7a45c9",
  cyan: "#0f7382",
  white: "#d8dbe0",
  brightBlack: "#57606a",
  brightRed: "#cf222e",
  brightGreen: "#116329",
  brightYellow: "#7d4e00",
  brightBlue: "#0969da",
  brightMagenta: "#6639ba",
  brightCyan: "#0a6b78",
  brightWhite: "#ffffff",
};

const THEMES: Record<TerminalThemeName, ITheme> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
};

/** A terminal view and the operations the UI needs from it. */
export type TerminalHandle = {
  terminal: Terminal;
  fit: () => void;
  write: (data: string) => void;
  setTheme: (theme: TerminalThemeName) => void;
  onInput: (handler: (data: string) => void) => void;
  onResize: (handler: (cols: number, rows: number) => void) => void;
  dispose: () => void;
};

/**
 * Creates a terminal view attached to `container`.
 *
 * Uses xterm's default DOM renderer. The WebGL renderer measured within
 * run-to-run variance of it and can paint nothing at all in some webviews.
 *
 * @param container - Element the terminal should fill.
 * @param theme - The initial palette.
 * @returns A handle exposing the terminal and its lifecycle operations.
 */
export function createTerminal(
  container: HTMLElement,
  theme: TerminalThemeName,
): TerminalHandle {
  const terminal = new Terminal({
    fontFamily: MONO_FONT_STACK,
    fontSize: 13,
    lineHeight: 1.25,
    letterSpacing: 0,
    cursorBlink: true,
    scrollback: 10_000,
    allowProposedApi: true,
    theme: THEMES[theme],
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);

  const fit = (): void => {
    try {
      fitAddon.fit();
    } catch {
      // A container being laid out has no measurable size yet; the next fit recovers.
    }
  };

  return {
    terminal,
    fit,
    write: (data) => terminal.write(data),
    setTheme: (next) => {
      terminal.options.theme = THEMES[next];
    },
    onInput: (handler) => void terminal.onData(handler),
    onResize: (handler) => void terminal.onResize(({ cols, rows }) => handler(cols, rows)),
    dispose: () => terminal.dispose(),
  };
}
