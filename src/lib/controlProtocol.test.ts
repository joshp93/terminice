import { describe, expect, it } from "vitest";
import {
  allowTool,
  controlRequest,
  controlSuccess,
  denyTool,
  readContextUsage,
  readControlResponse,
  readFastMode,
  readFileSuggestions,
  readInboundRequest,
  readInitialize,
  readMcpServers,
  readNames,
  readPlugins,
  readUsage,
} from "./controlProtocol";

describe("controlRequest", () => {
  it("tags the message and echoes the request id", () => {
    expect(controlRequest("req-1", { subtype: "interrupt" })).toEqual({
      type: "control_request",
      request_id: "req-1",
      request: { subtype: "interrupt" },
    });
  });
});

describe("allowTool", () => {
  it("allows without changing the input when none is given", () => {
    expect(allowTool("req-1")).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "req-1",
        response: { behavior: "allow" },
      },
    });
  });

  it("carries replacement input and permission rules when given", () => {
    const message = allowTool("req-1", { command: "ls" }, [{ type: "always" }]);
    const response = (message.response as Record<string, unknown>).response as Record<
      string,
      unknown
    >;

    expect(response.behavior).toBe("allow");
    expect(response.updatedInput).toEqual({ command: "ls" });
    expect(response.updatedPermissions).toEqual([{ type: "always" }]);
  });

  it("omits updatedInput for an explicitly undefined input", () => {
    const message = allowTool("req-1", undefined);
    const response = (message.response as Record<string, unknown>).response as Record<
      string,
      unknown
    >;
    expect("updatedInput" in response).toBe(false);
  });
});

describe("denyTool", () => {
  it("denies with the reason the model will read", () => {
    const message = denyTool("req-1", "not allowed");
    const response = (message.response as Record<string, unknown>).response as Record<
      string,
      unknown
    >;
    expect(response).toEqual({ behavior: "deny", message: "not allowed" });
  });
});

describe("controlSuccess", () => {
  it("wraps a payload as a success", () => {
    expect(controlSuccess("req-1", { ok: true })).toEqual({
      type: "control_response",
      response: { subtype: "success", request_id: "req-1", response: { ok: true } },
    });
  });
});

describe("readControlResponse", () => {
  it("decodes a success envelope", () => {
    const envelope = readControlResponse({
      type: "control_response",
      response: { subtype: "success", request_id: "req-1", response: { value: 1 } },
    });

    expect(envelope?.subtype).toBe("success");
    expect(envelope?.requestId).toBe("req-1");
    expect(envelope?.response).toEqual({ value: 1 });
  });

  it("decodes an error envelope and its message", () => {
    const envelope = readControlResponse({
      type: "control_response",
      response: { subtype: "error", request_id: "req-2", error: "nope" },
    });

    expect(envelope?.subtype).toBe("error");
    expect(envelope?.error).toBe("nope");
  });

  it("carries the prompts the CLI is still holding", () => {
    const envelope = readControlResponse({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "req-1",
        pending_permission_requests: [{ request_id: "p1" }],
        pending_user_dialog_requests: [{ request_id: "p2" }],
      },
    });

    expect(envelope?.pendingPermissionRequests).toEqual([{ request_id: "p1" }]);
    expect(envelope?.pendingUserDialogRequests).toEqual([{ request_id: "p2" }]);
  });

  it("defaults the pending lists to empty when absent", () => {
    const envelope = readControlResponse({
      type: "control_response",
      response: { subtype: "success", request_id: "req-1" },
    });

    expect(envelope?.pendingPermissionRequests).toEqual([]);
    expect(envelope?.pendingUserDialogRequests).toEqual([]);
  });

  it("ignores a line that is a different type", () => {
    expect(readControlResponse({ type: "assistant" })).toBeNull();
  });

  it("ignores a response with no envelope", () => {
    expect(readControlResponse({ type: "control_response" })).toBeNull();
  });

  it("treats an unrecognised subtype as success", () => {
    const envelope = readControlResponse({
      type: "control_response",
      response: { subtype: "something", request_id: "req-1" },
    });
    expect(envelope?.subtype).toBe("success");
  });
});

describe("readInboundRequest", () => {
  it("decodes a request the CLI sent", () => {
    const request = readInboundRequest({
      type: "control_request",
      request_id: "req-9",
      request: { subtype: "can_use_tool", tool_name: "Bash" },
    });

    expect(request?.requestId).toBe("req-9");
    expect(request?.subtype).toBe("can_use_tool");
    expect(request?.request.tool_name).toBe("Bash");
  });

  it("ignores a line that is not a control request", () => {
    expect(readInboundRequest({ type: "control_response" })).toBeNull();
  });

  it("ignores a request with no body", () => {
    expect(readInboundRequest({ type: "control_request", request_id: "req-9" })).toBeNull();
  });
});

describe("readInitialize", () => {
  it("reads the command, model and agent catalogue", () => {
    const catalogue = readInitialize({
      commands: [{ name: "compact", description: "Free up context", argumentHint: "" }],
      models: [
        {
          value: "sonnet",
          resolvedModel: "claude-sonnet-5-5",
          displayName: "Sonnet",
          description: "Balanced",
          supportedEffortLevels: ["low", "high"],
        },
      ],
      agents: [{ name: "Explore", description: "Search" }],
      output_style: "default",
      available_output_styles: ["default", "Concise"],
      current_permission_mode: "plan",
      capabilities: ["fast_mode"],
    });

    expect(catalogue?.commands).toEqual([
      { name: "compact", description: "Free up context", argumentHint: "" },
    ]);
    expect(catalogue?.models[0].resolvedModel).toBe("claude-sonnet-5-5");
    expect(catalogue?.models[0].supportedEffortLevels).toEqual(["low", "high"]);
    expect(catalogue?.agents).toEqual([{ name: "Explore", description: "Search" }]);
    expect(catalogue?.permissionMode).toBe("plan");
    expect(catalogue?.availableOutputStyles).toEqual(["default", "Concise"]);
    expect(catalogue?.capabilities).toEqual(["fast_mode"]);
  });

  it("falls back to the raw value when a model has no display name", () => {
    const catalogue = readInitialize({ models: [{ value: "opus" }] });
    expect(catalogue?.models[0].displayName).toBe("opus");
  });

  it("drops entries that carry no name", () => {
    const catalogue = readInitialize({
      commands: [{ description: "nameless" }, { name: "compact" }],
      models: [{ displayName: "nameless" }, { value: "opus" }],
      agents: [{ description: "nameless" }],
    });

    expect(catalogue?.commands).toHaveLength(1);
    expect(catalogue?.models).toHaveLength(1);
    expect(catalogue?.agents).toEqual([]);
  });

  it("returns an empty catalogue for a payload with nothing in it", () => {
    const catalogue = readInitialize({});
    expect(catalogue?.commands).toEqual([]);
    expect(catalogue?.permissionMode).toBe("");
  });

  it("returns null for a payload that is not an object", () => {
    expect(readInitialize("nope")).toBeNull();
    expect(readInitialize(null)).toBeNull();
  });
});

describe("readContextUsage", () => {
  it("reads the CLI's own percentage and total", () => {
    const usage = readContextUsage({
      categories: [{ name: "Messages", tokens: 1200, color: "#fff", kind: "message" }],
      totalTokens: 4000,
      maxTokens: 200000,
      percentage: 2,
      model: "claude-sonnet-5-5",
    });

    expect(usage?.percentage).toBe(2);
    expect(usage?.totalTokens).toBe(4000);
    expect(usage?.model).toBe("claude-sonnet-5-5");
    expect(usage?.categories[0]).toEqual({
      name: "Messages",
      tokens: 1200,
      color: "#fff",
      kind: "message",
    });
  });

  it("drops a category that carries no name", () => {
    const usage = readContextUsage({ categories: [{ tokens: 5 }, { name: "Tools" }] });
    expect(usage?.categories).toHaveLength(1);
  });

  it("defaults the numbers to zero rather than null", () => {
    const usage = readContextUsage({});
    expect(usage?.totalTokens).toBe(0);
    expect(usage?.maxTokens).toBe(0);
    expect(usage?.percentage).toBe(0);
  });

  it("returns null for a payload that is not an object", () => {
    expect(readContextUsage(null)).toBeNull();
  });
});

describe("readUsage", () => {
  it("reads the session totals", () => {
    const usage = readUsage({
      session: {
        total_cost_usd: 0.42,
        total_duration_ms: 9000,
        total_lines_added: 12,
        total_lines_removed: 3,
      },
    });

    expect(usage).toEqual({
      totalCostUsd: 0.42,
      totalDurationMs: 9000,
      linesAdded: 12,
      linesRemoved: 3,
    });
  });

  it("returns null when there is no session", () => {
    expect(readUsage({})).toBeNull();
    expect(readUsage(null)).toBeNull();
  });

  it("defaults a missing figure to zero", () => {
    expect(readUsage({ session: { total_cost_usd: 1 } })?.linesAdded).toBe(0);
  });
});

describe("readFastMode", () => {
  it("reads each of the three states the CLI can report", () => {
    expect(readFastMode({ fast_mode_state: "on" })?.state).toBe("on");
    expect(readFastMode({ fast_mode_state: "cooldown" })?.state).toBe("cooldown");
    expect(readFastMode({ fast_mode_state: "off" })?.state).toBe("off");
  });

  it("reads the reason alongside the state", () => {
    const reading = readFastMode({
      fast_mode_state: "off",
      fast_mode_disabled_reason: "preference",
    });
    expect(reading).toEqual({ state: "off", reason: "preference" });
  });

  it("reports no reason as null rather than an empty string", () => {
    expect(readFastMode({ fast_mode_state: "on" })?.reason).toBeNull();
  });

  it("says nothing for a value the CLI does not use", () => {
    expect(readFastMode({ fast_mode_state: "turbo" })).toBeNull();
  });

  it("says nothing when the payload carries no fast-mode field", () => {
    expect(readFastMode({})).toBeNull();
    expect(readFastMode(null)).toBeNull();
  });
});

describe("readFileSuggestions", () => {
  const payload = {
    cwd: "D:\\apps\\terminice",
    suggestions: [
      { path: "D:\\apps\\terminice\\src\\main.tsx" },
      { path: "D:\\apps\\terminice\\src\\lib\\json.ts" },
      { path: "C:\\Users\\Joshu\\.claude\\skills\\code-review\\SKILL.md" },
    ],
  };

  it("makes paths inside the session relative to it, keeping their separators", () => {
    expect(readFileSuggestions(payload)).toEqual(["src\\main.tsx", "src\\lib\\json.ts"]);
  });

  it("drops an absolute path from outside the session", () => {
    expect(readFileSuggestions(payload)).not.toContain(
      "C:\\Users\\Joshu\\.claude\\skills\\code-review\\SKILL.md",
    );
  });

  it("keeps a relative path that the CLI already made relative", () => {
    const suggestions = readFileSuggestions({
      cwd: "D:\\apps\\terminice",
      suggestions: [{ path: "src/App.tsx" }],
    });
    expect(suggestions).toEqual(["src/App.tsx"]);
  });

  it("tolerates a trailing separator on the cwd", () => {
    const suggestions = readFileSuggestions({
      cwd: "D:\\apps\\terminice\\",
      suggestions: [{ path: "D:\\apps\\terminice\\src\\App.tsx" }],
    });
    expect(suggestions).toEqual(["src\\App.tsx"]);
  });

  it("matches the directory case-insensitively, as Windows paths are", () => {
    const suggestions = readFileSuggestions({
      cwd: "d:\\apps\\TERMINICE",
      suggestions: [{ path: "D:\\apps\\terminice\\src\\App.tsx" }],
    });
    expect(suggestions).toEqual(["src\\App.tsx"]);
  });

  it("makes a forward-slash path relative when the cwd uses forward slashes too", () => {
    const suggestions = readFileSuggestions({
      cwd: "/home/joshu/terminice",
      suggestions: [{ path: "/home/joshu/terminice/src/App.tsx" }],
    });
    expect(suggestions).toEqual(["src/App.tsx"]);
  });

  it("drops the session directory itself", () => {
    const suggestions = readFileSuggestions({
      cwd: "D:\\apps\\terminice",
      suggestions: [{ path: "D:\\apps\\terminice" }],
    });
    expect(suggestions).toEqual([]);
  });

  it("drops entries with no path", () => {
    expect(readFileSuggestions({ cwd: "D:\\x", suggestions: [{}] })).toEqual([]);
  });

  it("returns empty when the payload has no suggestions", () => {
    expect(readFileSuggestions({})).toEqual([]);
    expect(readFileSuggestions(null)).toEqual([]);
  });

  it("keeps an absolute path when the response names no directory", () => {
    expect(readFileSuggestions({ suggestions: [{ path: "C:\\elsewhere.ts" }] })).toEqual([]);
  });
});

describe("readMcpServers", () => {
  it("reads each server and its status", () => {
    expect(readMcpServers({ mcpServers: [{ name: "files", status: "connected" }] })).toEqual([
      { name: "files", status: "connected" },
    ]);
  });

  it("defaults a missing status to unknown", () => {
    expect(readMcpServers({ mcpServers: [{ name: "files" }] })[0].status).toBe("unknown");
  });

  it("drops a server with no name", () => {
    expect(readMcpServers({ mcpServers: [{ status: "connected" }] })).toEqual([]);
  });

  it("returns empty for a payload with no servers", () => {
    expect(readMcpServers({})).toEqual([]);
  });
});

describe("readPlugins", () => {
  it("reads each plugin", () => {
    expect(
      readPlugins([{ name: "code-review", version: "1.2.0", source: "marketplace", path: "/p" }]),
    ).toEqual([{ name: "code-review", version: "1.2.0", source: "marketplace", path: "/p" }]);
  });

  it("reports a plugin the CLI ships without a version as builtin", () => {
    expect(readPlugins([{ name: "core" }])[0]).toEqual({
      name: "core",
      version: "builtin",
      source: "",
      path: "",
    });
  });

  it("drops a plugin with no name", () => {
    expect(readPlugins([{ version: "1.0.0" }])).toEqual([]);
  });

  it("returns empty for a field that is not an array", () => {
    expect(readPlugins(null)).toEqual([]);
    expect(readPlugins({ name: "core" })).toEqual([]);
  });
});

describe("readNames", () => {
  it("keeps the strings and drops everything else", () => {
    expect(readNames(["a", 3, null, "b"])).toEqual(["a", "b"]);
  });

  it("drops empty strings", () => {
    expect(readNames(["a", ""])).toEqual(["a"]);
  });

  it("returns empty for a field that is not an array", () => {
    expect(readNames(null)).toEqual([]);
  });
});
