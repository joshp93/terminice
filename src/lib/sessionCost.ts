import type { TokenUsage } from "../types";

/** What a million tokens of each kind costs, in US dollars. */
export type Rates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** The figure the header shows for a session, and where it came from. */
export type SessionCost =
  /** The CLI's own figure, which is right for the models it can price. */
  | { kind: "reported"; usd: number }
  /** Worked out here from the tokens spent and the rates the reader gave. */
  | { kind: "estimated"; usd: number }
  /** The model has no known price, and none has been given for it. */
  | { kind: "unknown" };

/** Model names the CLI prices itself, as `/config model` lists them. */
const KNOWN_ALIASES = [
  "default",
  "sonnet",
  "opus",
  "haiku",
  "fable",
  "best",
  "opusplan",
  "sonnet[1m]",
  "opus[1m]",
  "fable[1m]",
];

/**
 * Whether a model is one the CLI has no price for.
 *
 * Anthropic's own models are named `claude-…`, and the aliases they can be
 * asked for by are listed above; anything else is a model served through
 * something the CLI has no rates for, which is what makes its own figure a
 * guess. Its own flag is taken first where it said anything, because that is
 * the CLI answering the question rather than us inferring the answer.
 *
 * @param model - The model in use, or null before one is known.
 * @param flagged - True when the CLI has said it cannot price this model.
 * @returns True when the model's cost has to be worked out here.
 */
export function cannotBePriced(model: string | null, flagged: boolean): boolean {
  if (flagged) return true;
  if (model === null) return false;

  const name = model.trim().toLowerCase();
  if (name.length === 0) return false;
  if (name.startsWith("claude")) return false;
  return !KNOWN_ALIASES.includes(name);
}

/**
 * Whether any rate has been given.
 *
 * One rate is enough: a reader who knows what they are charged for output and
 * nothing else is better served by an estimate that counts only that than by
 * being told the session is unpriceable.
 *
 * @param rates - The rates from the settings.
 * @returns True when at least one of them is set.
 */
export function ratesConfigured(rates: Rates): boolean {
  return rates.input > 0 || rates.output > 0 || rates.cacheRead > 0 || rates.cacheWrite > 0;
}

/**
 * Says where a session's cost came from, for the reader who hovers it.
 *
 * @param cost - The figure being shown.
 * @returns A sentence naming its source.
 */
export function describeCost(cost: SessionCost): string {
  switch (cost.kind) {
    case "reported":
      return "The cost Claude Code reported for this session";
    case "estimated":
      return "Worked out here from the tokens spent and the rates in the settings, because Claude Code has no price for this model";
    default:
      return "This model has no known price, and no rates have been given for it in the settings";
  }
}

/**
 * Prices the tokens a session has spent.
 *
 * @param tokens - The tokens spent, by kind.
 * @param rates - What a million of each kind costs.
 * @returns The cost in US dollars.
 */
export function costOfTokens(tokens: TokenUsage, rates: Rates): number {
  const millions = (count: number, rate: number): number => (count / 1_000_000) * rate;
  return (
    millions(tokens.input, rates.input) +
    millions(tokens.output, rates.output) +
    millions(tokens.cacheRead, rates.cacheRead) +
    millions(tokens.cacheWrite, rates.cacheWrite)
  );
}

/**
 * Decides which cost a session is shown, and what to say about it.
 *
 * The CLI's own figure is used wherever it is competent — for Anthropic's
 * models it is the real cost, and recomputing it here would be a second opinion
 * about something already known. It is a fallback for anything else: a model
 * with no published price gets a number the CLI itself flags as unknown, which
 * is worse than saying nothing.
 *
 * @param options - What is known about the session.
 * @param options.reported - The CLI's figure, when it reported one.
 * @param options.unknown - True when the CLI said it cannot price the model.
 * @param options.model - The model in use.
 * @param options.tokens - The tokens spent so far.
 * @param options.rates - The rates from the settings.
 * @returns The cost to show, or null when there is nothing to show at all.
 */
export function sessionCost(options: {
  reported: number | null;
  unknown: boolean;
  model: string | null;
  tokens: TokenUsage;
  rates: Rates;
}): SessionCost | null {
  const { reported, unknown, model, tokens, rates } = options;

  if (!cannotBePriced(model, unknown)) {
    return reported === null ? null : { kind: "reported", usd: reported };
  }

  if (!ratesConfigured(rates)) return { kind: "unknown" };
  return { kind: "estimated", usd: costOfTokens(tokens, rates) };
}
