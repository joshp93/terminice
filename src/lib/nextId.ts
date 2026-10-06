let counter = 0;

/**
 * Returns an identifier that is unique within this page session.
 *
 * @param prefix - Short label included in the identifier.
 * @returns A unique identifier string.
 */
export function nextId(prefix = "entry"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
