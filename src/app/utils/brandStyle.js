/**
 * Pure helpers for applying (optional) agency branding to the public
 * property page. Kept separate from PropertyPageClient.js specifically
 * so the "no brand -> exactly today's appearance" guarantee can be unit
 * tested directly, without needing to render the full component.
 */

/**
 * Returns the inline CSS custom-property style object for a branded
 * page, or `undefined` when there's no brand — `undefined` means no
 * style attribute at all is applied, so every var(--brand-x, <default>)
 * reference in PropertyPageClient.js/PriceOpinionSlider.js falls through
 * to its existing default value, unchanged.
 */
export function computeBrandStyle(brand) {
  if (!brand?.colors?.primary) return undefined;
  const style = {
    '--brand-primary': brand.colors.primary,
    '--brand-primary-dark': brand.colors.primaryDark,
    '--brand-text-on-primary': brand.colors.primaryText,
  };
  if (brand.colors.secondary) {
    style['--brand-secondary'] = brand.colors.secondary;
  }
  return style;
}

/** Agency brand logo takes precedence over the agent's personal logo
 * upload, since the brand is meant to represent the whole office. Falls
 * back to the agent's own `logoUrl` (today's existing behaviour) when
 * there's no brand. */
export function computeDisplayLogoUrl({ brand, agentData }) {
  return brand?.logoUrl || agentData?.logoUrl || null;
}

/** The premium redesign's property-info eyebrow label — real
 * `listingStatus` data only, never fabricated marketing copy. */
export function computeListingEyebrow(listingStatus) {
  return listingStatus === 'on-market' ? 'On-Market Opportunity' : 'Off-Market Opportunity';
}
