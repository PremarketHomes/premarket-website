'use client';

import Link from 'next/link';
import BrandMark from '../BrandMark';

/**
 * Canonical nav for the redesigned public site — one component, reused
 * everywhere (homepage and every other public page), rather than a
 * homepage-only nav duplicated elsewhere.
 *
 * `solid`:
 *   - true (default) — always white/bordered. Used on every page except
 *     the homepage hero, which has its own full-bleed photo behind it.
 *   - false — transparent, white text; the caller (currently only the
 *     homepage) drives this to true once the visitor scrolls past the
 *     hero, via an IntersectionObserver in HeroSection.
 *
 * Intentionally minimal — Features, Contact, Log In, one primary CTA.
 * No mega-dropdowns, no /listings in primary nav (kept out per the
 * agent-first positioning; /listings is still linked from the footer so
 * its SEO value isn't orphaned).
 */
export default function PublicSiteNav({ solid = true }) {
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

        <div className="flex items-center gap-5 sm:gap-6">
          <Link
            href="/features"
            className={`hidden sm:inline text-sm font-medium transition-colors duration-500 ${
              solid ? 'text-slate-600 hover:text-slate-900' : 'text-white/80 hover:text-white'
            }`}
          >
            Features
          </Link>
          <Link
            href="/contact"
            className={`hidden sm:inline text-sm font-medium transition-colors duration-500 ${
              solid ? 'text-slate-600 hover:text-slate-900' : 'text-white/80 hover:text-white'
            }`}
          >
            Contact
          </Link>
          <Link
            href="/login"
            className={`text-sm font-medium transition-colors duration-500 ${
              solid ? 'text-slate-600 hover:text-slate-900' : 'text-white/80 hover:text-white'
            }`}
          >
            Log in
          </Link>
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
