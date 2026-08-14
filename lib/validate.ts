// Shared input-validation helpers for API routes.
//
// Postgres `uuid` columns throw sqlstate 22P02 ("invalid input syntax for type
// uuid") when a non-UUID string (empty, whitespace, "garbage") is passed into a
// parameterized query — even when the value is truthy, so a bare `if (!id)`
// guard does NOT protect you. Validate IDs at the route boundary, BEFORE any
// DB call, and return 400 instead of letting an unhandled 500 escape.

/** Standard 8-4-4-4-12 hex UUID with a `[1-5]` version nibble and `[89ab]`
 * variant nibble. Case-insensitive — Postgres accepts upper and lower case
 * UUIDs, so reject neither. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s);
}