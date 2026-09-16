'use client';

import { playfairDisplay } from '../property-page/fonts';
import PublicSiteNav from './PublicSiteNav';
import PublicSiteFooter from './PublicSiteFooter';

/**
 * Shared presentational wrapper for login/signup/join. Purely visual — the
 * calling page owns all form state, handlers and Firebase calls, and passes
 * its existing form JSX in as `children`. This component only supplies the
 * new nav/footer/typography/card treatment so all three auth entry points
 * look consistent without duplicating the shell three times.
 */
export default function AuthShell({ eyebrow, title, subtitle, children, footer }) {
  return (
    <div className={`min-h-screen flex flex-col bg-slate-50 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <main className="flex-1 flex items-center justify-center px-4 pt-28 pb-16 sm:pt-32 sm:pb-20">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            {eyebrow && (
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-3">
                {eyebrow}
              </p>
            )}
            <h1
              className="text-3xl sm:text-4xl text-slate-900"
              style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
            >
              {title}
            </h1>
            {subtitle && <p className="text-slate-500 mt-3">{subtitle}</p>}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
            {children}
          </div>

          {footer && <div className="text-center mt-6 space-y-2">{footer}</div>}
        </div>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
