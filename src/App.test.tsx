import { routeInvoke, sessionChannel } from "@test/tauriMock";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { DEFAULT_CHAT_FONT_SIZE, DEFAULT_COMPOSER_FONT_SIZE } from "./lib/fontSize";
import { type ClaudeEvent, createDefaultSettings, type Settings } from "./types";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

const STARTUP_CWD = "D:\\apps\\demo";

/** A speech engine with its model already in place. */
const VOICE_STATUS = {
  modelPath: "C:\\Users\\demo\\.config\\terminice\\ggml-base.en.bin",
  modelPresent: true,
  modelBytes: 147_951_465,
};

/** Stored settings, complete, so a field the test does not name is still there. */
const stored = (overrides: Partial<Settings> = {}): Settings => ({
  ...createDefaultSettings(),
  ...overrides,
});

/** Reads one of the custom properties the settings are written to. */
const cssVariable = (name: string): string => document.documentElement.style.getPropertyValue(name);

beforeEach(() => {
  routeInvoke("startup_directory_command", () => STARTUP_CWD);
  routeInvoke("load_settings", () => stored());
  routeInvoke("save_settings", () => null);
  routeInvoke("list_sessions", () => []);
  routeInvoke("start_claude", () => "session-1");
  routeInvoke("send_claude_line", () => null);
  routeInvoke("close_claude", () => null);
  routeInvoke("voice_status", () => VOICE_STATUS);
  routeInvoke("start_voice_recording", () => null);
  routeInvoke("stop_voice_recording", () => null);
  routeInvoke("download_voice_model", () => null);
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
    routeInvoke("load_settings", () =>
      stored({ theme: "light", composerFontSize: 15, chatFontSize: 12.5 }),
    );
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(cssVariable("--composer-font-size")).toBe("15px");
    expect(cssVariable("--chat-font-size")).toBe("12.5px");
  });

  it("puts the chosen code font in front of the built-in monospace stack", async () => {
    routeInvoke("load_settings", () => stored({ fontFamily: "Hack" }));
    render(<App />);

    await waitFor(() => expect(cssVariable("--font-mono")).toContain("Hack"));
    expect(cssVariable("--font-mono")).toContain("MesloLGLDZ Nerd Font Mono");
  });

  it("puts the chosen app font in front of the built-in interface stack", async () => {
    routeInvoke("load_settings", () => stored({ appFontFamily: "Georgia" }));
    render(<App />);

    await waitFor(() => expect(cssVariable("--font-ui")).toContain("Georgia"));
    expect(cssVariable("--font-ui")).toContain("Segoe UI");
  });

  it("keeps the two font settings apart", async () => {
    routeInvoke("load_settings", () => stored({ fontFamily: "Hack" }));
    render(<App />);

    await waitFor(() => expect(cssVariable("--font-mono")).toContain("Hack"));
    expect(cssVariable("--font-ui")).not.toContain("Hack");
  });

  it("leaves the font sizes at their defaults when the stored file predates them", async () => {
    routeInvoke("load_settings", () => {
      throw new Error("no settings file");
    });
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(cssVariable("--composer-font-size")).toBe(`${DEFAULT_COMPOSER_FONT_SIZE}px`);
    expect(cssVariable("--chat-font-size")).toBe(`${DEFAULT_CHAT_FONT_SIZE}px`);
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
    routeInvoke("load_settings", () => stored({ enterBehaviour: "newline", theme: "light" }));
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "New line" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  /// The tracker and the transcript are two halves of one workspace, so this
  /// covers the wiring that joins them rather than either half on its own.
  it("jumps from a running shell in the tracker to its card in the transcript", async () => {
    render(<App />);

    await waitFor(() => sessionChannel<ClaudeEvent>());
    sessionChannel<ClaudeEvent>().emit({
      kind: "line",
      line: JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pnpm test" } },
          ],
        },
      }),
    });

    const tool = await screen.findByRole("button", { name: /^Bash/ });
    expect(tool).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(screen.getByRole("button", { name: "1 shell running" }));

    expect(screen.getByRole("button", { name: /^Bash/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("offers no tracker at all while the session is idle", async () => {
    render(<App />);

    await screen.findByText("CLAUDE");

    expect(screen.queryByText(/running$/)).toBeNull();
  });

  it("remembers that dictation was turned on", async () => {
    const saved: Settings[] = [];
    routeInvoke("save_settings", (args) => {
      saved.push(args.settings as Settings);
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Hold space" }));

    await waitFor(() => expect(saved).toEqual([stored({ voiceEnabled: true })]));
  });

  it("shows the model the backend found", async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect(await screen.findByText("141 MB on disk")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("leaves dictation off until it is asked for, whichever way the model is", async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("button", { name: "Off" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("saves a theme change made from the header", async () => {
    const saved: Settings[] = [];
    routeInvoke("save_settings", (args) => {
      saved.push(args.settings as Settings);
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    await waitFor(() => expect(saved).toEqual([stored({ theme: "light" })]));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
