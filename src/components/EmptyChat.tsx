import logo from "../../assets/logo/terminice-logo.png";

/**
 * Renders the placeholder shown before anything has been said.
 *
 * @returns The rendered placeholder.
 */
export function EmptyChat() {
  return (
    <div className="chat-empty">
      <img className="chat-empty-logo" src={logo} alt="" draggable={false} aria-hidden="true" />
      <p className="chat-empty-caption">Do you like my nice green jacket?</p>
    </div>
  );
}
