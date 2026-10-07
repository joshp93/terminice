import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ExpansionProvider } from "./ExpansionContext";
import { ThinkingBlock } from "./ThinkingBlock";

function Harness({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <ExpansionProvider value={{ isOpen: () => open, toggle: () => setOpen((current) => !current) }}>
      <ThinkingBlock id="thinking-1" text={text} />
    </ExpansionProvider>
  );
}

const summary = () => screen.getByRole("button", { name: /Thought/ });

describe("ThinkingBlock", () => {
  it("starts collapsed and reports that to assistive technology", () => {
    render(<Harness text={"first line\nsecond line"} />);
    expect(summary()).toHaveAttribute("aria-expanded", "false");
  });

  it("shows only the opening line while collapsed", () => {
    render(<Harness text={"first line\nsecond line"} />);
    expect(screen.getByText("first line")).toBeInTheDocument();
    expect(screen.queryByText(/second line/)).toBeNull();
  });

  it("labels the collapsed control with a show disclosure", () => {
    render(<Harness text={"first line\nsecond line"} />);
    expect(summary()).toHaveTextContent("show");
  });

  it("takes its preview from the first line after trimming leading blank lines", () => {
    render(<Harness text={"\n\nthe real first line\nmore"} />);
    expect(screen.getByText("the real first line")).toBeInTheDocument();
  });

  it("reveals the whole reasoning when opened", async () => {
    const user = userEvent.setup();
    render(<Harness text={"first line\nsecond line"} />);

    await user.click(summary());

    expect(summary()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/second line/)).toBeInTheDocument();
    expect(summary()).toHaveTextContent("hide");
  });

  it("drops the preview once the body is showing", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness text={"just one line"} />);

    await user.click(summary());

    expect(container.querySelector(".thinking-preview")).toBeNull();
    expect(screen.getByText("just one line")).toBeInTheDocument();
  });

  it("opens and closes again on repeated activation", async () => {
    const user = userEvent.setup();
    render(<Harness text={"first line\nsecond line"} />);

    await user.click(summary());
    await user.click(summary());

    expect(summary()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/second line/)).toBeNull();
  });

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness text={"first line\nsecond line"} />);

    await user.tab();
    expect(summary()).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(summary()).toHaveAttribute("aria-expanded", "true");
  });

  it("shows no preview for empty reasoning", () => {
    const { container } = render(<Harness text="" />);
    expect(container.querySelector(".thinking-preview")).toBeNull();
    expect(summary()).toHaveTextContent("Thought");
    expect(summary()).toHaveAttribute("aria-expanded", "false");
  });
});
