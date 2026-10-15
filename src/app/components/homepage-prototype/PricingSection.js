'use client';

import { Sparkles } from 'lucide-react';
import Reveal from './Reveal';

// Mirrors the real, already-live pricing on /solutions/agents and the
// system default in agency-invoice/route.js (pricePerListing || 200) — not
// invented for this page. If the real figure ever changes, update both
// places together.
const PERKS = [
  'Unlimited buyer opinions',
  'Live vendor reports (PDF + in-app)',
  'Price opinion median & range',
  'Branded to your agency',
  'No monthly commitment',
  'Cancel any campaign, any time',
];

export default function PricingSection() {
  return (
    <section className="relative bg-[#F8F5F0] py-24 sm:py-32">
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <Reveal className="text-center mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-4">Pricing</p>
          <h2
            className="text-3xl sm:text-4xl text-slate-900"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            No subscription. No setup. Just a campaign.
          </h2>
        </Reveal>

        <Reveal delay={0.1} className="rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.18)] p-10 sm:p-14 text-center">
          <p className="text-5xl sm:text-6xl font-semibold tracking-tight text-slate-900">
            $200
          </p>
          <p className="mt-2 text-base sm:text-lg text-slate-500">
            vendor-paid, per campaign
          </p>
          <p className="mt-6 text-slate-600 max-w-xl mx-auto leading-relaxed">
            Your Premarket account is free. The vendor pays one flat fee only when you launch
            a campaign &mdash; nothing before that, nothing recurring.
          </p>

          <div className="mt-9 grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-w-lg mx-auto text-left">
            {PERKS.map((perk) => (
              <div key={perk} className="flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-[#e48900] flex-shrink-0 mt-0.5" strokeWidth={2} />
                <span className="text-sm text-slate-700 leading-snug">{perk}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
