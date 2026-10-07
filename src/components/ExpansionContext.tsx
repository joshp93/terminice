import { createContext, useContext } from "react";

/** How a card asks whether it is open, and reports that it changed. */
export type Expansion = {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
};

const ExpansionContext = createContext<Expansion>({
  isOpen: () => false,
  toggle: () => undefined,
});

/**
 * Shares one expansion state with every card in the transcript.
 *
 * It travels by context rather than by props because a subagent's card holds a
 * transcript of its own: nesting means the depth is not known when the pane
 * renders, and a single "expand all" has to reach every level of it.
 */
export const ExpansionProvider = ExpansionContext.Provider;

/**
 * Reads the transcript's expansion state.
 *
 * @returns Whether the card with a given id is open, and how to toggle it.
 */
export function useExpansion(): Expansion {
  return useContext(ExpansionContext);
}
