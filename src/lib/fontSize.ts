/**
 * How far one press of a font size button moves the size, in CSS pixels.
 *
 * Half a pixel is the smallest step that is reliably visible in a browser, so a
 * press is perceptible without a size being unreachable between two others.
 */
export const FONT_SIZE_STEP = 0.5;

/** The smallest size the text may be set to, in CSS pixels. */
export const MIN_FONT_SIZE = 9;

/** The largest size the text may be set to, in CSS pixels. */
export const MAX_FONT_SIZE = 24;

/** The size the composer is drawn at before anything is changed. */
export const DEFAULT_COMPOSER_FONT_SIZE = 13.5;

/** The size the transcript is drawn at before anything is changed. */
export const DEFAULT_CHAT_FONT_SIZE = 14;

/**
 * Moves a size by whole steps, keeping it inside the range it may take.
 *
 * The result is rounded to the step, so repeated presses cannot drift into a
 * size that is not on the scale.
 *
 * @param current - The size in force, in CSS pixels.
 * @param steps - How many presses to apply; negative moves down.
 * @returns The size after the presses, clamped to the range.
 */
export function stepFontSize(current: number, steps: number): number {
  const moved = current + steps * FONT_SIZE_STEP;
  const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, moved));
  return Math.round(clamped / FONT_SIZE_STEP) * FONT_SIZE_STEP;
}

/**
 * Whether a size has reached an end of the range it may take.
 *
 * @param current - The size in force, in CSS pixels.
 * @param steps - The direction being asked for; negative looks down.
 * @returns True when another press in that direction would do nothing.
 */
export function atFontSizeLimit(current: number, steps: number): boolean {
  return stepFontSize(current, steps) === current;
}

/**
 * Renders a size for display, leaving off a trailing zero.
 *
 * @param size - The size in CSS pixels.
 * @returns The size, with a `px` suffix.
 */
export function fontSizeLabel(size: number): string {
  return `${Number.isInteger(size) ? size : size.toFixed(1)}px`;
}
