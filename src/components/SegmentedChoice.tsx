/** One option in a segmented choice. */
export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

/** Props for {@link SegmentedChoice}. */
export type SegmentedChoiceProps<T extends string> = {
  value: T;
  options: readonly SegmentedOption<T>[];
  onSelect: (value: T) => void;
  label: string;
};

/**
 * Renders a row of mutually exclusive choices.
 *
 * @param props - The current value, the options, a change handler, and a label.
 * @returns The rendered control.
 */
export function SegmentedChoice<T extends string>({
  value,
  options,
  onSelect,
  label,
}: SegmentedChoiceProps<T>) {
  return (
    <div className="setting">
      <span className="setting-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? "segment active" : "segment"}
            aria-pressed={option.value === value}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
