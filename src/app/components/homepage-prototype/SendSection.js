'use client';

import Image from 'next/image';
import Reveal from './Reveal';

/**
 * SEND — the property leaves the hero photograph and travels into a quiet,
 * personal message. Deliberately neutral/off-white around it: this is the
 * opposite of a broadcast, so nothing here should feel loud.
 */
export default function SendSection() {
  return (
    <section id="send" className="relative bg-white py-24 sm:py-32">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
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

        <Reveal delay={0.1} className="max-w-sm mx-auto">
          <div className="rounded-2xl border border-slate-200 shadow-sm bg-white p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-slate-900 text-white text-sm font-semibold flex items-center justify-center">
                A
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Alex &mdash; Coastal Realty</p>
                <p className="text-xs text-slate-400">to James &middot; just now</p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
              <div className="flex gap-3">
                <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                  <Image
                    src="/prototype-homepage/hero-exterior.jpg"
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p
                    className="text-sm text-slate-900 truncate"
                    style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
                  >
                    14 Ocean Parade
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Pre-market &middot; not yet listed</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                &ldquo;Thought you&rsquo;d want to see this one first &mdash; before it&rsquo;s public.&rdquo;
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
