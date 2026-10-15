'use client';

import Reveal from './Reveal';

/**
 * WIN THE LISTING — a deliberately quiet, text-only beat between the hero
 * and the mechanism (Send). No illustration of an "appraisal meeting" —
 * there's no real photography of that moment to use honestly, and a staged
 * stock-photo handshake would cheapen the premium feel the rest of the page
 * earns with real product screens. Instead this section does the one job
 * the homepage audit found missing: it says, in plain language, who this
 * is for and what it's worth to them, before the mechanism is explained.
 */
export default function WinListingSection() {
  return (
    <section className="relative bg-[#F8F5F0] py-20 sm:py-28">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
        <Reveal>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-6">
            Win the listing
          </p>
          <p
            className="text-2xl sm:text-4xl text-slate-900 leading-[1.25] sm:leading-[1.3]"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            Every agent walks into the appraisal with an opinion.
            <br className="hidden sm:block" /> Walk in with the market&rsquo;s.
          </p>
          <p className="mt-6 text-slate-500 text-base sm:text-lg max-w-xl mx-auto">
            Comparable sales are someone else&rsquo;s property. Premarket is evidence from the
            buyers who&rsquo;d actually consider this one &mdash; gathered quietly, before you&rsquo;ve
            spent a dollar on the campaign.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
