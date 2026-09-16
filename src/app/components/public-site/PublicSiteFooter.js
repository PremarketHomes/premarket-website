import Link from 'next/link';
import BrandMark from '../BrandMark';

/**
 * Canonical footer for the redesigned public site — replaces the audit's
 * finding of three inconsistent footers (PublicFooter / FooterLarge /
 * AgentFooter) with one minimal, restrained treatment, reused everywhere.
 *
 * "Browse properties" -> /listings is kept here (not in primary nav) so
 * the route stays internally linked and its existing SEO value isn't
 * orphaned, without promoting marketplace browsing prominently.
 */
export default function PublicSiteFooter() {
  return (
    <footer className="bg-white border-t border-slate-100 py-10">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2">
          <BrandMark size={20} />
          <span className="font-semibold text-slate-900 text-sm">Premarket</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
          <Link href="/features" className="hover:text-slate-800">Features</Link>
          <Link href="/contact" className="hover:text-slate-800">Contact</Link>
          <Link href="/listings" className="hover:text-slate-800">Browse properties</Link>
          <Link href="/privacy" className="hover:text-slate-800">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-800">Terms</Link>
        </div>

        <p className="text-xs text-slate-400">&copy; {new Date().getFullYear()} Premarket</p>
      </div>
    </footer>
  );
}
