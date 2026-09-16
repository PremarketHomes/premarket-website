import Link from 'next/link';
import BrandMark from '../BrandMark';

/**
 * Single consolidated footer for the prototype, replacing the audit's
 * finding of three inconsistent footers (PublicFooter / FooterLarge /
 * AgentFooter) with one minimal, restrained treatment.
 */
export default function PrototypeFooter() {
  return (
    <footer className="bg-white border-t border-slate-100 py-10">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2">
          <BrandMark size={20} />
          <span className="font-semibold text-slate-900 text-sm">Premarket</span>
        </div>

        <div className="flex items-center gap-6 text-sm text-slate-500">
          <Link href="/contact" className="hover:text-slate-800">Contact</Link>
          <Link href="/privacy" className="hover:text-slate-800">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-800">Terms</Link>
        </div>

        <p className="text-xs text-slate-400">&copy; {new Date().getFullYear()} Premarket</p>
      </div>
    </footer>
  );
}
