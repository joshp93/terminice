import { fakeVoice } from "@test/fakeVoice";
import { invoke, routeInvoke } from "@test/tauriMock";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RunningGroup } from "../lib/runningTools";
import type { SlashMenuHost } from "../lib/slashMenu";
import { Composer, type ComposerProps } from "./Composer";

function supportLayoutMeasurement(): void {
  Element.prototype.scrollIntoView = () => undefined;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

supportLayoutMeasurement();

function createMenuHost(overrides: Partial<SlashMenuHost> = {}): SlashMenuHost {
  return {
    catalogue: null,
    contextUsage: null,
    mcpServers: [],
    plugins: [],
    skills: [],
    permissionMode: "default",
    sessions: [],
    runCommand: vi.fn(),
    setPermissionMode: vi.fn(),
    setModel: vi.fn(),
    currentModel: "",
    openTerminiceSettings: vi.fn(),
    newSession: vi.fn(),
    resumeSession: vi.fn(),
    refreshSessions: vi.fn(),
    refreshMcp: vi.fn(),
    ...overrides,
  };
}

function paste(element: Element, text: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  fireEvent(element, event);
}

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const onSend = vi.fn();
  const onRunShell = vi.fn();
  const onCycleMode = vi.fn();
  const onStop = vi.fn();
  const onSuggestFiles = vi.fn(async () => [] as string[]);

  const props: ComposerProps = {
    submitsOnEnter: () => true,
    menu: createMenuHost(),
    running: false,
    thinkingTokens: 0,
    trackers: [],
    suggestion: null,
    fastMode: false,
    fastModeTitle: "",
    sessionId: null,
    onSend,
    onRunShell,
    onCycleMode,
    onReveal: vi.fn(),
    voice: fakeVoice(),
    onStop,
    onSuggestFiles,
    ...overrides,
  };

  const view = render(<Composer {...props} />);

  const content = view.container.querySelector(".cm-content");
  if (!(content instanceof HTMLElement)) throw new Error("the composer did not mount");
  const host = view.container.querySelector(".composer-host");
  if (!(host instanceof HTMLElement)) throw new Error("the composer host is missing");

  return {
    onSend,
    onRunShell,
    onCycleMode,
    onStop,
    onSuggestFiles,
    props,
    content,
    host,
    container: view.container,
    rerender: view.rerender,
  };
}

function text(container: HTMLElement): string {
  return [...container.querySelectorAll(".cm-line")]
    .map((line) => {
      const copy = line.cloneNode(true) as HTMLElement;
      for (const placeholder of copy.querySelectorAll(".cm-placeholder")) placeholder.remove();
      return copy.textContent ?? "";
    })
    .join("\n");
}

const lineCount = (container: HTMLElement): number => container.querySelectorAll(".cm-line").length;

describe("the ! shell prefix", () => {
  it("runs the line locally instead of sending it to Claude", () => {
    const { content, onSend, onRunShell } = renderComposer();
    paste(content, "!ls");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onRunShell).toHaveBeenCalledWith("ls");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("strips the prefix and trims the command it is given", () => {
    const { content, onRunShell } = renderComposer();
    paste(content, "!   git status  ");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onRunShell).toHaveBeenCalledWith("git status");
  });

  it("marks the field as a shell while the line carries the prefix", () => {
    const { content, host } = renderComposer();

    paste(content, "!");

    expect(host).toHaveClass("shell");
  });

  it("leaves an ordinary line for Claude", () => {
    const { content, onSend, onRunShell } = renderComposer();
    paste(content, "hello");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("hello");
    expect(onRunShell).not.toHaveBeenCalled();
  });

  it("does not treat a prefix that is not at the start as a command", () => {
    const { content, onSend, onRunShell } = renderComposer();
    paste(content, "echo !ls");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("echo !ls");
    expect(onRunShell).not.toHaveBeenCalled();
  });

  it("counts only a leading prefix, so leading whitespace goes to Claude", () => {
    const { content, host, onSend, onRunShell } = renderComposer();
    paste(content, "  !ls");

    expect(host).not.toHaveClass("shell");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onRunShell).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith("  !ls");
  });
});

describe("the Send button", () => {
  it("is marked inactive while there is nothing to send", () => {
    renderComposer();
    const send = screen.getByRole("button", { name: "Send" });

    expect(send).toHaveClass("disabled");
    expect(send).toHaveAttribute("aria-disabled", "true");
  });

  it("stops being marked inactive once something has been typed", () => {
    const { content } = renderComposer();
    paste(content, "hello");

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).not.toHaveClass("disabled");
    expect(send).toHaveAttribute("aria-disabled", "false");
  });

  it("stays focusable, because a bare Tab is meant to land on it", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("sends nothing when it is pressed with an empty field", () => {
    const { onSend, onRunShell } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).not.toHaveBeenCalled();
    expect(onRunShell).not.toHaveBeenCalled();
  });
});

describe("Enter", () => {
  it("sends the line when the setting says Enter sends", () => {
    const { content, onSend } = renderComposer();
    paste(content, "ship it");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("ship it");
  });

  it("inserts a newline when the setting says Enter does not send", () => {
    const { content, container, onSend } = renderComposer({ submitsOnEnter: () => false });
    paste(content, "one");

    fireEvent.keyDown(content, { key: "Enter" });
    paste(content, "two");

    expect(onSend).not.toHaveBeenCalled();
    expect(lineCount(container)).toBe(2);
  });

  it("reads the setting again on every keypress", () => {
    let sends = true;
    const { content, onSend } = renderComposer({ submitsOnEnter: () => sends });
    paste(content, "first");
    fireEvent.keyDown(content, { key: "Enter" });

    sends = false;
    paste(content, "second");
    fireEvent.keyDown(content, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("first");
  });

  it("always inserts a newline on Shift+Enter, even while Enter sends", () => {
    const { content, container, onSend } = renderComposer();
    paste(content, "one");

    fireEvent.keyDown(content, { key: "Enter", shiftKey: true });
    paste(content, "two");

    expect(onSend).not.toHaveBeenCalled();
    expect(lineCount(container)).toBe(2);
  });

  it("empties the field once the line has been sent", () => {
    const { content, container, onSend } = renderComposer();
    paste(content, "byebye");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("byebye");
    expect(text(container)).toBe("");
    expect(lineCount(container)).toBe(1);
  });

  it("sends nothing for an empty field", () => {
    const { content, onSend } = renderComposer();

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends nothing for a line of whitespace", () => {
    const { content, onSend } = renderComposer();
    paste(content, "   ");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("the message history kept on disk", () => {
  const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const OTHER = "11111111-2222-3333-4444-555555555555";
  const error = () => screen.queryByText(/Could not .* your message history/);

  /**
   * Registers both commands.
   *
   * Routes are the test's to set, rather than the default being registered here:
   * doing it here would quietly replace the one a test had just set up to fail.
   */
  const routeHistory = (
    load: (args: Record<string, unknown>) => string[] = () => [],
    save: (args: Record<string, unknown>) => void = () => undefined,
  ): void => {
    routeInvoke("load_user_history", load);
    routeInvoke("save_user_history", save);
  };

  /** Renders a composer belonging to a session, and lets its load settle. */
  async function renderForSession(session: string) {
    const view = renderComposer({ sessionId: session });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("load_user_history", { session }));
    await act(async () => undefined);
    return view;
  }

  it("recalls what the session was sent before, so it outlives the window", async () => {
    routeHistory(() => ["from last time"]);
    const { content, container } = await renderForSession(SESSION);

    fireEvent.keyDown(content, { key: "ArrowUp" });

    expect(text(container)).toBe("from last time");
  });

  it("writes each message as it is sent", async () => {
    const written: string[][] = [];
    routeHistory(
      () => [],
      (args) => written.push(args.messages as string[]),
    );
    const { content } = await renderForSession(SESSION);

    paste(content, "first");
    fireEvent.keyDown(content, { key: "Enter" });
    await act(async () => undefined);

    expect(written.at(-1)).toEqual(["first"]);
  });

  it("writes the whole history, not only the message just sent", async () => {
    const written: string[][] = [];
    routeHistory(
      () => ["older"],
      (args) => written.push(args.messages as string[]),
    );
    const { content } = await renderForSession(SESSION);

    paste(content, "newer");
    fireEvent.keyDown(content, { key: "Enter" });
    await act(async () => undefined);

    expect(written.at(-1)).toEqual(["older", "newer"]);
  });

  it("says nothing while the history is being kept", async () => {
    routeHistory();
    const { content } = await renderForSession(SESSION);

    paste(content, "first");
    fireEvent.keyDown(content, { key: "Enter" });
    await act(async () => undefined);

    expect(error()).toBeNull();
  });

  it("says so under the composer when a save fails, and why", async () => {
    routeHistory(
      () => [],
      () => {
        throw new Error("access is denied");
      },
    );
    const { content } = await renderForSession(SESSION);

    paste(content, "first");
    fireEvent.keyDown(content, { key: "Enter" });

    expect(await screen.findByText(/Could not save your message history/)).toBeInTheDocument();
    expect(await screen.findByText(/access is denied/)).toBeInTheDocument();
  });

  it("takes the message away once saving works again", async () => {
    let failing = true;
    routeHistory(
      () => [],
      () => {
        if (failing) throw new Error("access is denied");
      },
    );
    const { content } = await renderForSession(SESSION);
    paste(content, "first");
    fireEvent.keyDown(content, { key: "Enter" });
    expect(await screen.findByText(/access is denied/)).toBeInTheDocument();

    failing = false;
    paste(content, "second");
    fireEvent.keyDown(content, { key: "Enter" });

    await waitFor(() => expect(error()).toBeNull());
  });

  it("says so under the composer when the history cannot be read", async () => {
    routeHistory(() => {
      throw new Error("no such folder");
    });
    renderComposer({ sessionId: SESSION });

    expect(await screen.findByText(/Could not read your message history/)).toBeInTheDocument();
    expect(await screen.findByText(/no such folder/)).toBeInTheDocument();
  });

  it("does not carry one session's messages into the next", async () => {
    routeHistory((args) => (args.session === SESSION ? ["from the first"] : []));
    const { content, container, props, rerender } = await renderForSession(SESSION);
    fireEvent.keyDown(content, { key: "ArrowUp" });
    expect(text(container)).toBe("from the first");

    rerender(<Composer {...props} sessionId={OTHER} />);
    await act(async () => undefined);
    fireEvent.keyDown(content, { key: "Escape" });
    fireEvent.keyDown(content, { key: "ArrowUp" });

    expect(text(container)).toBe("");
  });
});
describe("a menu entry with a submenu", () => {
  const sessions = [
    {
      id: "aaaa1111-2222",
      modified: 1_700_000_000_000,
      bytes: 10,
      preview: "Fix the parser",
      live: false,
    },
    {
      id: "bbbb3333-4444",
      modified: 1_700_000_000_000,
      bytes: 10,
      preview: "Add the tests",
      live: false,
    },
  ];
  const withSessions = () => renderComposer({ menu: createMenuHost({ sessions }) });

  /** Opens `/resume` from a partly typed command. */
  const openResume = (content: HTMLElement): void => {
    paste(content, "/resume");
    fireEvent.keyDown(content, { key: "Enter" });
  };

  it("puts the whole command in the composer, so the rows read as its argument", () => {
    const { content, container } = withSessions();

    openResume(content);

    expect(text(container)).toBe("/resume ");
  });

  it("shows the rows the command offers", () => {
    const { content } = withSessions();

    openResume(content);

    expect(screen.getByRole("option", { name: /Fix the parser/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Add the tests/ })).toBeInTheDocument();
  });

  it("filters those rows by what is typed after the command", () => {
    const { content } = withSessions();
    openResume(content);

    paste(content, "tests");

    expect(screen.queryByRole("option", { name: /Fix the parser/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Add the tests/ })).toBeInTheDocument();
  });

  it("puts the composer back when the submenu is backed out of", () => {
    const { content, container } = withSessions();
    openResume(content);

    fireEvent.keyDown(content, { key: "Escape" });

    expect(text(container)).toBe("/resume");
    expect(screen.getByRole("option", { name: /^\/resume/ })).toBeInTheDocument();
  });

  it("leaves the composer alone for a row that is not a command", () => {
    const { content, container } = renderComposer();
    paste(content, "/perm");
    fireEvent.keyDown(content, { key: "Enter" });

    expect(text(container)).toBe("/perm");
    expect(screen.getByText("Permission mode")).toBeInTheDocument();
  });

  it("leaves the composer alone when Tab is pressed on a row inside a submenu", () => {
    const { content, container } = withSessions();
    openResume(content);

    fireEvent.keyDown(content, { key: "Tab" });

    expect(text(container)).toBe("/resume ");
    expect(screen.getByRole("option", { name: /Fix the parser/ })).toBeInTheDocument();
  });
});

describe("recalling what has been sent", () => {
  /** Sends a line, leaving the composer empty and the line in the history. */
  const send = (content: HTMLElement, line: string): void => {
    paste(content, line);
    fireEvent.keyDown(content, { key: "Enter" });
  };

  it("brings back the last thing sent when Up is pressed on an empty composer", () => {
    const { content, container } = renderComposer();
    send(content, "first");
    expect(text(container)).toBe("");

    fireEvent.keyDown(content, { key: "ArrowUp" });

    expect(text(container)).toBe("first");
  });

  it("leaves the caret at the very start, so one more Up goes further back", () => {
    const { content, container } = renderComposer();
    send(content, "first");
    send(content, "second");

    fireEvent.keyDown(content, { key: "ArrowUp" });
    expect(text(container)).toBe("second");

    fireEvent.keyDown(content, { key: "ArrowUp" });

    expect(text(container)).toBe("first");
  });

  it("walks back down from the start to whatever was half-written", () => {
    const { content, container } = renderComposer();
    send(content, "first");
    fireEvent.keyDown(content, { key: "ArrowUp" });

    fireEvent.keyDown(content, { key: "ArrowDown" });

    expect(text(container)).toBe("");
  });

  it("takes Down from the start of a command, whose end belongs to its menu", () => {
    const { content, container } = renderComposer();
    // The trailing space closes the menu, so Enter sends the line rather than
    // being read by the menu as a choice from it.
    send(content, "/clear ");
    fireEvent.keyDown(content, { key: "ArrowUp" });
    expect(text(container)).toBe("/clear");

    fireEvent.keyDown(content, { key: "ArrowDown" });

    expect(text(container)).toBe("");
  });
});

describe("F6", () => {
  it("puts the keyboard in the composer from elsewhere in the window", () => {
    const { content } = renderComposer();
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    expect(send).toHaveFocus();

    fireEvent.keyDown(document, { key: "F6" });

    expect(content).toHaveFocus();
  });

  it("keeps the key to itself rather than letting the window act on it", () => {
    renderComposer();

    const event = new KeyboardEvent("keydown", { key: "F6", bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves every other key to the composer", () => {
    renderComposer();

    const event = new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("Tab", () => {
  it("leaves the composer for the Send button rather than inserting a tab while Enter sends", () => {
    const { content, container, onSend } = renderComposer();
    paste(content, "hi");

    fireEvent.keyDown(content, { key: "Tab" });

    expect(screen.getByRole("button", { name: "Send" })).toHaveFocus();
    expect(onSend).not.toHaveBeenCalled();
    expect(text(container)).toBe("hi");
  });

  it("cycles the permission mode on Shift+Tab when the line is not a list", () => {
    const { content, container, onCycleMode } = renderComposer();
    paste(content, "plain line");

    fireEvent.keyDown(content, { key: "Tab", shiftKey: true });

    expect(onCycleMode).toHaveBeenCalledTimes(1);
    expect(text(container)).toBe("plain line");
  });

  it("indents a list line on Tab rather than leaving the composer", () => {
    const { content, container, onCycleMode } = renderComposer();
    paste(content, "- item");

    fireEvent.keyDown(content, { key: "Tab" });

    expect(text(container)).toBe("  - item");
    expect(screen.getByRole("button", { name: "Send" })).not.toHaveFocus();
    expect(onCycleMode).not.toHaveBeenCalled();
  });

  it("outdents a list line on Shift+Tab rather than cycling the permission mode", () => {
    const { content, container, onCycleMode } = renderComposer();
    paste(content, "  - item");

    fireEvent.keyDown(content, { key: "Tab", shiftKey: true });

    expect(text(container)).toBe("- item");
    expect(onCycleMode).not.toHaveBeenCalled();
  });

  it("walks a list in and back out again a level at a time", () => {
    const { content, container } = renderComposer();
    paste(content, "- item");

    fireEvent.keyDown(content, { key: "Tab" });
    fireEvent.keyDown(content, { key: "Tab" });
    expect(text(container)).toBe("    - item");

    fireEvent.keyDown(content, { key: "Tab", shiftKey: true });
    expect(text(container)).toBe("  - item");
  });

  it("indents a list line on Ctrl+]", () => {
    const { content, container } = renderComposer();
    paste(content, "- item");

    fireEvent.keyDown(content, { key: "]", ctrlKey: true });

    expect(text(container)).toBe("  - item");
  });

  it("outdents a list line on Ctrl+[", () => {
    const { content, container } = renderComposer();
    paste(content, "  - item");

    fireEvent.keyDown(content, { key: "[", ctrlKey: true });

    expect(text(container)).toBe("- item");
  });
});

describe("the slash menu", () => {
  it("opens once the text starts with a slash", () => {
    const { content } = renderComposer();

    paste(content, "/");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Terminice settings")).toBeInTheDocument();
  });

  it("stays shut for text that does not start with a slash", () => {
    const { content } = renderComposer();

    paste(content, "hello");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("narrows the list to what has been typed", () => {
    const { content } = renderComposer();

    paste(content, "/cle");

    expect(screen.getByText("/clear")).toBeInTheDocument();
    expect(screen.queryByText("/model")).not.toBeInTheDocument();
  });
});

describe("the file menu", () => {
  const suggest = (paths: string[]) => vi.fn(async () => paths);

  it("asks for matches once an @ mention has two characters", async () => {
    const onSuggestFiles = suggest(["src/App.tsx"]);
    const { content } = renderComposer({ onSuggestFiles });

    paste(content, "@App");

    await waitFor(() => expect(screen.getByText("src/App.tsx")).toBeInTheDocument());
    expect(onSuggestFiles).toHaveBeenCalledWith("App");
  });

  it("waits for a second character before asking", () => {
    const onSuggestFiles = suggest(["src/App.tsx"]);
    const { content } = renderComposer({ onSuggestFiles });

    paste(content, "@A");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSuggestFiles).not.toHaveBeenCalled();
  });

  it("ignores an @ that does not open a word", () => {
    const onSuggestFiles = suggest(["src/App.tsx"]);
    const { content } = renderComposer({ onSuggestFiles });

    paste(content, "mail me@App");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSuggestFiles).not.toHaveBeenCalled();
  });

  it("takes Enter as choosing a file rather than sending the line", async () => {
    const onSuggestFiles = suggest(["src/App.tsx"]);
    const { content, container, onSend } = renderComposer({ onSuggestFiles });
    paste(content, "@App");
    await waitFor(() => expect(screen.getByText("src/App.tsx")).toBeInTheDocument());

    fireEvent.keyDown(content, { key: "Enter" });

    expect(text(container)).toBe("@src/App.tsx ");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("replaces only the mention and leaves the rest of the sentence alone", async () => {
    const onSuggestFiles = suggest(["src/App.tsx"]);
    const { content, container } = renderComposer({ onSuggestFiles });
    paste(content, "see @App for it");
    for (let step = 0; step < 7; step += 1) fireEvent.keyDown(content, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByText("src/App.tsx")).toBeInTheDocument());

    fireEvent.keyDown(content, { key: "Enter" });

    expect(text(container)).toBe("see @src/App.tsx  for it");
  });
});

describe("the formatting toolbar", () => {
  it("arms bold from its shortcut and disarms it on a second press", () => {
    const { content } = renderComposer();
    const bold = screen.getByRole("button", { name: "Bold" });

    fireEvent.keyDown(content, { key: "b", ctrlKey: true });
    expect(bold).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(content, { key: "b", ctrlKey: true });
    expect(bold).toHaveAttribute("aria-pressed", "false");
  });

  it("arms italic, code and strikethrough from their shortcuts", () => {
    const { content } = renderComposer();

    fireEvent.keyDown(content, { key: "i", ctrlKey: true });
    fireEvent.keyDown(content, { key: "e", ctrlKey: true });
    fireEvent.keyDown(content, { key: "x", ctrlKey: true, shiftKey: true });

    expect(screen.getByRole("button", { name: "Italic" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Inline code" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Strikethrough" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("arms a style from its toolbar button", () => {
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  });

  it("turns a line into a bulleted list from the toolbar", () => {
    const { content, container } = renderComposer();
    paste(content, "first");

    fireEvent.click(screen.getByRole("button", { name: "Bulleted list" }));

    expect(text(container)).toBe("- first");
  });

  it("sends literal Markdown rather than a stripped version of it", () => {
    const { content, onSend } = renderComposer();
    paste(content, "- item\n**bold** and `code`");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("- item\n**bold** and `code`");
  });
});

describe("the quote button", () => {
  const quote = () => screen.getByRole("button", { name: "Quote" });

  it("comes last of the buttons that write markers, after the lists", () => {
    const { container } = renderComposer();

    const buttons = [
      ...container.querySelectorAll(".format-toolbar .format-button:not(.preview-toggle)"),
    ];

    expect(buttons.at(-1)).toHaveAccessibleName("Quote");
  });

  it("prefixes the line, and takes the prefix off again", () => {
    const { content, container } = renderComposer();
    paste(content, "quoted words");
    expect(quote()).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(quote());
    expect(text(container)).toBe("> quoted words");
    expect(quote()).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(quote());
    expect(text(container)).toBe("quoted words");
    expect(quote()).toHaveAttribute("aria-pressed", "false");
  });

  it("quotes the list item rather than replacing the list with it", () => {
    const { content, container } = renderComposer();
    paste(content, "- item");

    fireEvent.click(quote());

    expect(text(container)).toBe("> - item");
  });

  it("sends rather than carrying the quote on when Enter is what sends", () => {
    const { content, onSend } = renderComposer();
    paste(content, "> quoted");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("> quoted");
  });

  it("carries the quote on with Shift+Enter when Enter is what sends", () => {
    const { content, container } = renderComposer();
    paste(content, "> quoted");

    fireEvent.keyDown(content, { key: "Enter", shiftKey: true });

    expect(text(container)).toBe("> quoted\n> ");
  });

  it("carries the quote on with Enter when Enter makes new lines", () => {
    const { content, container } = renderComposer({ submitsOnEnter: () => false });
    paste(content, "> quoted");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(text(container)).toBe("> quoted\n> ");
  });

  it("carries a list inside the quote on as a list", () => {
    const { content, container } = renderComposer({ submitsOnEnter: () => false });
    paste(content, "> - item");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(text(container)).toBe("> - item\n> - ");
  });

  it("ends the list on an empty item and keeps the quote going", () => {
    const { content, container } = renderComposer({ submitsOnEnter: () => false });
    paste(content, "> - item\n> - ");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(text(container)).toBe("> - item\n\n> ");
  });

  it("lets the quote go when Enter is pressed on an empty quoted line", () => {
    const { content, container } = renderComposer({ submitsOnEnter: () => false });
    paste(content, "> quoted\n> ");

    fireEvent.keyDown(content, { key: "Enter" });

    expect(text(container)).toBe("> quoted\n\n");
  });
});

describe("the Send button", () => {
  it("sends what was typed", () => {
    const { content, onSend } = renderComposer();
    paste(content, "third time lucky");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("third time lucky");
  });

  it("sends nothing while the composer is empty", () => {
    const { onSend } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends nothing for whitespace alone", () => {
    const { content, onSend } = renderComposer();
    paste(content, "    ");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("the status above the composer", () => {
  it("says the turn is working while one is running", () => {
    renderComposer({ running: true });

    expect(screen.getByText("Working…")).toBeInTheDocument();
  });

  it("counts the reasoning tokens as they are spent", () => {
    renderComposer({ running: true, thinkingTokens: 2400 });

    expect(screen.getByText("Thinking… 2,400 tokens")).toBeInTheDocument();
  });

  it("says nothing once the turn has ended", () => {
    renderComposer();

    expect(screen.queryByText("Working…")).toBeNull();
  });

  /// The whole point of the second indicator is that it can be seen without
  /// scrolling to the end of the transcript, so it has to be inside the strip
  /// that never scrolls, and above the controls rather than below them.
  it("stands above the format buttons and the composer itself", () => {
    const { container } = renderComposer({ running: true });
    const footer = container.querySelector(".composer");
    const order = [...(footer?.children ?? [])].map((child) => child.className);

    expect(order[0]).toContain("working");
    expect(order[1]).toContain("format-toolbar");
    expect(order[2]).toContain("composer-row");
  });

  it("keeps the turn's spinner turning, which the transcript does not show", () => {
    const { container } = renderComposer({ running: true });
    expect(container.querySelector(".working-mark")).not.toBeNull();
  });
});

describe("the running tracker", () => {
  const agents: RunningGroup = {
    kind: "agent",
    label: "2 agents running",
    items: [
      { id: "a1", label: "Agent one" },
      { id: "a2", label: "Agent two" },
    ],
  };

  it("sits below the composer row", () => {
    const { container } = renderComposer({ trackers: [agents] });
    const footer = container.querySelector(".composer");
    const order = [...(footer?.children ?? [])].map((child) => child.className);

    expect(order.at(-1)).toContain("trackers");
  });

  it("counts what is running", () => {
    renderComposer({ trackers: [agents] });
    expect(screen.getByText("2 agents running")).toBeInTheDocument();
  });

  it("shows nothing while the session is idle", () => {
    const { container } = renderComposer();
    expect(container.querySelector(".trackers")).toBeNull();
  });

  it("asks for the entry that was picked", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    renderComposer({ trackers: [agents], onReveal });

    await user.click(screen.getByRole("button", { name: /2 agents running/ }));
    await user.click(screen.getByRole("button", { name: "Agent two" }));

    expect(onReveal).toHaveBeenCalledWith("a2");
  });

  it("goes straight to a group that has only one thing in it", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    renderComposer({
      trackers: [
        {
          kind: "shell",
          label: "1 shell running",
          items: [{ id: "s1", label: "Bash · pnpm test" }],
        },
      ],
      onReveal,
    });

    await user.click(screen.getByRole("button", { name: /1 shell running/ }));

    expect(onReveal).toHaveBeenCalledWith("s1");
  });
});

describe("the Markdown preview", () => {
  const preview = () => screen.getByRole("button", { name: "Preview" });
  const backToEdit = () => screen.getByRole("button", { name: "Edit" });

  it("sits at the far end of the toolbar, away from the editing buttons", () => {
    const { container } = renderComposer();

    const buttons = [...container.querySelectorAll(".format-toolbar .format-button")];

    expect(buttons.at(-1)).toHaveClass("preview-toggle");
  });

  it("stands in for the editor rather than beside it", async () => {
    const user = userEvent.setup();
    const { container } = renderComposer();
    expect(container.querySelector(".composer-preview")).toBeNull();

    await user.click(preview());

    expect(container.querySelector(".composer-preview")).not.toBeNull();
    expect(container.querySelector(".composer-host")).toHaveClass("previewing");
  });

  it("renders what has been typed as Markdown", async () => {
    const user = userEvent.setup();
    const { container, content } = renderComposer();
    paste(content, "# Heading\n\nsome **bold** words");

    await user.click(preview());

    const shown = container.querySelector(".composer-preview") as HTMLElement;
    expect(shown.querySelector("h1")?.textContent).toBe("Heading");
    expect(shown.querySelector("strong")?.textContent).toBe("bold");
  });

  it("says so when there is nothing to preview", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(preview());

    expect(screen.getByText("There is nothing to preview yet.")).toBeInTheDocument();
  });

  it("takes the keyboard as it opens, so Escape has somewhere to land", async () => {
    const user = userEvent.setup();
    const { container } = renderComposer();

    await user.click(preview());

    expect(container.querySelector(".composer-preview")).toHaveFocus();
  });

  it("goes back to the editor when the same button is pressed again", async () => {
    const user = userEvent.setup();
    const { container } = renderComposer();
    await user.click(preview());

    await user.click(backToEdit());

    expect(container.querySelector(".composer-preview")).toBeNull();
    expect(container.querySelector(".composer-host")).not.toHaveClass("previewing");
    expect(container.querySelector(".formatted")).toBeNull();
  });

  it("goes back to the editor on Escape", async () => {
    const user = userEvent.setup();
    const { container } = renderComposer();
    await user.click(preview());

    await user.keyboard("{Escape}");

    expect(container.querySelector(".composer-preview")).toBeNull();
    expect(container.querySelector(".composer-host")).not.toHaveClass("previewing");
  });

  it("keeps what was typed, and the caret in it, across the round trip", async () => {
    const user = userEvent.setup();
    const { content } = renderComposer();
    paste(content, "half a thought");

    await user.click(preview());
    await user.click(backToEdit());

    expect(text(content)).toBe("half a thought");
    expect(content).toHaveFocus();
  });

  it("still sends what the preview was showing", async () => {
    const user = userEvent.setup();
    const { content, onSend } = renderComposer();
    paste(content, "**bold** answer");
    await user.click(preview());

    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("**bold** answer");
  });

  it("keeps the turn's stop button reachable while reading", async () => {
    const user = userEvent.setup();
    renderComposer({ running: true });

    await user.click(preview());

    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  /// The label is the way back, and a pressed button that still said "Preview"
  /// would read as an offer to preview what is already on screen.
  it("names the way back once it is showing", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(preview());

    expect(backToEdit()).toHaveAttribute("aria-pressed", "true");
    expect(backToEdit()).toHaveAttribute("title", "Return to edit (Esc)");
  });
});

describe("dictation", () => {
  it("hides the caret and shows the bars while the microphone is open", () => {
    const { host } = renderComposer({ voice: fakeVoice({ listening: true }) });

    expect(host).toHaveClass("listening");
  });

  it("leaves the caret alone the rest of the time", () => {
    const { host } = renderComposer();

    expect(host).not.toHaveClass("listening");
  });

  /// The level arrives tens of times a second, so it is written to the composer
  /// as a custom property for the bars to inherit rather than put in state.
  it("hands the audio level to the composer's own property", () => {
    const listeners: Array<(level: number) => void> = [];
    const voice = fakeVoice({
      subscribeToLevel: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
    });
    const { host } = renderComposer({ voice });
    expect(listeners).toHaveLength(1);

    act(() => {
      for (const listener of listeners) listener(0.42);
    });

    expect(host.style.getPropertyValue("--voice-level")).toBe("0.42");
  });

  it("puts what was dictated where the microphone was opened", () => {
    const { container, rerender, props } = renderComposer();
    paste(container.querySelector(".cm-content") as Element, "hello ");

    rerender(<Composer {...props} voice={fakeVoice({ transcript: { text: "world", seq: 1 } })} />);

    expect(text(container)).toBe("hello world");
  });

  it("puts each thing that is said in once", () => {
    const { container, rerender, props } = renderComposer();
    const said = fakeVoice({ transcript: { text: "once", seq: 1 } });

    rerender(<Composer {...props} voice={said} />);
    rerender(<Composer {...props} voice={said} />);
    rerender(<Composer {...props} voice={{ ...said }} />);

    expect(text(container)).toBe("once");
  });

  it("puts a second thing that is said in after the first", () => {
    const { container, rerender, props } = renderComposer();
    rerender(<Composer {...props} voice={fakeVoice({ transcript: { text: "one", seq: 1 } })} />);

    rerender(<Composer {...props} voice={fakeVoice({ transcript: { text: "two", seq: 2 } })} />);

    expect(text(container)).toBe("onetwo");
  });

  it("says so when dictation fails, in one line under the composer", () => {
    renderComposer({ voice: fakeVoice({ error: "the microphone is muted" }) });

    expect(screen.getByText("the microphone is muted")).toHaveClass("voice-error");
  });

  it("says nothing when dictation has nothing to report", () => {
    const { container } = renderComposer();

    expect(container.querySelector(".voice-error")).toBeNull();
  });
});
