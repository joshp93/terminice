import type { Settings } from "../types";

/**
 * Whether two readings of the settings say the same thing.
 *
 * Every field is a number, a string or a boolean, so this compares them one by
 * one rather than by identity — which is what makes it useful: a settings object
 * that has been through the file comes back as a new object every time, and
 * adopting it when nothing in it changed would re-render the whole window for
 * nothing.
 *
 * @param a - One reading.
 * @param b - The other.
 * @returns True when every setting is equal.
 */
export function sameSettings(a: Settings, b: Settings): boolean {
  const keys = Object.keys(a) as Array<keyof Settings>;
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
