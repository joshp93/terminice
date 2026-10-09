import type {
  ContextUsage,
  FastModeState,
  InitializePayload,
  McpServerInfo,
  PluginInfo,
} from "./lib/controlProtocol";
import { DEFAULT_CHAT_FONT_SIZE, DEFAULT_COMPOSER_FONT_SIZE } from "./lib/fontSize";
import { BUILT_IN_FONT_VALUE } from "./lib/fonts";
import type { HookNote } from "./lib/toolResults";

/** Events emitted by a Claude session in the Rust backend. */
export type ClaudeEvent =
  | { kind: "line"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "exit"; code: number | null };

/** Events emitted by the microphone and the speech engine. */
export type VoiceEvent =
  /** How loud the recording is right now, from 0 to 1. */
  | { kind: "level"; level: number }
  /** What was said, once the utterance has been transcribed. */
  | { kind: "transcript"; text: string }
  /** How much of the speech model has arrived. */
  | { kind: "modelProgress"; received: number; total: number }
  /** The model is on disk and can be loaded. */
  | { kind: "modelReady" }
  /** Something went wrong, in words worth showing the reader. */
  | { kind: "error"; message: string };

/** What the backend knows about the speech model. */
export type VoiceStatus = {
  /** The file the model is expected at, whether or not it is there. */
  modelPath: string;
  /** True once a complete model has been downloaded. */
  modelPresent: boolean;
  /** How large it is, or zero when it is not there. */
  modelBytes: number;
};

/** One item in the chat transcript. */
export type ChatEntry =
  | {
      id: string;
      role: "user";
      text: string;
      /** True while the CLI has not yet picked this message up. */
      queued?: boolean;
    }
  | { id: string; role: "assistant"; text: string }
  | { id: string; role: "thinking"; text: string }
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
      role: "subagent";
      /** The id pairing this agent with the call that spawned it. */
      toolUseId: string;
      /** The agent's description, as the spawning call gave it. */
      label: string;
      /** The spawning call's full input, shown when the card is opened. */
      input: string;
      /** The agent's closing report. */
      result: string;
      status: "running" | "ok" | "error";
      /** What the agent said and did, in the order it happened. */
      entries: ChatEntry[];
    }
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
  /** The session's working directory, which moves when Claude changes it. */
  cwd: string | null;
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
  /** Reasoning tokens spent so far on the running turn. */
  thinkingTokens: number;
  /** The CLI's predicted next prompt, when it offers one. */
  suggestion: string | null;
  /** Whether fast mode is serving, paused after a rate limit, or off. */
  fastMode: FastModeState;
  /** Why fast mode is not serving, when the CLI gives a reason. */
  fastModeReason: string | null;
};

/**
 * Creates an empty chat state.
 *
 * @returns A chat state with no entries and nothing known about a session.
 */
export function createChatState(): ChatState {
  return {
    entries: [],
    streaming: "",
    sessionId: null,
    cwd: null,
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
    thinkingTokens: 0,
    suggestion: null,
    fastMode: "off",
    fastModeReason: null,
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
  /** Size of the text in the composer, in CSS pixels. */
  composerFontSize: number;
  /** Size of the text in the transcript, in CSS pixels. */
  chatFontSize: number;
  /**
   * The family the composer and every tool and code output is drawn in, or an
   * empty string for the built-in monospace stack.
   */
  fontFamily: string;
  /**
   * The family everything else is drawn in — replies, labels and the rest of
   * the interface — or an empty string for the built-in proportional stack.
   */
  appFontFamily: string;
  /**
   * Whether holding the space bar starts dictating.
   *
   * Off by default: it changes what the space bar does, and a setting that
   * quietly eats a keystroke is worse than one that has to be found.
   */
  voiceEnabled: boolean;
};

/**
 * Creates the settings used when no file exists yet.
 *
 * @returns The default settings: Enter sends, the theme is dark, both font
 *   sizes are the ones the application was designed around, and the built-in
 *   monospace stack is used.
 */
export function createDefaultSettings(): Settings {
  return {
    enterBehaviour: "send",
    theme: "dark",
    composerFontSize: DEFAULT_COMPOSER_FONT_SIZE,
    chatFontSize: DEFAULT_CHAT_FONT_SIZE,
    fontFamily: BUILT_IN_FONT_VALUE,
    appFontFamily: BUILT_IN_FONT_VALUE,
    voiceEnabled: false,
  };
}
