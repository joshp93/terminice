import { modifierShortcut } from "./modifierShortcut";

/** One key combination, and what it does. */
export type Shortcut = {
  /** How the keys are written, as the platform writes them. */
  keys: string;
  /** What pressing them does. */
  description: string;
};

/** A headed set of shortcuts, grouped by where they apply. */
export type ShortcutGroup = {
  title: string;
  shortcuts: readonly Shortcut[];
};

/**
 * Lists every shortcut the application answers to.
 *
 * The labels are written for the platform the app is running on, because the
 * bindings behind them are `Mod-…` and that is a different key on a Mac. Each
 * entry says what the key does rather than only naming the command, since a
 * list of keys is only useful if it also says when they apply.
 *
 * @returns The shortcuts, grouped by the part of the window they work in.
 */
export function shortcutGroups(): readonly ShortcutGroup[] {
  const mod = (key: string): string => modifierShortcut(key);

  return [
    {
      title: "Composer",
      shortcuts: [
        { keys: "Enter", description: "Sends the message, unless Enter key is set to New line" },
        { keys: "Shift+Enter", description: "Starts a new line" },
        { keys: mod("Enter"), description: "Sends, whatever Enter is set to" },
        { keys: mod("B"), description: "Bold" },
        { keys: mod("I"), description: "Italic" },
        { keys: mod("E"), description: "Inline code" },
        {
          keys: mod("Shift+E"),
          description: "Turns the line, or the selection, into a code block",
        },
        { keys: mod("Shift+X"), description: "Strikethrough" },
        { keys: mod(">"), description: "Turns the line into a quote" },
        { keys: mod("L"), description: "Turns the line into a bulleted item" },
        { keys: mod("1"), description: "Turns the line into a numbered item" },
        {
          keys: `${mod("]")} / ${mod("[")}`,
          description: "Indents and outdents, list items too",
        },
        {
          keys: "Tab",
          description: "Indents a list item; anywhere else it leaves for the Send button",
        },
        {
          keys: "Shift+Tab",
          description: "Outdents a list item; anywhere else it leaves for the toolbar above",
        },
        {
          keys: mod("M"),
          description:
            "Cycles the permission mode: Ask → Plan → Accept edits → Auto. Works anywhere",
        },
        {
          keys: mod("P"),
          description: "Shows the message as Markdown, and takes you back to editing it",
        },
        {
          keys: "Backspace",
          description: "Between an empty pair of brackets, removes both characters",
        },
        { keys: "↑ / ↓", description: "At the start or end of a message, recalls what you sent" },
        { keys: "Esc", description: "Clears the composer, then stops the running turn" },
        { keys: "Hold Space", description: "Dictates, while dictation is switched on" },
        { keys: `${mod("click")} a link`, description: "Opens it in your browser" },
      ],
    },
    {
      title: "Menus",
      shortcuts: [
        { keys: "/", description: "Opens the command menu, when the message starts with one" },
        { keys: "@", description: "Opens the file menu, two characters in" },
        { keys: "↑ / ↓", description: "Moves through the open menu" },
        { keys: "Enter", description: "Runs the highlighted entry" },
        { keys: "Tab", description: "Puts the highlighted entry in the composer, unsent" },
        { keys: "Esc", description: "Closes the menu, or steps back out of a submenu" },
      ],
    },
    {
      title: "Transcript",
      shortcuts: [
        {
          keys: `${mod("↑")} / ${mod("↓")}`,
          description:
            "Steps through the messages you sent; past the last one it goes to the end of the chat and back to the composer",
        },
      ],
    },
    {
      title: "Approvals and questions",
      shortcuts: [
        { keys: "↑ / ↓", description: "Moves between the options" },
        { keys: "Enter", description: "Chooses the focused option, or sends the card" },
        { keys: "Space", description: "Ticks a box, on a question with more than one answer" },
        { keys: "n", description: "Opens the notes for the focused choice" },
        { keys: "Esc", description: "Closes the card without answering" },
      ],
    },
    {
      title: "Window",
      shortcuts: [
        { keys: "F1", description: "Opens the settings, with the keyboard already in them" },
        { keys: "F6", description: "Puts the keyboard in the composer, from anywhere" },
        { keys: "Esc", description: "Leaves the Markdown preview, while it is open" },
      ],
    },
  ];
}
