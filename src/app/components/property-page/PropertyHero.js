'use client';

import Image from 'next/image';

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
 * Full-bleed hero image with the headline, locality eyebrow and quick
 * stats overlaid — matches the approved reference's "property is the
 * hero" treatment. Only real property data is shown; no fabricated
 * marketing copy is added for fields the data model doesn't have.
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
}) {
  return (
    <div className="relative w-full aspect-[4/5] sm:aspect-[16/10] lg:aspect-[21/9] bg-slate-900 overflow-hidden">
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={title || 'Property photo'}
          fill
          priority
          unoptimized
          className="object-cover"
        />
      ) : null}

      {/* Legibility gradient — bottom-weighted so the photo itself stays the focus */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 px-5 sm:px-8 pb-6 sm:pb-10">
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

      {hasVideo && (
        <button
          onClick={onWatchVideo}
          className="absolute bottom-6 right-5 sm:bottom-10 sm:right-8 inline-flex items-center gap-2.5 bg-white/95 hover:bg-white text-slate-900 text-sm font-semibold pl-3 pr-4 py-2 rounded-full shadow-lg transition-colors"
        >
          <span className="w-7 h-7 rounded-full bg-slate-900 flex items-center justify-center flex-shrink-0">
            <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          Watch video
        </button>
      )}
    </div>
  );
}
