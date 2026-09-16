'use client';

import Image from 'next/image';
import Link from 'next/link';
import Reveal from './Reveal';

/**
 * Final CTA — a visual bookend of the hero: same photographic treatment,
 * a different moment of day, the positioning line restated as a close.
 */
export default function FinalCtaSection() {
  return (
    <section id="final-cta" className="relative h-[70vh] min-h-[440px] w-full overflow-hidden">
      <Image
        src="/prototype-homepage/daytime-exterior.jpg"
        alt="Premium residential property"
        fill
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative h-full flex items-center justify-center">
        <Reveal className="text-center px-5">
          <h2
            className="text-white text-3xl sm:text-5xl mb-4"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            Your database already has the buyers.
          </h2>
          <p className="text-white/85 text-lg sm:text-xl mb-8">Show the sellers what they&rsquo;re thinking.</p>
          <Link
            href="/join"
            className="inline-block px-7 py-3.5 rounded-xl bg-[#e48900] text-white font-semibold hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
