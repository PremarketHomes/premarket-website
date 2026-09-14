'use client';

const STAT_ICONS = {
  bed: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  bath: 'M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z',
  car: 'M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2',
  land: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  area: 'M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  type: 'M3 21h18M5 21V7l8-4v18M13 9h6v12M9 9h.01M9 12h.01M9 15h.01',
};

function Stat({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg className="w-[18px] h-[18px] text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
      </svg>
      <span className="text-slate-700 text-sm">
        {value} {label}
      </span>
    </div>
  );
}

/**
 * Companion card to PriceOpinionCard — real property details only (no
 * fabricated marketing tags like "pool" / "water views" unless that data
 * genuinely exists on the property record).
 */
export default function PropertyInfoCard({
  eyebrow,
  description,
  showFullDescription,
  onToggleDescription,
  bedrooms,
  bathrooms,
  carSpaces,
  landSize,
  squareFootage,
  yearBuilt,
  propertyType,
}) {
  const stats = [
    bedrooms ? { icon: STAT_ICONS.bed, label: 'Bedrooms', value: bedrooms } : null,
    bathrooms ? { icon: STAT_ICONS.bath, label: 'Bathrooms', value: bathrooms } : null,
    carSpaces ? { icon: STAT_ICONS.car, label: 'Car spaces', value: carSpaces } : null,
    landSize ? { icon: STAT_ICONS.land, label: 'm² land', value: landSize } : null,
    squareFootage ? { icon: STAT_ICONS.area, label: 'm² floor area', value: squareFootage } : null,
    yearBuilt ? { icon: STAT_ICONS.calendar, label: 'Built', value: yearBuilt } : null,
    propertyType ? { icon: STAT_ICONS.type, label: '', value: propertyType } : null,
  ].filter(Boolean);

  const isLong = (description || '').length > 320;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 sm:p-8 h-full flex flex-col">
      {eyebrow && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 mb-3">
          {eyebrow}
        </p>
      )}

      {description && (
        <div className="mb-6">
          <div className={`text-slate-600 text-[15px] leading-relaxed whitespace-pre-line ${!showFullDescription && isLong ? 'line-clamp-6' : ''}`}>
            {description}
          </div>
          {isLong && (
            <button
              onClick={onToggleDescription}
              className="mt-2 text-sm font-semibold text-slate-900 underline underline-offset-2 hover:no-underline"
            >
              {showFullDescription ? 'Show less' : 'View more details'}
            </button>
          )}
        </div>
      )}

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-auto pt-5 border-t border-slate-200">
          {stats.map((s, i) => (
            <Stat key={i} icon={s.icon} label={s.label} value={s.value} />
          ))}
        </div>
      )}
    </div>
  );
}
