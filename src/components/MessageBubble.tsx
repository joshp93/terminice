import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize, rehypeHighlight];

/** A chat message to render. */
export type MessageBubbleProps = {
  text: string;
  role: "user" | "assistant";
};

/**
 * Renders one chat message.
 *
 * User input is shown verbatim; Claude's output is rendered as sanitised
 * Markdown with highlighted code blocks.
 *
 * @param props - The message text and its author.
 * @returns The rendered message.
 */
export function MessageBubble({ text, role }: MessageBubbleProps) {
  if (role === "user") {
    return <div className="user-text">{text}</div>;
  }
  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
      {text}
    </Markdown>
  );
}
