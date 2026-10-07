import type {
  ContextUsage,
  InitializePayload,
  McpServerInfo,
  PluginInfo,
} from "./lib/controlProtocol";
import type { HookNote } from "./lib/toolResults";

/** Events emitted by a Claude session in the Rust backend. */
export type ClaudeEvent =
  | { kind: "line"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "exit"; code: number | null };

/** One item in the chat transcript. */
export type ChatEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string }
  | {
      id: string;
      role: "tool";
      /** The id pairing this call with its result. */
      toolUseId: string;
      name: string;
      /** A one-line summary of the input. */
      detail: string;
      /** The full input, shown when the card is expanded. */
      input: string;
      /** The result, shown when the card is expanded. */
      result: string;
      status: "running" | "ok" | "error";
      /** Hooks that ran around this call, which may have changed what ran. */
      hooks: HookNote[];
    }
  | { id: string; role: "notice"; text: string }
  | { id: string; role: "error"; text: string }
  | {
      id: string;
      role: "shell";
      /** The command as typed, without its leading `!`. */
      command: string;
      stdout: string;
      stderr: string;
      code: number | null;
      /** True until the command has finished. */
      running: boolean;
    };

/** Everything the chat pane renders for one Claude session. */
export type ChatState = {
  entries: ChatEntry[];
  streaming: string;
  sessionId: string | null;
  model: string | null;
  busy: boolean;
  costUsd: number | null;
  /** The CLI's own context reading, refreshed after each turn. */
  contextUsage: ContextUsage | null;
  /** The command, model and agent catalogue from `initialize`. */
  catalogue: InitializePayload | null;
  mcpServers: McpServerInfo[];
  /** Installed plugins, as the CLI announces them at startup. */
  plugins: PluginInfo[];
  /** Loaded skill names. */
  skills: string[];
  permissionMode: string;
  /** True while the CLI is summarising the conversation. */
  compacting: boolean;
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
    contextUsage: null,
    catalogue: null,
    mcpServers: [],
    plugins: [],
    skills: [],
    permissionMode: "default",
    compacting: false,
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
