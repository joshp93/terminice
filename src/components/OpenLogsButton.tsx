import { openLogsFolder } from "../lib/openLogsFolder";

/** Props for {@link OpenLogsButton}. */
export type OpenLogsButtonProps = {
  /** The classes the button is drawn with, which differ by where it stands. */
  className?: string;
  /** The words on the button. */
  label?: string;
};

/**
 * Opens the folder the application's log is written into.
 *
 * It stands beside an error because a message on its own says what went wrong
 * and nothing about what led to it, and the log is where that is.
 *
 * @param props - How the button is drawn.
 * @returns The rendered button.
 */
export function OpenLogsButton({
  className = "open-logs",
  label = "Open logs",
}: OpenLogsButtonProps) {
  return (
    <button type="button" className={className} onClick={openLogsFolder}>
      {label}
    </button>
  );
}
