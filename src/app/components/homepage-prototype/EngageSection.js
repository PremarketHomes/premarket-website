'use client';

import Image from 'next/image';
import Reveal from './Reveal';
import PremarketBadge from '../property-page/PremarketBadge';

/**
 * ENGAGE — the message "opens" into the real property campaign experience.
 * The header treatment here mirrors the actual property page's hierarchy
 * (agency mark, then the real PremarketBadge component — reused as-is, not
 * reinvented) so this reads as the genuine product, not an illustration of it.
 */
export default function EngageSection() {
  return (
    <section id="engage" className="relative bg-[#F8F5F0] py-24 sm:py-32">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <Reveal className="max-w-xl mx-auto text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-4">Engage</p>
          <h2
            className="text-3xl sm:text-4xl text-slate-900"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            They open a property experience with your name on it.
          </h2>
        </Reveal>

        <Reveal delay={0.1} className="max-w-3xl mx-auto rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 overflow-hidden">
          {/* Mock property-page header bar — agency mark left, real Premarket badge right */}
          <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
                CR
              </div>
              <span className="text-sm font-semibold text-slate-800">Coastal Realty</span>
            </div>
            <PremarketBadge variant="header" />
          </div>

          <div className="relative aspect-[16/10]">
            <Image
              src="/prototype-homepage/interior-living.jpg"
              alt="Property interior"
              fill
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <div className="absolute left-5 sm:left-6 bottom-5 sm:bottom-6">
              <p
                className="text-white text-xl sm:text-2xl"
                style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
              >
                14 Ocean Parade
              </p>
              <p className="text-white/80 text-sm mt-1">4 bed &middot; 2 bath &middot; 2 car</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
