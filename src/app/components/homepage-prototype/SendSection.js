'use client';

import Image from 'next/image';
import Reveal from './Reveal';

const DATABASE_INITIALS = ['J', 'S', 'M'];

/**
 * SEND — redesigned to be photography-led rather than a small floating
 * message card. The property photo is now the dominant visual, with the
 * "database" and "message" moments overlaid directly on it, so the
 * connection between "your existing buyers" and "this specific property"
 * reads in one frame rather than three disconnected ideas.
 */
export default function SendSection() {
  return (
    <section id="send" className="relative bg-white py-24 sm:py-32">
      <div className="max-w-4xl mx-auto px-5 sm:px-8">
        <Reveal className="max-w-xl mx-auto text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-4">Send</p>
          <h2
            className="text-3xl sm:text-4xl text-slate-900 mb-4"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            Sent from an agent&rsquo;s own database.
          </h2>
          <p className="text-slate-500 text-base sm:text-lg">
            No new leads. No cold marketplace. Just the buyers already in your CRM.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="relative rounded-[2rem] overflow-hidden shadow-[0_32px_70px_-32px_rgba(15,23,42,0.3)]">
            <div className="relative aspect-[4/5] sm:aspect-[16/9]">
              <Image
                src="/prototype-homepage/hero-exterior.jpg"
                alt="The property being shared"
                fill
                sizes="(max-width: 768px) 100vw, 896px"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-black/25" />
            </div>

            {/* "Your database" chip, floating over the top of the photo */}
            <div className="absolute top-5 left-5 sm:top-6 sm:left-6 flex items-center gap-2 bg-white/95 backdrop-blur-sm rounded-full pl-1.5 pr-3.5 py-1.5 shadow-sm">
              <div className="flex -space-x-2">
                {DATABASE_INITIALS.map((initial) => (
                  <div
                    key={initial}
                    className="w-6 h-6 rounded-full bg-slate-900 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white"
                  >
                    {initial}
                  </div>
                ))}
              </div>
              <span className="text-xs font-semibold text-slate-700">Your database</span>
            </div>

            {/* The message, floating over the bottom of the same photo */}
            <div className="absolute left-5 right-5 sm:left-8 sm:right-auto sm:w-[26rem] bottom-5 sm:bottom-6">
              <div className="bg-white rounded-2xl shadow-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-slate-900 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
                    A
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">Alex &mdash; Coastal Realty</p>
                    <p className="text-xs text-slate-400">to James &middot; just now</p>
                  </div>
                </div>
                <p
                  className="text-sm text-slate-900 mb-1"
                  style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
                >
                  14 Ocean Parade
                </p>
                <p className="text-xs text-slate-500 mb-2">Pre-market &middot; not yet listed</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  &ldquo;Thought you&rsquo;d want to see this one first &mdash; before it&rsquo;s public.&rdquo;
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
