/** Props for {@link ProgressBar}. */
export type ProgressBarProps = {
  /** What the bar is reporting, shown beside it. */
  label: string;
};

/**
 * Renders an indeterminate progress bar.
 *
 * The CLI reports a compaction as a start and an end, with no progress steps in
 * between, so this sweeps rather than claiming a percentage it does not have.
 *
 * @param props - The label to show.
 * @returns The rendered bar.
 */
export function ProgressBar({ label }: ProgressBarProps) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuetext={label}>
      <div className="progress-track">
        <div className="progress-fill" />
      </div>
      <span className="progress-label">{label}</span>
    </div>
  );
}
