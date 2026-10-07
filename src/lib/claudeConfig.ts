/**
 * The settings `/config` accepts.
 *
 * The key names and their legal values are exactly what `/config` prints when
 * run with no arguments, so the menu never offers a value the CLI would reject.
 */

import type { FastModeState } from "./controlProtocol";

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
 * Words are separated at case boundaries and at underscores or dashes, and the
 * first character of the result is capitalised. Capitals inside the key are
 * left alone, so a camel-cased key keeps the leading capital of each word.
 *
 * @param key - A setting name such as `autoCompact`.
 * @returns A spaced label such as `Auto Compact`.
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

/** The permission modes the CLI accepts, in the order it lists them. */
export const PERMISSION_MODES = ["default", "plan", "acceptEdits", "auto", "dontAsk"] as const;

/** Why fast mode is not serving, in the words the CLI's reason codes mean. */
const FAST_MODE_REASONS: Record<string, string> = {
  free: "it is not included in this plan",
  preference: "it is turned off for this organization",
  extra_usage_disabled: "extra usage is disabled",
  network_error: "of a network error",
  not_first_party: "this is not a first-party connection",
  disabled_by_env: "an environment variable disables it",
  model_not_allowed: "this model does not support it",
  sdk_opt_in_required: "the session has not opted in",
  pending: "the organization's status is pending",
  unknown: "for a reason the CLI did not name",
};

/**
 * Describes fast mode for a tooltip.
 *
 * Fast mode is two states in one field: it is either serving, or switched on
 * but paused after a rate limit. Both are worth showing; being off is not, so
 * the reason only matters once it is on.
 *
 * @param state - What the CLI last reported.
 * @param reason - The CLI's reason code for it not serving, when it gave one.
 * @returns A sentence to show on hover.
 */
export function describeFastMode(state: FastModeState, reason: string | null): string {
  if (state === "on") return "Fast mode is on";
  if (state === "cooldown") return "Fast mode is on, paused after a rate limit";
  if (reason === null) return "Fast mode is off";
  return `Fast mode is off because ${FAST_MODE_REASONS[reason] ?? FAST_MODE_REASONS.unknown}.`;
}

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
