'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Heart, DollarSign } from 'lucide-react';
import Reveal from './Reveal';

// Illustrative/demo identities only — first name + last initial, never real
// buyer data. Purpose is to show the shape of the intelligence layer (an
// agent-facing glimpse of engagement), not to simulate a real CRM record.
const ENGAGEMENT_FEED = [
  { name: 'James M.', action: 'Registered interest', icon: Heart },
  { name: 'Sarah T.', action: 'Price opinion submitted', icon: DollarSign },
  { name: 'Michael R.', action: 'Registered interest', icon: Heart },
  { name: 'Rebecca L.', action: 'Price opinion submitted', icon: DollarSign },
];

/**
 * INTEREST — genuine buyer interest, shown as a real "register interest"
 * moment plus a quiet, anonymised accumulation of engaged buyers (initials
 * only — no invented statistics, just an illustrative demo count).
 */
export default function InterestSection() {
  const [registered, setRegistered] = useState(false);
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { once: true, margin: '-100px' });
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => setRegistered(true), reduce ? 0 : 900);
    return () => clearTimeout(t);
  }, [inView, reduce]);

  return (
    <section id="interest" ref={sectionRef} className="relative bg-slate-50 py-24 sm:py-32">
      <div className="max-w-4xl mx-auto px-5 sm:px-8">
        <Reveal className="max-w-xl mx-auto text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-4">Interest</p>
          <h2
            className="text-3xl sm:text-4xl text-slate-900"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            Genuine buyers put their hand up.
          </h2>
        </Reveal>

        <div className="grid sm:grid-cols-2 gap-6 items-center">
          <Reveal delay={0.1} className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            {!registered ? (
              <button
                type="button"
                disabled
                className="w-full py-3.5 rounded-xl border border-slate-300 text-slate-800 font-semibold text-[15px] text-center"
              >
                Register formal interest
              </button>
            ) : (
              <div className="text-center py-2">
                <p className="text-sm font-semibold text-slate-900">Thanks &mdash; the agent&rsquo;s been notified.</p>
                <p className="text-xs text-slate-400 mt-1">Illustrative demo</p>
              </div>
            )}
          </Reveal>

          <Reveal delay={0.2} className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-4">
              4 buyers engaged with this property
            </p>
            <div className="divide-y divide-slate-100">
              {ENGAGEMENT_FEED.map((buyer, i) => {
                const Icon = buyer.icon;
                return (
                  <motion.div
                    key={buyer.name}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.15, duration: 0.5 }}
                    className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0 mt-0.5">
                      {buyer.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{buyer.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" strokeWidth={2} />
                        <p className="text-xs text-slate-500">{buyer.action}</p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
