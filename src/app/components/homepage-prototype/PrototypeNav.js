'use client';

import Link from 'next/link';
import BrandMark from '../BrandMark';

/**
 * Minimal nav for the homepage story prototype — one anchor link, one CTA.
 * Deliberately not the site-wide mega-dropdown Nav: the whole point of this
 * concept is that the page IS the explainer, so there is nothing to browse
 * to. Transparent over the hero photo, solidifies once the visitor scrolls
 * past the hero (see `solid` prop, driven by an IntersectionObserver in
 * HeroSection).
 */
export default function PrototypeNav({ solid }) {
  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-colors duration-500 ${
        solid
          ? 'bg-white/95 backdrop-blur-sm border-b border-slate-200'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark size={22} />
          <span
            className={`font-bold text-lg tracking-tight transition-colors duration-500 ${
              solid ? 'text-slate-900' : 'text-white'
            }`}
          >
            Premarket
          </span>
        </Link>

        <div className="flex items-center gap-6">
          <a
            href="#send"
            className={`hidden sm:inline text-sm font-medium transition-colors duration-500 ${
              solid ? 'text-slate-600 hover:text-slate-900' : 'text-white/80 hover:text-white'
            }`}
          >
            How it works
          </a>
          <Link
            href="/join"
            className="text-sm font-semibold px-4 py-2 rounded-xl bg-[#e48900] text-white hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}
