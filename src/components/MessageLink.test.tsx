import { routeInvoke } from "@test/tauriMock";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageLink } from "./MessageLink";

/** Records every address the backend was asked to open. */
function recordOpens(): string[] {
  const opened: string[] = [];
  routeInvoke("open_external_url", (args) => {
    opened.push(args.url as string);
  });
  return opened;
}

describe("MessageLink", () => {
  it("shows the address it was given", () => {
    render(<MessageLink href="https://example.com">docs</MessageLink>);
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("opens the address in the reader's browser", async () => {
    const opened = recordOpens();
    render(<MessageLink href="https://example.com">docs</MessageLink>);

    await userEvent.click(screen.getByRole("link", { name: "docs" }));

    await waitFor(() => expect(opened).toEqual(["https://example.com"]));
  });

  /// The opener is handed exactly what the message wrote: a query string, its
  /// ampersands and a fragment all belong to the address.
  it("passes a query string and a fragment through whole", async () => {
    const opened = recordOpens();
    const address = "https://example.com/a?b=1&c=2#frag";
    render(<MessageLink href={address}>search</MessageLink>);

    await userEvent.click(screen.getByRole("link", { name: "search" }));

    await waitFor(() => expect(opened).toEqual([address]));
  });

  it("refuses the click, so the webview never navigates away from the app", () => {
    render(<MessageLink href="https://example.com">docs</MessageLink>);
    const link = screen.getByRole("link", { name: "docs" });

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("refuses the middle button too, which would otherwise open a window of its own", () => {
    render(<MessageLink href="https://example.com">docs</MessageLink>);
    const link = screen.getByRole("link", { name: "docs" });

    const event = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the right button to the context menu", () => {
    render(<MessageLink href="https://example.com">docs</MessageLink>);
    const link = screen.getByRole("link", { name: "docs" });

    const event = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("does not raise an error over a link with no address", async () => {
    render(<MessageLink>no address</MessageLink>);
    await userEvent.click(screen.getByText("no address"));
  });

  it("carries no referrer on to the site", () => {
    render(<MessageLink href="https://example.com">docs</MessageLink>);
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "rel",
      "noreferrer noopener",
    );
  });
});
