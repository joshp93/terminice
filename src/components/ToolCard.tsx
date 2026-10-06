/** A tool call to display. */
export type ToolCardProps = {
  name: string;
  detail: string;
};

/**
 * Renders a compact summary of a tool call.
 *
 * @param props - The tool name and its summarised input.
 * @returns The rendered tool card.
 */
export function ToolCard({ name, detail }: ToolCardProps) {
  return (
    <div className="tool-card">
      <span className="tool-name">{name}</span>
      {detail.length > 0 && <span className="tool-detail">{detail}</span>}
    </div>
  );
}
