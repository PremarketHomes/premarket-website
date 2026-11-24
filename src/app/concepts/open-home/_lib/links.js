/** Addresses inside the Open Home concept. The QR on each sign encodes visitUrl() for that session. */
export const CONCEPT_BASE = '/concepts/open-home';

export const isSessionCode = (s) => typeof s === 'string' && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(s);

export function visitPath(sessionId, propertyId) {
  return `${CONCEPT_BASE}/visit?property=${encodeURIComponent(propertyId)}&session=${encodeURIComponent(sessionId)}`;
}

/** Absolute link for the QR: the deployment the presenter is on (preview, or premarket.homes once merged). */
export function visitUrl(sessionId, propertyId, origin) {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : 'https://premarket.homes');
  return `${base}${visitPath(sessionId, propertyId)}`;
}

export function signPath(sessionId, propertyId, format) {
  const q = new URLSearchParams({ property: propertyId, session: sessionId });
  if (format) q.set('format', format);
  return `${CONCEPT_BASE}/sign?${q.toString()}`;
}
