'use client';

import Link from 'next/link';
import BrandMark from '../BrandMark';

/**
 * Canonical nav for the redesigned public site — one component, reused
 * everywhere (homepage and every other public page) instead of duplicating
 * nav markup per page. Exactly five elements: logo, one contextual
 * "how it works" link, Contact, Log in, Get started.
 *
 * `howItWorksHref` / `howItWorksLabel` make the middle link contextual:
 *   - on the homepage, pass href="#send" label="How it works" (anchors
 *     into the homepage's own scroll story)
 *   - everywhere else, pass href="/features" label="Features"
 *
 * `solid`:
 *   - true (default) — always white/bordered, used on every page except
 *     the homepage hero (which has a full-bleed photo behind it).
 *   - false — transparent, white text; only the homepage drives this to
 *     true once the visitor scrolls past the hero.
 *
 * Deliberately does not include Browse/Solutions-dropdown/Features-
 * dropdown/"What is Premarket?"/Create account — those remain real,
 * reachable routes, just no longer part of primary navigation.
 */
export default function PublicSiteNav({ solid = true, howItWorksHref = '/features', howItWorksLabel = 'Features' }) {
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
            href={howItWorksHref}
            className={`hidden sm:inline text-sm font-medium transition-colors duration-500 ${
              solid ? 'text-slate-600 hover:text-slate-900' : 'text-white/80 hover:text-white'
            }`}
          >
            {howItWorksLabel}
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
