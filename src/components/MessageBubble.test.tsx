import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("links a bare URL with no markup around it", () => {
    render(<MessageBubble text="the notes are at https://example.com/docs if you need them" />);

    expect(screen.getByRole("link", { name: "https://example.com/docs" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
  });

  it("links a bare www address too", () => {
    render(<MessageBubble text="try www.example.com" />);

    expect(screen.getByRole("link", { name: "www.example.com" })).toHaveAttribute(
      "href",
      "http://www.example.com",
    );
  });

  it("leaves a URL inside code alone, where it is being quoted rather than offered", () => {
    const { container } = render(<MessageBubble text={"```\nhttps://example.com\n```"} />);

    expect(container.querySelector("a")).toBeNull();
  });

  it("keeps the trailing full stop out of the address", () => {
    render(<MessageBubble text="see https://example.com/docs." />);

    expect(screen.getByRole("link", { name: "https://example.com/docs" })).toBeInTheDocument();
  });
});

describe("code blocks", () => {
  /** A clipboard that records what it was given. */
  function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  }

  const fenced = "```ts\nconst x: number = 1;\n```";

  it("offers a copy button on a fenced block", () => {
    render(<MessageBubble text={fenced} />);

    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  });

  it("offers none on a message without code", () => {
    render(<MessageBubble text="just a sentence" />);

    expect(screen.queryByRole("button", { name: "Copy code" })).toBeNull();
  });

  /// What is copied is the code the message wrote, not the markup it was
  /// highlighted into — the tree the button wraps is spans, one per token.
  it("copies the code as it was written, without the highlighting", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<MessageBubble text={fenced} />);

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith("const x: number = 1;");
  });

  it("gives every block its own button, and copies that block", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<MessageBubble text={"```\nfirst\n```\n\ntext\n\n```\nsecond\n```"} />);

    const buttons = screen.getAllByRole("button", { name: "Copy code" });
    expect(buttons).toHaveLength(2);

    await user.click(buttons[1]);

    expect(writeText).toHaveBeenCalledWith("second");
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("turns the button it copied from into a tick", async () => {
    const user = userEvent.setup();
    stubClipboard();
    render(<MessageBubble text={fenced} />);

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
