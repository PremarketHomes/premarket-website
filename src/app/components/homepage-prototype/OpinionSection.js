'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'framer-motion';
import Reveal from './Reveal';
import PriceOpinionSlider, { PRICE_OPINION_STEP } from '../PriceOpinionSlider';

const MIN = 850000;
const MAX = 1050000;
const MID = 950000;

/**
 * OPINION — the centrepiece visual moment. This is the real, shared
 * PriceOpinionSlider component (same one used on the property page, the
 * iPad kiosk and the TV display) — not a recreation. It's purely
 * controlled here (value/onChange only, no Firestore/API calls), and the
 * value auto-plays gently back and forth only while this section is on
 * screen, and only if the visitor hasn't asked for reduced motion.
 */
export default function OpinionSection() {
  const [value, setValue] = useState(MID);
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { once: false, margin: '-100px' });
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView || reduce) return;

    let direction = 1;
    let current = MID;
    const id = setInterval(() => {
      current += direction * PRICE_OPINION_STEP;
      if (current >= MAX) direction = -1;
      if (current <= MIN) direction = 1;
      setValue(current);
    }, 550);

    return () => clearInterval(id);
  }, [inView, reduce]);

  const displayValue = reduce ? MID : value;

  return (
    <section
      id="opinion"
      ref={sectionRef}
      className="relative bg-white py-24 sm:py-32"
      style={{ '--brand-primary': '#e48900', '--brand-primary-dark': '#c64500' }}
    >
      <div className="max-w-2xl mx-auto px-5 sm:px-8 text-center">
        <Reveal>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-4">Opinion</p>
          <h2
            className="text-3xl sm:text-4xl text-slate-900 mb-3"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            They tell you what they&rsquo;d actually pay.
          </h2>
          <p className="text-slate-500 text-base sm:text-lg mb-12">
            Anonymous. Honest. In seconds.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="text-5xl sm:text-6xl font-semibold tabular-nums text-slate-900 mb-8">
            ${displayValue.toLocaleString('en-AU')}
          </p>

          <PriceOpinionSlider
            value={displayValue}
            min={MIN}
            max={MAX}
            onChange={setValue}
            className="slider-thumb w-full h-2 rounded-full appearance-none bg-slate-200 accent-[#e48900] cursor-pointer"
          />

          <div className="flex justify-between text-xs text-slate-400 mt-3">
            <span>${MIN.toLocaleString('en-AU')}</span>
            <span>${MAX.toLocaleString('en-AU')}</span>
          </div>

          <p className="text-xs text-slate-400 mt-10">Illustrative demo &mdash; not a real property</p>
        </Reveal>
      </div>
    </section>
  );
}
