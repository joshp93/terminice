import type { ReactNode } from "react";
import { openExternal } from "../lib/externalLinks";

/** Props for {@link MessageLink}. */
export type MessageLinkProps = {
  href?: string;
  children?: ReactNode;
};

/**
 * Renders a link in a message so that it opens in the reader's own browser.
 *
 * Following a link inside the webview would replace the application with the
 * page and leave no way back, so the default is refused whichever button was
 * used — the middle button opens a window of its own, which is the same trap by
 * another route.
 *
 * @param props - The address and the link's text.
 * @returns The rendered link.
 */
export function MessageLink({ href, children }: MessageLinkProps) {
  const open = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    if (href) void openExternal(href);
  };

  return (
    <a
      href={href}
      rel="noreferrer noopener"
      onClick={open}
      onAuxClick={(event) => {
        if (event.button === 1) open(event);
      }}
    >
      {children}
    </a>
  );
}
