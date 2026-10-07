import { asArray, asNumber, asRecord, asText, parseJsonLine, type Json } from "./json";

/** One slash command as the CLI describes it. */
export type SlashCommandInfo = {
  name: string;
  description: string;
  argumentHint: string;
};

/** One selectable model. */
export type ModelInfo = {
  value: string;
  resolvedModel: string;
  displayName: string;
  description: string;
  supportedEffortLevels: string[];
};

/** One subagent the CLI has loaded. */
export type AgentInfo = {
  name: string;
  description: string;
};

/** The `initialize` response, which is the catalogue behind the whole UI. */
export type InitializePayload = {
  commands: SlashCommandInfo[];
  agents: AgentInfo[];
  models: ModelInfo[];
  outputStyle: string;
  availableOutputStyles: string[];
  permissionMode: string;
  capabilities: string[];
};

/** One slice of the context window. */
export type ContextCategory = {
  name: string;
  tokens: number;
  color: string;
  kind: string;
};

/** How full the context window is, as the CLI computes it. */
export type ContextUsage = {
  categories: ContextCategory[];
  totalTokens: number;
  maxTokens: number;
  /** Whole-number percentage, exactly as `/context` reports it. */
  percentage: number;
};

/** One MCP server and its current state. */
export type McpServerInfo = {
  name: string;
  status: string;
};

/** One installed plugin. */
export type PluginInfo = {
  name: string;
  version: string;
  source: string;
  path: string;
};

/** Cost and duration for the session so far. */
export type UsageSummary = {
  totalCostUsd: number;
  totalDurationMs: number;
  linesAdded: number;
  linesRemoved: number;
};

/** A request the host sends to the CLI. */
export type ControlRequest = {
  type: "control_request";
  request_id: string;
  request: Json & { subtype: string };
};

/** A request the CLI sends to the host, which the host must answer. */
export type InboundRequest = {
  requestId: string;
  subtype: string;
  request: Json;
};

/** The envelope carried by a `control_response`. */
export type ControlEnvelope = {
  subtype: "success" | "error";
  requestId: string;
  response: unknown;
  error: string;
  /** Permission requests left unanswered when the host last detached. */
  pendingPermissionRequests: unknown[];
  /** Dialog requests left unanswered when the host last detached. */
  pendingUserDialogRequests: unknown[];
};

/**
 * Builds a control request.
 *
 * @param requestId - Identifier the response will echo back.
 * @param request - The request body, including its subtype.
 * @returns The message to write to the session.
 */
export function controlRequest(requestId: string, request: Json & { subtype: string }): ControlRequest {
  return { type: "control_request", request_id: requestId, request };
}

/**
 * Builds an approval for a tool the CLI asked about.
 *
 * @param requestId - The request being answered.
 * @param updatedInput - Replacement tool input; omit to run it unchanged.
 * @param updatedPermissions - Permission rules to install, such as an
 *   "always allow" suggestion.
 * @returns The message to write to the session.
 */
export function allowTool(
  requestId: string,
  updatedInput?: unknown,
  updatedPermissions?: unknown,
): Json {
  const result: Json = { behavior: "allow" };
  if (updatedInput !== undefined) result.updatedInput = updatedInput;
  if (updatedPermissions !== undefined) result.updatedPermissions = updatedPermissions;
  return { type: "control_response", response: { subtype: "success", request_id: requestId, response: result } };
}

/**
 * Builds a refusal for a tool the CLI asked about.
 *
 * @param requestId - The request being answered.
 * @param message - Why it was refused; the model sees this.
 * @returns The message to write to the session.
 */
export function denyTool(requestId: string, message: string): Json {
  return {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: { behavior: "deny", message },
    },
  };
}

/**
 * Builds a successful reply carrying a payload.
 *
 * @param requestId - The request being answered.
 * @param payload - The response body.
 * @returns The message to write to the session.
 */
export function controlSuccess(requestId: string, payload: unknown): Json {
  return {
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response: payload },
  };
}

/**
 * Decodes a `control_response` line.
 *
 * @param message - One decoded stream-json line.
 * @returns The envelope, or null when the line is not a control response.
 */
export function readControlResponse(message: Json): ControlEnvelope | null {
  if (asText(message.type) !== "control_response") return null;
  const envelope = asRecord(message.response);
  if (!envelope) return null;
  return {
    subtype: asText(envelope.subtype) === "error" ? "error" : "success",
    requestId: asText(envelope.request_id),
    response: envelope.response,
    error: asText(envelope.error),
    pendingPermissionRequests: asArray(envelope.pending_permission_requests),
    pendingUserDialogRequests: asArray(envelope.pending_user_dialog_requests),
  };
}

/**
 * Decodes a `control_request` line sent by the CLI.
 *
 * @param message - One decoded stream-json line.
 * @returns The request, or null when the line is not one.
 */
export function readInboundRequest(message: Json): InboundRequest | null {
  if (asText(message.type) !== "control_request") return null;
  const request = asRecord(message.request);
  if (!request) return null;
  return {
    requestId: asText(message.request_id),
    subtype: asText(request.subtype),
    request,
  };
}

/**
 * Reads the `initialize` payload.
 *
 * @param payload - The response body of an `initialize` request.
 * @returns The catalogue, or null when the payload is not one.
 */
export function readInitialize(payload: unknown): InitializePayload | null {
  const record = asRecord(payload);
  if (!record) return null;

  const commands = asArray(record.commands).flatMap((entry): SlashCommandInfo[] => {
    const item = asRecord(entry);
    const name = item ? asText(item.name) : "";
    if (!name) return [];
    return [
      {
        name,
        description: asText(item?.description),
        argumentHint: asText(item?.argumentHint),
      },
    ];
  });

  const models = asArray(record.models).flatMap((entry): ModelInfo[] => {
    const item = asRecord(entry);
    const value = item ? asText(item.value) : "";
    if (!value) return [];
    return [
      {
        value,
        resolvedModel: asText(item?.resolvedModel),
        displayName: asText(item?.displayName) || value,
        description: asText(item?.description),
        supportedEffortLevels: asArray(item?.supportedEffortLevels).map(asText).filter(Boolean),
      },
    ];
  });

  const agents = asArray(record.agents).flatMap((entry): AgentInfo[] => {
    const item = asRecord(entry);
    const name = item ? asText(item.name) : "";
    return name ? [{ name, description: asText(item?.description) }] : [];
  });

  return {
    commands,
    agents,
    models,
    outputStyle: asText(record.output_style),
    availableOutputStyles: asArray(record.available_output_styles).map(asText).filter(Boolean),
    permissionMode: asText(record.current_permission_mode),
    capabilities: asArray(record.capabilities).map(asText).filter(Boolean),
  };
}

/**
 * Reads the `get_context_usage` payload.
 *
 * @param payload - The response body.
 * @returns The usage breakdown, or null when the payload is not one.
 */
export function readContextUsage(payload: unknown): ContextUsage | null {
  const record = asRecord(payload);
  if (!record) return null;

  const categories = asArray(record.categories).flatMap((entry): ContextCategory[] => {
    const item = asRecord(entry);
    const name = item ? asText(item.name) : "";
    if (!name) return [];
    return [
      {
        name,
        tokens: asNumber(item?.tokens) ?? 0,
        color: asText(item?.color),
        kind: asText(item?.kind),
      },
    ];
  });

  return {
    categories,
    totalTokens: asNumber(record.totalTokens) ?? 0,
    maxTokens: asNumber(record.maxTokens) ?? 0,
    percentage: asNumber(record.percentage) ?? 0,
  };
}

/**
 * Reads the `get_usage` payload.
 *
 * @param payload - The response body.
 * @returns The session's cost and duration, or null when absent.
 */
export function readUsage(payload: unknown): UsageSummary | null {
  const session = asRecord(asRecord(payload)?.session);
  if (!session) return null;
  return {
    totalCostUsd: asNumber(session.total_cost_usd) ?? 0,
    totalDurationMs: asNumber(session.total_duration_ms) ?? 0,
    linesAdded: asNumber(session.total_lines_added) ?? 0,
    linesRemoved: asNumber(session.total_lines_removed) ?? 0,
  };
}

/**
 * Reads the `mcp_status` payload.
 *
 * @param payload - The response body.
 * @returns Each server with its status.
 */
export function readMcpServers(payload: unknown): McpServerInfo[] {
  return asArray(asRecord(payload)?.mcpServers).flatMap((entry): McpServerInfo[] => {
    const item = asRecord(entry);
    const name = item ? asText(item.name) : "";
    return name ? [{ name, status: asText(item?.status) || "unknown" }] : [];
  });
}

/**
 * Reads the plugin list from a `system/init` event.
 *
 * @param value - The event's `plugins` field.
 * @returns Each plugin's name, version and source.
 */
export function readPlugins(value: unknown): PluginInfo[] {
  return asArray(value).flatMap((entry): PluginInfo[] => {
    const item = asRecord(entry);
    const name = item ? asText(item.name) : "";
    if (!name) return [];
    return [
      {
        name,
        version: asText(item?.version) || "builtin",
        source: asText(item?.source),
        path: asText(item?.path),
      },
    ];
  });
}

/**
 * Reads a list of names, discarding anything that is not a string.
 *
 * @param value - The field to read.
 * @returns The names.
 */
export function readNames(value: unknown): string[] {
  return asArray(value).map(asText).filter(Boolean);
}

/**
 * Decodes one line of stream-json output.
 *
 * @param line - A single line.
 * @returns The decoded object, or null when it is not one.
 */
export function decodeLine(line: string): Json | null {
  return parseJsonLine(line);
}
