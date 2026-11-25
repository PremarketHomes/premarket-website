import { transparentKioskLogo } from '../kioskLogo';

/**
 * The co-brand "partner" for the Open Home screens and signs, from an office's own Premarket branding
 * ({ name, logoUrl, primary } from agencyBrands, as the buyer property page uses). The office's supplied logo is shown
 * as-is on light backgrounds; on dark ones the approved white version is used when one exists (the same mapping as the
 * iPad kiosk), otherwise the office name as text. No branding → Premarket only.
 */
export function partnerFromBrand(brand) {
  if (!brand || (!brand.logoUrl && !brand.name)) return null;
  const name = brand.name || 'Your agency';
  return {
    name,
    shortName: name,
    navy: brand.primary || '#1f2329',
    blue: '#00aeef',
    logoColour: brand.logoUrl ? { src: brand.logoUrl, width: 400, height: 200 } : null,
    logo: transparentKioskLogo(brand.logoUrl),
  };
}

/** The --brand-* colour variables the buyer screens read; Premarket's defaults when the office has no colour. */
export function brandStyleFromBrand(brand) {
  if (!brand?.primary || !/^#[0-9a-fA-F]{6}$/.test(brand.primary)) return undefined;
  return { '--brand-primary': brand.primary, '--brand-primary-dark': brand.primary, '--brand-text-on-primary': '#ffffff' };
}

export const openHomeVisitUrl = (code, origin) => `${origin || (typeof window !== 'undefined' ? window.location.origin : 'https://premarket.homes')}/open-home/${code}`;
