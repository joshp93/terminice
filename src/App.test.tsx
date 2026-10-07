import { routeInvoke, sessionChannel } from "@test/tauriMock";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { ClaudeEvent, Settings } from "./types";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

const STARTUP_CWD = "D:\\apps\\demo";

beforeEach(() => {
  routeInvoke("startup_directory_command", () => STARTUP_CWD);
  routeInvoke("load_settings", () => ({ enterBehaviour: "send", theme: "dark" }));
  routeInvoke("save_settings", () => null);
  routeInvoke("list_sessions", () => []);
  routeInvoke("start_claude", () => "session-1");
  routeInvoke("send_claude_line", () => null);
  routeInvoke("close_claude", () => null);
});

describe("App", () => {
  it("renders the empty workspace before a session exists", async () => {
    render(<App />);

    expect(await screen.findByText("CLAUDE")).toBeInTheDocument();
    expect(screen.getByText("Do you like my nice green jacket?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
  });

  it("shows the directory the backend reports at startup", async () => {
    render(<App />);

    expect(await screen.findByText(STARTUP_CWD)).toBeInTheDocument();
  });

  it("applies the stored theme and font sizes to the document", async () => {
    routeInvoke("load_settings", () => ({
      enterBehaviour: "send",
      theme: "light",
      composerFontSize: "large",
      chatFontSize: "small",
    }));
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(document.documentElement.dataset.composerFont).toBe("large");
    expect(document.documentElement.dataset.chatFont).toBe("small");
  });

  it("leaves the font sizes at their defaults when the stored file predates them", async () => {
    routeInvoke("load_settings", () => {
      throw new Error("no settings file");
    });
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(document.documentElement.dataset.composerFont).toBe("medium");
    expect(document.documentElement.dataset.chatFont).toBe("medium");
  });

  it("shows the model and cost once the session reports them", async () => {
    render(<App />);

    await waitFor(() => sessionChannel<ClaudeEvent>());
    const events = sessionChannel<ClaudeEvent>();

    events.emit({
      kind: "line",
      line: JSON.stringify({
        type: "system",
        subtype: "init",
        cwd: "D:\\apps\\project",
        model: "sonnet",
      }),
    });
    expect(await screen.findByText("sonnet")).toBeInTheDocument();

    events.emit({ kind: "line", line: JSON.stringify({ type: "result", total_cost_usd: 0.25 }) });
    expect(await screen.findByText("$0.250")).toBeInTheDocument();
  });

  it("reports a session that could not be started instead of crashing", async () => {
    routeInvoke("start_claude", () => {
      throw new Error("claude not found");
    });
    render(<App />);

    expect(await screen.findByText(/claude not found/)).toBeInTheDocument();
    expect(screen.queryByText("Do you like my nice green jacket?")).not.toBeInTheDocument();
  });

  it("loads the stored settings and applies the theme", async () => {
    routeInvoke("load_settings", () => ({ enterBehaviour: "newline", theme: "light" }));
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "New line" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves a theme change made from the header", async () => {
    const saved: Settings[] = [];
    routeInvoke("save_settings", (args) => {
      saved.push(args.settings as Settings);
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    await waitFor(() => expect(saved).toEqual([{ enterBehaviour: "send", theme: "light" }]));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
