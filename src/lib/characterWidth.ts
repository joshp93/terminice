/** How many characters are measured to find one character's width. */
const SAMPLE = "0123456789";

/**
 * The width of one character of an element's font, in CSS pixels.
 *
 * Measured from the live element rather than assumed, because the diff is drawn
 * in whatever the settings have made the monospace font — a stack, or a family
 * the reader chose — and the two are not the same width. A canvas is used
 * because the answer is needed before anything is laid out.
 *
 * @param element - The element whose font to measure.
 * @returns The width of one character, or zero when nothing can be measured.
 */
export function characterWidth(element: Element): number {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return 0;

  const style = getComputedStyle(element);
  context.font = `${style.fontSize} ${style.fontFamily}`;
  const measured = context.measureText(SAMPLE).width / SAMPLE.length;
  return Number.isFinite(measured) && measured > 0 ? measured : 0;
}
