/**
 * Minimal parser for the Firestore REST API's typed-value document
 * format (https://firestore.googleapis.com/v1/.../documents/{id}) into
 * a plain JS object — the same shape the client SDK's `doc.data()`
 * already returns.
 *
 * Used by find-property/page.js to fetch a property server-side (via
 * the same public, API-key'd REST read that already existed there for
 * Open Graph metadata) and reuse the *whole* document to seed the
 * client component's initial render, instead of hand-picking a handful
 * of metadata fields and discarding the rest of the fetch.
 */
function parseValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('mapValue' in value) return parseFields(value.mapValue?.fields);
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(parseValue);
  return null;
}

export function parseFields(fields) {
  if (!fields) return {};
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = parseValue(value);
  }
  return out;
}
