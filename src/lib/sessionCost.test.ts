import { describe, expect, it } from "vitest";
import type { TokenUsage } from "../types";
import {
  cannotBePriced,
  costOfTokens,
  type Rates,
  ratesConfigured,
  sessionCost,
} from "./sessionCost";

const none: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const spent: TokenUsage = {
  input: 1_000_000,
  output: 500_000,
  cacheRead: 2_000_000,
  cacheWrite: 0,
};
const noRates: Rates = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const rates: Rates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

describe("cannotBePriced", () => {
  it("takes the CLI's own answer when it gave one", () => {
    expect(cannotBePriced("claude-sonnet-4-5", true)).toBe(true);
    expect(cannotBePriced("deepseek-flash[1m]", false)).toBe(true);
  });

  it("knows Anthropic's models by name", () => {
    expect(cannotBePriced("claude-opus-4-1-20250805", false)).toBe(false);
    expect(cannotBePriced("CLAUDE-Sonnet-4-5", false)).toBe(false);
  });

  /// The aliases `/config model` offers resolve to a real model, but one can
  /// arrive unresolved, and none of them is a custom model.
  it("knows the aliases a model can be asked for by", () => {
    for (const alias of ["default", "sonnet", "opus", "haiku", "fable", "best", "opusplan"]) {
      expect(cannotBePriced(alias, false)).toBe(false);
    }
    expect(cannotBePriced("sonnet[1m]", false)).toBe(false);
  });

  it("says nothing before a model is known", () => {
    expect(cannotBePriced(null, false)).toBe(false);
    expect(cannotBePriced("  ", false)).toBe(false);
  });
});

describe("ratesConfigured", () => {
  it("counts one rate as enough to work with", () => {
    expect(ratesConfigured(noRates)).toBe(false);
    expect(ratesConfigured({ ...noRates, output: 15 })).toBe(true);
  });
});

describe("costOfTokens", () => {
  it("prices each kind of token at its own rate", () => {
    expect(costOfTokens(spent, rates)).toBeCloseTo(3 + 7.5 + 0.6, 6);
  });

  it("costs nothing when nothing has been spent", () => {
    expect(costOfTokens(none, rates)).toBe(0);
  });
});

describe("sessionCost", () => {
  /// For a model the CLI can price, its own figure is the cost — not a second
  /// opinion about something already known.
  it("uses the CLI's figure for a model it can price", () => {
    const cost = sessionCost({
      reported: 1.23,
      unknown: false,
      model: "claude-sonnet-4-5",
      tokens: spent,
      rates,
    });

    expect(cost).toEqual({ kind: "reported", usd: 1.23 });
  });

  /// The CLI reports a figure for a custom model too, and flags it as unknown.
  /// Showing it would be showing a number it made up.
  it("works the cost out here for a model the CLI cannot price", () => {
    const cost = sessionCost({
      reported: 1.77,
      unknown: true,
      model: "deepseek-flash[1m]",
      tokens: spent,
      rates,
    });

    expect(cost).toEqual({ kind: "estimated", usd: costOfTokens(spent, rates) });
  });

  it("says the cost is unknown when there are no rates to work it out from", () => {
    const cost = sessionCost({
      reported: 1.77,
      unknown: true,
      model: "deepseek-flash[1m]",
      tokens: spent,
      rates: noRates,
    });

    expect(cost).toEqual({ kind: "unknown" });
  });

  it("has nothing to show before either figure exists", () => {
    expect(
      sessionCost({ reported: null, unknown: false, model: null, tokens: none, rates: noRates }),
    ).toBeNull();
  });
});
