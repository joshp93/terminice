import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/// The Tauri window the controls talk to, with the same shape the real one has.
const tauri = vi.hoisted(() => ({
  minimize: vi.fn(async () => undefined),
  toggleMaximize: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  isMaximized: vi.fn(async () => false),
  onResized: vi.fn(async (handler: () => void) => {
    tauri.resizedBy = handler;
    return () => {
      tauri.resizedBy = null;
    };
  }),
  resizedBy: null as null | (() => void),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => tauri }));

const { WindowControls } = await import("./WindowControls");

beforeEach(() => {
  vi.clearAllMocks();
  tauri.isMaximized.mockResolvedValue(false);
  tauri.onResized.mockImplementation(async (handler: () => void) => {
    tauri.resizedBy = handler;
    return () => {
      tauri.resizedBy = null;
    };
  });
});

describe("WindowControls", () => {
  it("draws the three controls every window has", async () => {
    render(<WindowControls />);

    expect(screen.getByRole("button", { name: "Minimise" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximise" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("minimises, maximises and closes the window", async () => {
    const user = userEvent.setup();
    render(<WindowControls />);

    await user.click(screen.getByRole("button", { name: "Minimise" }));
    await user.click(screen.getByRole("button", { name: "Maximise" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(tauri.minimize).toHaveBeenCalledTimes(1);
    expect(tauri.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(tauri.close).toHaveBeenCalledTimes(1);
  });

  /// A maximised window's middle control offers to restore it, and it is read
  /// from the window rather than remembered: the bar can be double-clicked too.
  it("offers to restore a window that is already maximised", async () => {
    tauri.isMaximized.mockResolvedValue(true);
    render(<WindowControls />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument(),
    );
  });

  /// The window can be maximised by double-clicking the bar, or restored by a
  /// keyboard shortcut, and the control has to keep up with either.
  it("follows the window being resized", async () => {
    render(<WindowControls />);
    await waitFor(() => expect(tauri.resizedBy).not.toBeNull());

    tauri.isMaximized.mockResolvedValue(true);
    tauri.resizedBy?.();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument(),
    );
  });
});
