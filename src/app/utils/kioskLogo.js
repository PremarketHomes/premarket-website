import { OFFICES } from '../components/office-landing/offices';

/**
 * The iPad open-home view sits the agency logo directly on the property photo. When the office's branding logo is one
 * of our own supplied full-colour office logos (an opaque image, e.g. /offices/hph/logo-colour.png) and the same office
 * also has its approved white-on-transparent logo in the repo, use that one there instead, so it reads cleanly over the
 * photo with no white box. Returns { src, width, height } or null (any other logo: shown exactly as before).
 */
export function transparentKioskLogo(logoUrl) {
  if (typeof logoUrl !== 'string' || !logoUrl) return null;
  let url;
  try { url = new URL(logoUrl, 'https://premarket.homes'); } catch { return null; }
  if (url.protocol !== 'https:' || !['premarket.homes', 'www.premarket.homes'].includes(url.hostname)) return null;
  for (const office of Object.values(OFFICES)) {
    if (office.logoColour?.src && office.logo?.src && url.pathname === office.logoColour.src) return office.logo;
  }
  return null;
}
