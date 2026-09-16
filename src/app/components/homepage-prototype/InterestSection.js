'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import Reveal from './Reveal';

const BUYERS = ['J.', 'M.', 'S.', 'R.'];

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

          <Reveal delay={0.2}>
            <p className="text-sm text-slate-500 mb-4 text-center sm:text-left">4 buyers engaged with this property</p>
            <div className="flex justify-center sm:justify-start gap-3">
              {BUYERS.map((initial, i) => (
                <motion.div
                  key={initial}
                  initial={reduce ? false : { opacity: 0, y: 10 }}
                  whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15, duration: 0.5 }}
                  className="w-11 h-11 rounded-full bg-white border border-slate-200 flex items-center justify-center text-sm font-semibold text-slate-600"
                >
                  {initial}
                </motion.div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
