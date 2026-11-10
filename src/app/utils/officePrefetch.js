import { authFetch } from './authFetch';

/**
 * Office pages used to wait for GET /api/offices/mine before asking for their own data. The app already knows the
 * user's office id (userData.officeId), so the data request can start at the same time. The early answer is used only
 * when /mine confirms the same office and that the user is its admin; otherwise the page fetches as before. Every
 * endpoint still checks the caller's rights on the server, so starting early never grants anything.
 */
export function startOfficeRequest(knownOfficeId, path) {
  if (!knownOfficeId) return null;
  return authFetch(`/api/offices/${encodeURIComponent(knownOfficeId)}${path}`).catch(() => null);
}

export async function officeResponse(early, knownOfficeId, officeId, path) {
  if (early && knownOfficeId === officeId) {
    const res = await early;
    if (res) return res;
  }
  return authFetch(`/api/offices/${encodeURIComponent(officeId)}${path}`);
}
