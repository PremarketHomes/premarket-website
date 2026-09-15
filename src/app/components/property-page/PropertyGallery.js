'use client';

import { useRef } from 'react';
import SmartPropertyImage from './SmartPropertyImage';

/**
 * Horizontally-scrollable photo strip beneath the price-opinion/info
 * cards, matching the reference's gallery treatment. Every thumbnail
 * opens the existing full-screen lightbox (same lightbox/keyboard nav
 * logic already in PropertyPageClient — this component only renders
 * thumbnails and calls the passed-in open handler).
 */
export default function PropertyGallery({ imageUrls = [], title, onOpenImage }) {
  const scrollRef = useRef(null);

  if (imageUrls.length < 2) return null;

  const scrollBy = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.85), behavior: 'smooth' });
  };

  // Skip the first image — it's already the hero.
  const rest = imageUrls.slice(1);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {rest.map((url, i) => (
          <button
            key={i}
            onClick={() => onOpenImage(i + 1)}
            className="relative flex-shrink-0 w-[78%] sm:w-[340px] aspect-[4/3] rounded-xl overflow-hidden snap-start group"
          >
            <SmartPropertyImage
              src={url}
              alt={`${title || 'Property'} photo ${i + 2}`}
              className="group-hover:scale-[1.03] transition-transform duration-300"
            />
          </button>
        ))}
      </div>

      {rest.length > 1 && (
        <>
          <button
            onClick={() => scrollBy(-1)}
            aria-label="Previous photos"
            className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 border border-slate-200 items-center justify-center shadow-md hover:bg-white transition-colors"
          >
            <svg className="w-4 h-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => scrollBy(1)}
            aria-label="Next photos"
            className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 border border-slate-200 items-center justify-center shadow-md hover:bg-white transition-colors"
          >
            <svg className="w-4 h-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
