import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { MONO_FONT_STACK } from "./fonts";

const THEME: ITheme = {
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

const FONT_FAMILY = MONO_FONT_STACK;

/** A terminal view and the operations the UI needs from it. */
export type TerminalHandle = {
  terminal: Terminal;
  fit: () => void;
  write: (data: string) => void;
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
 * @returns A handle exposing the terminal and its lifecycle operations.
 */
export function createTerminal(container: HTMLElement): TerminalHandle {
  const terminal = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    lineHeight: 1.25,
    letterSpacing: 0,
    cursorBlink: true,
    scrollback: 10_000,
    allowProposedApi: true,
    theme: THEME,
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
    onInput: (handler) => void terminal.onData(handler),
    onResize: (handler) => void terminal.onResize(({ cols, rows }) => handler(cols, rows)),
    dispose: () => terminal.dispose(),
  };
}
