/**
 * Phone helpers shared between client (dashboard mobile-confirmation
 * flow, admin user management) and server (admin routes).
 *
 * Keeping these pure and dep-free so they can be imported anywhere
 * without pulling in Node-only crypto modules.
 */

/**
 * Normalize a phone number to E.164. Defaults to Australian (+61) when a
 * bare local mobile is provided. Returns null if unparseable.
 *
 *   04xxxxxxxx    → +614xxxxxxxx
 *   4xxxxxxxx     → +614xxxxxxxx
 *   614xxxxxxxx   → +614xxxxxxxx
 *   +61412345678  → +61412345678 (pass-through)
 *   00614... (intl dial prefix) → +614...
 */
export function normalizeE164(input) {
  if (!input) return null;
  let s = String(input).trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) {
    return /^\+\d{8,15}$/.test(s) ? s : null;
  }
  if (s.startsWith('00')) {
    const rest = s.slice(2);
    return /^\d{8,15}$/.test(rest) ? '+' + rest : null;
  }
  if (/^04\d{8}$/.test(s)) return '+61' + s.slice(1);
  if (/^614\d{8}$/.test(s)) return '+' + s;
  if (/^4\d{8}$/.test(s)) return '+61' + s;
  return null;
}

/**
 * Human-friendly display: wraps the country code so it's visually
 * obvious in UI cards. E.g. "+61412345678" → "+61 412 345 678".
 */
export function formatDisplayPhone(e164) {
  const n = normalizeE164(e164) || e164;
  if (!n || !n.startsWith('+61') || n.length !== 12) return n || '';
  return `+61 ${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}`;
}
