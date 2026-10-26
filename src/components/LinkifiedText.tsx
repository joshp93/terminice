import { Fragment, type ReactNode } from "react";
import { browserUrl, findUrls } from "../lib/urls";
import { MessageLink } from "./MessageLink";

/** Props for {@link LinkifiedText}. */
export type LinkifiedTextProps = {
  /** Plain text that may contain bare URLs. */
  text: string;
};

/**
 * Renders text with the bare URLs in it turned into links.
 *
 * Nothing else about the text is interpreted: this is command output, so what
 * is shown has to be exactly what the command wrote, spaces and punctuation
 * included. Only the addresses become links.
 *
 * @param props - The text to render.
 * @returns The text, with each URL as a link.
 */
export function LinkifiedText({ text }: LinkifiedTextProps) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of findUrls(text)) {
    if (match.from > cursor) {
      parts.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor, match.from)}</Fragment>);
    }

    const href = browserUrl(match.url);
    const shown = text.slice(match.from, match.to);
    parts.push(
      href.length > 0 ? (
        <MessageLink key={`url-${match.from}`} href={href}>
          {shown}
        </MessageLink>
      ) : (
        <Fragment key={`url-${match.from}`}>{shown}</Fragment>
      ),
    );
    cursor = match.to;
  }

  if (cursor < text.length) {
    parts.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor)}</Fragment>);
  }

  return <>{parts}</>;
}
