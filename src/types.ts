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
      /**
       * The uuid the message was sent to the CLI under.
       *
       * It is how the CLI names a message it is holding in its queue, so it is
       * what taking one back is addressed by. Absent on anything the app did not
       * send — a replayed message, or one the CLI raised itself.
       */
      messageUuid?: string;
    }
  | { id: string; role: "assistant"; text: string }
  | { id: string; role: "thinking"; text: string }
  | {
      id: string;
      role: "tool";
      /** The id pairing this call with its result. */
      toolUseId: string;
      name: string;
      /** The description the call gave itself, when it gave one. */
      description: string;
      /** A one-line summary of the input. */
      detail: string;
      /** The full input, shown when the card is expanded. */
      input: string;
      /** The result, shown when the card is expanded. */
      result: string;
      status: "running" | "ok" | "error";
      /** Hooks that ran around this call, which may have changed what ran. */
      hooks: HookNote[];
      /** How long the CLI last said the call had been running. */
      elapsedSeconds?: number;
    }
  | { id: string; role: "notice"; text: string }
  | {
      id: string;
      role: "summary";
      /** The summary a compaction wrote, in place of the messages it replaced. */
      text: string;
    }
  | { id: string; role: "error"; text: string }
  | {
      id: string;
      role: "subagent";
      /** The id pairing this agent with the call that spawned it. */
      toolUseId: string;
      /**
       * The id the CLI gave the agent itself, when it named one.
       *
       * A background agent is acknowledged with this alongside the call it was
       * started by, and it is the other name the agent's own frames can arrive
       * under — so a frame is filed against either.
       */
      agentId?: string;
      /** The agent's description, as the spawning call gave it. */
      label: string;
      /** The spawning call's full input, shown when the card is opened. */
      input: string;
      /** The agent's closing report. */
      result: string;
      status: "running" | "ok" | "error";
      /**
       * True when the agent was started to run in the background.
       *
       * Such an agent's call is answered as soon as it has been started, so
       * nothing about the call says whether the work is over — the CLI's own
       * task events do.
       */
      background?: boolean;
      /** What the task has spent, as the CLI last reported it. */
      usage?: TaskUsage;
      /** Where the task is up to, while it is still running. */
      progress?: TaskUsage;
      /** What the agent said and did, in the order it happened. */
      entries: ChatEntry[];
      /** How long the CLI last said the agent had been running. */
      elapsedSeconds?: number;
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
      /** True when the reader stopped it rather than letting it finish. */
      stopped?: boolean;
    };

/** Tokens the session has spent, by the kind that is priced differently. */
export type TokenUsage = {
  /** Tokens sent, which the prompt cache did not hold. */
  input: number;
  /** Tokens the model produced. */
  output: number;
  /** Tokens read back out of the prompt cache. */
  cacheRead: number;
  /** Tokens written into the prompt cache. */
  cacheWrite: number;
};

/** What a task an agent was started for has spent, as the CLI reports it. */
export type TaskUsage = {
  /** Tokens the task has used. */
  tokens: number;
  /** Calls it has made. */
  toolUses: number;
  /** How long it has been running, in milliseconds. */
  durationMs: number;
  /** The call it made last, while it is still running. */
  lastTool?: string;
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
  /** Tokens spent so far, counted from what each message reported. */
  tokens: TokenUsage;
  /**
   * True when the CLI has said it has no price for the model in use.
   *
   * It reports a cost anyway, and that figure is a fallback rather than a
   * price, so it is only worth showing when we cannot work one out ourselves.
   */
  costUnknown: boolean;
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
  /**
   * True when a compaction boundary has arrived and its summary has not.
   *
   * The live stream sends the summary as an ordinary user line with none of the
   * flags the transcript carries, so the boundary is what says the next one is
   * a summary rather than something the reader typed.
   */
  summaryPending: boolean;
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
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUnknown: false,
    contextUsage: null,
    catalogue: null,
    mcpServers: [],
    plugins: [],
    skills: [],
    permissionMode: "default",
    compacting: false,
    summaryPending: false,
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
  /**
   * Whether a tool's patch is drawn as two columns.
   *
   * Only ever used where there is room for two: a narrow card, or a patch of
   * lines too long to give a column to, is drawn as one column whatever this
   * says.
   */
  diffSideBySide: boolean;
  /**
   * Whether to ask a node version manager where node is, when it is not on
   * `PATH`.
   *
   * A Start-menu launch inherits Explorer's environment rather than a shell
   * profile, so node can be missing even though fnm or nvm is installed. This
   * does nothing on a machine where node is already on `PATH`, and can be
   * turned off for one that would rather it never looked.
   */
  nodeVersionManager: boolean;
  /**
   * What a million tokens sent to a model the CLI cannot price costs, in US
   * dollars, or zero when that is not known.
   *
   * A model served through a proxy has no published price, so the reader is the
   * only one who can say what it costs — and until they do, a session on such a
   * model is reported as unpriceable rather than being given a made-up number.
   */
  inputCostPerMillion: number;
  /** What a million tokens the model produced costs, or zero when unknown. */
  outputCostPerMillion: number;
  /** What a million tokens read from the cache costs, or zero when unknown. */
  cacheReadCostPerMillion: number;
  /** What a million tokens written to the cache costs, or zero when unknown. */
  cacheWriteCostPerMillion: number;
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
    diffSideBySide: true,
    nodeVersionManager: true,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    cacheReadCostPerMillion: 0,
    cacheWriteCostPerMillion: 0,
  };
}
