'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import {
  BookOpen,
  Home,
  Camera,
  FileText,
  BarChart3,
  Users,
  Lightbulb,
  ArrowLeft,
  Menu,
  X,
  Download,
  CheckCircle,
  HelpCircle,
} from 'lucide-react';
import { loginUrlForCurrentPage } from '../../utils/loginRedirect';

/* ─── Sidebar Navigation Structure ─── */
const NAV_SECTIONS = [
  {
    group: 'Getting Started',
    items: [
      { id: 'welcome', label: 'Welcome', icon: BookOpen },
      { id: 'why-premarket', label: 'Why Premarket?', icon: Lightbulb },
    ],
  },
  {
    group: 'Listing a Property',
    items: [
      { id: 'step-1', label: 'Enter Address', icon: Home },
      { id: 'step-2', label: 'Property Type', icon: FileText },
      { id: 'step-3', label: 'Set Price', icon: BarChart3 },
      { id: 'step-4', label: 'Property Details', icon: FileText },
      { id: 'step-5', label: 'Photos & Video', icon: Camera },
      { id: 'step-6', label: 'Listing Details', icon: FileText },
      { id: 'step-7', label: 'Review & Submit', icon: CheckCircle },
    ],
  },
  {
    group: 'Your Dashboard',
    items: [
      { id: 'engagement', label: 'Engagement Metrics', icon: BarChart3 },
      { id: 'price-intelligence', label: 'Price Intelligence', icon: BarChart3 },
      { id: 'buyer-opinions', label: 'Buyer Opinions', icon: Users },
    ],
  },
  {
    group: 'Tips & Support',
    items: [
      { id: 'best-practices', label: 'Best Practices', icon: Lightbulb },
      { id: 'need-help', label: 'Need Help?', icon: HelpCircle },
    ],
  },
];

const ALL_IDS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.id));

export default function UserManualPage() {
  useRequireAgent();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState('welcome');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isScrollingTo = useRef(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace(loginUrlForCurrentPage());
    }
  }, [loading, user, router]);

  // Scroll-spy via IntersectionObserver
  useEffect(() => {
    const observers = [];
    const visibleSections = new Set();

    ALL_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (isScrollingTo.current) return;
          if (entry.isIntersecting) {
            visibleSections.add(id);
          } else {
            visibleSections.delete(id);
          }
          for (const sectionId of ALL_IDS) {
            if (visibleSections.has(sectionId)) {
              setActiveSection(sectionId);
              break;
            }
          }
        },
        { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
      );

      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const scrollTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    isScrollingTo.current = true;
    setActiveSection(id);
    setSidebarOpen(false);

    const y = el.getBoundingClientRect().top + window.scrollY - 32;
    window.scrollTo({ top: y, behavior: 'smooth' });

    window.history.replaceState(null, '', `#${id}`);

    setTimeout(() => {
      isScrollingTo.current = false;
    }, 800);
  }, []);

  // Handle initial hash on mount
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && ALL_IDS.includes(hash)) {
      setTimeout(() => scrollTo(hash), 100);
    }
  }, [scrollTo]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  const sidebarNav = (
    <nav className="px-3 py-2">
      {NAV_SECTIONS.map((section) => (
        <div key={section.group} className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {section.group}
          </p>
          {section.items.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                  isActive
                    ? 'text-orange-600 font-medium bg-orange-50 border-l-2 border-orange-500 -ml-px'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-white">
      {/* ─── Desktop Sidebar ─── */}
      <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 bg-slate-50 border-r border-slate-200 z-30">
        <div className="flex flex-col h-full">
          <div className="p-5 border-b border-slate-200">
            <Link href="/">
              <Image
                src="https://premarketvideos.b-cdn.net/assets/logo.png"
                alt="Premarket"
                width={130}
                height={32}
                className="h-6 w-auto"
                unoptimized
              />
            </Link>
          </div>

          <div className="px-4 pt-4 pb-2">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Dashboard
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto">
            {sidebarNav}
          </div>

          {/* Download PDF button in sidebar */}
          <div className="p-4 border-t border-slate-200">
            <a
              href="/AgentUserManual.pdf"
              download
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </a>
          </div>
        </div>
      </aside>

      {/* ─── Mobile Header ─── */}
      <div className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <Menu className="w-5 h-5 text-slate-600" />
            </button>
            <span className="font-semibold text-slate-900 text-sm">User Manual</span>
          </div>
          <a
            href="/AgentUserManual.pdf"
            download
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </a>
        </div>
      </div>

      {/* ─── Mobile Sidebar Overlay ─── */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 w-72 bg-white shadow-xl z-50 lg:hidden overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <span className="font-semibold text-slate-900">User Manual</span>
              <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            {sidebarNav}
          </aside>
        </>
      )}

      {/* ─── Main Content ─── */}
      <main className="lg:pl-60">
        <div className="max-w-3xl mx-auto px-6 sm:px-8 py-12 lg:py-16">

          {/* ════════════════════════════════════════ */}
          {/* GETTING STARTED                          */}
          {/* ════════════════════════════════════════ */}

          <section id="welcome" className="scroll-mt-20">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-4">
              Agent User Manual
            </h1>
            <p className="text-lg text-slate-500 mb-6">
              Real Buyer Feedback. Better Vendor Conversations.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              Premarket is a pre-market property platform that connects agents with serious buyers before a property hits the open market. This manual will guide you through listing a property and understanding your dashboard.
            </p>

            <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 mt-6">
              <div className="flex items-start gap-3">
                <Download className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-900 text-sm mb-1">Download PDF Version</p>
                  <p className="text-sm text-slate-600 mb-3">
                    Prefer a printable version? Download the full user manual as a PDF.
                  </p>
                  <a
                    href="/AgentUserManual.pdf"
                    download
                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download PDF
                  </a>
                </div>
              </div>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          <section id="why-premarket" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Why Premarket?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { title: 'Gauge genuine interest', desc: 'Understand real buyer interest before going public with a listing.' },
                { title: 'Data-driven pricing', desc: 'Receive price feedback directly from the market to inform your strategy.' },
                { title: 'Identify serious buyers', desc: 'Find buyers who are ready to act early in the process.' },
                { title: 'Confident decisions', desc: 'Make informed pricing decisions backed by real buyer evidence.' },
              ].map((item, i) => (
                <div key={i} className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                  <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center mb-3">
                    <CheckCircle className="w-4 h-4 text-orange-600" />
                  </div>
                  <h3 className="font-semibold text-slate-900 text-sm mb-1">{item.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* LISTING A PROPERTY                       */}
          {/* ════════════════════════════════════════ */}

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Listing a Property</h2>
            <p className="text-slate-600 leading-relaxed">
              Adding a property to Premarket takes just a few minutes. Follow these 7 simple steps to create your listing.
            </p>
          </div>

          <section id="step-1" className="scroll-mt-20 mb-10">
            <div className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                1
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Enter the Property Address</h3>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Start typing the property address and select from the Google-powered suggestions. This ensures accurate location data for your listing.
                </p>
              </div>
            </div>
          </section>

          <section id="step-2" className="scroll-mt-20 mb-10">
            <div className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                2
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Select Property Type</h3>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Choose the property type that best describes the listing: House, Apartment, Villa, Townhouse, or Acreage.
                </p>
              </div>
            </div>
          </section>

          <section id="step-3" className="scroll-mt-20 mb-10">
            <div className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                3
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Set Expected Price</h3>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Enter your expected sale price. This is the figure buyers will see and provide feedback on. Be realistic — the market will tell you if it&apos;s on target.
                </p>
              </div>
            </div>
          </section>

          <section id="step-4" className="scroll-mt-20 mb-10">
            <div className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                4
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Add Property Details</h3>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Enter the key property specifications: bedrooms, bathrooms, car spaces, and land size. Then select relevant features like pool, solar, air conditioning, and more.
                </p>
              </div>
            </div>
          </section>

          <section id="step-5" className="scroll-mt-20 mb-10">
            <div className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                5
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Upload Photos & Video</h3>
                <p className="text-slate-600 leading-relaxed text-sm mb-3">
                  Upload high-quality photos to showcase the property. You can also add an optional walkthrough video. Drag and drop files or click to browse.
                </p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">Supported formats:</span> JPG, PNG, HEIC (images) &middot; MP4, MOV, WebM (video)
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section id="step-6" className="scroll-mt-20 mb-10">
            <div className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                6
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Add Listing Details</h3>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Write a compelling title and description for the property. Short on time? Click &ldquo;Generate with AI&rdquo; and we&apos;ll create an engaging listing for you automatically.
                </p>
              </div>
            </div>
          </section>

          <section id="step-7" className="scroll-mt-20">
            <div className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                7
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Review & Submit</h3>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Review the Terms & Conditions, then click &ldquo;Submit Property&rdquo; to publish your listing. Your property is now live on Premarket.
                </p>
              </div>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* YOUR DASHBOARD                           */}
          {/* ════════════════════════════════════════ */}

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Understanding Your Dashboard</h2>
            <p className="text-slate-600 leading-relaxed">
              Once your property is live, the dashboard provides real-time insights into buyer engagement and market sentiment.
            </p>
          </div>

          <section id="engagement" className="scroll-mt-20 mb-10">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Engagement Metrics</h3>
            <p className="text-slate-600 leading-relaxed text-sm mb-4">
              Track how buyers are interacting with your listing at a glance.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total Views', desc: 'How many buyers have seen your property' },
                { label: 'Total Likes', desc: 'Buyers who\'ve expressed interest' },
                { label: 'Price Opinions', desc: 'Buyers who\'ve provided price feedback' },
                { label: 'Serious Buyers', desc: 'Buyers marked as highly interested' },
              ].map((metric, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                  <p className="text-xs font-semibold text-slate-500 mb-1">{metric.label}</p>
                  <p className="text-xs text-slate-400 leading-tight">{metric.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="price-intelligence" className="scroll-mt-20 mb-10">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Price Intelligence</h3>
            <p className="text-slate-600 leading-relaxed text-sm mb-4">
              See how the market values your property compared to your listing price. The Combined Median shows the average price opinion across all buyers.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-slate-900 mb-3">What you&apos;ll see:</h4>
              <ul className="space-y-2">
                {[
                  'Price distribution chart showing where buyer opinions cluster',
                  'Combined median price opinion vs your listing price',
                  'Breakdown by serious buyers vs passive browsers',
                  'Buyer type analysis (first home buyers, investors, etc.)',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section id="buyer-opinions" className="scroll-mt-20">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Buyer Opinions</h3>
            <p className="text-slate-600 leading-relaxed text-sm">
              View individual buyer price opinions, their seriousness level, and buyer type. This helps you identify which buyers are most likely to proceed and tailor your vendor conversations with real evidence.
            </p>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* TIPS & SUPPORT                           */}
          {/* ════════════════════════════════════════ */}

          <section id="best-practices" className="scroll-mt-20 mb-10">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Best Practices</h2>
            <div className="space-y-4">
              {[
                { title: 'Use high-quality photos', desc: 'First impressions matter. Great photos drive significantly more engagement.' },
                { title: 'Be realistic with your expected price', desc: 'The market will tell you the truth. A realistic price attracts more genuine opinions.' },
                { title: 'Add a video walkthrough', desc: 'Properties with video get significantly more engagement and higher quality leads.' },
                { title: 'Select all relevant features', desc: 'Buyers filter by amenities like pool, solar, and air conditioning. Don\'t miss out.' },
                { title: 'Monitor your dashboard regularly', desc: 'Serious buyers emerge quickly. Stay on top of engagement to act fast.' },
                { title: 'Use the AI description generator', desc: 'Short on time? Our AI creates compelling listings in seconds.' },
              ].map((tip, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-green-100 flex items-center justify-center mt-0.5">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm mb-0.5">{tip.title}</h3>
                    <p className="text-slate-600 text-sm leading-relaxed">{tip.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="need-help" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Need Help?</h2>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
              <p className="text-slate-600 leading-relaxed text-sm mb-4">
                If you have questions or need assistance, our support team is here to help. Contact us anytime for guidance on getting the most from Premarket.
              </p>
              <a
                href="mailto:knockknock@premarket.homes"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                knockknock@premarket.homes
              </a>
            </div>
          </section>

          {/* Footer */}
          <div className="mt-16 pt-8 border-t border-slate-200 text-center">
            <Image
              src="https://premarketvideos.b-cdn.net/assets/logo.png"
              alt="Premarket"
              width={100}
              height={25}
              className="mx-auto mb-3 opacity-40"
              unoptimized
            />
            <p className="text-xs text-slate-400">&copy; 2026 Premarket. All rights reserved.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
