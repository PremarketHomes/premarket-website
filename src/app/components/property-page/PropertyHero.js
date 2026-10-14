'use client';

import { useEffect, useRef } from 'react';
import SmartPropertyImage from './SmartPropertyImage';
import HeroValuationBar from './HeroValuationBar';

const STAT_ICONS = {
  bed: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  bath: 'M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z',
  car: 'M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2',
  land: 'M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4',
};

function HeroStat({ icon, label }) {
  return (
    <div className="flex items-center gap-2">
      <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
      </svg>
      <span className="text-white text-sm sm:text-[15px] font-medium">{label}</span>
    </div>
  );
}

/**
 * Full-bleed hero image with the headline, locality eyebrow, quick
 * stats, and — now — the primary valuation control all anchored to
 * its bottom edge. Only real property data is shown; no fabricated
 * marketing copy is added for fields the data model doesn't have.
 *
 * HeroValuationBar sits as the last item in this same bottom-anchored
 * content stack (not a second absolutely-positioned layer fighting for
 * the same space) — title/locality/stats keep their own inset padding
 * above it, while the bar itself runs edge-to-edge immediately below,
 * so a buyer can see the property AND start giving a price opinion in
 * the very first screen, no scrolling required.
 *
 * Mobile height is viewport-relative (60vh, clamped 420–560px) to make
 * room for that embedded bar without crowding the title/stats above it
 * — checked against realistic iPhone viewports (see the property-page
 * conversion report); desktop/tablet (sm: and up) keep the original
 * aspect-ratio treatment, which already has ample room.
 *
 * `onPastHero`, when passed, fires once a 1px sentinel at the bottom of
 * the hero scrolls out of view. Since the valuation bar now lives
 * inside the hero's own bounds, "past hero" and "the hero's slider has
 * scrolled away" are the same event — this single signal drives the
 * persistent valuation bar's visibility.
 */
export default function PropertyHero({
  title,
  locality,
  bedrooms,
  bathrooms,
  carSpaces,
  landSize,
  imageUrl,
  hasVideo,
  onWatchVideo,
  onPastHero,
  priceOpinion,
  hasInteracted,
  isSliding,
  minPrice,
  maxPrice,
  onPriceChange,
  onSlideStart,
  onSlideEnd,
  onSubmitOpinion,
  formatMoney,
}) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !onPastHero) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        onPastHero(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onPastHero]);

  return (
    <div className="relative w-full h-[60vh] min-h-[420px] max-h-[560px] sm:h-auto sm:aspect-[16/10] lg:aspect-[21/9] bg-slate-900 overflow-hidden">
      {imageUrl ? (
        <SmartPropertyImage
          src={imageUrl}
          alt={title || 'Property photo'}
          priority
          sizes="100vw"
        />
      ) : null}

      {/* Legibility gradient — bottom-weighted so the photo itself stays the focus */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

      {/* Watch video — top-right on every breakpoint now, since the
          valuation bar below occupies the full-width bottom edge
          regardless of screen size. */}
      {hasVideo && (
        <button
          onClick={onWatchVideo}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 inline-flex items-center gap-2.5 bg-white/95 hover:bg-white text-slate-900 text-sm font-semibold pl-3 pr-4 py-2 rounded-full shadow-lg transition-colors"
        >
          <span className="w-7 h-7 rounded-full bg-slate-900 flex items-center justify-center flex-shrink-0">
            <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          Watch video
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col">
        <div className="px-5 sm:px-8 pb-4 sm:pb-6">
          <div className="max-w-6xl mx-auto">
            {locality && (
              <p className="text-white/70 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.15em] mb-2 sm:mb-3">
                {locality}
              </p>
            )}
            <h1
              className="text-white font-semibold leading-[1.05] mb-3 sm:mb-4 text-[2.1rem] sm:text-5xl lg:text-6xl"
              style={{ fontFamily: 'var(--font-playfair, serif)' }}
            >
              {title}
            </h1>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:gap-x-7">
              {bedrooms ? <HeroStat icon={STAT_ICONS.bed} label={`${bedrooms} Bedrooms`} /> : null}
              {bathrooms ? <HeroStat icon={STAT_ICONS.bath} label={`${bathrooms} Bathrooms`} /> : null}
              {carSpaces ? <HeroStat icon={STAT_ICONS.car} label={`${carSpaces} Car spaces`} /> : null}
              {landSize ? <HeroStat icon={STAT_ICONS.land} label={`${landSize} m² Land size`} /> : null}
            </div>
          </div>
        </div>

        <HeroValuationBar
          priceOpinion={priceOpinion}
          hasInteracted={hasInteracted}
          isSliding={isSliding}
          minPrice={minPrice}
          maxPrice={maxPrice}
          onChange={onPriceChange}
          onSlideStart={onSlideStart}
          onSlideEnd={onSlideEnd}
          onSubmit={onSubmitOpinion}
          formatMoney={formatMoney}
        />
      </div>

      {/* Sentinel — the persistent valuation bar considers itself
          free to appear once this leaves the viewport */}
      <div ref={sentinelRef} className="absolute bottom-0 left-0 w-full h-px" />
    </div>
  );
}
