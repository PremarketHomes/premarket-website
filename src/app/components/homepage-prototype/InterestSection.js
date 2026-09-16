'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Heart, DollarSign, CheckCircle2 } from 'lucide-react';
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
 * INTEREST — one continuous card telling a single story: a buyer registers
 * interest on the property experience, the agent is notified, and that
 * action becomes part of a running engagement feed. Deliberately one
 * connected composition rather than two separate demo boxes.
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
    <section id="interest" ref={sectionRef} className="relative bg-[#F8F5F0] py-24 sm:py-32">
      <div className="max-w-2xl mx-auto px-5 sm:px-8">
        <Reveal className="max-w-xl mx-auto text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-4">Interest</p>
          <h2
            className="text-3xl sm:text-4xl text-slate-900"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            Genuine buyers register their interest.
          </h2>
        </Reveal>

        <Reveal delay={0.1} className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04),0_24px_60px_-30px_rgba(15,23,42,0.12)] overflow-hidden">
          {/* Property reference bar — ties this back to the same demo campaign */}
          <div className="flex items-center justify-between px-6 sm:px-8 py-4 border-b border-slate-100">
            <p
              className="text-sm sm:text-base text-slate-800"
              style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
            >
              14 Ocean Parade
            </p>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 border border-slate-200 rounded-full px-2.5 py-1 flex-shrink-0">
              Illustrative example
            </span>
          </div>

          {/* The moment: a buyer registers interest on the property experience */}
          <div className="px-6 sm:px-8 pt-8 pb-7 text-center">
            {!registered ? (
              <button
                type="button"
                disabled
                className="mx-auto px-7 py-3.5 rounded-xl border border-slate-300 text-slate-800 font-semibold text-[15px]"
              >
                Register formal interest
              </button>
            ) : (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center"
              >
                <div className="w-11 h-11 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" strokeWidth={2} />
                </div>
                <p className="text-sm font-semibold text-slate-900">Interest registered &mdash; the agent&rsquo;s been notified.</p>
              </motion.div>
            )}
          </div>

          {/* Flow connector */}
          <div className="flex items-center gap-3 px-6 sm:px-8">
            <span className="h-px flex-1 bg-slate-100" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Becomes engagement intelligence</span>
            <span className="h-px flex-1 bg-slate-100" />
          </div>

          {/* The result: engagement accumulating into a feed the agent can see */}
          <div className="px-6 sm:px-8 pt-6 pb-7">
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-4">
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
          </div>

          <div className="px-6 sm:px-8 py-3.5 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400">Illustrative demo &mdash; not real buyer data</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
