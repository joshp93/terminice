import { asArray, asRecord, asText, prettyJson, type Json } from "./json";
import type { InboundRequest } from "./controlProtocol";

/** How the user resolved a card. */
export type PromptResolution =
  | { kind: "permission"; choice: "allow" | "always" | "deny"; permissions?: unknown }
  | {
      kind: "question";
      answers: Record<string, string>;
      annotations: Record<string, { notes?: string }>;
    };

/** A button on a permission card. */
export type PermissionChoice = {
  id: "allow" | "always" | "deny";
  label: string;
  /** Permission rules to install, for the "always" choice. */
  permissions?: unknown;
};

/** A tool the CLI wants permission to run. */
export type PermissionPrompt = {
  kind: "permission";
  requestId: string;
  toolName: string;
  /** One line naming what the tool would act on. */
  title: string;
  toolUseId: string;
  /** The tool input, formatted for reading. */
  body: string;
  /** The tool input as the CLI sent it, echoed back when approving. */
  rawInput: Json;
  choices: PermissionChoice[];
};

/** One option within a question. */
export type QuestionOptionModel = {
  label: string;
  description: string;
  /** Optional richer content the CLI supplies for a focused option. */
  preview: string;
};

/** One question the model is asking. */
export type QuestionModel = {
  question: string;
  header: string;
  options: QuestionOptionModel[];
  multiSelect: boolean;
};

/** A question the model wants answered. */
export type QuestionPrompt = {
  kind: "question";
  requestId: string;
  toolName: string;
  toolUseId: string;
  /** The tool input as the CLI sent it; answers are merged into it. */
  rawInput: Json;
  questions: QuestionModel[];
};

/** Something the CLI is waiting on the user to decide. */
export type Prompt = PermissionPrompt | QuestionPrompt;

/**
 * Describes a permission suggestion as a button label.
 *
 * @param suggestion - One entry from the CLI's `permission_suggestions`.
 * @returns A label, or an empty string when the suggestion is not understood.
 */
export function describeSuggestion(suggestion: unknown): string {
  const record = asRecord(suggestion);
  if (!record) return "";

  const type = asText(record.type);
  if (type === "setMode") {
    switch (asText(record.mode)) {
      case "acceptEdits":
        return "Always allow edits";
      case "bypassPermissions":
        return "Always allow everything";
      case "plan":
        return "Switch to plan mode";
      default:
        return "Always allow";
    }
  }

  if (type === "addRules") {
    const rules = asArray(record.rules);
    const first = asRecord(rules[0]);
    const tool = asText(first?.toolName);
    return tool ? `Always allow ${tool}` : "Always allow";
  }

  return "";
}

/**
 * Summarises a tool input on one line.
 *
 * @param toolName - The tool being called.
 * @param input - Its input.
 * @returns A short description, or an empty string.
 */
function summarise(toolName: string, input: Record<string, unknown> | null): string {
  if (!input) return "";
  const path = asText(input.file_path) || asText(input.path) || asText(input.notebook_path);
  if (path) return path;
  const command = asText(input.command);
  if (command) return command.split("\n")[0];
  const pattern = asText(input.pattern);
  if (pattern) return pattern;
  const url = asText(input.url);
  if (url) return url;
  const prompt = asText(input.prompt) || asText(input.description);
  if (prompt) return prompt;
  return toolName;
}

/**
 * Reads the questions carried by an `AskUserQuestion` request.
 *
 * @param input - The tool input.
 * @returns Each question with its options.
 */
function readQuestions(input: Record<string, unknown> | null): QuestionModel[] {
  return asArray(input?.questions).flatMap((entry): QuestionModel[] => {
    const record = asRecord(entry);
    const question = asText(record?.question);
    if (!question) return [];
    const options = asArray(record?.options).flatMap((option): QuestionOptionModel[] => {
      const item = asRecord(option);
      const label = asText(item?.label);
      return label
        ? [
            {
              label,
              description: asText(item?.description),
              preview: asText(item?.preview),
            },
          ]
        : [];
    });
    return [
      {
        question,
        header: asText(record?.header),
        options,
        multiSelect: record?.multiSelect === true,
      },
    ];
  });
}

/**
 * Turns an inbound control request into something the UI can render.
 *
 * `AskUserQuestion` arrives as a permission request that is flagged as needing
 * user interaction, so it is separated out here rather than being shown as a
 * yes/no approval.
 *
 * @param request - The decoded inbound request.
 * @returns The prompt, or null when this request is not one we render.
 */
export function readPrompt(request: InboundRequest): Prompt | null {
  if (request.subtype === "elicitation") return null;

  const toolName = asText(request.request.tool_name);
  const toolUseId = asText(request.request.tool_use_id);
  const input = asRecord(request.request.input);

  if (toolName === "AskUserQuestion") {
    const questions = readQuestions(input);
    if (questions.length === 0) return null;
    return {
      kind: "question",
      requestId: request.requestId,
      toolName,
      toolUseId,
      rawInput: input ?? {},
      questions,
    };
  }

  const choices: PermissionChoice[] = [{ id: "allow", label: "Allow" }];

  const always = asArray(request.request.permission_suggestions)
    .map((suggestion) => ({ suggestion, label: describeSuggestion(suggestion) }))
    .find((entry) => entry.label.length > 0);
  if (always) {
    choices.push({ id: "always", label: always.label, permissions: [always.suggestion] });
  }

  choices.push({ id: "deny", label: "Deny" });

  return {
    kind: "permission",
    requestId: request.requestId,
    toolName,
    title: asText(request.request.description) || summarise(toolName, input),
    toolUseId,
    body: prettyJson(input ?? {}),
    rawInput: input ?? {},
    choices,
  };
}
