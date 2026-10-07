/** A decoded JSON object. */
export type Json = Record<string, unknown>;

/**
 * Narrows an unknown value to a JSON object.
 *
 * @param value - Any value, typically from parsed JSON.
 * @returns The value as an object, or null when it is not one.
 */
export function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

/**
 * Reads a string field, defaulting to empty.
 *
 * @param value - Any value.
 * @returns The value when it is a string, otherwise an empty string.
 */
export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads a numeric field.
 *
 * @param value - Any value.
 * @returns The value when it is a number, otherwise null.
 */
export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads an array field.
 *
 * @param value - Any value.
 * @returns The value when it is an array, otherwise an empty array.
 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Parses one line of newline-delimited JSON.
 *
 * @param line - A single line of output.
 * @returns The decoded object, or null when the line is not a JSON object.
 */
export function parseJsonLine(line: string): Json | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

/**
 * Serialises a value as indented JSON for display.
 *
 * @param value - Any value.
 * @returns The value as indented JSON, falling back to a string form.
 */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
