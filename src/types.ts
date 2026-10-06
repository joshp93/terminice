/** Events emitted by a Claude session in the Rust backend. */
export type ClaudeEvent =
  | { kind: "line"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "exit"; code: number | null };

/** One item in the chat transcript. */
export type ChatEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string }
  | { id: string; role: "tool"; name: string; detail: string }
  | { id: string; role: "notice"; text: string }
  | { id: string; role: "error"; text: string };

/** Everything the chat pane renders for one Claude session. */
export type ChatState = {
  entries: ChatEntry[];
  streaming: string;
  sessionId: string | null;
  model: string | null;
  busy: boolean;
  costUsd: number | null;
  /** Tokens currently occupying the context window. */
  contextUsed: number | null;
  /** Size of that window, as reported by the CLI. */
  contextWindow: number | null;
};

/** Creates an empty chat state. */
export function createChatState(): ChatState {
  return {
    entries: [],
    streaming: "",
    sessionId: null,
    model: null,
    busy: false,
    costUsd: null,
    contextUsed: null,
    contextWindow: null,
  };
}

/** What a bare Enter key does in the composer. */
export type EnterBehaviour = "send" | "newline";

/** Colour scheme for the whole application. */
export type ThemeName = "dark" | "light";

/** Settings persisted to `~/.config/terminice-settings.json`. */
export type Settings = {
  enterBehaviour: EnterBehaviour;
  theme: ThemeName;
};

/** Creates the settings used when no file exists yet. */
export function createDefaultSettings(): Settings {
  return { enterBehaviour: "send", theme: "dark" };
}
