import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";

const REMARK_PLUGINS = [remarkGfm];
const REMARK_PLUGINS_WITH_BREAKS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeSanitize, rehypeHighlight];

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
    >
      {text}
    </Markdown>
  );
}
