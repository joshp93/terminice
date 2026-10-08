import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { MessageLink } from "./MessageLink";

const REMARK_PLUGINS = [remarkGfm];
const REMARK_PLUGINS_WITH_BREAKS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeSanitize, rehypeHighlight];

/**
 * Swaps the anchor for one that hands its address to the browser.
 *
 * A bare URL needs no Markdown around it to become a link: `remark-gfm` turns
 * one into an anchor on its own, which is what keeps a link costing nothing
 * more than the address itself.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) => <MessageLink href={href}>{children}</MessageLink>,
};

/** Props for {@link MessageBubble}. */
export type MessageBubbleProps = {
  text: string;
  /**
   * Whether single newlines should render as line breaks.
   *
   * Markdown normally folds a single newline into a space; user messages turn
   * it on so the transcript shows what was actually typed.
   */
  preserveLineBreaks?: boolean;
};

/**
 * Renders one chat message as sanitised Markdown.
 *
 * @param props - The message text and whether newlines are significant.
 * @returns The rendered message body.
 */
export function MessageBubble({ text, preserveLineBreaks = false }: MessageBubbleProps) {
  return (
    <Markdown
      remarkPlugins={preserveLineBreaks ? REMARK_PLUGINS_WITH_BREAKS : REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={COMPONENTS}
    >
      {text}
    </Markdown>
  );
}
