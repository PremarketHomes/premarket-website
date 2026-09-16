'use client';

import Reveal from './Reveal';

/**
 * PROOF — deliberately a placeholder, not a real quote.
 *
 * The audit found two existing testimonial data sources in the codebase
 * attributing the same agent name to two different agencies (an
 * unresolved data conflict). Rather than reuse either unverified quote,
 * or invent a new one, this section is left as an explicit placeholder
 * per the brief: "use a clearly labelled prototype placeholder rather
 * than inventing statistics." Swap for a verified quote before this ever
 * ships.
 */
export default function ProofSection() {
  return (
    <section id="proof" className="relative bg-slate-50 py-20 sm:py-28">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 text-center">
        <Reveal>
          <h2
            className="text-2xl sm:text-3xl text-slate-900 mb-6"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            Agents are already using it this way.
          </h2>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10">
            <span className="inline-block text-[11px] uppercase tracking-wider font-semibold text-slate-400 border border-slate-300 rounded-full px-3 py-1 mb-4">
              Prototype placeholder
            </span>
            <p className="text-slate-500 italic">
              Verified agent testimonial to be added here once confirmed with the agency.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
