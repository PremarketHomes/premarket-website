/**
 * Pure helpers for applying (optional) agency branding to the public
 * property page. Kept separate from PropertyPageClient.js specifically
 * so the "no brand -> exactly today's appearance" guarantee can be unit
 * tested directly, without needing to render the full component.
 *
 * Precedence (shared default + personal override model): an agent's
 * own personal logo/colour override — `users/{uid}.logoUrl` /
 * `.brandColors` — ALWAYS wins over the inherited shared agency brand,
 * which in turn only ever applies when there's no personal override.
 * With neither, every var(--brand-x, <default>) falls through to the
 * existing Premarket default, unchanged. A personal override never
 * requires a shared brand to exist at all.
 */

/**
 * Returns the inline CSS custom-property style object for a branded
 * page, or `undefined` when there are no colours at all to apply —
 * `undefined` means no style attribute is applied, so every
 * var(--brand-x, <default>) reference in PropertyPageClient.js/
 * PriceOpinionSlider.js falls through to its existing default value,
 * unchanged. Takes a plain `colors` object (already resolved by
 * computeEffectiveColors below) rather than a brand, so callers decide
 * precedence once, in one place, rather than this function re-deriving
 * it.
 */
export function computeBrandStyle(colors) {
  if (!colors?.primary) return undefined;
  const style = {
    '--brand-primary': colors.primary,
    '--brand-primary-dark': colors.primaryDark,
    '--brand-text-on-primary': colors.primaryText,
  };
  if (colors.secondary) {
    style['--brand-secondary'] = colors.secondary;
  }
  return style;
}

/** The agent's own personal colour override wins over the inherited
 * shared brand's colours; falls back to `null` (Premarket default)
 * when neither exists. `previewBrand`, when supplied, represents
 * exactly what the dashboard branding-setup page is about to save —
 * it takes absolute precedence so the live preview there always shows
 * the proposed state, never a mix with whatever is already saved. */
export function computeEffectiveColors({ brand, agentData, previewBrand }) {
  if (previewBrand) return previewBrand.colors || null;
  return agentData?.brandColors || brand?.colors || null;
}

/** The agent's own personal logo upload wins over the inherited shared
 * brand's logo; falls back to `null` when neither exists. Same
 * `previewBrand` precedence reasoning as computeEffectiveColors. */
export function computeDisplayLogoUrl({ brand, agentData, previewBrand }) {
  if (previewBrand) return previewBrand.logoUrl || null;
  return agentData?.logoUrl || brand?.logoUrl || null;
}

/** For an office-linked agent the office's master brand is authoritative:
 * its logo, agency name and colours replace the agent's PERSONAL
 * logoUrl/companyName/brandColors for display. Pure and display-only —
 * the agent's own user document is never written, so removing them from
 * the office (or changing the office brand) takes effect immediately.
 * Independent agents (no officeId) and a missing brand pass through
 * untouched. Fields the brand lacks fall back to null, not the old
 * personal value, so stale personal branding can't show through. */
export function applyOfficeBrand(agent, brand) {
  if (!agent || !agent.officeId || !brand) return agent;
  return {
    ...agent,
    logoUrl: brand.logoUrl || null,
    companyName: brand.name || agent.companyName || null,
    brandColors: null,
  };
}
