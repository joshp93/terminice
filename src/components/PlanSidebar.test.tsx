import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLAN_MIN_SHARE, PLAN_RAIL_WIDTH } from "../lib/planWidth";
import { PlanSidebar } from "./PlanSidebar";

/** The chat area the plan measures itself against, in jsdom's terms. */
const AREA_WIDTH = 1000;

const box = {
  left: 0,
  top: 0,
  width: AREA_WIDTH,
  height: 600,
  right: AREA_WIDTH,
  bottom: 600,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

/// jsdom lays nothing out, so every box is zero and nothing can be measured
/// against it. The chat area is given a size instead, which is what the plan's
/// width is a share of.
let measuring = false;

beforeEach(() => {
  measuring = true;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => (measuring ? AREA_WIDTH : 0),
  });
  Element.prototype.getBoundingClientRect = () => box;
});

afterEach(() => {
  measuring = false;
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
});

/** Renders the plan beside a chat area, as the workspace does. */
function renderSidebar(text = "1. Do the thing"): void {
  render(
    <div className="workspace">
      <div className="pane" />
      <PlanSidebar text={text} />
    </div>,
  );
}

const panel = (): HTMLElement | null => document.querySelector(".plan-panel");
const widthOf = (): number => Number.parseInt(panel()?.style.width ?? "", 10);

describe("PlanSidebar", () => {
  it("shows the plan, with the rail that it collapses into", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(panel()).not.toBeNull();
    expect(screen.getByText("Do the thing")).toBeInTheDocument();
  });

  it("opens at four tenths of the chat area", () => {
    renderSidebar();

    expect(widthOf()).toBe(AREA_WIDTH * 0.4);
  });

  /// The rail is what a plan is put aside into, so it is still there when the
  /// plan itself is not.
  it("collapses to the rail and comes back", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Plan" }));
    expect(panel()).toBeNull();
    expect(screen.getByRole("button", { name: "Plan" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Plan" }));
    expect(panel()).not.toBeNull();
  });

  it("closes from the button on the plan itself", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Hide the plan" }));

    expect(panel()).toBeNull();
  });

  /// The edge is the whole of the resizing, and a drag that leaves the edge has
  /// not stopped — so the pointer is followed on the window.
  it("follows a drag of its edge", () => {
    renderSidebar();
    const edge = screen.getByRole("separator", { name: "Resize the plan" });

    fireEvent.pointerDown(edge, { clientX: 600 });
    fireEvent.pointerMove(window, { clientX: 400 });

    expect(widthOf()).toBe(AREA_WIDTH - PLAN_RAIL_WIDTH - 400);
  });

  it("holds the drag to the range a plan may take", () => {
    renderSidebar();
    const edge = screen.getByRole("separator", { name: "Resize the plan" });

    fireEvent.pointerDown(edge, { clientX: 600 });
    fireEvent.pointerMove(window, { clientX: 990 });

    expect(widthOf()).toBe(Math.round(AREA_WIDTH * PLAN_MIN_SHARE));
  });

  /// A drag that has been let go of must not keep resizing the panel.
  it("stops following the pointer once the drag is let go", () => {
    renderSidebar();
    const edge = screen.getByRole("separator", { name: "Resize the plan" });

    fireEvent.pointerDown(edge, { clientX: 600 });
    fireEvent.pointerMove(window, { clientX: 300 });
    const dragged = widthOf();

    fireEvent.pointerUp(window);
    fireEvent.pointerMove(window, { clientX: 700 });

    expect(widthOf()).toBe(dragged);
  });

  /// Not every reader drags. The edge takes the keyboard and moves with the
  /// arrow keys, which is what makes the width reachable without a mouse.
  it("moves its edge with the arrow keys", () => {
    renderSidebar();
    const edge = screen.getByRole("separator", { name: "Resize the plan" });

    const before = widthOf();
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(widthOf()).toBe(before + 24);

    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(widthOf()).toBe(before);
  });

  it("leaves keys that are not arrows to whatever else wants them", () => {
    renderSidebar();
    const edge = screen.getByRole("separator", { name: "Resize the plan" });

    const before = widthOf();
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    edge.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(widthOf()).toBe(before);
  });
});
