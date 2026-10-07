/**
 * The settings `/config` accepts.
 *
 * The key names and their legal values are exactly what `/config` prints when
 * run with no arguments, so the menu never offers a value the CLI would reject.
 */

/** One setting `/config` accepts. */
export type ClaudeConfigKey = {
  key: string;
  /** A readable form of the key, for display. */
  label: string;
  /** The accepted values, or empty when the setting takes free text. */
  values: string[];
  /** True when the only choices are `true` and `false`. */
  boolean: boolean;
};

const RAW_VALUES: Record<string, string[]> = {
  autoCompact: ["true", "false"],
  autoConnectIde: ["true", "false"],
  autoScroll: ["true", "false"],
  checkpoints: ["true", "false"],
  copyFullResponse: ["true", "false"],
  copyOnSelect: ["true", "false"],
  defaultToAgentsView: ["true", "false"],
  editor: ["normal", "vim"],
  externalEditorContext: ["true", "false"],
  gitignore: ["true", "false"],
  language: [],
  leftArrowOpensAgents: ["true", "false"],
  model: [
    "default",
    "sonnet",
    "opus",
    "haiku",
    "fable",
    "best",
    "sonnet[1m]",
    "opus[1m]",
    "fable[1m]",
    "opusplan",
  ],
  notifChannel: [
    "auto",
    "iterm2",
    "terminal_bell",
    "iterm2_with_bell",
    "kitty",
    "ghostty",
    "notifications_disabled",
  ],
  outputStyle: ["default", "Proactive", "Concise", "Explanatory", "Learning"],
  permissionMode: ["default", "plan", "acceptEdits", "auto", "dontAsk"],
  prStatus: ["true", "false"],
  progressBar: ["true", "false"],
  promptSuggestionEnabled: ["true", "false"],
  recap: ["true", "false"],
  reduceMotion: ["true", "false"],
  switchModelsOnFlag: ["Switch automatically", "Ask each time"],
  theme: [
    "auto",
    "dark",
    "light",
    "light-daltonized",
    "dark-daltonized",
    "light-ansi",
    "dark-ansi",
  ],
  thinking: ["true", "false"],
  timeFormat: ["auto", "12-hour", "24-hour", "24-hour-utc"],
  tips: ["true", "false"],
  turnDuration: ["true", "false"],
  useAutoModeDuringPlan: ["true", "false"],
  verbose: ["true", "false"],
  workflowKeywordTriggerEnabled: ["true", "false"],
  workflowSizeGuideline: ["unrestricted", "small", "medium", "large"],
  workflows: ["true", "false"],
  worktreeBaseRef: ["fresh", "head"],
};

/**
 * Turns a camel-cased key into a readable label.
 *
 * @param key - A setting name such as `autoCompact`.
 * @returns A spaced, sentence-cased label such as `Auto compact`.
 */
export function humaniseKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Every setting `/config` accepts. */
export const CLAUDE_CONFIG_KEYS: ClaudeConfigKey[] = Object.entries(RAW_VALUES).map(
  ([key, values]) => ({
    key,
    label: humaniseKey(key),
    values,
    boolean: values.length === 2 && values[0] === "true" && values[1] === "false",
  }),
);

/**
 * Finds a setting by name.
 *
 * @param key - The setting name.
 * @returns The setting, or undefined when the CLI does not define it.
 */
export function findConfigKey(key: string): ClaudeConfigKey | undefined {
  return CLAUDE_CONFIG_KEYS.find((entry) => entry.key === key);
}

/** The permission modes the CLI accepts, in the order it lists them. */
export const PERMISSION_MODES = ["default", "plan", "acceptEdits", "auto", "dontAsk"] as const;

/**
 * Describes a permission mode for display.
 *
 * @param mode - A mode name from {@link PERMISSION_MODES}.
 * @returns A readable label.
 */
export function describePermissionMode(mode: string): string {
  switch (mode) {
    case "default":
      return "Ask";
    case "plan":
      return "Plan";
    case "acceptEdits":
      return "Accept edits";
    case "auto":
      return "Auto";
    case "dontAsk":
      return "Don't ask";
    case "bypassPermissions":
      return "Bypass";
    default:
      return humaniseKey(mode);
  }
}
