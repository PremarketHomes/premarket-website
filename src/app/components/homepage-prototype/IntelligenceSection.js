'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { MessageSquare, Heart } from 'lucide-react';
import Reveal from './Reveal';

// Illustrative shape only — 12 individual demo buyer opinions plotted
// between $1.6M and $2.1M, matching the "12 price opinions submitted"
// stat shown alongside it (not a separate, disconnected chart). Median of
// these 12 values is exactly $1,850,000, which lands at the dead centre
// of the $1.6M-$2.1M scale.
const OPINIONS_M = [1.65, 1.70, 1.76, 1.80, 1.82, 1.84, 1.86, 1.88, 1.90, 1.94, 1.99, 2.05];
const SCALE_MIN = 1.6;
const SCALE_MAX = 2.1;
const MEDIAN_M = 1.85;
const toPct = (v) => ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
// Small alternating vertical jitter so closely-clustered opinions near the
// median don't fully overlap into an illegible blob.
const JITTER = [0, 10, -8, 6, -10, 4, -4, 10, -6, 8, -2, 0];

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
          <p className="text-slate-500 text-base sm:text-lg max-w-xl mx-auto">
            Take the pressure out of the pricing conversation. Real buyer price opinions gathered
            before launch give you and your vendor another layer of evidence to set realistic
            expectations &mdash; and protect the campaign&rsquo;s critical opening days.
          </p>
        </Reveal>

        {/* Miniature seller/agent report, anchored to the same demo property */}
        <Reveal delay={0.1} className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04),0_24px_60px_-30px_rgba(15,23,42,0.12)] overflow-hidden">
          {/* Property photo header — ties the report back to a real property, not an abstract dashboard */}
          <div className="relative h-44 sm:h-56">
            <Image
              src="/prototype-homepage/hero-exterior.jpg"
              alt="Property this report relates to"
              fill
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <span className="absolute top-4 right-4 text-[10px] uppercase tracking-wider font-semibold text-slate-700 bg-white/90 rounded-full px-2.5 py-1">
              Illustrative example
            </span>
            <div className="absolute left-5 sm:left-6 bottom-4 sm:bottom-5">
              <p
                className="text-white text-lg sm:text-xl"
                style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
              >
                14 Ocean Parade
              </p>
              <p className="text-white/75 text-xs sm:text-sm mt-0.5">Buyer opinion report</p>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            {/* Headline stat */}
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
              Buyer opinion median
            </p>
            <p className="text-4xl sm:text-[2.75rem] font-semibold tabular-nums text-slate-900 leading-none mb-8">
              $1,850,000
            </p>

            {/* Distribution — individual buyer opinions plotted on a scale, not an algorithmic curve */}
            <div className="mb-8">
              <div className="relative h-16 mb-2">
                {/* baseline */}
                <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-200" />
                {/* median marker */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-[#e48900]/40"
                  style={{ left: `${toPct(MEDIAN_M)}%` }}
                />
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: -4 }}
                  animate={inView ? { opacity: 1, y: 0 } : reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.5, delay: reduce ? 0 : 0.6 }}
                  className="absolute -top-1 text-[9px] uppercase tracking-wider font-bold text-[#c64500] whitespace-nowrap"
                  style={{ left: `${toPct(MEDIAN_M)}%`, transform: 'translateX(-50%)' }}
                >
                  Median
                </motion.div>
                {/* individual opinion dots */}
                {OPINIONS_M.map((v, i) => (
                  <motion.div
                    key={i}
                    initial={reduce ? false : { opacity: 0, scale: 0 }}
                    animate={inView ? { opacity: 1, scale: 1 } : reduce ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
                    transition={{ duration: 0.4, delay: reduce ? 0 : 0.05 * i }}
                    className={`absolute top-1/2 w-2.5 h-2.5 rounded-full border-2 border-white ${
                      Math.abs(v - MEDIAN_M) < 0.02 ? 'bg-[#e48900]' : 'bg-slate-400'
                    }`}
                    style={{
                      left: `${toPct(v)}%`,
                      transform: `translate(-50%, calc(-50% + ${JITTER[i]}px))`,
                      boxShadow: '0 1px 3px rgba(15,23,42,0.15)',
                    }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>$1.6M</span>
                <span>$2.1M</span>
              </div>
            </div>

            {/* Opinions + interest counts */}
            <div className="grid grid-cols-2 gap-5 mb-7 pt-6 border-t border-slate-100">
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

            {/* Interest breakdown */}
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

          <div className="px-6 sm:px-8 py-3.5 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400">Illustrative demo data &mdash; buyer-submitted opinions, not an algorithmic valuation</p>
          </div>
        </Reveal>

        <Reveal delay={0.15} className="text-center mt-10 max-w-lg mx-auto">
          <p
            className="text-lg sm:text-xl text-slate-700 leading-snug"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 500, fontStyle: 'italic' }}
          >
            &ldquo;When enough buyers have their say, it&rsquo;s no longer just the agent&rsquo;s
            opinion. The market starts to speak.&rdquo;
          </p>
        </Reveal>

        <Reveal delay={0.2} className="text-center mt-8">
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
