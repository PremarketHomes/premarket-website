// components/Nav.js

'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  LogOut,
  ChevronDown,
  Home,
  Users,
  Briefcase,
  FileBarChart,
  BellRing,
  TrendingUp,
  Tablet,
  Building2,
  ArrowRight,
} from 'lucide-react';
import { defaultDashboardFor } from '../utils/roles';
import BrandMark, { BrandMarkLogo } from './BrandMark';

// ---------- Mega dropdown content ----------

const SOLUTIONS = [
  {
    title: 'Home Owners',
    description: 'Test the market privately. Get real buyer evidence before you commit to selling.',
    href: '/solutions/home-owners',
    icon: Home,
  },
  {
    title: 'Buyers',
    description: 'Save listings, share price opinions, and get early access to premarket properties.',
    href: '/solutions/buyers',
    icon: Users,
  },
  {
    title: "Buyer's Agents",
    description: 'See properties before they hit the portals. Win more deals with first-mover advantage.',
    href: '/solutions/buyers-agents',
    icon: Briefcase,
  },
  {
    title: 'Listing Agents',
    description: 'Win more listings with live buyer evidence. $200 vendor-paid per campaign — no subscription.',
    href: '/solutions/agents',
    icon: Building2,
  },
];

const FEATURES = [
  {
    title: 'Reports',
    description: 'Vendor reports built from real buyer evidence, accurate the moment you open them.',
    href: '/features/reports',
    icon: FileBarChart,
  },
  {
    title: 'Reminders',
    description: 'A scheduled check-in at 14 and 30 days, sent to the agent.',
    href: '/features/reminders',
    icon: BellRing,
  },
  {
    title: 'Price Opinions',
    description: 'Anonymous buyer pricing aggregated into a clear market signal.',
    href: '/features/price-opinions',
    icon: TrendingUp,
  },
  {
    title: 'Agent iPad',
    description: 'A kiosk mode for capturing buyer feedback in the field — opens in Safari, nothing to install.',
    href: '/features/agent-ipad',
    icon: Tablet,
  },
];

// ---------- Reusable mega dropdown ----------

function MegaDropdown({ label, items, isActive, onMouseEnter, onMouseLeave, open, width = 'md' }) {
  // Width tokens — small enough to feel intentional, big enough to breathe.
  const widthClass = {
    sm: 'w-[640px]',
    md: 'w-[760px]',
    lg: 'w-[900px]',
  }[width] || 'w-[760px]';

  // Two-column layout for short menus, three for longer ones.
  const cols = items.length > 3 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div
      className="relative"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        className={`flex items-center gap-1 text-slate-700 hover:text-[#c64500] font-medium text-sm transition-colors duration-200 ${
          isActive ? 'text-[#c64500]' : ''
        }`}
        aria-expanded={open}
      >
        {label}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 -translate-x-1/2 top-full pt-4 z-50"
          >
            <div
              className={`bg-white rounded-3xl shadow-[0_40px_80px_-30px_rgba(15,23,42,0.25)] border border-slate-100 p-7 ${widthClass}`}
            >
              <div className={`grid gap-2 ${cols}`}>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.title}
                      href={item.href}
                      className="group flex items-start gap-4 p-4 rounded-2xl hover:bg-slate-50 transition-colors"
                    >
                      <Icon
                        className="w-5 h-5 text-slate-400 group-hover:text-[#e48900] transition-colors flex-shrink-0 mt-0.5"
                        strokeWidth={1.75}
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 text-[14px] tracking-tight">
                          {item.title}
                        </p>
                        <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {/* Footer banner */}
              <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                  <BrandMark size={14} />
                  New to Premarket?{' '}
                  <Link href="/premarket" className="font-semibold text-[#c64500] hover:underline">
                    Read the explainer →
                  </Link>
                </span>
                <Link
                  href="/contact"
                  className="text-xs font-semibold text-slate-700 hover:text-[#c64500] transition-colors inline-flex items-center gap-1"
                >
                  Talk to us
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- Main Nav ----------

export default function Nav({ isHomepage = false }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [openMega, setOpenMega] = useState(null); // 'solutions' | 'features' | null
  const [mobileSection, setMobileSection] = useState(null);
  const dropdownRef = useRef(null);
  const closeTimeout = useRef(null);
  const { user, userData, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Close avatar dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close mega dropdowns on route change
  useEffect(() => {
    setOpenMega(null);
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
    await signOut();
    router.push('/');
  };

  // Mega dropdown hover handlers (with grace period to prevent flicker)
  function openMegaWithGrace(name) {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    setOpenMega(name);
  }
  function closeMegaWithGrace() {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    closeTimeout.current = setTimeout(() => setOpenMega(null), 140);
  }

  const initials = user
    ? (userData?.firstName?.[0] || userData?.email?.[0] || '?').toUpperCase()
    : '';

  const avatarUrl = userData?.avatar;
  const hasRealAvatar = avatarUrl && !avatarUrl.includes('placeholder');

  const dashboardHref = defaultDashboardFor(userData);

  const isSection = (prefix) => pathname?.startsWith(prefix);

  return (
    <>
      <header className="bg-white/90 backdrop-blur-md shadow-sm sticky top-0 z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 lg:h-20">
            {/* Logo */}
            <div className="flex-shrink-0">
              <Link href="/" aria-label="Premarket — home">
                <BrandMarkLogo size={26} />
              </Link>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-7">
              <Link
                href="/listings"
                className="text-gray-700 hover:text-[#e48900] font-medium text-sm transition-colors duration-200"
              >
                Browse
              </Link>

              <MegaDropdown
                label="Solutions"
                items={SOLUTIONS}
                isActive={isSection('/solutions')}
                open={openMega === 'solutions'}
                onMouseEnter={() => openMegaWithGrace('solutions')}
                onMouseLeave={closeMegaWithGrace}
                width="md"
              />

              <MegaDropdown
                label="Features"
                items={FEATURES}
                isActive={isSection('/features')}
                open={openMega === 'features'}
                onMouseEnter={() => openMegaWithGrace('features')}
                onMouseLeave={closeMegaWithGrace}
                width="lg"
              />

              <Link
                href="/premarket"
                className={`text-slate-700 hover:text-[#c64500] font-medium text-sm transition-colors duration-200 ${
                  isSection('/premarket') ? 'text-[#c64500]' : ''
                }`}
              >
                What is Premarket?
              </Link>

              <Link
                href="/contact"
                className={`text-slate-700 hover:text-[#c64500] font-medium text-sm transition-colors duration-200 ${
                  isSection('/contact') ? 'text-[#c64500]' : ''
                }`}
              >
                Contact
              </Link>

              {!loading && user ? (
                <>
                  <Link
                    href={dashboardHref}
                    className="text-gray-700 hover:text-[#e48900] font-medium text-sm transition-colors duration-200"
                  >
                    Dashboard
                  </Link>

                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => setDropdownOpen(!dropdownOpen)}
                      className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors border border-gray-200"
                    >
                      {hasRealAvatar ? (
                        <Image
                          src={avatarUrl}
                          alt="Avatar"
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="w-8 h-8 bg-gradient-to-br from-[#e48900] to-[#c64500] rounded-full flex items-center justify-center text-white font-bold text-sm">
                          {initials}
                        </div>
                      )}
                      <ChevronDown
                        className={`w-4 h-4 text-gray-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {dropdownOpen && (
                      <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
                        <div className="px-4 py-3 border-b border-gray-100">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {[userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || 'Account'}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {userData?.email || user?.email}
                          </p>
                        </div>

                        <Link
                          href={dashboardHref}
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <LayoutDashboard className="w-4 h-4 text-gray-400" />
                          Dashboard
                        </Link>

                        <button
                          onClick={handleSignOut}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          Sign Out
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : !loading ? (
                <>
                  <Link
                    href="/login"
                    className="text-slate-700 hover:text-[#c64500] font-medium text-sm transition-colors duration-200"
                  >
                    Log In
                  </Link>
                  <Link
                    href="/signup"
                    className="px-5 py-2.5 bg-[#e48900] hover:bg-[#c64500] text-white font-semibold text-sm rounded-full transition-colors duration-200"
                  >
                    Create account
                  </Link>
                </>
              ) : null}
            </nav>

            {/* Mobile Menu Button */}
            <div className="flex items-center gap-3 lg:hidden">
              {!loading && user && (
                <Link href={dashboardHref} className="flex-shrink-0">
                  {hasRealAvatar ? (
                    <Image
                      src={avatarUrl}
                      alt="Avatar"
                      width={32}
                      height={32}
                      className="w-8 h-8 rounded-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-8 h-8 bg-gradient-to-br from-[#e48900] to-[#c64500] rounded-full flex items-center justify-center text-white font-bold text-xs">
                      {initials}
                    </div>
                  )}
                </Link>
              )}

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="lg:hidden overflow-hidden bg-white border-t border-gray-100"
            >
              <div className="px-4 pt-3 pb-6 space-y-1">
                <Link
                  href="/listings"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-[#e48900] font-semibold transition-all duration-200"
                >
                  Browse Properties
                </Link>

                {/* Solutions accordion */}
                <button
                  type="button"
                  onClick={() =>
                    setMobileSection(mobileSection === 'solutions' ? null : 'solutions')
                  }
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-[#e48900] font-semibold transition-all duration-200"
                >
                  Solutions
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${mobileSection === 'solutions' ? 'rotate-180' : ''}`}
                  />
                </button>
                <AnimatePresence>
                  {mobileSection === 'solutions' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden pl-4 space-y-1"
                    >
                      {SOLUTIONS.map((item) => (
                        <Link
                          key={item.title}
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className="block px-4 py-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-[#c64500]"
                        >
                          <span className="font-semibold text-slate-900">{item.title}</span>
                          <span className="block text-xs text-slate-500 mt-0.5">
                            {item.description}
                          </span>
                        </Link>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Features accordion */}
                <button
                  type="button"
                  onClick={() =>
                    setMobileSection(mobileSection === 'features' ? null : 'features')
                  }
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-[#e48900] font-semibold transition-all duration-200"
                >
                  Features
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${mobileSection === 'features' ? 'rotate-180' : ''}`}
                  />
                </button>
                <AnimatePresence>
                  {mobileSection === 'features' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden pl-4 space-y-1"
                    >
                      {FEATURES.map((item) => (
                        <Link
                          key={item.title}
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className="block px-4 py-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-[#c64500]"
                        >
                          <span className="font-semibold text-slate-900">{item.title}</span>
                          <span className="block text-xs text-slate-500 mt-0.5">
                            {item.description}
                          </span>
                        </Link>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                <Link
                  href="/premarket"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-[#e48900] font-semibold transition-all duration-200"
                >
                  What is Premarket?
                </Link>
                <Link
                  href="/contact"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-[#e48900] font-semibold transition-all duration-200"
                >
                  Contact
                </Link>

                {!loading && user ? (
                  <>
                    <div className="px-4 py-3 border-t border-gray-100 mt-2 pt-3">
                      <p className="text-sm font-semibold text-gray-900">
                        {[userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || 'Account'}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {userData?.email || user?.email}
                      </p>
                    </div>
                    <Link
                      href={dashboardHref}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-[#e48900] font-semibold transition-all duration-200"
                    >
                      <LayoutDashboard className="w-5 h-5" />
                      Dashboard
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 font-semibold transition-all duration-200"
                    >
                      <LogOut className="w-5 h-5" />
                      Sign Out
                    </button>
                  </>
                ) : !loading ? (
                  <>
                    <Link
                      href="/login"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-[#e48900] font-semibold transition-all duration-200"
                    >
                      Log In
                    </Link>
                    <Link
                      href="/signup"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block mx-4 mt-4 px-4 py-3 bg-[#e48900] hover:bg-[#c64500] text-white font-semibold text-center rounded-full transition-colors"
                    >
                      Create account
                    </Link>
                  </>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </>
  );
}
