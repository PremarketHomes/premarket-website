'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { useReducedMotion } from 'framer-motion';

/**
 * Hero — Option 1 from the approved concept: full-bleed premium property
 * photography and a single positioning line. No product UI yet. The
 * technology reveals itself as the visitor scrolls (Send → Engage → ...).
 */
export default function HeroSection({ onPastHero }) {
  const sentinelRef = useRef(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !onPastHero) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        onPastHero(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onPastHero]);

  return (
    <section className="relative h-screen min-h-[560px] w-full overflow-hidden">
      <div className={`absolute inset-0 ${reduce ? '' : 'animate-hero-zoom'}`}>
        <Image
          src="/prototype-homepage/hero-exterior.jpg"
          alt="Premium residential property at dusk"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </div>

      {/* Legibility gradient — same bottom-weighted treatment as the real property page hero */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 pb-16 sm:pb-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <h1
            className="text-white text-4xl sm:text-6xl lg:text-7xl leading-[1.05] max-w-2xl"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            Your database already has the buyers.
          </h1>
          <p className="mt-4 text-white/85 text-lg sm:text-xl max-w-xl">
            Premarket shows you what they&rsquo;re thinking.
          </p>
        </div>
      </div>

      {/* Scroll cue */}
      <div className="absolute inset-x-0 bottom-6 flex justify-center">
        <div className={`w-6 h-10 rounded-full border border-white/40 flex items-start justify-center p-1.5 ${reduce ? '' : 'animate-scroll-cue'}`}>
          <div className="w-1 h-1.5 rounded-full bg-white/80" />
        </div>
      </div>

      {/* Sentinel — nav solidifies once this leaves the viewport */}
      <div ref={sentinelRef} className="absolute bottom-0 left-0 w-full h-px" />

      <style jsx>{`
        @keyframes heroZoom {
          from { transform: scale(1); }
          to { transform: scale(1.06); }
        }
        .animate-hero-zoom {
          animation: heroZoom 14s ease-out forwards;
        }
        @keyframes scrollCue {
          0%, 100% { transform: translateY(0); opacity: 0.6; }
          50% { transform: translateY(6px); opacity: 1; }
        }
        .animate-scroll-cue {
          animation: scrollCue 2s ease-in-out infinite;
        }
      `}</style>
    </section>
  );
}
