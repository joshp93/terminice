import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitializePayload, PluginInfo } from "./controlProtocol";
import {
  buildRootEntries,
  commandNameOf,
  filterEntries,
  type MenuEntry,
  type SlashMenuHost,
  textAfterCommand,
  valuesFromHint,
} from "./slashMenu";

/** A host whose every action is a spy, with sensible empty data. */
function makeHost(overrides: Partial<SlashMenuHost> = {}): SlashMenuHost {
  return {
    catalogue: null,
    contextUsage: null,
    mcpServers: [],
    plugins: [],
    skills: [],
    permissionMode: "default",
    sessions: [],
    runCommand: vi.fn(),
    setPermissionMode: vi.fn(),
    setModel: vi.fn(),
    currentModel: "",
    openTerminiceSettings: vi.fn(),
    newSession: vi.fn(),
    resumeSession: vi.fn(),
    refreshSessions: vi.fn(),
    refreshMcp: vi.fn(),
    ...overrides,
  };
}

const catalogue = (overrides: Partial<InitializePayload> = {}): InitializePayload => ({
  commands: [],
  agents: [],
  models: [],
  outputStyle: "",
  availableOutputStyles: [],
  permissionMode: "default",
  capabilities: [],
  ...overrides,
});

const find = (entries: MenuEntry[], id: string): MenuEntry => {
  const found = entries.find((entry) => entry.id === id);
  if (!found)
    throw new Error(`no entry with id ${id} among ${entries.map((e) => e.id).join(", ")}`);
  return found;
};

const openSubmenu = (entry: MenuEntry): MenuEntry[] => {
  if (!entry.submenu) throw new Error(`${entry.id} does not open a submenu`);
  return entry.submenu();
};

/** Reaches the value rows of one `/config` key. */
const configValues = (host: SlashMenuHost, key: string): MenuEntry[] =>
  openSubmenu(find(openSubmenu(find(buildRootEntries(host), "command:config")), `config:${key}`));

describe("valuesFromHint", () => {
  it("reads a bracketed list of alternatives", () => {
    expect(valuesFromHint("[red|blue|green]")).toEqual(["red", "blue", "green"]);
  });

  it("reads a spaced, unbracketed list", () => {
    expect(valuesFromHint("consent | revoke")).toEqual(["consent", "revoke"]);
  });

  it("reads angle-bracket alternatives", () => {
    expect(valuesFromHint("<on|off>")).toEqual(["on", "off"]);
  });

  it("ignores a single bracketed value", () => {
    expect(valuesFromHint("[file]")).toEqual([]);
  });

  it("ignores a hint with no alternatives", () => {
    expect(valuesFromHint("<value>")).toEqual([]);
    expect(valuesFromHint("")).toEqual([]);
  });

  it("ignores alternatives that are not plain words", () => {
    expect(valuesFromHint("[a b|c d]")).toEqual([]);
  });

  it("ignores a bare hint that is not purely a list", () => {
    expect(valuesFromHint("set the mode to a | b")).toEqual([]);
  });

  it("keeps dots and dashes inside a value", () => {
    expect(valuesFromHint("[dark-ansi|light-ansi]")).toEqual(["dark-ansi", "light-ansi"]);
  });

  it("requires a value to start with a letter, so a digit-led hint is not offered", () => {
    expect(valuesFromHint("[24-hour|24-hour-utc]")).toEqual([]);
  });

  it("reads the first bracketed group that offers alternatives", () => {
    expect(valuesFromHint("[one] [two|three]")).toEqual(["two", "three"]);
  });
});

describe("buildRootEntries", () => {
  it("puts terminice's own entries first", () => {
    const ids = buildRootEntries(makeHost()).map((entry) => entry.id);
    expect(ids.slice(0, 5)).toEqual([
      "terminice:settings",
      "terminice:resume",
      "terminice:plugins",
      "terminice:skills",
      "terminice:mode",
    ]);
  });

  it("offers the curated commands that need a richer menu", () => {
    const ids = buildRootEntries(makeHost()).map((entry) => entry.id);
    for (const name of [
      "model",
      "effort",
      "config",
      "mcp",
      "context",
      "clear",
      "compact",
      "agents",
    ]) {
      expect(ids).toContain(`command:${name}`);
    }
  });

  it("lists every command the CLI offers", () => {
    const host = makeHost({
      catalogue: catalogue({
        commands: [{ name: "doctor", description: "Check", argumentHint: "" }],
      }),
    });
    expect(buildRootEntries(host).map((entry) => entry.id)).toContain("command:doctor");
  });

  it("does not list a curated command twice", () => {
    const host = makeHost({
      catalogue: catalogue({ commands: [{ name: "model", description: "", argumentHint: "" }] }),
    });
    const ids = buildRootEntries(host).map((entry) => entry.id);
    expect(ids.filter((id) => id === "command:model")).toHaveLength(1);
  });

  it("offers a hint list for a command whose hint names alternatives", () => {
    const host = makeHost({
      catalogue: catalogue({
        commands: [{ name: "theme", description: "Pick", argumentHint: "[dark|light]" }],
      }),
    });
    const entry = find(buildRootEntries(host), "command:theme");
    expect(openSubmenu(entry).map((value) => value.label)).toEqual(["dark", "light"]);
  });

  it("fills the composer for a command with a free-text hint", () => {
    const fillComposer = vi.fn();
    const runCommand = vi.fn();
    const host = makeHost({
      fillComposer,
      runCommand,
      catalogue: catalogue({
        commands: [{ name: "language", description: "Set", argumentHint: "<value>" }],
      }),
    });

    find(buildRootEntries(host), "command:language").run?.();

    expect(fillComposer).toHaveBeenCalledWith("/language ");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("sends a command that takes no argument", () => {
    const runCommand = vi.fn();
    const host = makeHost({
      runCommand,
      catalogue: catalogue({
        commands: [{ name: "doctor", description: "Check", argumentHint: "" }],
      }),
    });

    find(buildRootEntries(host), "command:doctor").run?.();
    expect(runCommand).toHaveBeenCalledWith("/doctor");
  });

  it("falls back to sending when the host cannot fill the composer", () => {
    const runCommand = vi.fn();
    const host = makeHost({
      runCommand,
      fillComposer: undefined,
      catalogue: catalogue({
        commands: [{ name: "language", description: "Set", argumentHint: "<value>" }],
      }),
    });

    find(buildRootEntries(host), "command:language").run?.();
    expect(runCommand).toHaveBeenCalledWith("/language ");
  });
});

describe("/config", () => {
  let host: SlashMenuHost;

  beforeEach(() => {
    host = makeHost();
  });

  it("routes the model through the control channel and does not also send a message", () => {
    find(configValues(host, "model"), "config:model:sonnet").run?.();

    expect(host.setModel).toHaveBeenCalledWith("sonnet");
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("routes the permission mode through the control channel and does not also send a message", () => {
    find(configValues(host, "permissionMode"), "config:permissionMode:plan").run?.();

    expect(host.setPermissionMode).toHaveBeenCalledWith("plan");
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("sends a message for a setting that has no control request", () => {
    find(configValues(host, "theme"), "config:theme:light").run?.();

    expect(host.runCommand).toHaveBeenCalledWith("/config theme=light");
    expect(host.setModel).not.toHaveBeenCalled();
  });

  it("marks the value already in force", () => {
    const values = configValues(makeHost({ currentModel: "claude-sonnet-5-5" }), "model");
    expect(find(values, "config:model:sonnet").selected).toBe(false);
  });

  it("offers no submenu for a setting that takes free text", () => {
    const entry = find(
      openSubmenu(find(buildRootEntries(host), "command:config")),
      "config:language",
    );
    expect(entry.submenu).toBeUndefined();
    entry.run?.();
    expect(host.runCommand).toHaveBeenCalledWith("/config language=");
  });

  it("shows the key as the detail so the sent command is recognisable", () => {
    const entry = find(openSubmenu(find(buildRootEntries(host), "command:config")), "config:model");
    expect(entry.detail).toBe("model");
  });
});

describe("/model", () => {
  const models = [
    {
      value: "sonnet",
      resolvedModel: "claude-sonnet-5-5",
      displayName: "Sonnet",
      description: "Balanced",
      supportedEffortLevels: ["low", "high"],
    },
    {
      value: "opus",
      resolvedModel: "claude-opus-5-5",
      displayName: "Opus",
      description: "Deepest",
      supportedEffortLevels: ["high"],
    },
  ];

  it("switches the model over the control channel", () => {
    const host = makeHost({ catalogue: catalogue({ models }) });
    find(openSubmenu(find(buildRootEntries(host), "command:model")), "command:model:opus").run?.();
    expect(host.setModel).toHaveBeenCalledWith("opus");
  });

  it("marks the model actually in use, not the alias asked for", () => {
    const host = makeHost({ catalogue: catalogue({ models }), currentModel: "claude-opus-5-5" });
    const values = openSubmenu(find(buildRootEntries(host), "command:model"));
    expect(find(values, "command:model:opus").selected).toBe(true);
    expect(find(values, "command:model:sonnet").selected).toBe(false);
  });

  it("shows the model in use as the hint", () => {
    const host = makeHost({ catalogue: catalogue({ models }), currentModel: "claude-opus-5-5" });
    expect(find(buildRootEntries(host), "command:model").hint).toBe("claude-opus-5-5");
  });
});

describe("/effort", () => {
  it("offers every level the models advertise, plus auto", () => {
    const host = makeHost({
      catalogue: catalogue({
        models: [
          {
            value: "sonnet",
            resolvedModel: "s",
            displayName: "Sonnet",
            description: "",
            supportedEffortLevels: ["low", "high"],
          },
          {
            value: "opus",
            resolvedModel: "o",
            displayName: "Opus",
            description: "",
            supportedEffortLevels: ["high", "max"],
          },
        ],
      }),
    });

    const labels = openSubmenu(find(buildRootEntries(host), "command:effort")).map(
      (value) => value.label,
    );
    expect(labels).toEqual(["low", "high", "max", "auto"]);
  });

  it("sends the chosen level as a command", () => {
    const runCommand = vi.fn();
    const host = makeHost({ runCommand });
    find(
      openSubmenu(find(buildRootEntries(host), "command:effort")),
      "command:effort:auto",
    ).run?.();
    expect(runCommand).toHaveBeenCalledWith("/effort auto");
  });
});

describe("/mcp", () => {
  it("refreshes the server list when it opens", () => {
    const refreshMcp = vi.fn();
    const host = makeHost({ refreshMcp, mcpServers: [{ name: "files", status: "connected" }] });
    openSubmenu(find(buildRootEntries(host), "command:mcp"));
    expect(refreshMcp).toHaveBeenCalled();
  });

  it("says so when no server is configured", () => {
    expect(find(buildRootEntries(makeHost()), "command:mcp").detail).toBe(
      "No MCP servers configured",
    );
  });

  it("lists each server with its status", () => {
    const host = makeHost({ mcpServers: [{ name: "files", status: "connected" }] });
    const entries = openSubmenu(find(buildRootEntries(host), "command:mcp"));
    expect(find(entries, "mcp:files").detail).toBe("connected");
  });

  it("offers only the actions the CLI accepts", () => {
    const runCommand = vi.fn();
    const host = makeHost({ runCommand });
    const entries = openSubmenu(find(buildRootEntries(host), "command:mcp"));

    find(entries, "mcp:reconnect").run?.();
    find(entries, "mcp:enable").run?.();
    find(entries, "mcp:disable").run?.();

    expect(runCommand.mock.calls.map(([command]) => command)).toEqual([
      "/mcp reconnect all",
      "/mcp enable all",
      "/mcp disable all",
    ]);
  });
});

describe("/context", () => {
  it("prompts the user to send a message when there is no reading yet", () => {
    const entries = openSubmenu(find(buildRootEntries(makeHost()), "command:context"));
    expect(entries[0].label).toBe("No reading yet");
  });

  it("shows the CLI's own percentage", () => {
    const host = makeHost({
      contextUsage: {
        categories: [{ name: "Messages", tokens: 100, color: "", kind: "message" }],
        totalTokens: 100,
        maxTokens: 200_000,
        percentage: 3,
        model: "sonnet",
      },
    });

    expect(find(buildRootEntries(host), "command:context").detail).toBe("3% of 200,000 tokens");
    expect(
      find(openSubmenu(find(buildRootEntries(host), "command:context")), "context:total").label,
    ).toBe("3% used");
  });

  it("sends the compaction command", () => {
    const runCommand = vi.fn();
    const host = makeHost({
      runCommand,
      contextUsage: {
        categories: [],
        totalTokens: 1,
        maxTokens: 2,
        percentage: 50,
        model: "sonnet",
      },
    });

    find(openSubmenu(find(buildRootEntries(host), "command:context")), "context:compact").run?.();
    expect(runCommand).toHaveBeenCalledWith("/compact");
  });
});

describe("/resume", () => {
  it("refreshes the list when it opens", () => {
    const refreshSessions = vi.fn();
    openSubmenu(find(buildRootEntries(makeHost({ refreshSessions })), "terminice:resume"));
    expect(refreshSessions).toHaveBeenCalled();
  });

  it("says so when there is nothing to reopen", () => {
    const entries = openSubmenu(find(buildRootEntries(makeHost()), "terminice:resume"));
    expect(entries[0].id).toBe("resume:none");
  });

  it("resumes the chosen session by id", () => {
    const resumeSession = vi.fn();
    const host = makeHost({
      resumeSession,
      sessions: [{ id: "abc123", modified: 0, bytes: 1, preview: "hello", live: false }],
    });

    find(openSubmenu(find(buildRootEntries(host), "terminice:resume")), "resume:abc123").run?.();
    expect(resumeSession).toHaveBeenCalledWith("abc123");
  });

  it("marks a session that is still running", () => {
    const host = makeHost({
      sessions: [{ id: "abc123", modified: 0, bytes: 1, preview: "hello", live: true }],
    });
    const entry = find(
      openSubmenu(find(buildRootEntries(host), "terminice:resume")),
      "resume:abc123",
    );
    expect(entry.hint).toBe("live");
  });

  it("falls back to the session id when there is no preview", () => {
    const host = makeHost({
      sessions: [{ id: "abcdef1234", modified: 0, bytes: 1, preview: "", live: false }],
    });
    const entry = find(
      openSubmenu(find(buildRootEntries(host), "terminice:resume")),
      "resume:abcdef1234",
    );
    expect(entry.label).toBe("abcdef12");
  });
});

describe("/plugins", () => {
  it("shows the version the CLI reported", () => {
    const plugins: PluginInfo[] = [
      { name: "code-review", version: "1.2.0", source: "marketplace", path: "/p" },
    ];
    const entries = openSubmenu(find(buildRootEntries(makeHost({ plugins })), "terminice:plugins"));
    expect(find(entries, "plugins:code-review").hint).toBe("1.2.0");
  });

  it("shows builtin for a plugin the CLI ships without a version", () => {
    const plugins: PluginInfo[] = [{ name: "core", version: "builtin", source: "", path: "core" }];
    const entries = openSubmenu(find(buildRootEntries(makeHost({ plugins })), "terminice:plugins"));
    expect(find(entries, "plugins:core").hint).toBe("builtin");
  });

  it("counts plugins and skills", () => {
    const host = makeHost({
      plugins: [{ name: "core", version: "builtin", source: "", path: "" }],
      skills: ["one", "two"],
    });
    expect(find(buildRootEntries(host), "terminice:plugins").detail).toBe(
      "1 plugin(s), 2 skill(s) loaded",
    );
  });

  it("passes reloading straight through", () => {
    const runCommand = vi.fn();
    const entries = openSubmenu(
      find(buildRootEntries(makeHost({ runCommand })), "terminice:plugins"),
    );

    find(entries, "plugins:reload").run?.();
    find(entries, "plugins:reload-skills").run?.();

    expect(runCommand.mock.calls.map(([command]) => command)).toEqual([
      "/reload-plugins",
      "/reload-skills",
    ]);
  });
});

describe("/skills", () => {
  it("runs a skill by name", () => {
    const runCommand = vi.fn();
    const entries = openSubmenu(
      find(buildRootEntries(makeHost({ runCommand, skills: ["pdf"] })), "terminice:skills"),
    );
    find(entries, "skills:pdf").run?.();
    expect(runCommand).toHaveBeenCalledWith("/pdf");
  });

  it("offers the skill doctor", () => {
    const runCommand = vi.fn();
    const entries = openSubmenu(
      find(buildRootEntries(makeHost({ runCommand })), "terminice:skills"),
    );
    find(entries, "skills:doctor").run?.();
    expect(runCommand).toHaveBeenCalledWith("/skill-doctor");
  });
});

describe("permission mode entry", () => {
  it("describes the mode currently in force", () => {
    const host = makeHost({ permissionMode: "plan" });
    expect(find(buildRootEntries(host), "terminice:mode").detail).toBe("Currently Plan");
  });

  it("switches the mode over the control channel", () => {
    const setPermissionMode = vi.fn();
    const host = makeHost({ setPermissionMode });
    find(openSubmenu(find(buildRootEntries(host), "terminice:mode")), "mode:acceptEdits").run?.();
    expect(setPermissionMode).toHaveBeenCalledWith("acceptEdits");
  });

  it("marks the mode in force", () => {
    const host = makeHost({ permissionMode: "plan" });
    const entries = openSubmenu(find(buildRootEntries(host), "terminice:mode"));
    expect(find(entries, "mode:plan").selected).toBe(true);
  });
});

describe("other curated entries", () => {
  it("starts a new session for /clear", () => {
    const newSession = vi.fn();
    find(buildRootEntries(makeHost({ newSession })), "command:clear").run?.();
    expect(newSession).toHaveBeenCalled();
  });

  it("sends /compact", () => {
    const runCommand = vi.fn();
    find(buildRootEntries(makeHost({ runCommand })), "command:compact").run?.();
    expect(runCommand).toHaveBeenCalledWith("/compact");
  });

  it("lists the loaded subagents", () => {
    const host = makeHost({
      catalogue: catalogue({ agents: [{ name: "Explore", description: "Search" }] }),
    });
    const entries = openSubmenu(find(buildRootEntries(host), "command:agents"));
    expect(find(entries, "agents:Explore").detail).toBe("Search");
  });

  it("says so when no subagent is loaded", () => {
    const entries = openSubmenu(find(buildRootEntries(makeHost()), "command:agents"));
    expect(entries[0].id).toBe("agents:none");
  });

  it("opens terminice's own settings", () => {
    const openTerminiceSettings = vi.fn();
    find(buildRootEntries(makeHost({ openTerminiceSettings })), "terminice:settings").run?.();
    expect(openTerminiceSettings).toHaveBeenCalled();
  });
});

describe("filterEntries", () => {
  it("returns everything for an empty query", () => {
    const entries = buildRootEntries(makeHost());
    expect(filterEntries(entries, "")).toEqual(entries);
  });

  it("matches on the label with its slash removed", () => {
    const entries = buildRootEntries(
      makeHost({
        catalogue: catalogue({
          commands: [{ name: "doctor", description: "Check", argumentHint: "" }],
        }),
      }),
    );
    expect(filterEntries(entries, "doc")[0].id).toBe("command:doctor");
  });

  it("drops entries that do not match", () => {
    expect(filterEntries(buildRootEntries(makeHost()), "zzzz")).toEqual([]);
  });
});

describe("commandNameOf", () => {
  it("reads the name out of a row that is a command", () => {
    expect(commandNameOf("/resume")).toBe("resume");
    expect(commandNameOf("/output-style")).toBe("output-style");
  });

  it("finds no name in a row that is prose", () => {
    expect(commandNameOf("Permission mode")).toBe("");
    expect(commandNameOf("Terminice settings")).toBe("");
    expect(commandNameOf("")).toBe("");
  });

  it("finds none in a bare slash either", () => {
    expect(commandNameOf("/")).toBe("");
  });
});

describe("textAfterCommand", () => {
  it("reads what has been typed after the command", () => {
    expect(textAfterCommand("/resume my-session", "resume")).toBe("my-session");
    expect(textAfterCommand("/resume  spaced", "resume")).toBe("spaced");
  });

  it("reads nothing while the command stands alone", () => {
    expect(textAfterCommand("/resume", "resume")).toBe("");
    expect(textAfterCommand("/resume ", "resume")).toBe("");
  });

  it("reads nothing for a row that is not a command", () => {
    expect(textAfterCommand("Permission mode", "")).toBe("");
  });

  /// A longer command that merely starts with this one is a different command,
  /// so what follows it is not this one's argument.
  it("is not fooled by a command that starts with the same letters", () => {
    expect(textAfterCommand("/resumex foo", "resume")).toBe("");
  });

  it("reads nothing once the command has been replaced", () => {
    expect(textAfterCommand("/model opus", "resume")).toBe("");
    expect(textAfterCommand("just a message", "resume")).toBe("");
  });
});
