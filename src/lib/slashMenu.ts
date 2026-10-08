import { CLAUDE_CONFIG_KEYS, describePermissionMode, PERMISSION_MODES } from "./claudeConfig";
import type {
  AgentInfo,
  ContextUsage,
  InitializePayload,
  McpServerInfo,
  ModelInfo,
  PluginInfo,
  SlashCommandInfo,
} from "./controlProtocol";
import { rankByMatch } from "./fuzzyMatch";
import type { SessionSummary } from "./sessions";

/** One row in the slash menu, or in a submenu it opens. */
export type MenuEntry = {
  id: string;
  /** The primary text, already including a leading slash where one applies. */
  label: string;
  /** A second line: the CLI's description, or the current value. */
  detail: string;
  /** The CLI's argument hint, shown dimmed at the end of the row. */
  hint: string;
  /** Marks the active choice inside a submenu. */
  selected: boolean;
  /** Opens a submenu in place of the current one. */
  submenu?: () => MenuEntry[];
  /** Runs when the entry is chosen, unless it opens a submenu. */
  run?: () => void;
};

/** Everything the slash menu needs from the application. */
export type SlashMenuHost = {
  catalogue: InitializePayload | null;
  contextUsage: ContextUsage | null;
  mcpServers: McpServerInfo[];
  plugins: PluginInfo[];
  skills: string[];
  permissionMode: string;
  sessions: SessionSummary[];
  /** Sends a line to Claude as though it had been typed. */
  runCommand: (command: string) => void;
  /** Switches the permission mode over the control channel. */
  setPermissionMode: (mode: string) => void;
  /** Switches the model over the control channel. */
  setModel: (value: string) => void;
  /** The model in use, as the CLI reports it. */
  currentModel: string;
  /** Puts text in the composer without sending it. Defaults to sending. */
  fillComposer?: (text: string) => void;
  /** Opens terminice's own settings, which are separate from Claude's. */
  openTerminiceSettings: () => void;
  /** Starts a new session in this directory. */
  newSession: () => void;
  /** Resumes a past session by id. */
  resumeSession: (id: string) => void;
  /** Refreshes the resume list; called when its submenu opens. */
  refreshSessions: () => void;
  /** Refreshes MCP status; called when its submenu opens. */
  refreshMcp: () => void;
};

/**
 * Pulls the alternative values out of an argument hint.
 *
 * The CLI writes hints such as `[red|blue|green]` or `consent | revoke`, so the
 * values a command accepts can be read from its own catalogue entry rather than
 * being duplicated here.
 *
 * @param hint - A command's argument hint.
 * @returns The values, or an empty array when the hint offers no alternatives.
 */
export function valuesFromHint(hint: string): string[] {
  const words = (text: string): string[] =>
    text
      .split("|")
      .map((part) => part.trim())
      .filter((part) => /^[a-zA-Z][\w.-]*$/.test(part));

  const groups = hint.match(/[[<][^[\]<>]*[\]>]/g) ?? [];
  for (const group of groups) {
    const parts = words(group.slice(1, -1));
    if (parts.length >= 2) return parts;
  }

  const bare = words(hint);
  return bare.length >= 2 && bare.length === hint.split("|").length ? bare : [];
}

/**
 * Formats a transcript timestamp for the resume list.
 *
 * @param millis - Milliseconds since the epoch.
 * @returns A short local date and time.
 */
function formatSessionTime(millis: number): string {
  if (!millis) return "";
  const date = new Date(millis);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function entry(
  partial: Omit<MenuEntry, "detail" | "hint" | "selected"> & Partial<MenuEntry>,
): MenuEntry {
  return { detail: "", hint: "", selected: false, ...partial };
}

/**
 * Builds a submenu entry that sends one value from a fixed list.
 *
 * @param name - The command name, without its slash.
 * @param intro - A line explaining the choice.
 * @param values - The values the command accepts.
 * @param current - The value in force, marked in the list.
 * @param send - Sends a command line to Claude.
 * @returns The menu entry.
 */
function valueEntry(
  name: string,
  intro: string,
  values: string[],
  current: string,
  send: (command: string) => void,
): MenuEntry {
  return entry({
    id: `command:${name}`,
    label: `/${name}`,
    detail: intro,
    submenu: () =>
      values.map((value) =>
        entry({
          id: `command:${name}:${value}`,
          label: value,
          selected: value === current,
          run: () => send(`/${name} ${value}`),
        }),
      ),
  });
}

/**
 * Builds the `/model` submenu.
 *
 * @param models - The models the CLI offers.
 * @param current - The model in use, marked in the list.
 * @param choose - Switches the model over the control channel.
 * @returns The menu entry.
 */
function modelEntry(
  models: ModelInfo[],
  current: string,
  choose: (value: string) => void,
): MenuEntry {
  return entry({
    id: "command:model",
    label: "/model",
    detail: "Choose the model for this session",
    hint: current,
    submenu: () =>
      models.map((model) =>
        entry({
          id: `command:model:${model.value}`,
          label: model.displayName,
          detail: model.description,
          hint: model.value,
          selected: model.resolvedModel === current,
          run: () => choose(model.value),
        }),
      ),
  });
}

/**
 * Builds the `/effort` submenu from the levels the CLI advertises.
 *
 * @param models - The models the CLI offers.
 * @param send - Sends a command line to Claude.
 * @returns The menu entry.
 */
function effortEntry(models: ModelInfo[], send: (command: string) => void): MenuEntry {
  const levels = [...new Set(models.flatMap((model) => model.supportedEffortLevels))];
  return valueEntry("effort", "How hard the model should think", [...levels, "auto"], "", send);
}

/**
 * Builds the `/mcp` submenu.
 *
 * The CLI rejects `toggle_mcp_server`, so servers are listed with their state
 * and the actions offered are the ones `/mcp` itself accepts.
 *
 * @param servers - The servers and their statuses.
 * @param send - Sends a command line to Claude.
 * @param refresh - Re-reads the server list.
 * @returns The menu entry.
 */
function mcpEntry(
  servers: McpServerInfo[],
  send: (command: string) => void,
  refresh: () => void,
): MenuEntry {
  return entry({
    id: "command:mcp",
    label: "/mcp",
    detail: servers.length === 0 ? "No MCP servers configured" : `${servers.length} server(s)`,
    submenu: () => {
      refresh();
      const children: MenuEntry[] = servers.map((server) =>
        entry({
          id: `mcp:${server.name}`,
          label: server.name,
          detail: server.status,
        }),
      );
      return [
        ...children,
        entry({
          id: "mcp:reconnect",
          label: "Reconnect all",
          detail: "Ask every server to connect again",
          run: () => send("/mcp reconnect all"),
        }),
        entry({
          id: "mcp:enable",
          label: "Enable all",
          run: () => send("/mcp enable all"),
        }),
        entry({
          id: "mcp:disable",
          label: "Disable all",
          run: () => send("/mcp disable all"),
        }),
        entry({
          id: "mcp:note",
          label: "Servers cannot be toggled individually here",
          detail: "This CLI build has no control request for it; use /mcp in a terminal",
        }),
      ];
    },
  });
}

/**
 * Builds the `/config` submenu from the keys the CLI documents.
 *
 * Two of the keys have a control request of their own, and going through it is
 * what keeps the header in step — sending `/config model=…` as a message
 * changes the model without anything telling us it happened.
 *
 * @param send - Sends a command line to Claude.
 * @param host - The application actions, for the keys that bypass messaging.
 * @returns The menu entry.
 */
function configEntry(send: (command: string) => void, host: SlashMenuHost): MenuEntry {
  const direct: Record<string, (value: string) => void> = {
    model: host.setModel,
    permissionMode: host.setPermissionMode,
  };

  return entry({
    id: "command:config",
    label: "/config",
    detail: "Set a Claude Code setting",
    hint: "key=value",
    submenu: () =>
      CLAUDE_CONFIG_KEYS.map((config) =>
        entry({
          id: `config:${config.key}`,
          label: config.label,
          detail: config.key,
          hint: config.values.length === 0 ? "<value>" : config.values.slice(0, 3).join(" | "),
          submenu:
            config.values.length === 0
              ? undefined
              : () => {
                  const setDirectly = direct[config.key];
                  return config.values.map((value) =>
                    entry({
                      id: `config:${config.key}:${value}`,
                      label: value,
                      run: () => {
                        if (setDirectly) setDirectly(value);
                        else send(`/config ${config.key}=${value}`);
                      },
                    }),
                  );
                },
          run: config.values.length === 0 ? () => send(`/config ${config.key}=`) : undefined,
        }),
      ),
  });
}

/**
 * Builds the `/context` submenu from the CLI's own breakdown.
 *
 * @param usage - The usage breakdown, when it has been read.
 * @param send - Sends a command line to Claude.
 * @returns The menu entry.
 */
function contextEntry(usage: ContextUsage | null, send: (command: string) => void): MenuEntry {
  const summary = usage
    ? `${usage.percentage}% of ${usage.maxTokens.toLocaleString()} tokens`
    : "Read the breakdown";
  return entry({
    id: "command:context",
    label: "/context",
    detail: summary,
    submenu: () => {
      if (!usage) {
        return [
          entry({
            id: "context:none",
            label: "No reading yet",
            detail: "Send a message, then open this again",
          }),
        ];
      }
      return [
        entry({
          id: "context:total",
          label: `${usage.percentage}% used`,
          detail: `${usage.totalTokens.toLocaleString()} of ${usage.maxTokens.toLocaleString()} tokens`,
        }),
        ...usage.categories.map((category) =>
          entry({
            id: `context:${category.name}`,
            label: category.name,
            detail: category.kind,
            hint: `${category.tokens.toLocaleString()} tokens`,
          }),
        ),
        entry({
          id: "context:compact",
          label: "Compact now",
          detail: "Free up context",
          run: () => send("/compact"),
        }),
      ];
    },
  });
}

/**
 * Builds the `/resume` submenu.
 *
 * `/resume` is not one of the CLI's commands; terminice restarts the session
 * against a chosen transcript instead.
 *
 * @param sessions - The past sessions for this directory.
 * @param resume - Resumes a session by id.
 * @param refresh - Re-reads the session list.
 * @returns The menu entry.
 */
function resumeEntry(
  sessions: SessionSummary[],
  resume: (id: string) => void,
  refresh: () => void,
): MenuEntry {
  return entry({
    id: "terminice:resume",
    label: "/resume",
    detail: "Reopen a past session in this directory",
    submenu: () => {
      refresh();
      if (sessions.length === 0) {
        return [
          entry({
            id: "resume:none",
            label: "No past sessions here",
            detail: "Sessions are read from ~/.claude/projects",
          }),
        ];
      }
      return sessions.map((session) =>
        entry({
          id: `resume:${session.id}`,
          label: session.preview || session.id.slice(0, 8),
          detail: session.live
            ? "Still running — reopening restores any waiting prompt"
            : formatSessionTime(session.modified),
          hint: session.live ? "live" : session.id.slice(0, 8),
          selected: false,
          run: () => resume(session.id),
        }),
      );
    },
  });
}

/**
 * Builds the entries that need more than the CLI's own description.
 *
 * @param host - The application actions and live data.
 * @returns Entries keyed by command name.
 */
function buildCurated(host: SlashMenuHost): Map<string, MenuEntry> {
  const catalogue = host.catalogue;
  const send = host.runCommand;
  const curated = new Map<string, MenuEntry>();

  curated.set("model", modelEntry(catalogue?.models ?? [], host.currentModel, host.setModel));
  curated.set("effort", effortEntry(catalogue?.models ?? [], send));
  curated.set("config", configEntry(send, host));
  curated.set("mcp", mcpEntry(host.mcpServers, send, host.refreshMcp));
  curated.set("context", contextEntry(host.contextUsage, send));
  curated.set(
    "output-style",
    valueEntry(
      "output-style",
      "Choose how Claude writes",
      catalogue?.availableOutputStyles ?? [],
      catalogue?.outputStyle ?? "",
      send,
    ),
  );
  curated.set(
    "clear",
    entry({
      id: "command:clear",
      label: "/clear",
      detail: "Start a new session with empty context",
      run: () => host.newSession(),
    }),
  );
  curated.set(
    "compact",
    entry({
      id: "command:compact",
      label: "/compact",
      detail: "Summarise the conversation to free up context",
      run: () => send("/compact"),
    }),
  );

  const agents = catalogue?.agents ?? [];
  curated.set(
    "agents",
    entry({
      id: "command:agents",
      label: "/agents",
      detail: `${agents.length} subagent(s) loaded`,
      submenu: () =>
        agents.length === 0
          ? [entry({ id: "agents:none", label: "No subagents loaded" })]
          : agents.map((agent: AgentInfo) =>
              entry({
                id: `agents:${agent.name}`,
                label: agent.name,
                detail: agent.description,
              }),
            ),
    }),
  );

  return curated;
}

/**
 * Builds a plain entry for a command the CLI describes fully.
 *
 * Commands whose hint offers alternatives get a list of those values; commands
 * with a free-text hint fill the composer so arguments can be typed; the rest
 * are sent as they are.
 *
 * @param command - The CLI's catalogue entry.
 * @param send - Sends a command line to Claude.
 * @param fill - Puts text in the composer without sending.
 * @returns The menu entry.
 */
function commandEntry(
  command: SlashCommandInfo,
  send: (command: string) => void,
  fill: (text: string) => void,
): MenuEntry {
  const values = valuesFromHint(command.argumentHint);

  if (values.length >= 2) {
    return valueEntry(command.name, command.description, values, "", send);
  }

  if (command.argumentHint.trim().length > 0) {
    return entry({
      id: `command:${command.name}`,
      label: `/${command.name}`,
      detail: command.description,
      hint: command.argumentHint,
      run: () => fill(`/${command.name} `),
    });
  }

  return entry({
    id: `command:${command.name}`,
    label: `/${command.name}`,
    detail: command.description,
    run: () => send(`/${command.name}`),
  });
}

/**
 * Builds the `/plugins` submenu.
 *
 * The CLI has no plugin-listing command, so this is terminice's own view of what
 * the CLI announced at startup. Reloading is passed straight through.
 *
 * @param plugins - The installed plugins.
 * @param skills - The loaded skill names.
 * @param send - Sends a command line to Claude.
 * @returns The menu entry.
 */
function pluginsEntry(
  plugins: PluginInfo[] = [],
  skills: string[] = [],
  send: (command: string) => void,
): MenuEntry {
  return entry({
    id: "terminice:plugins",
    label: "/plugins",
    detail: `${plugins.length} plugin(s), ${skills.length} skill(s) loaded`,
    hint: "not a Claude command",
    submenu: () => [
      ...plugins.map((plugin) =>
        entry({
          id: `plugins:${plugin.name}`,
          label: plugin.name,
          detail: plugin.source || plugin.path,
          hint: plugin.version,
        }),
      ),
      entry({
        id: "plugins:reload",
        label: "Reload plugins",
        detail: "Activate pending plugin changes in this session",
        run: () => send("/reload-plugins"),
      }),
      entry({
        id: "plugins:reload-skills",
        label: "Reload skills",
        detail: "Pick up skills added or changed on disk",
        run: () => send("/reload-skills"),
      }),
    ],
  });
}

/**
 * Builds the `/skills` submenu.
 *
 * @param skills - The loaded skill names.
 * @param send - Sends a command line to Claude.
 * @returns The menu entry.
 */
function skillsEntry(skills: string[] = [], send: (command: string) => void): MenuEntry {
  return entry({
    id: "terminice:skills",
    label: "/skills",
    detail: `${skills.length} loaded`,
    hint: "not a Claude command",
    submenu: () => [
      ...skills.map((skill) =>
        entry({ id: `skills:${skill}`, label: skill, run: () => send(`/${skill}`) }),
      ),
      entry({
        id: "skills:doctor",
        label: "Unused skills",
        detail: "Show which loaded skills cost context without being used",
        run: () => send("/skill-doctor"),
      }),
    ],
  });
}

/**
 * Builds the top level of the slash menu.
 *
 * terminice's own entries come first, then the commands the CLI offers, with
 * the ones that have richer menus pulled to the front. Every command is listed,
 * including the ones that refuse to run outside a terminal, so that a failure
 * is the CLI's own rather than a silently missing entry.
 *
 * @param host - The application actions and live data.
 * @returns The entries, in display order.
 */
export function buildRootEntries(host: SlashMenuHost): MenuEntry[] {
  const curated = buildCurated(host);
  const fill = host.fillComposer ?? host.runCommand;

  const commands = host.catalogue?.commands ?? [];
  const curatedOrder = [
    "model",
    "effort",
    "config",
    "mcp",
    "context",
    "output-style",
    "compact",
    "clear",
    "agents",
  ];

  const leading = curatedOrder.flatMap((name) => {
    const found = curated.get(name);
    return found ? [found] : [];
  });

  const rest = commands
    .filter((command) => !curated.has(command.name))
    .map((command) => commandEntry(command, host.runCommand, fill));

  return [
    entry({
      id: "terminice:settings",
      label: "Terminice settings",
      detail: "Theme and Enter key behaviour",
      hint: "not a Claude command",
      run: host.openTerminiceSettings,
    }),
    resumeEntry(host.sessions, host.resumeSession, host.refreshSessions),
    pluginsEntry(host.plugins, host.skills, host.runCommand),
    skillsEntry(host.skills, host.runCommand),
    entry({
      id: "terminice:mode",
      label: "Permission mode",
      detail: `Currently ${describePermissionMode(host.permissionMode)}`,
      hint: "Shift+Tab cycles",
      submenu: () =>
        PERMISSION_MODES.map((mode) =>
          entry({
            id: `mode:${mode}`,
            label: describePermissionMode(mode),
            detail: mode,
            selected: mode === host.permissionMode,
            run: () => host.setPermissionMode(mode),
          }),
        ),
    }),
    ...leading,
    ...rest,
  ];
}

/**
 * Filters and ranks entries against what has been typed.
 *
 * @param entries - The entries to filter.
 * @param query - The text after the leading slash.
 * @returns The matching entries, closest first; all of them when the query is
 *   empty.
 */
export function filterEntries(entries: MenuEntry[], query: string): MenuEntry[] {
  return rankByMatch(entries, query, (item) => item.label.replace(/^\//, ""));
}

/**
 * The command a label names, without its slash.
 *
 * Not every row is a command: terminice's own rows — the permission mode, its
 * settings — are prose, and have no name to put in the composer.
 *
 * @param label - The row's label.
 * @returns The command name, or an empty string when the row is not one.
 */
export function commandNameOf(label: string): string {
  const trimmed = label.trim();
  return trimmed.startsWith("/") ? trimmed.slice(1).trim() : "";
}

/**
 * What has been typed after a command, which is what its submenu filters on.
 *
 * A submenu is opened from a command, and the composer is left holding that
 * command so that what is typed next reads as its argument. This is the
 * argument: `/resume my-session` filters the sessions by `my-session`.
 *
 * @param text - What the composer holds.
 * @param command - The command the submenu was opened from, without its slash.
 * @returns The text after it, or an empty string when the composer no longer
 *   holds that command, or holds a different one that merely starts the same.
 */
export function textAfterCommand(text: string, command: string): string {
  if (command.length === 0) return "";
  const trimmed = text.trim();
  const prefix = `/${command}`;
  if (trimmed === prefix) return "";
  if (!trimmed.startsWith(`${prefix} `)) return "";
  return trimmed.slice(prefix.length + 1).trim();
}
