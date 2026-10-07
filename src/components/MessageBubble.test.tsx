import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble", () => {
  it("renders plain text", () => {
    render(<MessageBubble text="a plain sentence" />);
    expect(screen.getByText("a plain sentence")).toBeInTheDocument();
  });

  it("renders emphasis as elements rather than literal asterisks", () => {
    const { container } = render(<MessageBubble text="**bold** and _italic_" />);
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
  });

  it("does not turn a script tag into a live element", () => {
    const { container } = render(<MessageBubble text={"<script>alert('xss')</script>"} />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("drops event-handler attributes carried by raw HTML", () => {
    const { container } = render(<MessageBubble text={'<img src="x" onerror="alert(1)">'} />);
    expect(container.querySelector("[onerror]")).toBeNull();
  });

  it("drops an onclick attribute carried by raw HTML", () => {
    const { container } = render(<MessageBubble text={'<p onclick="alert(1)">click me</p>'} />);
    expect(container.querySelector("[onclick]")).toBeNull();
  });

  it("keeps a javascript: URL out of a rendered link", () => {
    const { container } = render(<MessageBubble text={"[click me](javascript:alert(1))"} />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href") ?? "").not.toContain("javascript:");
  });

  it("keeps an ordinary http link intact", () => {
    render(<MessageBubble text={"[docs](https://example.com)"} />);
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("renders a GFM table with its headers and cells", () => {
    render(<MessageBubble text={"| name | count |\n| --- | --- |\n| apples | 3 |"} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "apples" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "3" })).toBeInTheDocument();
  });

  it("renders GFM strikethrough as a del element", () => {
    const { container } = render(<MessageBubble text="~~removed~~" />);
    expect(container.querySelector("del")).toHaveTextContent("removed");
  });

  it("folds a single newline into a space by default", () => {
    render(<MessageBubble text={"first line\nsecond line"} />);
    expect(screen.getByText("first line second line")).toBeInTheDocument();
  });

  it("preserves single newlines as breaks when asked", () => {
    const { container } = render(
      <MessageBubble text={"first line\nsecond line"} preserveLineBreaks />,
    );
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("highlights a fenced code block with a language", () => {
    const { container } = render(<MessageBubble text={"```ts\nconst n: number = 1;\n```"} />);
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("hljs");
    expect(code?.className).toContain("language-ts");
  });

  it("still renders a fenced code block with no language", () => {
    const { container } = render(<MessageBubble text={"```\nplain block\n```"} />);
    expect(container.querySelector("pre code")).toHaveTextContent("plain block");
  });
});
