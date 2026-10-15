import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { textInHast } from "../lib/hastText";
import { CodeBlock } from "./CodeBlock";
import { MessageLink } from "./MessageLink";

const REMARK_PLUGINS = [remarkGfm];
const REMARK_PLUGINS_WITH_BREAKS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeSanitize, rehypeHighlight];

/**
 * Swaps the anchor for one that hands its address to the browser, and a fenced
 * block for one that can be copied out of.
 *
 * A bare URL needs no Markdown around it to become a link: `remark-gfm` turns
 * one into an anchor on its own, which is what keeps a link costing nothing
 * more than the address itself.
 *
 * The block is read from the rendered tree rather than from the Markdown
 * source, because what is being replaced is the drawing of it: the copy button
 * wraps the same highlighted code rather than re-rendering it. What it copies
 * is the text at that tree's leaves, which is the code as it was written — see
 * {@link textInHast}.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) => <MessageLink href={href}>{children}</MessageLink>,
  pre: ({ node, children }) => <CodeBlock code={textInHast(node)}>{children}</CodeBlock>,
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
