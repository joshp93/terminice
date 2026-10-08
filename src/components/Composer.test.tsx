import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  const view = render(
    <Composer
      submitsOnEnter={() => true}
      onSend={onSend}
      menu={createMenuHost()}
      running={false}
      compacting={false}
      contextTokens={null}
      onStop={onStop}
      onCycleMode={onCycleMode}
      onRunShell={onRunShell}
      suggestion={null}
      fastMode={false}
      fastModeTitle=""
      onSuggestFiles={onSuggestFiles}
      {...overrides}
    />,
  );

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
    content,
    host,
    container: view.container,
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

  it("cycles the permission mode on Shift+Tab before CodeMirror can outdent the line", () => {
    const { content, container, onCycleMode } = renderComposer();
    paste(content, "  - item");

    fireEvent.keyDown(content, { key: "Tab", shiftKey: true });

    expect(onCycleMode).toHaveBeenCalledTimes(1);
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
