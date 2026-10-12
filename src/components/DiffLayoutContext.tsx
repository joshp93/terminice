import { createContext, type ReactNode, useContext } from "react";

/** Whether patches are wanted as two columns, where there is room for them. */
const DiffLayoutContext = createContext(true);

/** Props for {@link DiffLayoutProvider}. */
export type DiffLayoutProviderProps = {
  /** Whether the reader has asked for two columns. */
  sideBySide: boolean;
  children: ReactNode;
};

/**
 * Hands the diff layout setting down to every tool card.
 *
 * A card is several levels below the settings, and it is the only thing that
 * draws a patch, so the setting travels by context rather than through the
 * transcript's own props.
 *
 * @param props - The setting and what to render.
 * @returns The rendered children.
 */
export function DiffLayoutProvider({ sideBySide, children }: DiffLayoutProviderProps) {
  return <DiffLayoutContext.Provider value={sideBySide}>{children}</DiffLayoutContext.Provider>;
}

/**
 * Whether patches are wanted as two columns.
 *
 * @returns The setting. It is on unless a provider says otherwise, so a card
 *   drawn outside one still reads the way the application does.
 */
export function useDiffLayout(): boolean {
  return useContext(DiffLayoutContext);
}
