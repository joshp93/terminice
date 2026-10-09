/**
 * Names what a running turn is doing.
 *
 * Reasoning is reported in tokens as it is spent, so the label counts them
 * while there are any and falls back to a plain statement of work otherwise.
 *
 * @param thinkingTokens - Reasoning tokens spent so far on the turn.
 * @returns The label to show beside the turning mark.
 */
export function turnLabel(thinkingTokens: number): string {
  return thinkingTokens > 0 ? `Thinking… ${thinkingTokens.toLocaleString()} tokens` : "Working…";
}

/**
 * Names what a compaction is doing.
 *
 * The CLI reports a compaction as a start and an end with no steps in between,
 * and the context reading taken before it began is the only size known, so the
 * figure is offered as what is being summarised rather than as progress.
 *
 * @param contextTokens - Tokens in context before compaction began, if known.
 * @returns The label to show beside the bar.
 */
export function compactLabel(contextTokens: number | null): string {
  return contextTokens === null
    ? "Compacting…"
    : `Compacting ${contextTokens.toLocaleString()} tokens…`;
}
