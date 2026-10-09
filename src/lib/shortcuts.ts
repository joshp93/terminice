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
        { keys: mod("Shift+X"), description: "Strikethrough" },
        { keys: mod(">"), description: "Turns the line into a quote" },
        { keys: `${mod("]")} / ${mod("[")}`, description: "Indents and outdents, list items too" },
        {
          keys: "Tab",
          description: "Indents, or in a list always; with Enter sending it leaves for Send",
        },
        {
          keys: "Shift+Tab",
          description: "Cycles the permission mode; outdents instead, in a list",
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
          description: "Jumps to the previous or next message you sent",
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
        { keys: "F6", description: "Puts the keyboard in the composer, from anywhere" },
        { keys: "Esc", description: "Leaves the Markdown preview, while it is open" },
      ],
    },
  ];
}
