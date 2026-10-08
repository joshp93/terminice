import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { MAX_CARD_OUTPUT, MAX_PREVIEW_LINE } from "../lib/outputLimits";
import type { HookNote } from "../lib/toolResults";
import { ExpansionProvider } from "./ExpansionContext";
import { ToolCard, type ToolCardProps } from "./ToolCard";

function Harness(props: Omit<ToolCardProps, "id">) {
  const [open, setOpen] = useState(false);

  return (
    <ExpansionProvider value={{ isOpen: () => open, toggle: () => setOpen((current) => !current) }}>
      <ToolCard id="tool-1" {...props} />
    </ExpansionProvider>
  );
}

const base: Omit<ToolCardProps, "id"> = {
  name: "Bash",
  detail: "ls -la",
  input: '{"command":"ls -la"}',
  result: "",
  status: "ok",
  hooks: [],
};

const hook = (overrides: Partial<HookNote>): HookNote => ({
  hookId: "hook-1",
  name: "PreToolUse:Bash",
  event: "PreToolUse",
  outcome: "allow",
  exitCode: 0,
  output: "",
  ...overrides,
});

const summary = () => screen.getByRole("button", { name: /^Bash/ });

const numberedLines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

describe("ToolCard", () => {
  it("shows the tool name and its one-line detail", () => {
    render(<Harness {...base} />);
    expect(summary()).toHaveTextContent("Bash");
    expect(summary()).toHaveTextContent("ls -la");
  });

  it("omits the detail when there is none", () => {
    render(<Harness {...base} detail="" />);
    expect(summary()).toHaveTextContent("Bash");
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("marks a running call on the status dot", () => {
    const { container } = render(<Harness {...base} status="running" />);
    expect(container.querySelector(".tool-status.running")).not.toBeNull();
  });

  it("marks a successful call on the status dot", () => {
    const { container } = render(<Harness {...base} status="ok" />);
    expect(container.querySelector(".tool-status.ok")).not.toBeNull();
  });

  it("marks a failed call on the status dot", () => {
    const { container } = render(<Harness {...base} status="error" />);
    expect(container.querySelector(".tool-status.error")).not.toBeNull();
  });

  it("previews only the first two lines of a result", () => {
    render(<Harness {...base} result={numberedLines(5)} />);
    const preview = screen.getByRole("button", { name: "Expand Bash output" });
    expect(preview).toHaveTextContent("line 2");
    expect(preview).not.toHaveTextContent("line 3");
    expect(preview).toHaveTextContent("…");
  });

  it("counts the hidden lines in the disclosure", () => {
    render(<Harness {...base} result={numberedLines(5)} />);
    expect(summary()).toHaveTextContent("show 3 more");
  });

  it("offers a plain show when there is nothing hidden", () => {
    render(<Harness {...base} result="short" />);
    expect(summary()).toHaveTextContent("show");
    expect(summary()).not.toHaveTextContent("more");
  });

  it("marks the error preview as failed", () => {
    render(<Harness {...base} status="error" result={numberedLines(4)} />);
    expect(screen.getByRole("button", { name: "Expand Bash output" })).toHaveClass("failed");
  });

  it("reveals the exact input and the whole output when opened", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness {...base} result={numberedLines(5)} />);

    await user.click(summary());

    expect(container.querySelector(".tool-card.open")).not.toBeNull();
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText('{"command":"ls -la"}')).toBeInTheDocument();
    expect(screen.getByText(/line 5/)).toBeInTheDocument();
    expect(summary()).toHaveTextContent("hide");
  });

  it("marks a failed output block when expanded", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness {...base} status="error" result="it broke" />);

    await user.click(summary());

    expect(container.querySelector(".tool-body pre.failed")).toHaveTextContent("it broke");
  });

  it("drops the collapsed preview once open", async () => {
    const user = userEvent.setup();
    render(<Harness {...base} result={numberedLines(5)} />);

    await user.click(summary());

    expect(screen.queryByRole("button", { name: "Expand Bash output" })).toBeNull();
  });

  it("shows a chip for every hook that ran around the call", () => {
    render(
      <Harness
        {...base}
        hooks={[
          hook({ hookId: "h1", name: "PreToolUse:Bash" }),
          hook({ hookId: "h2", name: "PostToolUse:Bash" }),
        ]}
      />,
    );
    expect(screen.getByText("PreToolUse:Bash")).toBeInTheDocument();
    expect(screen.getByText("PostToolUse:Bash")).toBeInTheDocument();
  });

  it("names the exit code on a failing hook chip", () => {
    const { container } = render(
      <Harness {...base} hooks={[hook({ name: "PreToolUse:Bash", exitCode: 2 })]} />,
    );
    expect(container.querySelector(".hook-chip.failed")).toHaveTextContent(
      "PreToolUse:Bash · exit 2",
    );
  });

  it("lists only the failing or talkative hooks in the expanded body", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        {...base}
        hooks={[
          hook({
            hookId: "h1",
            name: "PreToolUse:Bash",
            exitCode: 2,
            outcome: "deny",
            output: "nope",
          }),
          hook({ hookId: "h2", name: "PostToolUse:Bash", exitCode: 0, output: "" }),
        ]}
      />,
    );

    await user.click(summary());

    expect(screen.getByText("Hooks")).toBeInTheDocument();
    expect(screen.getByText(/PreToolUse:Bash → deny/)).toBeInTheDocument();
    expect(screen.queryByText(/PostToolUse:Bash →/)).toBeNull();
  });

  it("disables the summary when there is no input or output to reveal", () => {
    render(<Harness {...base} input="" result="" />);
    expect(summary()).toBeDisabled();
    expect(summary()).not.toHaveTextContent("show");
  });

  it("cannot be opened while it has nothing to reveal", async () => {
    const user = userEvent.setup();
    render(<Harness {...base} input="" result="" />);

    await user.click(summary());

    expect(summary()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness {...base} result={numberedLines(3)} />);

    await user.tab();
    expect(summary()).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(summary()).toHaveAttribute("aria-expanded", "true");
  });

  /// Two long lines are still two lines, so counting them is not enough to keep
  /// a collapsed card small: a tool that returned a minified document would
  /// otherwise lay the whole of it out behind a two-line preview.
  it("shortens a line too long for the collapsed card", () => {
    render(<Harness {...base} result={`${"x".repeat(MAX_PREVIEW_LINE + 500)}TAIL`} />);

    const preview = screen.getByRole("button", { name: "Expand Bash output" });

    expect(preview).toHaveTextContent(`${"x".repeat(MAX_PREVIEW_LINE)}…`);
    expect(preview).not.toHaveTextContent("TAIL");
  });

  it("still counts lines when it shortens them", () => {
    render(<Harness {...base} result={`${"x".repeat(MAX_PREVIEW_LINE + 500)}\nsecond\nthird`} />);

    expect(summary()).toHaveTextContent("show 1 more");
  });

  it("caps the output it renders once opened", async () => {
    const user = userEvent.setup();
    render(<Harness {...base} result={`${"x".repeat(MAX_CARD_OUTPUT)}TAIL`} />);

    await user.click(summary());

    expect(
      screen.getByText(new RegExp(`output truncated at ${MAX_CARD_OUTPUT} characters`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/TAIL/)).toBeNull();
  });
});
