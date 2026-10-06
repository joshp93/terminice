/** Events emitted by a terminal session in the Rust backend. */
export type TerminalEvent =
  | { kind: "data"; data: string }
  | { kind: "exit"; code: number | null };

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
  };
}

/** Which destination the composer sends to. */
export type ComposerTarget = "terminal" | "claude";
