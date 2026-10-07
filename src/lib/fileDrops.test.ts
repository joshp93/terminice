import { beforeEach, describe, expect, it, vi } from "vitest";

const { onDragDropEvent } = vi.hoisted(() => ({ onDragDropEvent: vi.fn() }));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

import { subscribeToFileDrops } from "./fileDrops";

/** The handler the module registered with Tauri. */
function registered(): (event: { payload: unknown }) => void {
  const call = onDragDropEvent.mock.calls[0];
  if (!call) throw new Error("nothing was subscribed");
  return call[0] as (event: { payload: unknown }) => void;
}

beforeEach(() => {
  onDragDropEvent.mockReturnValue(() => undefined);
});

describe("subscribeToFileDrops", () => {
  it("subscribes to the webview's drag-drop events", async () => {
    await subscribeToFileDrops(() => undefined);
    expect(onDragDropEvent).toHaveBeenCalledTimes(1);
  });

  it("reports the paths of a drop", async () => {
    const handler = vi.fn();
    await subscribeToFileDrops(handler);

    registered()({ payload: { type: "drop", paths: ["D:\\a.txt", "D:\\b.txt"] } });

    expect(handler).toHaveBeenCalledWith(["D:\\a.txt", "D:\\b.txt"]);
  });

  it("ignores the enter and leave phases of a drag", async () => {
    const handler = vi.fn();
    await subscribeToFileDrops(handler);

    registered()({ payload: { type: "enter", paths: ["D:\\a.txt"], position: { x: 0, y: 0 } } });
    registered()({ payload: { type: "over", position: { x: 0, y: 0 } } });
    registered()({ payload: { type: "leave" } });

    expect(handler).not.toHaveBeenCalled();
  });

  it("returns the unlisten function Tauri gave it", async () => {
    const unlisten = vi.fn();
    onDragDropEvent.mockReturnValue(unlisten);

    const stop = await subscribeToFileDrops(() => undefined);
    stop();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
