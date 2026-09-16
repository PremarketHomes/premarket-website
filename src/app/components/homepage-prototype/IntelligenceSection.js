'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import Reveal from './Reveal';

// Illustrative shape only — mirrors the real price-opinion distribution
// and interest-level breakdown already shown in the agent dashboard
// (dashboard/property/[id]/page.js), rebuilt lightweight here rather than
// importing recharts into the marketing homepage.
const PRICE_BARS = [18, 34, 62, 100, 58, 28, 12];
const INTEREST_BUCKETS = [
  { label: 'Just Browsing', value: 40 },
  { label: 'Interested', value: 30 },
  { label: 'Very Interested', value: 20 },
  { label: 'Ready to Buy', value: 10 },
];

export default function IntelligenceSection() {
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { once: true, margin: '-100px' });
  const reduce = useReducedMotion();

  return (
    <section id="intelligence" ref={sectionRef} className="relative bg-white py-24 sm:py-32">
      <div className="max-w-2xl mx-auto px-5 sm:px-8">
        <Reveal className="text-center mb-14">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-4">Intelligence</p>
          <h2
            className="text-3xl sm:text-4xl text-slate-900 mb-3"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            You walk back into the conversation with proof.
          </h2>
          <p className="text-slate-500 text-base sm:text-lg">
            Real price opinions. Real interest. All in one view.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 sm:p-8">
          <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-4">Price opinions</p>
          <div className="flex items-end gap-2 h-24 mb-8">
            {PRICE_BARS.map((h, i) => (
              <motion.div
                key={i}
                initial={reduce ? false : { height: 0 }}
                animate={inView ? { height: `${h}%` } : reduce ? { height: `${h}%` } : { height: 0 }}
                transition={{ duration: 0.7, delay: reduce ? 0 : i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                className={`flex-1 rounded-t-md ${h === 100 ? 'bg-[#e48900]' : 'bg-slate-200'}`}
              />
            ))}
          </div>

          <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-4">Buyer interest</p>
          <div className="space-y-3">
            {INTEREST_BUCKETS.map((b, i) => (
              <div key={b.label}>
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{b.label}</span>
                  <span>{b.value}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <motion.div
                    initial={reduce ? false : { width: 0 }}
                    animate={inView ? { width: `${b.value}%` } : reduce ? { width: `${b.value}%` } : { width: 0 }}
                    transition={{ duration: 0.7, delay: reduce ? 0 : 0.4 + i * 0.08 }}
                    className="h-full rounded-full bg-slate-400"
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-400 mt-6 text-center">Example report &mdash; illustrative data</p>
        </Reveal>

        <Reveal delay={0.2} className="text-center mt-10">
          <Link
            href="/join"
            className="inline-block px-6 py-3.5 rounded-xl bg-[#e48900] text-white font-semibold text-[15px] hover:opacity-90 transition-opacity"
          >
            See it with your own listing
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
