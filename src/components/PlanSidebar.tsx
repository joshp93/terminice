import { useCallback, useEffect, useRef, useState } from "react";
import { clampPlanWidth, defaultPlanWidth, PLAN_RAIL_WIDTH, planWidthFor } from "../lib/planWidth";
import { MessageBubble } from "./MessageBubble";
import { PlanIcon } from "./PlanIcon";

/** Props for {@link PlanSidebar}. */
export type PlanSidebarProps = {
  /** The plan, as the reply that wrote it did. */
  text: string;
};

/** How far an arrow key moves the edge when the keyboard is doing the resizing. */
const KEYBOARD_STEP_PX = 24;

/**
 * Finds the chat area a plan is drawn beside.
 *
 * The width a plan may take is a share of the area it shares with the
 * transcript, so that is what is measured — not the window, which also holds
 * the window bar and the composer, and not the sidebar itself, which is sized
 * by the plan inside it.
 *
 * @param panel - The plan's own box.
 * @returns The chat area, or null when it is not on screen.
 */
function chatAreaOf(panel: HTMLElement | null): HTMLElement | null {
  return panel?.closest<HTMLElement>(".workspace") ?? null;
}

/**
 * Shows the plan beside the transcript, at a width the reader sets.
 *
 * A plan is long, and the card that asks for it to be approved has the buttons
 * rather than the room: this is the same plan given the height of the chat area
 * to be read in, which is what a decision about it wants. It stands at four
 * tenths of the chat area to begin with, and its edge can be dragged or moved
 * with the arrow keys.
 *
 * It collapses to the rail it hangs from rather than closing, so putting a plan
 * aside while something else is looked at and coming back to it is one press
 * each way. It is drawn only while a plan is waiting to be approved, which is
 * what makes deciding on it — either way — take it off the screen.
 *
 * @param props - The plan to show.
 * @returns The rendered sidebar.
 */
export function PlanSidebar({ text }: PlanSidebarProps) {
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState<number | null>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  const panelRef = useRef<HTMLElement | null>(null);

  /**
   * Keeps the width of the chat area, which is what the plan's own width is
   * bounded by and what it is measured as a share of.
   */
  useEffect(() => {
    if (!open) return;
    const area = chatAreaOf(panelRef.current);
    if (!area) return;

    const measure = (): void => setAreaWidth(area.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [open]);

  /**
   * Gives the plan the width it opens at, once there is an area to measure.
   */
  useEffect(() => {
    if (width !== null || areaWidth === 0) return;
    setWidth(defaultPlanWidth(areaWidth));
  }, [areaWidth, width]);

  /**
   * Follows the pointer while the edge is being dragged.
   *
   * The listeners are on the window rather than on the edge itself, because a
   * drag that leaves the few pixels the edge occupies has not stopped.
   */
  const startDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const area = chatAreaOf(panelRef.current);
    if (!area) return;
    const bounds = area.getBoundingClientRect();
    event.preventDefault();

    const onMove = (moveEvent: PointerEvent): void => {
      setWidth(
        planWidthFor({
          areaWidth: bounds.width,
          pointerOffset: moveEvent.clientX - bounds.left,
          railWidth: PLAN_RAIL_WIDTH,
        }),
      );
    };
    const onStop = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onStop);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onStop);
  }, []);

  /**
   * Moves the edge with the arrow keys, for a reader who is not using a mouse.
   *
   * @param event - The key press.
   */
  const onEdgeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step =
        event.key === "ArrowLeft"
          ? KEYBOARD_STEP_PX
          : event.key === "ArrowRight"
            ? -KEYBOARD_STEP_PX
            : 0;
      if (step === 0) return;

      event.preventDefault();
      setWidth((current) => clampPlanWidth(areaWidth, (current ?? 0) + step));
    },
    [areaWidth],
  );

  return (
    <div className="plan-sidebar">
      {open && (
        <section
          className="plan-panel"
          style={width === null ? undefined : { width: `${width}px` }}
          aria-label="Plan"
          ref={panelRef}
        >
          {/* A rule between two things, which is what a divider is — and the
              one element whose own role is a separator. */}
          <hr
            className="plan-resizer"
            aria-orientation="vertical"
            aria-label="Resize the plan"
            aria-valuenow={width ?? 0}
            aria-valuemin={0}
            aria-valuemax={areaWidth === 0 ? 0 : clampPlanWidth(areaWidth, areaWidth)}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={onEdgeKeyDown}
          />
          <div className="plan-head">
            <span className="plan-heading">Plan</span>
            <button
              type="button"
              className="plan-hide"
              aria-label="Hide the plan"
              title="Hide the plan"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="plan-body">
            <MessageBubble text={text} />
          </div>
        </section>
      )}
      <div className="plan-rail">
        <button
          type="button"
          className={open ? "plan-rail-button on" : "plan-rail-button"}
          aria-label="Plan"
          aria-pressed={open}
          title={open ? "Hide the plan" : "Show the plan"}
          onClick={() => setOpen((current) => !current)}
        >
          <PlanIcon size={18} />
        </button>
      </div>
    </div>
  );
}
