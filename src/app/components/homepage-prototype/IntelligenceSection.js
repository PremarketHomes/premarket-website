'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { MessageSquare, Heart } from 'lucide-react';
import Reveal from './Reveal';

// Illustrative shape only — mirrors the real price-opinion distribution
// and interest-level breakdown already shown in the agent dashboard
// (dashboard/property/[id]/page.js), rebuilt lightweight here rather than
// importing recharts into the marketing homepage. The 4th bar (index 3)
// is the tallest and represents the illustrative median.
const PRICE_BARS = [18, 34, 62, 100, 58, 28, 12];
const MEDIAN_INDEX = 3;
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
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
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

        {/* Miniature seller/agent report */}
        <Reveal delay={0.1} className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04),0_24px_60px_-30px_rgba(15,23,42,0.12)] overflow-hidden">
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

          <div className="p-6 sm:p-8 grid sm:grid-cols-2 gap-10 sm:gap-8">
            {/* Left: the headline stat + distribution */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
                Buyer opinion median
              </p>
              <p className="text-4xl sm:text-[2.75rem] font-semibold tabular-nums text-slate-900 leading-none mb-7">
                $1,850,000
              </p>

              <div className="relative flex items-end gap-1.5 h-20">
                {PRICE_BARS.map((h, i) => (
                  <div key={i} className="relative flex-1">
                    {i === MEDIAN_INDEX && (
                      <motion.span
                        initial={reduce ? false : { opacity: 0, y: 4 }}
                        animate={inView ? { opacity: 1, y: 0 } : reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
                        transition={{ duration: 0.5, delay: reduce ? 0 : 0.5 }}
                        className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-wider font-bold text-[#c64500] whitespace-nowrap"
                      >
                        Median
                      </motion.span>
                    )}
                    <motion.div
                      initial={reduce ? false : { height: 0 }}
                      animate={inView ? { height: `${h}%` } : reduce ? { height: `${h}%` } : { height: 0 }}
                      transition={{ duration: 0.7, delay: reduce ? 0 : i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                      className={`w-full rounded-t-md ${i === MEDIAN_INDEX ? 'bg-[#e48900]' : 'bg-slate-200'}`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-slate-400 mt-2">
                <span>$1.6M</span>
                <span>$2.1M</span>
              </div>
            </div>

            {/* Right: opinion + interest counts, and the interest breakdown */}
            <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-5 mb-7">
                <div>
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1.5">
                    <MessageSquare className="w-3.5 h-3.5" strokeWidth={2} />
                    <p className="text-[11px] uppercase tracking-wider font-semibold">Opinions</p>
                  </div>
                  <p className="text-3xl font-semibold text-slate-900 tabular-nums">12</p>
                  <p className="text-xs text-slate-500 mt-0.5">price opinions submitted</p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1.5">
                    <Heart className="w-3.5 h-3.5" strokeWidth={2} />
                    <p className="text-[11px] uppercase tracking-wider font-semibold">Interest</p>
                  </div>
                  <p className="text-3xl font-semibold text-slate-900 tabular-nums">4</p>
                  <p className="text-xs text-slate-500 mt-0.5">buyers registered interest</p>
                </div>
              </div>

              <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-3">
                Buyer interest
              </p>
              <div className="space-y-2.5">
                {INTEREST_BUCKETS.map((b, i) => (
                  <div key={b.label}>
                    <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                      <span>{b.label}</span>
                      <span>{b.value}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
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
            </div>
          </div>

          <div className="px-6 sm:px-8 py-3.5 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400">Illustrative demo data &mdash; not a real campaign result</p>
          </div>
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
