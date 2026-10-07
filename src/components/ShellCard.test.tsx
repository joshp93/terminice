import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ShellCard } from "./ShellCard";

const summary = () => screen.getByRole("button", { name: /^!/ });

const numberedLines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

describe("ShellCard", () => {
  it("shows the command with its shell prefix", () => {
    render(<ShellCard command="ls -la" stdout="a" stderr="" code={0} running={false} />);
    expect(summary()).toHaveTextContent("!ls -la");
  });

  it("reports a running command rather than an exit code", () => {
    render(<ShellCard command="sleep 5" stdout="" stderr="" code={null} running />);
    expect(summary()).toHaveTextContent("running…");
    expect(screen.queryByText(/exit /)).toBeNull();
  });

  it("marks the running state on the status dot", () => {
    const { container } = render(
      <ShellCard command="sleep 5" stdout="" stderr="" code={null} running />,
    );
    expect(container.querySelector(".tool-status.running")).not.toBeNull();
  });

  it("says nothing about an exit code when a command succeeded", () => {
    render(<ShellCard command="ls" stdout="a" stderr="" code={0} running={false} />);
    expect(screen.queryByText(/exit /)).toBeNull();
  });

  it("shows the failing exit code and marks the card failed", () => {
    const { container } = render(
      <ShellCard command="ls" stdout="" stderr="boom" code={3} running={false} />,
    );
    expect(screen.getByText("exit 3")).toBeInTheDocument();
    expect(container.querySelector(".shell-card.failed")).not.toBeNull();
  });

  it("does not mark a successful command as failed", () => {
    const { container } = render(
      <ShellCard command="ls" stdout="a" stderr="" code={0} running={false} />,
    );
    expect(container.querySelector(".shell-card.failed")).toBeNull();
  });

  it("joins stdout and stderr into one output block", () => {
    render(<ShellCard command="ls" stdout={"out\n"} stderr={"err\n"} code={1} running={false} />);
    const output = screen.getByRole("button", { name: "Expand ls output" });
    expect(output).toHaveTextContent("out");
    expect(output).toHaveTextContent("err");
  });

  it("previews only the first four lines of a long output", () => {
    render(<ShellCard command="ls" stdout={numberedLines(6)} stderr="" code={0} running={false} />);
    const output = screen.getByRole("button", { name: "Expand ls output" });
    expect(output).toHaveTextContent("line 4");
    expect(output).not.toHaveTextContent("line 5");
    expect(output).toHaveTextContent("…");
  });

  it("counts the hidden lines in the disclosure", () => {
    render(<ShellCard command="ls" stdout={numberedLines(6)} stderr="" code={0} running={false} />);
    expect(summary()).toHaveTextContent("show 2 more");
  });

  it("expands to the whole output when the summary is clicked", async () => {
    const user = userEvent.setup();
    render(<ShellCard command="ls" stdout={numberedLines(6)} stderr="" code={0} running={false} />);

    await user.click(summary());

    const output = screen.getByRole("button", { name: "Expand ls output" });
    expect(output).toHaveTextContent("line 6");
    expect(output).not.toHaveTextContent("…");
    expect(summary()).toHaveTextContent("hide");
    expect(summary()).toHaveAttribute("aria-expanded", "true");
  });

  it("expands when the output preview itself is clicked", async () => {
    const user = userEvent.setup();
    render(<ShellCard command="ls" stdout={numberedLines(6)} stderr="" code={0} running={false} />);

    await user.click(screen.getByRole("button", { name: "Expand ls output" }));

    expect(summary()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Expand ls output" })).toHaveTextContent("line 6");
  });

  it("collapses again when the summary is clicked a second time", async () => {
    const user = userEvent.setup();
    render(<ShellCard command="ls" stdout={numberedLines(6)} stderr="" code={0} running={false} />);

    await user.click(summary());
    await user.click(summary());

    expect(summary()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Expand ls output" })).not.toHaveTextContent(
      "line 5",
    );
  });

  it("disables both controls when there is nothing hidden to reveal", () => {
    render(<ShellCard command="ls" stdout={numberedLines(3)} stderr="" code={0} running={false} />);
    expect(summary()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Expand ls output" })).toBeDisabled();
  });

  it("renders no output preview when the command produced nothing", () => {
    render(<ShellCard command="cd ." stdout="" stderr="" code={0} running={false} />);
    expect(screen.queryByRole("button", { name: /Expand .* output/ })).toBeNull();
    expect(summary()).toBeDisabled();
  });

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    render(<ShellCard command="ls" stdout={numberedLines(6)} stderr="" code={0} running={false} />);

    await user.tab();
    expect(summary()).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(summary()).toHaveAttribute("aria-expanded", "true");
  });
});
