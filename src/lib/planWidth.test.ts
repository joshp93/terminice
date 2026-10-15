import { describe, expect, it } from "vitest";
import {
  clampPlanWidth,
  defaultPlanWidth,
  PLAN_DEFAULT_SHARE,
  PLAN_MAX_SHARE,
  PLAN_MIN_SHARE,
  PLAN_RAIL_WIDTH,
  planWidthFor,
} from "./planWidth";

describe("clampPlanWidth", () => {
  it("leaves a width inside the range alone", () => {
    expect(clampPlanWidth(1000, 400)).toBe(400);
  });

  /// Neither bound may swallow the transcript or the plan itself, whatever a
  /// drag asks for.
  it("holds a width to the shares a plan may take", () => {
    expect(clampPlanWidth(1000, 10)).toBe(Math.round(1000 * PLAN_MIN_SHARE));
    expect(clampPlanWidth(1000, 990)).toBe(Math.round(1000 * PLAN_MAX_SHARE));
    expect(clampPlanWidth(1000, -50)).toBe(Math.round(1000 * PLAN_MIN_SHARE));
  });
});

describe("defaultPlanWidth", () => {
  it("opens at four tenths of the chat area", () => {
    expect(defaultPlanWidth(1000)).toBe(1000 * PLAN_DEFAULT_SHARE);
    expect(PLAN_DEFAULT_SHARE).toBe(0.4);
  });
});

describe("planWidthFor", () => {
  /// The plan stands against the rail, so the width is the room between the
  /// pointer and the rail — dragging left makes it wider.
  it("measures from the pointer to the rail", () => {
    expect(planWidthFor({ areaWidth: 1000, pointerOffset: 500, railWidth: PLAN_RAIL_WIDTH })).toBe(
      1000 - PLAN_RAIL_WIDTH - 500,
    );
  });

  it("makes the plan wider as the edge is dragged left", () => {
    const wide = planWidthFor({ areaWidth: 1000, pointerOffset: 300, railWidth: PLAN_RAIL_WIDTH });
    const narrow = planWidthFor({
      areaWidth: 1000,
      pointerOffset: 700,
      railWidth: PLAN_RAIL_WIDTH,
    });

    expect(wide).toBeGreaterThan(narrow);
  });

  it("stops at the bounds rather than following the pointer past them", () => {
    expect(planWidthFor({ areaWidth: 1000, pointerOffset: 0, railWidth: PLAN_RAIL_WIDTH })).toBe(
      Math.round(1000 * PLAN_MAX_SHARE),
    );
    expect(planWidthFor({ areaWidth: 1000, pointerOffset: 1000, railWidth: PLAN_RAIL_WIDTH })).toBe(
      Math.round(1000 * PLAN_MIN_SHARE),
    );
  });
});
