import type { Settings } from "../types";

/** Props for {@link CostRates}. */
export type CostRatesProps = {
  settings: Settings;
  onChange: (settings: Settings) => void;
};

/** The four rates, and what each one is charged for. */
const RATES: readonly {
  key:
    | "inputCostPerMillion"
    | "outputCostPerMillion"
    | "cacheReadCostPerMillion"
    | "cacheWriteCostPerMillion";
  label: string;
  hint: string;
}[] = [
  { key: "inputCostPerMillion", label: "Input", hint: "tokens sent that the cache did not hold" },
  { key: "outputCostPerMillion", label: "Output", hint: "tokens the model produced" },
  {
    key: "cacheReadCostPerMillion",
    label: "Cache read",
    hint: "tokens read back out of the cache",
  },
  { key: "cacheWriteCostPerMillion", label: "Cache write", hint: "tokens written into the cache" },
];

/**
 * Renders the rates a model the CLI cannot price is costed at.
 *
 * A model served through a proxy has no published price, so the only figure
 * that means anything is the one the reader is charged — which is why these are
 * typed in rather than looked up. Left at nothing, a session on such a model
 * says its cost is unknown, which is the truth; the CLI's own figure for one is
 * a fallback it flags as unknown itself, and showing that would be showing a
 * number nobody is charged.
 *
 * @param props - The settings and how to change them.
 * @returns The rendered rates.
 */
export function CostRates({ settings, onChange }: CostRatesProps) {
  return (
    <div className="cost-rates">
      <span className="setting-label">Custom model cost, per million tokens</span>
      <div className="cost-rate-row">
        {RATES.map((rate) => (
          <label className="cost-rate" key={rate.key} title={rate.hint}>
            <span className="cost-rate-label">{rate.label}</span>
            <input
              type="number"
              min={0}
              step={0.01}
              className="cost-rate-input"
              aria-label={`${rate.label} cost per million tokens`}
              value={settings[rate.key]}
              onChange={(event) => {
                const value = Number.parseFloat(event.target.value);
                onChange({
                  ...settings,
                  [rate.key]: Number.isFinite(value) && value > 0 ? value : 0,
                });
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
