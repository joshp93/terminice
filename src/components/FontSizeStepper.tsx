import { atFontSizeLimit, fontSizeLabel, stepFontSize } from "../lib/fontSize";

/** Props for {@link FontSizeStepper}. */
export type FontSizeStepperProps = {
  /** What the size applies to, used as the control's accessible name. */
  label: string;
  /** The size in force, in CSS pixels. */
  value: number;
  /** The size the restore button puts back. */
  defaultValue: number;
  onChange: (value: number) => void;
};

/**
 * Renders a font size as a pair of steps and a way back to the default.
 *
 * Stepping rather than offering fixed sizes means every half pixel between the
 * ends of the range is reachable, and the restore button means widening the
 * range does not make the size the application was designed around harder to
 * get back to.
 *
 * @param props - The size in force, the default, and a change handler.
 * @returns The rendered control.
 */
export function FontSizeStepper({ label, value, defaultValue, onChange }: FontSizeStepperProps) {
  const atDefault = value === defaultValue;

  return (
    <div className="setting">
      <span className="setting-label">{label}</span>
      <fieldset className="stepper" aria-label={label}>
        <button
          type="button"
          className="stepper-button"
          aria-label={`Smaller ${label}`}
          disabled={atFontSizeLimit(value, -1)}
          onClick={() => onChange(stepFontSize(value, -1))}
        >
          −
        </button>
        <span className="stepper-value">{fontSizeLabel(value)}</span>
        <button
          type="button"
          className="stepper-button"
          aria-label={`Larger ${label}`}
          disabled={atFontSizeLimit(value, 1)}
          onClick={() => onChange(stepFontSize(value, 1))}
        >
          +
        </button>
        <button
          type="button"
          className="stepper-reset"
          aria-label={`Reset ${label}`}
          title={`Back to ${fontSizeLabel(defaultValue)}`}
          disabled={atDefault}
          onClick={() => onChange(defaultValue)}
        >
          ↺
        </button>
      </fieldset>
    </div>
  );
}
