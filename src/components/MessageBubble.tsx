import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize, rehypeHighlight];

/** Props for {@link MessageBubble}. */
export type MessageBubbleProps = {
  text: string;
};

/**
 * Renders one chat message as sanitised Markdown.
 *
 * Both directions are Markdown: what the user types is Markdown source, and so
 * is what Claude replies with.
 *
 * @param props - The message text.
 * @returns The rendered message body.
 */
export function MessageBubble({ text }: MessageBubbleProps) {
  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
      {text}
    </Markdown>
  );
}
