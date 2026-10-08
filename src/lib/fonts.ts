/**
 * The monospace stack the application uses when no family has been chosen.
 *
 * Nerd Font variants come first so text pasted from a terminal prompt keeps its
 * private-use glyphs instead of showing blanks.
 */
export const MONO_FONT_STACK =
  '"MesloLGLDZ Nerd Font Mono", "MesloLGM Nerd Font Mono", "MesloLGL Nerd Font Mono", "Cascadia Code", Consolas, "Courier New", monospace';

/** What the picker calls the stack above. */
export const BUILT_IN_FONT_LABEL = "Built-in (Nerd Font first)";

/**
 * The proportional stack the rest of the application is drawn in.
 *
 * Segoe UI Variable is the Windows 11 face and Segoe UI the one before it, so
 * the text keeps the shape the operating system gives it before anything has
 * been chosen.
 */
export const UI_FONT_STACK = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

/** What the picker calls the stack above. */
export const BUILT_IN_UI_FONT_LABEL = "Built-in (Segoe UI first)";

/** The value the pickers store for the built-in stacks. */
export const BUILT_IN_FONT_VALUE = "";

/** Families a monospace patcher such as Nerd Fonts renames or adds to. */
const BASE_FAMILIES: readonly string[] = [
  "MesloLGLDZ",
  "MesloLGM",
  "MesloLGL",
  "MesloLGS",
  "CaskaydiaCove",
  "CaskaydiaMono",
  "JetBrainsMono",
  "FiraCode",
  "FiraMono",
  "SauceCodePro",
  "IBMPlexMono",
  "VictorMono",
  "RobotoMono",
  "UbuntuMono",
  "DejaVuSansMono",
  "GeistMono",
  "CommitMono",
  "MapleMono",
  "MonaspaceNeon",
  "NotoSansMono",
  "SpaceMono",
  "AnonymousPro",
  "LiberationMono",
  "Hack",
  "Inconsolata",
  "Iosevka",
  "Iosevka Term",
  "IosevkaTerm",
  "Cascadia Code",
  "Cascadia Mono",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "IBM Plex Mono",
  "Roboto Mono",
  "Ubuntu Mono",
  "DejaVu Sans Mono",
  "Noto Sans Mono",
  "Space Mono",
  "Anonymous Pro",
  "Liberation Mono",
  "PT Mono",
  "Geist Mono",
  "Commit Mono",
  "Maple Mono",
  "Monaspace Neon",
  "Consolas",
  "Courier New",
  "Lucida Console",
  "Menlo",
  "Monaco",
  "SF Mono",
];

/** The suffixes a family takes in each of its patched spellings. */
const NERD_SUFFIXES: readonly string[] = ["", " Nerd Font Mono", " Nerd Font", " NFM", " NF"];

/** Every spelling of every family the code picker is willing to offer. */
export const FONT_FAMILY_CANDIDATES: readonly string[] = [
  ...new Set(BASE_FAMILIES.flatMap((family) => NERD_SUFFIXES.map((suffix) => family + suffix))),
];

/** Faces the application font picker is willing to offer. */
const UI_BASE_FAMILIES: readonly string[] = [
  "Segoe UI Variable Text",
  "Segoe UI Variable Display",
  "Segoe UI",
  "Tahoma",
  "Verdana",
  "Calibri",
  "Candara",
  "Corbel",
  "Franklin Gothic Medium",
  "Gill Sans MT",
  "Century Gothic",
  "Trebuchet MS",
  "Arial",
  "Arial Nova",
  "Helvetica Neue",
  "Helvetica",
  "Inter",
  "IBM Plex Sans",
  "Source Sans Pro",
  "Open Sans",
  "Noto Sans",
  "Roboto",
  "Lato",
  "Montserrat",
  "Poppins",
  "Work Sans",
  "Fira Sans",
  "DM Sans",
  "Manrope",
  "Rubik",
  "Nunito Sans",
  "Public Sans",
  "Atkinson Hyperlegible",
  "Ubuntu",
  "Cantarell",
  "DejaVu Sans",
  "Liberation Sans",
  "Georgia",
  "Cambria",
  "Constantia",
  "Palatino Linotype",
  "Book Antiqua",
  "Times New Roman",
  "Garamond",
  "Baskerville",
];

/** A named set of families, so a list too long to read can be shown in sections. */
export type FontFamilyGroup = {
  /** What the section is called in the picker. */
  label: string;
  /** The families in it. */
  families: readonly string[];
};

/**
 * The sections the application font picker offers.
 *
 * The monospace and patched families are here as well as in the code picker,
 * because wanting a Nerd Font everywhere is a real thing to want and there is
 * no reason to make it anyone's second choice of setting.
 */
const UI_FONT_GROUPS: readonly FontFamilyGroup[] = [
  { label: "Interface", families: UI_BASE_FAMILIES },
  { label: "Code and Nerd Fonts", families: FONT_FAMILY_CANDIDATES },
];

/** Every family the application font picker is willing to offer, flattened. */
export const UI_FONT_CANDIDATES: readonly string[] = [
  ...new Set(UI_FONT_GROUPS.flatMap((group) => group.families)),
];

/** The text a family is measured with, chosen to separate one from another. */
const PROBE_TEXT = "mmmmmmmmmmlliWWW@@##";

/** What detection found, kept so the canvas is measured only once per run. */
let cachedCode: string[] | null = null;

/** What detection found for the application font, kept for the same reason. */
let cachedUi: FontFamilyGroup[] | null = null;

/**
 * Quotes a family name when CSS would not read it as one.
 *
 * @param family - The family name.
 * @returns The name, quoted when it contains anything but letters, digits and
 *   hyphens.
 */
export function quoteFamily(family: string): string {
  return /^[A-Za-z0-9-]+$/.test(family) ? family : `"${family}"`;
}

/**
 * Builds the font stack for a chosen family.
 *
 * The chosen family goes in front of the built-in stack rather than replacing
 * it, so a family that turns out not to have a glyph still falls back to one
 * that has it.
 *
 * @param family - The chosen family, or an empty string for the built-in stack.
 * @returns A CSS font-family list.
 */
export function monoFontStack(family: string): string {
  const name = family.trim();
  if (name.length === 0) return MONO_FONT_STACK;
  return `${quoteFamily(name)}, ${MONO_FONT_STACK}`;
}

/**
 * Builds the font stack for a chosen application family.
 *
 * @param family - The chosen family, or an empty string for the built-in stack.
 * @returns A CSS font-family list.
 */
export function uiFontStack(family: string): string {
  const name = family.trim();
  if (name.length === 0) return UI_FONT_STACK;
  return `${quoteFamily(name)}, ${UI_FONT_STACK}`;
}

/**
 * Measures the probe in a family, falling back to a generic face.
 *
 * @param context - The measuring context.
 * @param font - The CSS font shorthand to measure with.
 * @returns The width the probe occupies.
 */
function measure(context: CanvasRenderingContext2D, font: string): number {
  context.font = font;
  return context.measureText(PROBE_TEXT).width;
}

/**
 * Finds which of a list of families are installed.
 *
 * A family that is not installed falls back to the generic face and so measures
 * exactly as that face does; one that is installed draws the probe at its own
 * metrics. That is the whole of the test, and it is why the generic has to be
 * the one the list would fall back to.
 *
 * One blind spot is inherent: a family that *is* the browser's default for that
 * generic measures the same as the generic and is reported missing. That costs
 * nothing here, because the built-in stack reaches the same face anyway.
 *
 * @param candidates - The families to look for.
 * @param generic - The generic family they would fall back to.
 * @returns The installed families, or null when the browser offers no canvas to
 *   measure with.
 */
function installedAmong(candidates: readonly string[], generic: string): string[] | null {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;

  const baseline = measure(context, `72px ${generic}`);
  return candidates.filter(
    (family) => measure(context, `72px ${quoteFamily(family)}, ${generic}`) !== baseline,
  );
}

/**
 * Finds which monospace families are installed.
 *
 * @param candidates - The families to look for.
 * @returns The installed families, or null when nothing can be measured.
 */
export function detectFontFamilies(
  candidates: readonly string[] = FONT_FAMILY_CANDIDATES,
): string[] | null {
  return installedAmong(candidates, "monospace");
}

/**
 * Finds which application families are installed.
 *
 * @param candidates - The families to look for.
 * @returns The installed families, or null when nothing can be measured.
 */
export function detectUiFontFamilies(
  candidates: readonly string[] = UI_FONT_CANDIDATES,
): string[] | null {
  return installedAmong(candidates, "sans-serif");
}

/**
 * The monospace families the code picker should offer.
 *
 * Detection is preferred, so the list holds fonts the machine actually has. A
 * browser that cannot measure gets the full candidate list instead: offering a
 * family that turns out to be missing costs nothing, because the stack falls
 * back, whereas offering nothing would leave the setting unusable.
 *
 * @returns Family names, in the order they should be offered.
 */
export function availableFontFamilies(): string[] {
  if (cachedCode !== null) return cachedCode;
  cachedCode = detectFontFamilies() ?? [...FONT_FAMILY_CANDIDATES];
  return cachedCode;
}

/**
 * The application families the app font picker should offer.
 *
 * @returns Family names, in the order they should be offered.
 */
export function availableUiFontFamilies(): string[] {
  return availableUiFontGroups().flatMap((group) => group.families);
}

/**
 * The application families the app font picker should offer, in sections.
 *
 * Detection runs per section rather than over the flattened list, so a section
 * the machine has nothing in can be left out entirely instead of showing as an
 * empty heading.
 *
 * @returns The sections, each holding only the families that are installed.
 */
export function availableUiFontGroups(): FontFamilyGroup[] {
  if (cachedUi !== null) return cachedUi;
  cachedUi = UI_FONT_GROUPS.map((group) => ({
    label: group.label,
    families: detectUiFontFamilies(group.families) ?? group.families,
  })).filter((group) => group.families.length > 0);
  return cachedUi;
}
