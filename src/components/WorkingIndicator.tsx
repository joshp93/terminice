import logo from "../../assets/logo/terminice-logo.png";

/** Props for {@link WorkingIndicator}. */
export type WorkingIndicatorProps = {
  /** What to say beside the mark, which changes as the turn reports progress. */
  label: string;
};

/**
 * Shows that a turn is running.
 *
 * The mark turns a quarter of the way round eight times a second, in whole
 * steps rather than smoothly, so it reads as an instrument working rather than
 * as a page still loading.
 *
 * @param props - The label to show beside the mark.
 * @returns The rendered indicator.
 */
export function WorkingIndicator({ label }: WorkingIndicatorProps) {
  return (
    <div className="working">
      <img className="working-mark" src={logo} alt="" draggable={false} aria-hidden="true" />
      <span className="working-label">{label}</span>
    </div>
  );
}
