/** How wide the rail the plan collapses into is, in pixels. */
export const PLAN_RAIL_WIDTH = 34;

/** The share of the chat area a plan is first shown at. */
export const PLAN_DEFAULT_SHARE = 0.4;

/** The narrowest a plan may be dragged, as a share of the chat area. */
export const PLAN_MIN_SHARE = 0.2;

/** The widest a plan may be dragged, as a share of the chat area. */
export const PLAN_MAX_SHARE = 0.8;

/**
 * Holds a wanted width inside the range a plan may be drawn at.
 *
 * The bounds are shares of the chat area rather than fixed widths, so the plan
 * keeps its proportions whether the window is wide or narrow — and neither
 * bound can swallow the transcript or the plan itself.
 *
 * @param areaWidth - How wide the chat area is, in pixels.
 * @param wanted - The width asked for, in pixels.
 * @returns The width to draw, in pixels.
 */
export function clampPlanWidth(areaWidth: number, wanted: number): number {
  const narrowest = Math.round(areaWidth * PLAN_MIN_SHARE);
  const widest = Math.round(areaWidth * PLAN_MAX_SHARE);
  return Math.max(narrowest, Math.min(widest, Math.round(wanted)));
}

/**
 * The width a plan takes when its edge is dragged to a point.
 *
 * The plan stands against the rail on the right of the chat area, so what is
 * measured is the room between the pointer and the rail: dragging the edge left
 * makes the plan wider, which is what dragging the left edge of something on
 * the right means.
 *
 * @param options - The chat area, where the pointer is, and where the drag began.
 * @param options.areaWidth - How wide the chat area is, in pixels.
 * @param options.pointerOffset - How far the pointer is from the area's left edge.
 * @param options.railWidth - How wide the rail is, in pixels.
 * @returns The width to draw, in pixels.
 */
export function planWidthFor(options: {
  areaWidth: number;
  pointerOffset: number;
  railWidth: number;
}): number {
  const { areaWidth, pointerOffset, railWidth } = options;
  return clampPlanWidth(areaWidth, areaWidth - railWidth - pointerOffset);
}

/**
 * The width a plan is first shown at.
 *
 * @param areaWidth - How wide the chat area is, in pixels.
 * @returns The width to draw, in pixels.
 */
export function defaultPlanWidth(areaWidth: number): number {
  return Math.round(areaWidth * PLAN_DEFAULT_SHARE);
}
