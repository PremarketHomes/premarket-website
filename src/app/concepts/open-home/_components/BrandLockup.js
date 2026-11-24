/* eslint-disable @next/next/no-img-element -- plain <img> keeps the supplied logos pixel-exact in print and in scaled previews */

// The live Premarket logos (the same files the site, emails and the HPH pages use). Never redrawn or recoloured.
export const PREMARKET_LOGO = { src: 'https://premarketvideos.b-cdn.net/assets/logo.png', width: 2000, height: 400 }; // charcoal + orange, for light backgrounds
export const PREMARKET_LOGO_ON_DARK = { src: '/brand/premarket-on-dark.png', width: 900, height: 163 }; // white + orange, for dark backgrounds

/**
 * "Premarket × Office" partnership lockup, as on the HPH vendor page: Premarket always leads, the office's own supplied
 * logo follows (full-colour on light, white on dark). No office (or no logo supplied) = Premarket only, or the office
 * name as plain text, never an invented logo.
 *
 * `height` is the Premarket wordmark's height in CSS units (any length, e.g. '22px' or '1.6em').
 */
export default function BrandLockup({ partner, tone = 'light', height = '22px', className = '', gap = '0.7em' }) {
  const dark = tone === 'dark';
  const premarket = dark ? PREMARKET_LOGO_ON_DARK : PREMARKET_LOGO;
  // The light logo file has transparent padding (2000x400 canvas); the dark one is cropped tight. Even them out.
  const premarketHeight = dark ? `calc(${height} * 0.82)` : height;
  const logo = partner ? (dark ? partner.logo : partner.logoColour || null) : null;
  // The office logos are taller marks than the Premarket wordmark; this ratio matches the HPH page's lockup.
  const partnerHeight = `calc(${height} * ${dark ? 2 : 1.8})`;
  return (
    <div className={`flex items-center ${className}`} style={{ gap }}>
      <img
        src={premarket.src}
        alt="Premarket"
        width={premarket.width}
        height={premarket.height}
        style={{ height: premarketHeight, width: 'auto' }}
        draggable={false}
      />
      {partner && (
        <>
          <span aria-hidden="true" className={`font-light leading-none ${dark ? 'text-white/55' : 'text-slate-400'}`} style={{ fontSize: `calc(${height} * 0.9)` }}>
            &times;
          </span>
          {logo ? (
            <img src={logo.src} alt={partner.name} width={logo.width} height={logo.height} style={{ height: partnerHeight, width: 'auto' }} draggable={false} />
          ) : (
            <span className={`font-semibold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`} style={{ fontSize: `calc(${height} * 0.8)` }}>{partner.name}</span>
          )}
        </>
      )}
    </div>
  );
}
