'use client';

import { playfairDisplay } from '../property-page/fonts';
import PublicSiteNav from './PublicSiteNav';
import PublicSiteFooter from './PublicSiteFooter';

/**
 * Shared wrapper for legal pages (Privacy, Terms). Only supplies nav,
 * footer, typography and spacing — the legal text itself is passed in as
 * children, unchanged from the previous copy.
 */
export default function LegalPageShell({ eyebrow, title, meta, children }) {
  return (
    <div className={`min-h-screen bg-white ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <main className="max-w-3xl mx-auto px-5 sm:px-8 pt-28 pb-20 sm:pt-32 sm:pb-28">
        {eyebrow && (
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-3">{eyebrow}</p>
        )}
        <h1
          className="text-3xl sm:text-4xl text-slate-900 mb-2"
          style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
        >
          {title}
        </h1>
        {meta && <p className="text-sm text-slate-400 mb-10">{meta}</p>}
        <div className="text-[15px] text-slate-600 leading-relaxed space-y-8">{children}</div>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
