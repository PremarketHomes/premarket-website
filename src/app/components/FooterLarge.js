// components/FooterLarge.js

import Link from 'next/link';
import BrandMark from './BrandMark';

export default function Footer() {
  return (
    <footer className="bg-slate-950 text-white py-16 sm:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Main Footer Content */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-10 mb-14">
          {/* Logo & Description */}
          <div className="col-span-2 lg:col-span-2">
            <Link href="/" className="inline-flex items-center gap-2.5 mb-5 group">
              <BrandMark size={28} />
              <span className="font-bold tracking-tight text-white text-2xl">Premarket</span>
            </Link>
            <p className="text-slate-400 text-sm max-w-sm leading-relaxed">
              Real buyer evidence for the way Australian property is actually bought and sold —
              before, during, and after a listing goes public.
            </p>
          </div>

          {/* Solutions */}
          <div>
            <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.18em] mb-5">
              Solutions
            </h3>
            <ul className="space-y-3 text-slate-400 text-sm">
              <li>
                <Link href="/solutions/home-owners" className="hover:text-white transition-colors">
                  Home owners
                </Link>
              </li>
              <li>
                <Link href="/solutions/buyers" className="hover:text-white transition-colors">
                  Buyers
                </Link>
              </li>
              <li>
                <Link href="/solutions/buyers-agents" className="hover:text-white transition-colors">
                  Buyer&apos;s agents
                </Link>
              </li>
              <li>
                <Link href="/solutions/agents" className="hover:text-white transition-colors">
                  Listing agents
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.18em] mb-5">
              Company
            </h3>
            <ul className="space-y-3 text-slate-400 text-sm">
              <li>
                <Link href="/premarket" className="hover:text-white transition-colors">
                  What is Premarket?
                </Link>
              </li>
              <li>
                <Link href="/features" className="hover:text-white transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-white transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Get started */}
          <div>
            <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.18em] mb-5">
              Get started
            </h3>
            <ul className="space-y-3 text-slate-400 text-sm">
              <li>
                <Link href="/signup" className="hover:text-white transition-colors">
                  Create buyer account
                </Link>
              </li>
              <li>
                <Link href="/join" className="hover:text-white transition-colors">
                  Real estate agents — join here
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-white transition-colors">
                  Log in
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-white transition-colors">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-white transition-colors">
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t border-slate-800/80 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500 text-xs">
          <p>&copy; {new Date().getFullYear()} Premarket. All rights reserved.</p>
          <p className="font-semibold tracking-wider uppercase">Made in Australia</p>
        </div>
      </div>
    </footer>
  );
}
