'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import {
  BookOpen,
  Users,
  Code,
  Home,
  UserCheck,
  FileText,
  Search,
  Key,
  List,
  Terminal,
  ArrowLeft,
  Menu,
  X,
  ChevronRight,
  Database,
  Activity,
  Plug,
  LinkIcon,
  BarChart3,
  Copy,
  Check,
  Lock,
  TrendingUp,
  AlertCircle,
  Zap,
  DollarSign,
  Gauge,
  ThermometerSun,
  Scale,
  Flame,
  Timer,
  ShieldCheck,
  GitBranch,
  ArrowLeftRight,
  Receipt,
  CreditCard,
  RefreshCw,
  Settings,
  CalendarClock,
  Contact2,
} from 'lucide-react';

/* ─── Sidebar Navigation Structure ─── */
const NAV_SECTIONS = [
  {
    group: 'Getting Started',
    items: [
      { id: 'introduction', label: 'Introduction', icon: BookOpen },
      { id: 'how-it-works', label: 'How It Works', icon: List },
    ],
  },
  {
    group: 'Solutions',
    items: [
      { id: 'price-education', label: 'Price Education', icon: TrendingUp },
      { id: 'the-problem', label: 'The Problem', icon: AlertCircle },
      { id: 'the-data-engine', label: 'The Data Engine', icon: Zap },
      { id: 'the-business', label: 'The Business', icon: DollarSign },
    ],
  },
  {
    group: 'User Journeys',
    items: [
      { id: 'listing-agents', label: 'Listing Agents', icon: UserCheck },
      { id: 'buyers-agents', label: "Buyer's Agents", icon: Search },
      { id: 'sellers', label: 'Sellers', icon: Home },
      { id: 'buyers', label: 'Buyers', icon: Users },
    ],
  },
  {
    group: 'Product',
    items: [
      { id: 'core-insight', label: 'Core Insight', icon: Activity },
      { id: 'the-flywheel', label: 'The Flywheel', icon: Database },
      { id: 'integrations', label: 'Integrations', icon: Plug },
    ],
  },
  {
    group: 'Health Indicators',
    items: [
      { id: 'phi-overview', label: 'PHI Overview', icon: Activity },
      { id: 'phi-mhi', label: 'Market Heat (MHI)', icon: Flame },
      { id: 'phi-bdi', label: 'Buyer Demand (BDI)', icon: Gauge },
      { id: 'phi-smi', label: 'Seller Motivation (SMI)', icon: ThermometerSun },
      { id: 'phi-pvi', label: 'Price Validity (PVI)', icon: Scale },
      { id: 'phi-evs', label: 'Engagement Velocity (EVS)', icon: Timer },
      { id: 'phi-bqi', label: 'Buyer Quality (BQI)', icon: ShieldCheck },
      { id: 'phi-fpi', label: 'Forward Pipeline (FPI)', icon: GitBranch },
      { id: 'phi-sdb', label: 'Supply-Demand (SDB)', icon: ArrowLeftRight },
      { id: 'data-confidence', label: 'Data Confidence', icon: ShieldCheck },
    ],
  },
  {
    group: 'Market Intelligence',
    items: [
      { id: 'data-advantage', label: 'The Data Advantage', icon: Database },
      { id: 'api-overview', label: 'API Overview', icon: Code },
      { id: 'authentication', label: 'Authentication', icon: Key },
      { id: 'endpoints', label: 'Endpoints', icon: FileText },
      { id: 'code-examples', label: 'Code Examples', icon: Terminal },
    ],
  },
  {
    group: 'CRM & Contacts',
    items: [
      { id: 'crm-overview', label: 'CRM Overview', icon: Contact2 },
      { id: 'contact-scoring', label: 'Contact Scoring', icon: Activity },
      { id: 'crm-api', label: 'API: Contacts', icon: Code },
    ],
  },
  {
    group: 'Billing & Invoicing',
    items: [
      { id: 'invoicing-overview', label: 'Overview', icon: Receipt },
      { id: 'invoicing-how-it-works', label: 'How Billing Works', icon: DollarSign },
      { id: 'invoicing-runs', label: 'Invoice Runs', icon: FileText },
      { id: 'invoicing-xero', label: 'Xero Integration', icon: CreditCard },
      { id: 'invoicing-automation', label: 'Automation', icon: CalendarClock },
      { id: 'invoicing-api', label: 'API Reference', icon: Code },
    ],
  },
];

const ALL_IDS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.id));

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/v1/phi-scores',
    description: 'All 8 PHI scores + confidence metadata for a location',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
  {
    method: 'GET',
    path: '/api/v1/property-valuation',
    description: 'Per-property valuation analysis: overvalued/undervalued list sorted by deviation',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
  {
    method: 'GET',
    path: '/api/v1/heatmap-data',
    description: 'GeoJSON FeatureCollection from market scores for Mapbox heatmap visualisation',
    params: 'metric (bdi, smi, pvi, mhi, evs, bqi, fpi, sdb)',
  },
  {
    method: 'GET',
    path: '/api/v1/buyer-score',
    description: 'Buyer intent score (0-100) for a location',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
  {
    method: 'GET',
    path: '/api/v1/seller-score',
    description: 'Seller intent score (0-100) for a location',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
  {
    method: 'GET',
    path: '/api/v1/market-forecast',
    description: 'Properties going to market, expected prices, demand indicator',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
  {
    method: 'GET',
    path: '/api/v1/trending-areas',
    description: 'Top trending areas ranked by buyer activity growth, includes PHI scores per area',
    params: 'limit, country',
  },
  {
    method: 'GET',
    path: '/api/v1/historical-trends',
    description: 'Buyer/seller score and PHI trends over past months',
    params: 'location, suburb, state, postcode, lat, lng, radius, months',
  },
  {
    method: 'GET',
    path: '/api/v1/property-insights',
    description: 'Per-property views, opinions, likes, PVI score, and price vs opinion gap',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
  {
    method: 'GET',
    path: '/api/v1/national-overview',
    description: 'National market summary with aggregated PHI averages across all tracked suburbs',
    params: 'none',
  },
  {
    method: 'GET',
    path: '/api/v1/contacts',
    description: 'Paginated CRM contacts with buyer/seller scores',
    params: 'type, search, limit, offset',
  },
];

/* ─── Default export with Suspense wrapper ─── */
export default function DocsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
        </div>
      }
    >
      <DocsGate />
    </Suspense>
  );
}

/* ─── Access Gate ─── */
function DocsGate() {
  const { user, userData, loading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('t');

  const [accessState, setAccessState] = useState('checking'); // checking | granted | denied | expired
  const [isTokenAccess, setIsTokenAccess] = useState(false);

  useEffect(() => {
    if (loading) return;

    const isAdmin = userData?.superAdmin === true;

    // Path 1: superAdmin — instant access, no recording
    if (isAdmin) {
      setAccessState('granted');
      setIsTokenAccess(false);
      return;
    }

    // Path 2: token present — validate it
    if (token) {
      fetch(`/api/docs/links/${token}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.valid) {
            setAccessState('granted');
            setIsTokenAccess(true);
          } else if (data.expired) {
            setAccessState('expired');
          } else {
            setAccessState('denied');
          }
        })
        .catch(() => setAccessState('denied'));
      return;
    }

    // Path 3: no admin, no token — redirect
    if (user) {
      router.push('/dashboard');
    } else {
      router.push('/join');
    }
  }, [loading, user, userData, token, router]);

  if (loading || accessState === 'checking') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (accessState === 'expired') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Link Expired</h1>
          <p className="text-slate-500 text-sm mb-6">This link has expired after 72 hours. Please request a new link to access the documentation.</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
          >
            Go to Homepage
          </Link>
        </div>
      </div>
    );
  }

  if (accessState === 'denied') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-6 h-6 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h1>
          <p className="text-slate-500 text-sm mb-6">This link is no longer active or is invalid.</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
          >
            Go to Homepage
          </Link>
        </div>
      </div>
    );
  }

  const isAdmin = userData?.superAdmin === true;

  return (
    <DocsContent
      isAdmin={isAdmin}
      isTokenAccess={isTokenAccess}
      linkToken={token}
      user={user}
    />
  );
}

/* ─── Generate Link Modal ─── */
function GenerateLinkModal({ uid, onClose }) {
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await authFetch('/api/docs/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      const data = await res.json();
      if (data.url) {
        setGeneratedUrl(data.url);
      }
    } catch (err) {
      console.error('Failed to create link:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-slate-900 mb-4">Generate Trackable Link</h3>

        {!generatedUrl ? (
          <>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Label (optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Investor A, Board Meeting"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-3">Share this link to grant tracked access:</p>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
              <code className="text-xs text-slate-700 flex-1 break-all font-mono">{generatedUrl}</code>
              <button
                onClick={handleCopy}
                className="flex-shrink-0 p-2 rounded-lg hover:bg-slate-200 transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-500" />
                )}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Main Docs Content ─── */
function DocsContent({ isAdmin, isTokenAccess, linkToken, user }) {
  const [activeSection, setActiveSection] = useState('introduction');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const isScrollingTo = useRef(false);

  // ─── Session Recording (token access only) ───
  const sessionIdRef = useRef(null);
  const viewedSectionsRef = useRef(new Set());
  const interactionsRef = useRef([]);
  const rrwebEventsRef = useRef([]);
  const startedAtRef = useRef(null);
  const stopRecordRef = useRef(null);
  const heartbeatRef = useRef(null);

  const flushSession = useCallback(() => {
    if (!isTokenAccess || !linkToken || !sessionIdRef.current) return;

    const duration = startedAtRef.current
      ? Math.round((Date.now() - new Date(startedAtRef.current).getTime()) / 1000)
      : 0;

    const payload = {
      linkToken,
      sessionId: sessionIdRef.current,
      startedAt: startedAtRef.current,
      duration,
      sectionsViewed: [...viewedSectionsRef.current],
      interactions: interactionsRef.current.slice(-500),
      recording: rrwebEventsRef.current,
      userAgent: navigator.userAgent,
      referrer: document.referrer || null,
    };

    // Use sendBeacon for unload, fetch otherwise
    if (document.visibilityState === 'hidden') {
      navigator.sendBeacon(
        '/api/docs/sessions',
        new Blob([JSON.stringify(payload)], { type: 'application/json' })
      );
    } else {
      fetch('/api/docs/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
  }, [isTokenAccess, linkToken]);

  useEffect(() => {
    if (!isTokenAccess) return;

    sessionIdRef.current = crypto.randomUUID();
    startedAtRef.current = new Date().toISOString();

    // Start rrweb recording
    import('rrweb').then(({ record }) => {
      stopRecordRef.current = record({
        emit: (event) => {
          rrwebEventsRef.current.push(event);
        },
      });
    });

    // Click tracking
    const handleClick = (e) => {
      const heading = e.target.closest('h1, h2, h3, h4, section');
      const target = heading?.textContent?.slice(0, 100) || e.target.textContent?.slice(0, 100) || '';
      interactionsRef.current.push({
        type: 'click',
        target,
        timestamp: Date.now(),
      });
    };
    document.addEventListener('click', handleClick);

    // Selection tracking
    const handleSelection = () => {
      const text = document.getSelection()?.toString()?.trim();
      if (text && text.length > 2) {
        interactionsRef.current.push({
          type: 'selection',
          target: text.slice(0, 200),
          timestamp: Date.now(),
        });
      }
    };
    document.addEventListener('selectionchange', handleSelection);

    // Heartbeat every 30s
    heartbeatRef.current = setInterval(() => {
      flushSession();
    }, 30000);

    // Visibility change
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushSession();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Beforeunload
    const handleUnload = () => {
      flushSession();
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      if (stopRecordRef.current) stopRecordRef.current();
      clearInterval(heartbeatRef.current);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('selectionchange', handleSelection);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      flushSession();
    };
  }, [isTokenAccess, flushSession]);

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
            // Track viewed section for recording
            if (isTokenAccess) {
              viewedSectionsRef.current.add(id);
            }
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
  }, [isTokenAccess]);

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

          <nav className="flex-1 px-3 py-2 overflow-y-auto">
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
        </div>
      </aside>

      {/* ─── Mobile Header ─── */}
      <div className="sticky top-0 z-40 bg-white border-b border-slate-200 lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 hover:bg-slate-100 rounded-lg"
          >
            <Menu className="w-5 h-5 text-slate-700" />
          </button>
          <span className="text-sm font-semibold text-slate-900">Documentation</span>
          <Link href="/dashboard" className="p-2 -mr-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </Link>
        </div>
      </div>

      {/* ─── Mobile Sidebar Overlay ─── */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 w-64 bg-slate-50 border-r border-slate-200 z-50 lg:hidden overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <Link href="/">
                <Image
                  src="https://premarketvideos.b-cdn.net/assets/logo.png"
                  alt="Premarket"
                  width={120}
                  height={30}
                  className="h-6 w-auto"
                  unoptimized
                />
              </Link>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 hover:bg-slate-200 rounded-lg"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
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
                            ? 'text-orange-600 font-medium bg-orange-50'
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
          </aside>
        </>
      )}

      {/* ─── Main Content ─── */}
      <main className="lg:pl-60">
        <div className="max-w-3xl mx-auto px-6 sm:px-8 py-12 lg:py-16">

          {/* ════════════════════════════════════════ */}
          {/* GETTING STARTED                          */}
          {/* ════════════════════════════════════════ */}

          <section id="introduction" className="scroll-mt-20">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-4">
              Premarket Documentation
            </h1>
            <p className="text-slate-600 leading-relaxed mb-4">
              Premarket is a platform built on a single idea: <span className="font-medium text-slate-900">a home is worth what a buyer would pay for it</span> — not what the house across the street sold for two months ago. We call this Price Education backed by data, and it&apos;s the foundation of everything the platform does.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              The platform connects listing agents, sellers, buyers, and buyer&apos;s agents before a property goes to market — replacing guesswork, gut feel, and backward-looking estimates with live buyer evidence. Every interaction — every price opinion submitted, every property saved, every interest registered — creates a real-time signal about what the market would pay today, not what it paid last quarter.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              This documentation covers the{' '}
              <button onClick={() => scrollTo('price-education')} className="text-orange-600 hover:text-orange-700 underline">
                problem Premarket solves
              </button>
              , the{' '}
              <button onClick={() => scrollTo('the-data-engine')} className="text-orange-600 hover:text-orange-700 underline">
                data engine
              </button>
              {' '}that powers it, the{' '}
              <button onClick={() => scrollTo('phi-overview')} className="text-orange-600 hover:text-orange-700 underline">
                8 Premarket Health Indicators (PHI)
              </button>
              {' '}that quantify market health in real time, how each stakeholder interacts with the platform, the product mechanics that drive value for all participants, and the Market Intelligence API for developers building on top of Premarket&apos;s data layer.
            </p>

            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg mt-6">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">New to Premarket?</span> Start with{' '}
                <button onClick={() => scrollTo('price-education')} className="underline hover:no-underline">
                  Price Education
                </button>{' '}
                to understand the problem we solve, or jump to{' '}
                <button onClick={() => scrollTo('how-it-works')} className="underline hover:no-underline">
                  How It Works
                </button>{' '}
                for a quick overview of the process.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* How It Works */}
          <section id="how-it-works" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">How It Works</h2>
            <p className="text-slate-600 leading-relaxed mb-8">
              Premarket follows a simple process that takes a property from private campaign to confident listing decision. Each step generates data that benefits every participant in the transaction.
            </p>

            <ol className="space-y-6">
              {[
                {
                  title: 'Agent creates a campaign',
                  desc: 'The listing agent creates a pre-market campaign using the native app or desktop dashboard — photos, property details, optional guide price, and a short description. Takes about 1–2 minutes. The agent chooses whether to keep the campaign private or showcase it on the Premarket website.',
                },
                {
                  title: 'Agent distributes the campaign',
                  desc: 'The agent shares the campaign link to their buyer database, buyer\'s agents, active buyers, via SMS and email campaigns, and through CRM integrations. This targeted distribution means the right buyers see the property immediately.',
                },
                {
                  title: 'Buyers engage and provide feedback',
                  desc: 'Buyers and buyer\'s agents discover the property, submit price opinions (what they\'d genuinely pay), register interest, and save it to their shortlist. Each interaction creates a real buyer evaluation of the property — the core data asset.',
                },
                {
                  title: 'Live vendor report builds automatically',
                  desc: 'Premarket compiles engagement into a live report: price opinion distribution, median buyer value, interest signals, and activity trends. This is price education backed by data — the seller sees what real buyers would actually pay, not what an algorithm estimates based on past sales.',
                },
                {
                  title: 'Agent educates on price with evidence',
                  desc: 'Armed with buyer data instead of estimates, the agent can confidently educate the seller on price. The conversation shifts from "trust my opinion" to "look at what buyers are telling us." This is the core of what Premarket enables — credible, evidence-based price education that aligns expectations with reality.',
                },
              ].map((step, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-1">{step.title}</h3>
                    <p className="text-slate-600 leading-relaxed text-sm">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* SOLUTIONS                                */}
          {/* ════════════════════════════════════════ */}

          {/* Price Education — hero-style header */}
          <section id="price-education" className="scroll-mt-20">
            <div className="rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 sm:p-10 mb-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent" />
              <div className="relative">
                <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">Solutions</p>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                  Price Education backed by data.
                </h2>
                <p className="text-slate-300 leading-relaxed max-w-2xl">
                  Real estate has a pricing problem. Sellers have expectations. Agents have opinions. Buyers have budgets. Until now, there was no single source of truth to align them. Premarket changes that by replacing gut feel and guesswork with live buyer evidence — the only data that actually determines what a home is worth.
                </p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              The most valuable thing an agent can do for a seller is not find a buyer — it&apos;s educate them on price. But price education has always been built on shaky foundations: comparable sales that may no longer be relevant, algorithm-driven estimates that extrapolate from the past, and ultimately, the agent&apos;s professional judgement — which the seller may or may not trust.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              Premarket creates a fundamentally different kind of price education. One built on what buyers would actually pay <span className="font-medium text-slate-900">right now</span>, for <span className="font-medium text-slate-900">this specific property</span>, based on <span className="font-medium text-slate-900">their direct input</span>. Not a statistical model. Not a prediction. Live market evidence from the people who would write the cheque.
            </p>
            <p className="text-slate-600 leading-relaxed">
              When the pricing conversation is backed by buyer data rather than agent opinion, everything changes. The awkward conversations disappear. Unrealistic expectations get corrected by evidence, not arguments. And the agent transforms from someone with an opinion into someone with proof.
            </p>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* The Problem */}
          <section id="the-problem" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">The Problem</h2>
            <p className="text-lg text-slate-500 mb-6">The pricing conversation in real estate is broken — and everyone knows it.</p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Unrealistic expectations</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Every agent has been in this situation. A seller is convinced their home is worth $1.5 million because their neighbour sold for $1.4 million six months ago — and their kitchen is nicer. The agent knows the market has shifted. Interest rates have moved. Buyer sentiment has changed. But the seller has anchored to a number, and no amount of professional advice will shift it.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              This isn&apos;t a rare edge case. It&apos;s the default dynamic in the majority of listing conversations. Sellers overestimate because they&apos;re emotionally invested, because they&apos;ve seen headlines, because they&apos;ve checked an online estimate, or simply because they need a certain number to make their next move work. The agent is stuck trying to correct expectations using the same tools the seller has already seen — and didn&apos;t believe.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">The awkward conversation</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              The hardest part of being a listing agent isn&apos;t finding buyers. It&apos;s the conversation where you tell a seller their home is worth less than they think. It&apos;s adversarial by nature — the agent appears to be arguing <em>against</em> the seller&apos;s interest, even when they&apos;re trying to protect it.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              Agents lose listings over this conversation. They either tell the truth and lose to an agent who inflates the number, or they agree to an unrealistic price and spend weeks watching the campaign fail. Neither outcome is good for anyone. The root cause is always the same: the agent has no independent, credible evidence to support their pricing recommendation. It&apos;s their word against the seller&apos;s hopes.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Static photos collecting dust, not data</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Walk past any real estate office and look at the window. Static photos of properties. No engagement data. No buyer feedback. No indication of demand. The same image sits there for weeks — a poster in a glass case, doing nothing.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              The same is true of most digital advertising. A property is listed with photos and a price guide. Buyers either enquire or they don&apos;t. There&apos;s no middle ground — no mechanism to capture the buyer who looked, considered, and had a view on price but wasn&apos;t ready to call. That buyer&apos;s insight is lost entirely. Every impression that doesn&apos;t convert to an enquiry is wasted. The photos collect views, not intelligence. Dust, not data.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Backward-looking data in a forward-moving market</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              The industry&apos;s current answer to price education is historical data. CoreLogic, Pricefinder, RPData — they all work the same way. They take past transactions, apply statistical models, and project a current estimate. The house down the street sold for $X three months ago, so this one should be worth approximately $Y.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              The fundamental flaw is obvious: <span className="font-medium text-slate-900">they&apos;re using the past to predict the future.</span> In a stable market, this works reasonably well. But markets aren&apos;t stable. Interest rates move. Buyer sentiment shifts. Supply changes. Seasonal patterns disrupt. By the time a comparable sale is recorded, settled, and published, the market conditions that produced it no longer exist.
            </p>

            <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-r-lg mb-6">
              <p className="text-sm text-red-800">
                <span className="font-semibold">The core problem.</span> A home is worth what a buyer would pay for it — not what the house across the street sold for two months ago. The entire industry prices property based on lagging indicators, and then wonders why seller expectations are misaligned with market reality.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Current approach</p>
                <div className="space-y-2.5">
                  {[
                    'Comparable sales from months ago',
                    'Statistical models extrapolating trends',
                    'Agent opinion vs seller expectation',
                    'Static advertising with zero feedback',
                    'No data captured from non-enquiring buyers',
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-slate-600">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border-2 border-orange-200 bg-orange-50/30 p-5">
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider mb-3">Premarket approach</p>
                <div className="space-y-2.5">
                  {[
                    'Live buyer price opinions in real time',
                    'Direct data from qualified buyers',
                    'Evidence replaces opinion in conversations',
                    'Every view generates usable data',
                    'Non-enquiring buyers still contribute value',
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-slate-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* The Data Engine */}
          <section id="the-data-engine" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">The Data Engine</h2>
            <p className="text-lg text-slate-500 mb-6">Live buyer feedback — the only real-time valuation signal in real estate.</p>

            <p className="text-slate-600 leading-relaxed mb-4">
              At the centre of Premarket is a data warehouse that operates fundamentally differently from every other real estate data provider. It doesn&apos;t scrape public listings. It doesn&apos;t wait for settlements to record a price. It doesn&apos;t extrapolate from historical trends.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              <span className="font-medium text-slate-900">It captures what buyers would pay, right now, for a specific property, directly from the buyers themselves.</span>
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">How the engine works</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              When an agent creates a pre-market campaign and distributes it to their buyer network, every interaction generates a data point. A buyer views the property — that&apos;s a signal. They save it — stronger signal. They submit a price opinion — that&apos;s a direct valuation from a real market participant. They register interest — that&apos;s confirmed demand.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              Aggregate these signals across every campaign, every property, every suburb, and you have something that has never existed before in real estate: a live, continuously updating picture of buyer demand and property value, sourced directly from the people who would actually buy.
            </p>

            <div className="rounded-xl bg-gradient-to-br from-blue-50 to-slate-50 border border-blue-100 p-6 sm:p-8 mb-8">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Why this is more accurate than CoreLogic</h3>
              <p className="text-slate-600 leading-relaxed mb-4">
                CoreLogic is the industry standard. Agents use it. Banks use it. It powers automated valuations across Australia. But CoreLogic has an inherent limitation: <span className="font-medium text-slate-900">it can only tell you what already happened.</span>
              </p>
              <p className="text-slate-600 leading-relaxed mb-4">
                CoreLogic collects settlement data — properties that sold, the price they sold for, and the characteristics of those properties. It then applies hedonic regression models, median price calculations, and automated valuation methodologies to estimate what a similar property might be worth today. It&apos;s backward-looking by design. It uses the past to predict the future.
              </p>
              <p className="text-slate-600 leading-relaxed mb-6">
                <span className="font-medium text-slate-900">Premarket does the opposite.</span> Instead of looking backward at what sold, it looks forward at what buyers would pay. Instead of modelling from comparable sales, it captures direct input from actual market participants. Instead of publishing quarterly updates, it updates continuously — in real time, as buyers engage.
              </p>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="rounded-lg bg-white border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">CoreLogic</p>
                  <div className="space-y-2">
                    {[
                      ['Source', 'Settlement records (past transactions)'],
                      ['Timing', 'Weeks to months after a sale'],
                      ['Method', 'Statistical models & extrapolation'],
                      ['Updates', 'Monthly or quarterly'],
                      ['Tells you', 'What similar homes sold for'],
                    ].map(([label, value], i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-xs font-medium text-slate-500 w-16 flex-shrink-0 mt-0.5">{label}</span>
                        <span className="text-xs text-slate-600">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-white border-2 border-orange-200 p-4">
                  <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider mb-3">Premarket</p>
                  <div className="space-y-2">
                    {[
                      ['Source', 'Buyer price opinions (direct input)'],
                      ['Timing', 'Real time, as buyers engage'],
                      ['Method', 'Direct measurement, not modelling'],
                      ['Updates', 'Continuously, with every interaction'],
                      ['Tells you', 'What buyers would pay today'],
                    ].map(([label, value], i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-xs font-medium text-slate-500 w-16 flex-shrink-0 mt-0.5">{label}</span>
                        <span className="text-xs text-slate-700 font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">The data comes from buyers — that&apos;s the entire point</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Every other data provider in real estate is one or more steps removed from the actual buyer. CoreLogic sees a settlement record weeks after the fact. Pricefinder sees a listing price that may bear no relation to the final sale. Domain and REA see search behaviour — clicks and saves — but never a price opinion. None of them capture what a buyer would actually pay.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              Premarket goes directly to the source. When a buyer submits a price opinion, they&apos;re telling you — in real terms — what this property is worth to them. Multiply that across dozens of buyers for a single property, and you have a statistically meaningful valuation built entirely from primary data. Not modelled. Not inferred. Measured.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              This is why the accuracy is higher. It&apos;s not a better algorithm — it&apos;s a better data source. The algorithm doesn&apos;t need to be clever when the input is already the answer. Buyers <em>are</em> the market. Their opinions <em>are</em> the value. Premarket simply captures that signal in a structured, scalable way.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">What the engine produces</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              The data engine powers the{' '}
              <button onClick={() => scrollTo('phi-overview')} className="text-orange-600 hover:text-orange-700 underline">
                8 Premarket Health Indicators (PHI)
              </button>
              {' '}— a proprietary scoring framework that quantifies every dimension of market health:
            </p>
            <div className="space-y-3 mb-8">
              {[
                ['Per-property valuations (PHI:PVI)', 'Median buyer price opinion, price distribution, opinion count, and confidence score — for individual properties, updated in real time. Properties flagged as overvalued, undervalued, or fairly priced.'],
                ['Buyer demand signals (PHI:BDI, PHI:BQI)', 'Aggregated buyer intent by location — which suburbs are heating up, which are cooling, and where demand is concentrated. BQI separates serious, financially ready buyers from casual browsers.'],
                ['Market heat and momentum (PHI:MHI, PHI:EVS)', 'The composite market activity score and the speed at which new listings attract engagement. Together they tell you not just how hot a market is, but whether it\'s accelerating or decelerating.'],
                ['Supply-demand dynamics (PHI:SDB, PHI:FPI)', 'The real-time balance between buyer demand and available supply, plus the forward pipeline of properties preparing to list. SDB tells you who has leverage now; FPI tells you how that balance will shift.'],
                ['Seller commitment (PHI:SMI)', 'How eager and committed sellers are to transact — from serious sellers with 30-day go-to-market goals to those testing the waters. A leading indicator of supply that no backward-looking data can capture.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-orange-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}.</span> {desc}
                  </p>
                </div>
              ))}
            </div>

            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">The compounding effect.</span> Every new campaign, every new buyer, every new price opinion makes the engine more accurate and more valuable. This is a dataset that cannot be replicated by scraping public records or modelling historical sales. It can only be built by capturing real buyer intent at scale — and that requires the platform, the agent network, and the buyer engagement that Premarket has built.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* The Business */}
          <section id="the-business" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">The Business</h2>
            <p className="text-lg text-slate-500 mb-6">How it works, how it makes money, and where the real value sits.</p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">The How — agents and their database</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              The distribution engine behind Premarket is the agent and their existing buyer database. Agents don&apos;t need to build a new audience. They already have one — years of contacts, active buyers from past campaigns, buyer&apos;s agents they work with regularly, and CRM databases full of qualified prospects.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              When an agent creates a pre-market campaign, they share it through channels they already control: SMS, email, CRM workflows, and direct outreach. The agent is the distribution channel. Their database is the audience. Premarket provides the platform that turns those existing relationships into structured, usable market data.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              This is why adoption scales efficiently. Agents aren&apos;t being asked to do something new. They&apos;re being asked to do what they already do — share properties with buyers — through a tool that captures data they&apos;ve never been able to capture before.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">The Cashflow — vendor-paid fees</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Revenue comes from the seller. When an agent creates a pre-market campaign, the vendor pays a campaign fee. This aligns incentives perfectly: the seller pays for market intelligence about their own property, the agent gets a tool that helps them win and retain listings, and the buyer participates for free — which is critical for data quality and volume.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              The fee is a fraction of traditional marketing spend. A seller might pay $10,000–$30,000 for a full marketing campaign (photography, styling, portal listings, print advertising) with no guarantee of success. A Premarket campaign costs significantly less and delivers actionable intelligence before the seller commits to anything else.
            </p>

            <div className="rounded-lg border border-slate-200 overflow-hidden mb-8">
              <div className="divide-y divide-slate-200">
                {[
                  ['Campaign fee', 'Vendor pays per pre-market campaign — the primary revenue driver'],
                  ['Subscription', 'Agents subscribe for premium features, advanced analytics, and priority support'],
                  ['API access', 'Developers and platforms pay for access to the Market Intelligence API'],
                ].map(([item, desc], i) => (
                  <div key={i} className="flex items-start gap-4 px-4 py-3">
                    <span className="flex-shrink-0 w-28 text-sm font-medium text-slate-900">{item}</span>
                    <p className="text-sm text-slate-600">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">The Value — the data is the company</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Campaign fees drive cashflow. But the real value of Premarket is the data engine underneath.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              Every campaign generates buyer price opinions. Every price opinion is a primary data point that no other company in real estate has. Aggregated across thousands of properties and suburbs, this becomes a proprietary dataset of live buyer valuations — a forward-looking valuation layer that covers the entire market and improves with every interaction.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              The cashflow comes from fees. The value of the company comes from owning the most accurate, most current, and most direct source of property valuation data in the market. A dataset that cannot be replicated by scraping, modelling, or extrapolating. It can only be built by capturing real buyer intent at scale.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              And the output of that data is what makes everything work: <span className="font-medium text-slate-900">the ability to educate on price — confidently, credibly, and backed by evidence.</span> That&apos;s what agents need. That&apos;s what sellers need. And that&apos;s what Premarket delivers.
            </p>

            <div className="rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 sm:p-8 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent" />
              <div className="relative">
                <div className="grid sm:grid-cols-3 gap-6">
                  <div>
                    <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-2">The How</p>
                    <p className="text-white font-medium mb-1">Agents &amp; their database</p>
                    <p className="text-slate-400 text-sm">Existing relationships become structured market data through the platform.</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-2">The Cashflow</p>
                    <p className="text-white font-medium mb-1">Vendor-paid fees</p>
                    <p className="text-slate-400 text-sm">Sellers pay for market intelligence. Buyers participate free. Incentives align.</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-2">The Value</p>
                    <p className="text-white font-medium mb-1">The data &amp; its accuracy</p>
                    <p className="text-slate-400 text-sm">A proprietary, forward-looking valuation layer that improves with every interaction.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* USER JOURNEYS                            */}
          {/* ════════════════════════════════════════ */}

          {/* Listing Agents */}
          <section id="listing-agents" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Listing Agents</h2>
            <p className="text-lg text-slate-500 mb-6">Educate sellers on price with buyer evidence — not opinions, not comparables, not guesswork.</p>

            <p className="text-slate-600 leading-relaxed mb-4">
              In competitive markets, listing agents are typically pitching against two or three other agencies for the same property. Every agent offers marketing. Every agent has comparables. Every agent has an opinion on price. But opinions create friction — especially when they don&apos;t match what the seller wants to hear. The agent who tells the truth risks losing the listing. The agent who inflates the number wins the pitch but fails the campaign.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              Premarket changes this dynamic entirely. Instead of asking a vendor to trust an appraisal built on what similar homes sold for months ago, the agent presents{' '}
              <button onClick={() => scrollTo('the-data-engine')} className="text-orange-600 hover:text-orange-700 underline">
                live buyer evidence
              </button>
              {' '} — real price opinions from qualified buyers, genuine interest signals, and a data-driven view of what the market would pay today. The conversation shifts from &ldquo;trust me&rdquo; to &ldquo;look at what buyers are telling us.&rdquo;
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              This is{' '}
              <button onClick={() => scrollTo('price-education')} className="text-orange-600 hover:text-orange-700 underline">
                Price Education backed by data
              </button>
              {' '}in practice. The agent doesn&apos;t need to convince the seller — the buyer data does that. And because the data comes directly from buyers rather than from historical sales or algorithms, it carries a credibility that no comparable sale or automated valuation can match.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mt-8 mb-4">The agent journey</h3>

            <div className="space-y-6 mb-8">
              <div>
                <h4 className="font-medium text-slate-900 mb-1">1. Identify the opportunity</h4>
                <p className="text-slate-600 text-sm leading-relaxed mb-2">
                  The agent identifies a potential seller — a homeowner thinking about selling, an investor uncertain about price, a privacy-focused vendor who doesn&apos;t want their property on the portals, or a listing the agent has been chasing for months. The agent introduces Premarket as a way to test the market privately before committing to anything.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">2. Create the campaign</h4>
                <p className="text-slate-600 text-sm leading-relaxed mb-2">
                  Using the native agent app or the desktop dashboard, the agent creates a pre-market campaign in about 1–2 minutes. They upload photos, enter the suburb and property details, set an optional guide price, and write a short description. The agent controls whether the listing stays private (link-only access) or is showcased on the Premarket website.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">3. Distribute the campaign link</h4>
                <p className="text-slate-600 text-sm leading-relaxed mb-2">
                  The agent shares the campaign to their buyer database, buyer&apos;s agents in the area, active buyers from past campaigns, and through SMS, email, and CRM integrations. This targeted distribution puts the property in front of the right people immediately — without a portal listing, without marketing spend, and without public exposure.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">4. Buyers provide feedback</h4>
                <p className="text-slate-600 text-sm leading-relaxed mb-2">
                  Buyers interact with the property by submitting price opinions — what they&apos;d genuinely be willing to pay — and registering their interest. This creates the core data: a real buyer evaluation of the property, independent of the agent&apos;s appraisal.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">5. The vendor report builds live</h4>
                <p className="text-slate-600 text-sm leading-relaxed mb-2">
                  Premarket compiles everything into a live dashboard for the seller: price opinion distribution, median buyer value, buyer interest signals, and engagement trends. The seller sees a real-time picture of their property&apos;s market position — built entirely from buyer behaviour, not agent estimates.
                </p>
                <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg mt-3">
                  <p className="text-sm text-blue-800">
                    <span className="font-semibold">This is price education in action.</span> The listing conversation is no longer agent opinion vs seller expectation. It becomes buyer evidence — data from the people who would actually write the cheque. That&apos;s very difficult to argue with.
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">6. Progress the sale with data</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The agent now has multiple paths forward: secure the listing with a confident recommendation, set a guide price validated by real buyers, negotiate an off-market deal if a strong offer materialises, or transition into a full marketing campaign with proven demand already in hand.
                </p>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Why agents choose Premarket</h3>
            <div className="space-y-3 mb-2">
              {[
                ['Win listings', 'Competing agents offer marketing and opinions. Premarket agents offer price education backed by buyer data — a fundamentally different pitch that sellers trust.'],
                ['Differentiation', 'The agent has a tool that produces live buyer evidence no other agency can replicate. Not comparables. Not estimates. Direct buyer valuations.'],
                ['End awkward conversations', 'When buyers determine the value — not the agent — the most adversarial part of the listing conversation disappears. The data does the educating.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-orange-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}.</span> {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* Buyer's Agents */}
          <section id="buyers-agents" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Buyer&apos;s Agents</h2>
            <p className="text-lg text-slate-500 mb-6">Access exclusive opportunities and provide independent price insight to clients.</p>

            <p className="text-slate-600 leading-relaxed mb-4">
              Buyer&apos;s agents live and die by access. Their clients expect them to find properties before the general market, negotiate better deals, and provide professional pricing insight. Premarket gives them a dedicated channel to do exactly that — a stream of properties that haven&apos;t hit the portals yet, with the ability to engage directly with selling agents before the competition arrives.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              For buyer&apos;s agents, premarket access isn&apos;t just a convenience — it&apos;s a competitive advantage they use to attract and retain clients.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mt-8 mb-4">The buyer&apos;s agent journey</h3>

            <div className="space-y-6 mb-8">
              <div>
                <h4 className="font-medium text-slate-900 mb-1">1. Search and filter</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The buyer&apos;s agent logs into the web platform and filters by suburb, price range, property type, and bedroom/bathroom count — matching properties against their active client briefs. They&apos;re looking for opportunities that haven&apos;t surfaced on public portals.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">2. Analyse the property</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The buyer&apos;s agent reviews the listing — photos, property details, and agent notes — then cross-references with their own tools: CoreLogic, Pricefinder, comparable sales data. This dual analysis gives them a well-informed independent view of value before making any move.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">3. Submit a pricing opinion</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The buyer&apos;s agent submits their independent valuation opinion — a professional assessment of what the property is worth. This positions them as a credible, informed participant and signals to the selling agent that there&apos;s serious interest from a qualified party.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">4. Engage the selling agent</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The buyer&apos;s agent contacts the selling agent directly — discuss their client&apos;s interest, arrange a private inspection, and begin negotiating early. This happens while the property is still in its pre-market phase, before public competition has a chance to build.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">5. Secure the deal before market</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The possible outcomes are an off-market purchase, an early negotiated agreement, or at minimum a strong position prepared for when the campaign goes public. The buyer&apos;s agent&apos;s client gets first-mover advantage — the kind of access that justifies their fee.
                </p>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Why buyer&apos;s agents choose Premarket</h3>
            <div className="space-y-3 mb-2">
              {[
                ['Client attraction', 'Clients expect their buyer\'s agent to have access to off-market, pre-market, and on-market deals. Premarket delivers that consistently.'],
                ['Reduced competition', 'Properties in the pre-market phase have a fraction of the buyer interest they\'ll attract once publicly listed. Less competition means better outcomes.'],
                ['Shape the data', 'Every price opinion a buyer\'s agent submits feeds the data engine that powers price education for agents and sellers. Their professional valuations carry weight — and contribute to the most accurate pricing dataset in real estate.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-orange-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}.</span> {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* Sellers */}
          <section id="sellers" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Sellers</h2>
            <p className="text-lg text-slate-500 mb-6">See what buyers would actually pay — before committing to anything.</p>

            <p className="text-slate-600 leading-relaxed mb-4">
              Sellers face a fundamental problem: they have to commit significant time, money, and emotional energy to a marketing campaign before they know whether the market will meet their expectations. Photography, styling, advertising spend, open homes — all before a single offer comes in. If the campaign fails, the property sits on the portals with a stale listing and a damaged perception.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              The root cause is a lack of price education. Sellers set expectations based on online estimates, neighbour conversations, and emotional attachment — none of which reflect what today&apos;s buyers would actually pay. By the time the market corrects those expectations, the seller has already spent thousands and weeks of time.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              Premarket eliminates that risk by delivering{' '}
              <button onClick={() => scrollTo('price-education')} className="text-orange-600 hover:text-orange-700 underline">
                price education backed by data
              </button>
              {' '}before the seller commits to anything. Real buyer price opinions. Genuine interest signals. A live view of what the market would pay — not what an algorithm thinks it should be worth.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mt-8 mb-4">The seller journey</h3>

            <div className="space-y-6 mb-8">
              <div>
                <h4 className="font-medium text-slate-900 mb-1">1. The seller has concerns</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The seller is thinking about selling but has common reservations: they&apos;re unsure about price, don&apos;t want to pay for marketing before knowing it&apos;ll work, have privacy concerns about their property being publicly listed, or simply aren&apos;t ready to fully commit.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">2. Their agent introduces Premarket</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The agent explains the concept: &ldquo;We can test the market privately first.&rdquo; No public listing, no portal footprint, no marketing spend. The property goes out to qualified buyers only, and the seller sees exactly how the market responds — with real data, not forecasts.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">3. The campaign runs privately</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The agent creates and distributes the campaign. Privacy is maintained — there&apos;s no portal listing, no public footprint. For high-value sellers particularly, this is critical. A failed public campaign can damage a property&apos;s market perception for months. A private pre-market campaign carries none of that risk.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">4. The seller receives price education</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  As buyers engage, the seller sees the data build in real time: how many buyers have viewed the property, their price opinions, the median buyer value, and the level of registered interest. This is price education in its purest form — not an agent&apos;s estimate, not an algorithm projecting from past sales. Real buyers telling you what they&apos;d pay, right now, for your property.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">5. Confidence builds</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The seller now has evidence that real buyers exist at achievable prices. The uncertainty that was holding them back — &ldquo;Will anyone pay what I need?&rdquo; — gets answered with data. The emotional decision to sell becomes an informed one.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">6. The seller proceeds on their terms</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  With evidence in hand, the seller can accept a pre-market offer if one materialises, move to a full on-market campaign with proven demand already in hand, or decide to hold if the timing isn&apos;t right — all without having spent a dollar or exposed their property publicly.
                </p>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Why sellers choose Premarket</h3>
            <div className="space-y-3 mb-2">
              {[
                ['Price education before commitment', 'Sellers see what real buyers would pay — direct price opinions, not estimates — before spending anything on marketing or making any public commitment.'],
                ['Privacy', 'No portal listing, no public exposure, no risk of a stale listing damaging perception. Static photos in office windows collect dust. Premarket campaigns collect data.'],
                ['Buyer-determined value', 'Price opinions come directly from buyers — not algorithms extrapolating from past sales, not agent appraisals. A home is worth what a buyer would pay. Premarket measures exactly that.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-orange-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}.</span> {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* Buyers */}
          <section id="buyers" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Buyers</h2>
            <p className="text-lg text-slate-500 mb-6">Discover properties before the crowd and become an active market participant.</p>

            <p className="text-slate-600 leading-relaxed mb-4">
              In most real estate markets, buyers are passive participants. They wait for properties to appear on the portals, compete at overcrowded auctions, and react to prices set by others. By the time a buyer finds a property they like, there are already dozens of registered bidders and the price has been pushed beyond budget.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              Premarket inverts this dynamic. Buyers get early access to properties before they&apos;re publicly listed, and their interactions — price opinions, registered interest, saved properties — actively shape the market data that agents and sellers rely on. Buyers become evaluators of value, not just respondents to it.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mt-8 mb-4">The buyer journey</h3>

            <div className="space-y-6 mb-8">
              <div>
                <h4 className="font-medium text-slate-900 mb-1">1. Browse the showcase</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The buyer visits premarket.homes and explores listings that are off-market, pre-market, or on-market — genuine early access you won&apos;t find on public portals.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">2. Discover a property</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The buyer clicks into a property listing, reviews the photos and details, and decides whether it matches what they&apos;re looking for. They can save the property, express interest, or provide a price opinion — all from the property page.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">3. Submit a price opinion</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The buyer enters what they&apos;d genuinely be willing to pay for the property. This isn&apos;t a bid or an offer — it&apos;s a market signal. Each price opinion contributes to the buyer valuation dataset, building a real-time picture of what the market believes a property is worth.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">4. Register strong interest</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  If the buyer is serious, they register their interest. This sends a direct signal to the listing agent: there&apos;s a qualified, motivated buyer. Registered buyers are contacted first when the property progresses — before public competition has a chance to build.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">5. Agent engagement</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  The listing agent may contact the buyer directly — invite them to a private inspection, discuss their interest, or begin early negotiations. The buyer potentially secures the property before it ever goes public, avoiding the stress and uncertainty of a competitive auction.
                </p>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Why buyers choose Premarket</h3>
            <div className="space-y-3 mb-2">
              {[
                ['Early access', 'Properties appear on Premarket weeks before they hit the public portals. Being early changes everything.'],
                ['Reduced competition', 'Fewer buyers means less pressure, more time for due diligence, and better negotiating conditions.'],
                ['Your opinion matters', 'Every price opinion directly feeds the data engine. Buyers aren\'t passive spectators — they\'re the primary source of truth. Their input is what makes price education backed by data possible.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-orange-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}.</span> {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* PRODUCT                                  */}
          {/* ════════════════════════════════════════ */}

          {/* Core Insight */}
          <section id="core-insight" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">The Core Product Insight</h2>

            <p className="text-slate-600 leading-relaxed mb-6">
              Premarket doesn&apos;t just make existing processes faster or cheaper. It fundamentally restructures who determines value in a real estate transaction.
            </p>

            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              <div className="rounded-lg border border-slate-200 p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Traditional model</p>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500 w-14 flex-shrink-0">Agent</span>
                    <span className="text-slate-400">&rarr;</span>
                    <span className="text-sm text-slate-600">guesses the price</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500 w-14 flex-shrink-0">Seller</span>
                    <span className="text-slate-400">&rarr;</span>
                    <span className="text-sm text-slate-600">hopes it&apos;s right</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500 w-14 flex-shrink-0">Buyer</span>
                    <span className="text-slate-400">&rarr;</span>
                    <span className="text-sm text-slate-600">reacts to whatever lands</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border-2 border-orange-200 bg-orange-50/30 p-5">
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider mb-3">Premarket model</p>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-700 font-medium w-14 flex-shrink-0">Buyer</span>
                    <span className="text-orange-400">&rarr;</span>
                    <span className="text-sm text-slate-700">provides the value signal</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-700 font-medium w-14 flex-shrink-0">Agent</span>
                    <span className="text-orange-400">&rarr;</span>
                    <span className="text-sm text-slate-700">interprets and presents it</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-700 font-medium w-14 flex-shrink-0">Seller</span>
                    <span className="text-orange-400">&rarr;</span>
                    <span className="text-sm text-slate-700">gains confidence from evidence</span>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              The buyer becomes the evaluator of value. Not an algorithm trained on historical sales. Not an agent&apos;s appraisal. Real buyers, expressing what they&apos;d genuinely pay, in real time. This is why Premarket delivers{' '}
              <button onClick={() => scrollTo('price-education')} className="text-orange-600 hover:text-orange-700 underline">
                price education backed by data
              </button>
              {' '}— the data comes from the only source that actually determines value: the buyers themselves.
            </p>
            <p className="text-slate-600 leading-relaxed">
              This is a structural shift. Every interaction on the platform — every price opinion, every interest registration, every saved property — feeds into{' '}
              <button onClick={() => scrollTo('the-data-engine')} className="text-orange-600 hover:text-orange-700 underline">
                the data engine
              </button>
              , generating forward-looking signals about market demand that backward-looking providers like CoreLogic simply cannot capture. The more participants in the system, the more accurate and valuable those signals become.
            </p>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* The Flywheel */}
          <section id="the-flywheel" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">The Flywheel</h2>
            <p className="text-slate-600 leading-relaxed mb-6">
              Each participant in the Premarket ecosystem creates value for every other participant. This isn&apos;t a linear product — it&apos;s a compounding one.
            </p>

            <ol className="space-y-4 mb-8">
              {[
                ['Agents bring listings', 'Properties enter the system, creating inventory for buyers to discover and evaluate.'],
                ['Buyers give price opinions', 'Real buyer evaluations of property value flow into the data engine — primary data that no other platform captures.'],
                ['Data enables price education', 'Aggregated buyer intent, price opinion distributions, and demand signals form a live valuation layer — replacing backward-looking estimates with forward-looking evidence.'],
                ['Sellers gain confidence', 'Price education backed by buyer data gives sellers the confidence to list. Expectations align with reality because the evidence is undeniable.'],
                ['More listings appear', 'Confident sellers and successful agents bring more properties onto the platform — each one generating more buyer data.'],
                ['Buyers return for early access', 'A growing inventory of pre-market properties attracts more buyers, who provide more price opinions, which makes the data engine more accurate. The accuracy compounds.'],
              ].map(([title, desc], i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-slate-600 text-sm leading-relaxed">
                      <span className="font-medium text-slate-900">{title}.</span> {desc}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Network effect.</span> Each additional participant — whether agent, buyer, or seller — increases the value of the platform for every other participant. More data means better insights. Better insights mean more confident sellers. More listings mean more buyers. The cycle compounds.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* Integrations */}
          <section id="integrations" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Integrations</h2>
            <p className="text-lg text-slate-500 mb-6">Connecting Premarket directly into the tools agents already use.</p>

            <p className="text-slate-600 leading-relaxed mb-6">
              Most agents live inside their CRM. That&apos;s where their contacts are, where their workflows run, and where their day starts and ends. Premarket is building native integrations with the major real estate CRMs so agents can create campaigns, manage listings, and distribute to their buyer database without ever leaving the tools they already know.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-4">CRM integrations in development</h3>

            <div className="space-y-4 mb-8">
              {[
                ['AgentBox (Reapit)', 'One of Australia\'s most widely used real estate CRMs, used by thousands of agencies across the country.'],
                ['Rex', 'A modern cloud-based CRM built for high-performing real estate teams, popular across Australia and New Zealand.'],
                ['Vault', 'An enterprise-grade CRM used by many of Australia\'s largest agency groups and franchise networks.'],
              ].map(([name, desc], i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-100 text-amber-700">In Development</span>
                    <span className="font-medium text-slate-900 text-sm">{name}</span>
                  </div>
                  <p className="text-sm text-slate-600">{desc}</p>
                </div>
              ))}
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">What the integrations enable</h3>

            <div className="mb-8">
              <h4 className="font-medium text-slate-900 mb-2">Stage 1 — Campaign management from the CRM</h4>
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                Agents will be able to create and manage Premarket campaigns directly from within their CRM. Add a property, upload photos, set a price guide, and distribute the campaign link to matched buyers in their database — all without switching platforms. The integration handles syncing property details, contact matching, and campaign distribution through the channels agents already use: SMS, email, and CRM-native workflows.
              </p>

              <h4 className="font-medium text-slate-900 mb-2">Stage 2 — Data flowing back into the CRM</h4>
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                Once a campaign is live, Premarket will push engagement data back into the CRM. Agents will see report cards and market intelligence directly inside their existing property records — buyer interest levels, price opinion distributions, demand signals, and campaign performance metrics. No need to log into a separate dashboard. The data lives where the agent already works.
              </p>
            </div>

            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Why this matters.</span> CRM integration removes the last friction point in adoption. Agents don&apos;t need to learn a new tool or change their workflow. Premarket becomes a native capability inside the systems they already depend on — which means faster adoption, more campaigns, more data, and a stronger flywheel.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* PREMARKET HEALTH INDICATORS (PHI)        */}
          {/* ════════════════════════════════════════ */}

          <section id="phi-overview" className="scroll-mt-20">
            <div className="rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 sm:p-10 mb-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent" />
              <div className="relative">
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">Health Indicators</p>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                  Premarket Health Indicators (PHI)
                </h2>
                <p className="text-slate-300 leading-relaxed max-w-2xl">
                  8 proprietary metrics computed daily from real buyer feedback — price opinions, registered interest and engagement — across Premarket's active campaigns and suburbs, not historical sales data.
                </p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              Every existing market indicator in real estate — median prices, days on market, clearance rates — is backward-looking. They tell you what already happened. By the time the data is published, the market has moved on. PHI scores are fundamentally different: they measure what&apos;s happening <span className="font-medium text-slate-900">right now</span> and what&apos;s <span className="font-medium text-slate-900">about to happen</span>, sourced directly from live buyer and seller behaviour on the Premarket platform.
            </p>
            <p className="text-slate-600 leading-relaxed mb-4">
              Each PHI metric is scored 0&ndash;100 and computed per suburb, updated continuously as new data flows in. Together, the 8 scores paint a complete picture of market health that no other data provider can offer — because no other provider captures buyer intent at this level of granularity.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-4">The 8 Core Metrics</h3>

            <div className="overflow-hidden rounded-lg border border-slate-200 mb-8">
              <div className="divide-y divide-slate-200">
                {[
                  ['MHI', 'Market Heat Index', '0-100', 'Composite market activity and momentum — the single headline number'],
                  ['BDI', 'Buyer Demand Index', '0-100', 'Real buyer demand from opinions, serious registrations, likes, and engagement'],
                  ['SMI', 'Seller Motivation Index', '0-100', 'How eager and committed sellers are to transact'],
                  ['PVI', 'Price Validity Index', '0-100', 'Whether properties are correctly priced vs what buyers would actually pay'],
                  ['EVS', 'Engagement Velocity Score', '0-100', 'How fast properties attract interest after listing'],
                  ['BQI', 'Buyer Quality Index', '0-100', 'Financial readiness and seriousness of the buyer pool'],
                  ['FPI', 'Forward Pipeline Index', '0-100', 'Strength of upcoming supply — what\'s about to hit the market'],
                  ['SDB', 'Supply-Demand Balance', '0-100', 'Demand vs supply ratio (50 = balanced, >50 = seller\'s market)'],
                ].map(([code, name, range, desc], i) => (
                  <div key={i} className="flex items-start gap-4 px-4 py-3">
                    <code className="flex-shrink-0 w-10 text-sm font-bold font-mono text-orange-600 mt-0.5">{code}</code>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-slate-900">{name}</span>
                        <span className="text-xs text-slate-400 font-mono">{range}</span>
                      </div>
                      <p className="text-xs text-slate-500">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">How to read PHI scores</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              PHI scores are displayed in the format <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">PHI:MHI 78</code>. Each score is a 0&ndash;100 scale where higher generally means more activity, except for SDB which uses 50 as the equilibrium point. A suburb with <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">PHI:MHI 82</code> and <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">PHI:SDB 68</code> is a hot market tilting toward sellers — high activity, more demand than supply.
            </p>

            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              <div className="rounded-lg border border-slate-200 p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Traditional indicators</p>
                <div className="space-y-2.5">
                  {[
                    'Median price (months old)',
                    'Days on market (after the fact)',
                    'Clearance rates (weekend snapshot)',
                    'Statistical estimates (modelled)',
                    'No buyer intent data',
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-slate-600">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/30 p-5">
                <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-3">PHI Scores</p>
                <div className="space-y-2.5">
                  {[
                    'Real-time buyer demand (BDI)',
                    'Live price validation (PVI)',
                    'Forward supply pipeline (FPI)',
                    'Engagement velocity (EVS)',
                    'Supply-demand equilibrium (SDB)',
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-slate-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Property lifecycle segmentation</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              PHI scores account for where each property sits in its lifecycle. A property that&apos;s already on the market counts differently from one that&apos;s still in the premarket pipeline. This segmentation is critical for accurate scoring — an on-market property contributes to current supply (SDB), while a premarket property signals future supply (FPI).
            </p>

            <div className="overflow-hidden rounded-lg border border-slate-200 mb-8">
              <div className="divide-y divide-slate-200">
                {[
                  ['On-Market', 'Listed publicly', 'Current supply, SDB supply side, MHI heat'],
                  ['Premarket', 'Visible but not listed', 'FPI pipeline, upcoming to market, SMI signals'],
                  ['Off-Market', 'Private / inactive', 'FPI pipeline (lower weight), early seller signals'],
                ].map(([status, criteria, counts], i) => (
                  <div key={i} className="flex items-start gap-4 px-4 py-3">
                    <span className="flex-shrink-0 w-24 text-sm font-medium text-slate-900">{status}</span>
                    <span className="flex-shrink-0 w-36 text-xs text-slate-500">{criteria}</span>
                    <p className="text-xs text-slate-600">{counts}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Live playground.</span> You can explore PHI scores for any suburb in Australia on the{' '}
                <button onClick={() => scrollTo('phi-mhi')} className="underline hover:no-underline">
                  interactive heatmap
                </button>
                {' '}in the dashboard, or query them programmatically via the{' '}
                <button onClick={() => scrollTo('endpoints')} className="underline hover:no-underline">
                  PHI Scores API endpoint
                </button>.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* MHI */}
          <section id="phi-mhi" className="scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-100 text-red-600">
                <Flame className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Market Heat Index (MHI)</h2>
                <p className="text-sm text-slate-500 font-mono">PHI:MHI &middot; 0-100</p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              The headline number. MHI is a composite score that rolls up buyer demand, seller motivation, engagement velocity, and pricing accuracy into a single measure of how &quot;hot&quot; a market is right now. It&apos;s the first number you look at and the one that tells you whether a suburb is heating up, cooling down, or stable.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Why it matters</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Agents need a single, clear signal to communicate market conditions to sellers and buyers. &quot;The MHI for Bondi is 82&quot; is instantly meaningful — it&apos;s a hot market. No need to explain five different data points. For investors and analysts, MHI is the screening metric — scan every suburb in Australia by MHI to find where the action is.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">How it&apos;s calculated</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              MHI is a weighted composite of four other PHI scores:
            </p>
            <div className="rounded-lg border border-slate-200 p-4 mb-4">
              <code className="text-sm font-mono text-slate-800">
                MHI = BDI &times; 0.35 + SMI &times; 0.25 + EVS &times; 0.25 + PVI &times; 0.15
              </code>
            </div>
            <p className="text-slate-600 leading-relaxed mb-6 text-sm">
              Buyer demand is weighted highest because demand is the primary driver of market heat. Seller motivation and engagement velocity contribute equally, reflecting both supply-side commitment and the speed at which interest materialises. Price validity has the lowest weight — a market can be hot even if pricing is slightly off.
            </p>

            <div className="overflow-hidden rounded-lg border border-slate-200 mb-4">
              <div className="divide-y divide-slate-200 text-sm">
                <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-50">
                  <span className="w-20 font-medium text-slate-900">Score</span>
                  <span className="flex-1 font-medium text-slate-900">Interpretation</span>
                </div>
                {[
                  ['80-100', 'Very hot market — strong demand, motivated sellers, rapid engagement'],
                  ['60-79', 'Active market — healthy activity across most dimensions'],
                  ['40-59', 'Moderate — some activity but no strong momentum in either direction'],
                  ['20-39', 'Cool — limited buyer activity or seller commitment'],
                  ['0-19', 'Cold — very little market activity or data'],
                ].map(([range, desc], i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-2.5">
                    <span className="w-20 font-mono text-slate-700">{range}</span>
                    <span className="flex-1 text-slate-600">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* BDI */}
          <section id="phi-bdi" className="scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 text-blue-600">
                <Gauge className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Buyer Demand Index (BDI)</h2>
                <p className="text-sm text-slate-500 font-mono">PHI:BDI &middot; 0-100</p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              BDI measures real buyer demand using direct signals from buyers themselves — not page views, not search trends, not modelled estimates. Every price opinion submitted, every serious buyer registration, every property saved is a tangible, measurable expression of demand.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Why it matters</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Demand is the fundamental driver of property value. A suburb with high BDI has active, engaged buyers who are expressing interest and submitting price opinions. For sellers, high BDI means their property is likely to attract competitive interest. For agents, it&apos;s evidence to bring to the listing presentation. For investors, it&apos;s a leading indicator of price movement.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">What feeds into BDI</h3>
            <div className="space-y-2 mb-6">
              {[
                ['Price opinions (20%)', 'Total buyer price opinions submitted — the core demand signal. A buyer who submits a price opinion is actively evaluating the property.'],
                ['Serious buyers (30%)', 'Buyers who have flagged themselves as serious or registered formal interest. Weighted highest because this is the strongest demand signal.'],
                ['Property saves / likes (15%)', 'Buyers who saved a property to their shortlist. Weaker than a price opinion but still indicates active interest.'],
                ['Seriousness distribution (20%)', 'The breakdown across seriousness levels: just browsing, interested, very interested, and ready to buy. A suburb full of ready-to-buy signals scores higher than one with casual browsers.'],
                ['Buyer diversity (10%)', 'Mix of first home buyers vs investors. A diverse buyer pool indicates broader market appeal and more sustainable demand.'],
                ['Engagement velocity (5%)', 'Opinions per property — a suburb where every listing gets multiple opinions shows concentrated demand.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-blue-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}</span> {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* SMI */}
          <section id="phi-smi" className="scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 text-amber-600">
                <ThermometerSun className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Seller Motivation Index (SMI)</h2>
                <p className="text-sm text-slate-500 font-mono">PHI:SMI &middot; 0-100</p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              SMI measures how eager and committed sellers are to transact in a given area. A high SMI means sellers are actively preparing to list — they have go-to-market goals set, they&apos;ve indicated urgency, and they&apos;re moving through the pre-market pipeline toward a public listing.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Why it matters</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Seller motivation is the supply-side counterpart to buyer demand. For buyer&apos;s agents, high SMI signals opportunities — motivated sellers are more likely to accept reasonable offers and move quickly. For listing agents, it indicates competitive pressure from other sellers in the area. For market analysts, rising SMI is a leading indicator of increased supply hitting the market.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">What feeds into SMI</h3>
            <div className="space-y-2 mb-6">
              {[
                ['Active visible properties (20%)', 'Properties that sellers have made visible on the platform — a commitment to testing the market.'],
                ['Go-to-market within 30 days (25%)', 'Properties with a go-to-market goal in the next 30 days. This is the strongest SMI signal — the seller has a concrete timeline.'],
                ['Go-to-market within 60 days (10%)', 'Broader pipeline of properties preparing to list in the next two months.'],
                ['Seller eagerness (25%)', 'A three-tier eagerness rating: Very Serious (1.0 weight), Serious If Price Right (0.6), and Testing the Waters (0.2). The weighted sum captures the overall urgency of the seller pool.'],
                ['Listing density (10%)', 'Total property count in the area — more properties means a more active local market.'],
                ['On-market ratio (10%)', 'Proportion of properties already listed publicly. High on-market ratio means sellers in this area are converting from premarket to active listings.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-amber-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}</span> {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* PVI */}
          <section id="phi-pvi" className="scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-100 text-purple-600">
                <Scale className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Price Validity Index (PVI)</h2>
                <p className="text-sm text-slate-500 font-mono">PHI:PVI &middot; 0-100</p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              PVI answers the fundamental question: <span className="font-medium text-slate-900">are properties in this area priced correctly?</span> For each property with buyer opinions, PVI compares the median buyer price opinion against the listing price. A deviation of more than 7% in either direction flags the property as overvalued or undervalued.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Why it matters</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              PVI is the metric that makes{' '}
              <button onClick={() => scrollTo('price-education')} className="text-orange-600 hover:text-orange-700 underline">
                price education
              </button>
              {' '}quantifiable. A suburb with PVI of 92 has properties that are largely priced in line with what buyers would pay — expectations are aligned with reality. A suburb with PVI of 45 has a significant pricing mismatch — either sellers are overpricing or the market hasn&apos;t adjusted to buyer sentiment. This is the metric agents use to show sellers, in hard numbers, whether their pricing is realistic.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">How it works</h3>
            <div className="space-y-2 mb-4">
              {[
                ['Per-property comparison', 'For each property, PVI calculates the median buyer price opinion and compares it to the listing price.'],
                ['7% deviation threshold', 'If the median opinion is within 7% of the listing price, the property is classified as "fairly priced." Beyond that: overvalued or undervalued.'],
                ['Area-level scoring', 'The suburb PVI score is the percentage of properties that are fairly priced (70% weight) combined with average deviation magnitude (30% weight). More fairly priced properties = higher PVI.'],
                ['Confidence levels', 'Each property gets a confidence rating based on opinion count: Low (1-2 opinions), Medium (3-5), High (6+). More opinions = more reliable pricing signal.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-purple-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}</span> {desc}
                  </p>
                </div>
              ))}
            </div>

            <div className="bg-purple-50 border-l-4 border-purple-400 p-4 rounded-r-lg mb-6">
              <p className="text-sm text-purple-800">
                <span className="font-semibold">Per-property PVI.</span> In addition to the suburb-level score, PVI generates individual property valuations showing exactly which properties are overvalued, undervalued, or fairly priced — available via the <code className="bg-purple-100 text-purple-700 px-1 py-0.5 rounded text-xs font-mono">/api/v1/property-valuation</code> endpoint.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* EVS */}
          <section id="phi-evs" className="scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-100 text-cyan-600">
                <Timer className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Engagement Velocity Score (EVS)</h2>
                <p className="text-sm text-slate-500 font-mono">PHI:EVS &middot; 0-100</p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              EVS measures how quickly properties attract meaningful buyer interest after being listed. A high EVS means properties in this suburb don&apos;t sit — they get opinions, saves, and engagement almost immediately. It&apos;s a velocity metric: not just how much interest, but how fast it arrives.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Why it matters</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Speed of engagement is one of the most reliable predictors of sale outcome. A property that gets 5 opinions in its first 48 hours is in a fundamentally different market position than one that gets 5 opinions over 3 weeks. For sellers, high EVS means confidence that their property will attract rapid interest. For agents, it&apos;s a data point for campaign strategy — in high-EVS suburbs, campaigns generate results quickly.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">What feeds into EVS</h3>
            <div className="space-y-2 mb-6">
              {[
                ['Time to first opinion (40%)', 'Average days between a property being listed and receiving its first buyer price opinion. Lower is better — a score of 0 days means instant engagement, 7+ days means slow uptake.'],
                ['Opinions per day (35%)', 'Average daily rate of buyer opinions across properties. 2+ opinions per day per property is the benchmark for maximum score.'],
                ['Engagement depth (25%)', 'Proportion of properties that have received any form of engagement (opinions, likes, or tracked view sessions). A suburb where every listing gets attention scores higher.'],
                ['Engagement quality (bonus)', 'When engagement tracking data is available: average view duration and opinion conversion rate from property page sessions. This provides a bonus of up to 10% on the EVS score.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-cyan-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}</span> {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* BQI */}
          <section id="phi-bqi" className="scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600">
                <ShieldCheck className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Buyer Quality Index (BQI)</h2>
                <p className="text-sm text-slate-500 font-mono">PHI:BQI &middot; 0-100</p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              BQI goes beyond demand volume to measure the <span className="font-medium text-slate-900">quality</span> of the buyer pool. A suburb can have high BDI (lots of demand) but low BQI (mostly casual browsers). BQI distinguishes between a market full of serious, financially ready buyers and one with lots of tyre-kickers.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Why it matters</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              For sellers, buyer quality determines whether interest will convert to actual offers and settlement. High BDI with low BQI means lots of interest but potentially few real buyers. High BQI with moderate BDI means fewer buyers but they&apos;re serious — a more reliable path to sale. For agents, BQI is the metric that differentiates genuine buyer activity from noise.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">What feeds into BQI</h3>
            <div className="space-y-2 mb-6">
              {[
                ['Seriousness distribution (50%)', 'Weighted average across seriousness levels: Just Browsing (0.1), Interested (0.4), Very Interested (0.7), Ready to Buy (1.0). A suburb full of ready-to-buy signals scores significantly higher than one dominated by browsers.'],
                ['Buyer type quality (30%)', 'Buyer profile composition: investors (0.8 weight), upgraders/downsizers (0.7), first home buyers (0.6). Different buyer types indicate different levels of financial readiness and transaction likelihood.'],
                ['Financial readiness (20%)', 'Proportion of buyers who are both flagged as serious AND have submitted a concrete offer amount. This is the strongest quality signal — they&apos;re ready to transact.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-emerald-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}</span> {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* FPI */}
          <section id="phi-fpi" className="scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600">
                <GitBranch className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Forward Pipeline Index (FPI)</h2>
                <p className="text-sm text-slate-500 font-mono">PHI:FPI &middot; 0-100</p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              FPI predicts what&apos;s coming next. It measures the strength of the upcoming supply pipeline — properties that are preparing to go to market but haven&apos;t listed yet. This is data that doesn&apos;t exist anywhere else: no portal, no data provider, and no public record captures pre-market supply signals.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Why it matters</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              FPI is a genuine leading indicator. A suburb with high BDI but low FPI means strong demand and limited incoming supply — prices are likely to remain firm or rise. High FPI with moderate demand means a wave of new listings is about to hit — buyers may get more choice and leverage. For investors, FPI is the supply-side signal that completes the demand picture from BDI.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">What feeds into FPI</h3>
            <div className="space-y-2 mb-4">
              {[
                ['Go-to-market within 30 days (35%)', 'Premarket and off-market properties with a go-to-market goal in the next month. The strongest pipeline signal — these sellers have committed to a timeline.'],
                ['Go-to-market within 60 days (20%)', 'Broader pipeline of properties preparing to list in the next two months.'],
                ['Go-to-market within 90 days (10%)', 'Early-stage pipeline — sellers who have set a goal but are further out.'],
                ['Eager sellers in pipeline (20%)', 'Eagerness-weighted count of pipeline properties. Very Serious sellers (full weight) are more likely to follow through than Testing the Waters sellers (50% weight for off-market, lower eagerness weight).'],
                ['New listing growth (15%)', 'Month-over-month growth in new pipeline entries. Rising growth means the pipeline is building — more properties are entering premarket. Declining growth means the pipeline is thinning.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-indigo-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}</span> {desc}
                  </p>
                </div>
              ))}
            </div>

            <div className="bg-indigo-50 border-l-4 border-indigo-400 p-4 rounded-r-lg mb-6">
              <p className="text-sm text-indigo-800">
                <span className="font-semibold">Unique to Premarket.</span> FPI is the only forward-looking supply indicator in Australian real estate. Traditional data can tell you what&apos;s currently listed. Only Premarket can tell you what&apos;s about to be listed — because only Premarket captures seller intent before the property goes public.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* SDB */}
          <section id="phi-sdb" className="scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-rose-100 text-rose-600">
                <ArrowLeftRight className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Supply-Demand Balance (SDB)</h2>
                <p className="text-sm text-slate-500 font-mono">PHI:SDB &middot; 0-100 (50 = balanced)</p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              SDB is the equilibrium metric. Unlike other PHI scores where higher always means more, SDB uses 50 as the balance point. Above 50 = seller&apos;s market (demand exceeds supply). Below 50 = buyer&apos;s market (supply exceeds demand). It answers the simplest and most important question: who has leverage in this market?
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Why it matters</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              SDB is the metric that determines negotiating dynamics. In a seller&apos;s market (SDB &gt; 55), buyers compete and prices tend to hold or rise. In a buyer&apos;s market (SDB &lt; 45), sellers compete and prices may soften. For agents, SDB contextualises every pricing conversation. For investors, it&apos;s the macro signal that drives timing decisions.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">How it&apos;s calculated</h3>
            <div className="space-y-2 mb-4">
              {[
                ['Supply', 'Count of on-market properties only. Premarket properties are excluded from supply because they&apos;re not yet competing for buyer attention in the open market.'],
                ['Demand', 'Total buyer price opinions + property saves/likes across all properties (including premarket). Demand signals count regardless of listing status — buyers are expressing interest even for premarket properties.'],
                ['Balance ratio', 'Demand signals per on-market property. A ratio of 5:1 (5 demand signals per listed property) is defined as balanced (score = 50). Higher ratio = seller&apos;s market. Lower ratio = buyer&apos;s market.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-rose-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}</span> {desc}
                  </p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 mb-6">
              <div className="divide-y divide-slate-200 text-sm">
                <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-50">
                  <span className="w-20 font-medium text-slate-900">Score</span>
                  <span className="flex-1 font-medium text-slate-900">Market condition</span>
                </div>
                {[
                  ['70-100', "Strong seller's market — demand significantly exceeds supply"],
                  ['56-69', "Seller's market — more demand than supply, prices likely to hold"],
                  ['45-55', 'Balanced market — supply and demand roughly equal'],
                  ['30-44', "Buyer's market — supply exceeds demand, buyers have leverage"],
                  ['0-29', "Strong buyer's market — significant oversupply or very low demand"],
                ].map(([range, desc], i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-2.5">
                    <span className="w-20 font-mono text-slate-700">{range}</span>
                    <span className="flex-1 text-slate-600">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ─── Data Confidence ─── */}
          <section id="data-confidence" className="scroll-mt-20 mt-12">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600">
                <ShieldCheck className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Data Confidence</h2>
                <p className="text-sm text-slate-500 font-mono">confidence &middot; low / medium / high</p>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed mb-4">
              Every PHI API response includes a <code className="text-sm bg-slate-100 px-1.5 py-0.5 rounded font-mono">confidence</code> object that describes the quality and quantity of underlying data. A suburb with 50 opinions produces a score with very different reliability than one with 2 opinions &mdash; confidence tells you the difference.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Confidence levels</h3>
            <div className="overflow-hidden rounded-lg border border-slate-200 mb-6">
              <div className="divide-y divide-slate-200 text-sm">
                <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-50">
                  <span className="w-24 font-medium text-slate-900">Level</span>
                  <span className="w-20 font-medium text-slate-900">Score</span>
                  <span className="flex-1 font-medium text-slate-900">Interpretation</span>
                </div>
                {[
                  ['High', '60-100', 'Sufficient data for reliable scores. Act on these with confidence.'],
                  ['Medium', '30-59', 'Some data available. Treat scores as directional indicators, not absolutes.'],
                  ['Low', '0-29', 'Limited data. Scores are preliminary and should be caveated when presented to clients.'],
                ].map(([level, range, desc], i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-2.5">
                    <span className="w-24 font-mono text-slate-700">{level}</span>
                    <span className="w-20 font-mono text-slate-700">{range}</span>
                    <span className="flex-1 text-slate-600">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Contributing factors</h3>
            <div className="space-y-2 mb-4">
              {[
                ['Property count (20%)', '10+ properties in the search radius produces maximum contribution. Fewer properties means less data to base scores on.'],
                ['Opinion count (30%)', '20+ buyer opinions reaches maximum weight. Opinions are the primary signal for BDI, PVI, and BQI scores.'],
                ['Serious buyer count (15%)', '5+ serious (registered) buyers indicates meaningful demand signal validation.'],
                ['Opinions per property (20%)', '3+ opinions per property means enough data points to reliably estimate price validity.'],
                ['Data freshness (15%)', 'Percentage of opinions from the last 30 days. Stale data may not reflect current market conditions.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-emerald-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}</span> {desc}
                  </p>
                </div>
              ))}
            </div>

            <h3 className="text-base font-semibold text-slate-900 mb-2">Warnings</h3>
            <p className="text-slate-600 leading-relaxed mb-3">
              The <code className="text-sm bg-slate-100 px-1.5 py-0.5 rounded font-mono">warnings</code> array in the confidence object provides human-readable caveats:
            </p>
            <div className="space-y-2 mb-4">
              {[
                'Fewer than 3 properties found',
                'No buyer opinions recorded',
                'Fewer than 5 opinions total',
                'Most data older than 30 days',
              ].map((w, i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-amber-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">{w}</p>
                </div>
              ))}
            </div>

            <h3 className="text-base font-semibold text-slate-900 mb-2">API response example</h3>
            <div className="rounded-lg overflow-hidden border border-slate-200 mb-4">
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">{`{
  "phi": { "bdi": 42, "smi": 35, ... },
  "confidence": {
    "level": "medium",
    "score": 48,
    "factors": {
      "propertyCount": 7,
      "opinionCount": 12,
      "seriousBuyerCount": 3,
      "avgOpinionsPerProperty": 1.71,
      "recentOpinionPercent": 67
    },
    "warnings": [
      "Only 7 properties found — scores may not be representative."
    ]
  }
}`}</pre>
            </div>

            <h3 className="text-base font-semibold text-slate-900 mt-6 mb-2">Best practices</h3>
            <div className="space-y-2 mb-4">
              {[
                ['Always check confidence before acting on scores', 'A PHI:BDI of 75 with high confidence is an actionable signal. The same score with low confidence is a hypothesis.'],
                ['Surface warnings to end users', 'When building client-facing dashboards, display the confidence level alongside scores so users understand data reliability.'],
                ['Use wider search radius for sparse areas', 'If confidence is low, increasing the radius parameter (e.g. 15km instead of 10km) will capture more properties and improve data quality.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-emerald-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}</span> &mdash; {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* MARKET INTELLIGENCE                      */}
          {/* ════════════════════════════════════════ */}

          {/* Data Advantage — hero-style header */}
          <section id="data-advantage" className="scroll-mt-20">
            <div className="rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 sm:p-10 mb-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent" />
              <div className="relative">
                <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">Market Intelligence</p>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                  The Data Advantage
                </h2>
                <p className="text-slate-300 leading-relaxed max-w-2xl">
                  Every existing real estate data provider — CoreLogic, Pricefinder, RPData — tells you what already happened. Premarket tells you what&apos;s about to happen.
                </p>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Backward-looking vs forward-looking</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              As covered in{' '}
              <button onClick={() => scrollTo('the-data-engine')} className="text-orange-600 hover:text-orange-700 underline">
                The Data Engine
              </button>
              , traditional real estate data is built on historical transactions. A property sold six months ago for $1.2M. A suburb&apos;s median price moved 4% last quarter. These are useful reference points, but they describe a market that no longer exists. By the time the data is published, the conditions that produced it have already changed.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              Premarket captures something fundamentally different: <span className="font-medium text-slate-900">forward-looking intent signals</span>, quantified through the{' '}
              <button onClick={() => scrollTo('phi-overview')} className="text-orange-600 hover:text-orange-700 underline">
                8 PHI scores
              </button>
              {' '} — MHI, BDI, SMI, PVI, EVS, BQI, FPI, and SDB. What buyers are actively searching for right now (BDI). What they&apos;re willing to pay today (PVI). Which properties are generating interest before they&apos;ve hit the market (FPI). Where demand is building, shifting, or cooling — in real time (MHI, SDB). This is the API layer built on top of the same buyer data that powers{' '}
              <button onClick={() => scrollTo('price-education')} className="text-orange-600 hover:text-orange-700 underline">
                price education
              </button>
              {' '}for agents and sellers.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">What the data captures</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Every interaction on Premarket generates a signal. Aggregated across thousands of buyers, properties, and suburbs, these signals form a predictive layer that doesn&apos;t exist anywhere else in real estate.
            </p>

            <div className="space-y-3 mb-8">
              {[
                ['Buyer intent (PHI:BDI)', 'Which locations and property types are attracting active buyer interest — measured by price opinions, saved properties, and registered interest, not just page views. Quantified as the Buyer Demand Index.'],
                ['Seller intent (PHI:SMI)', 'Which properties are being tested on the market through pre-market campaigns — a leading indicator of future listings that no portal or data provider can see. Quantified as the Seller Motivation Index.'],
                ['Price discovery (PHI:PVI)', 'Real-time price opinion distributions from qualified buyers, creating a crowdsourced valuation layer that updates continuously — not quarterly. The Price Validity Index flags exactly which properties are overvalued or undervalued.'],
                ['Engagement velocity (PHI:EVS)', 'How fast properties attract meaningful interest after listing — a velocity metric that predicts sale outcomes better than static demand counts alone.'],
                ['Supply-demand dynamics (PHI:SDB)', 'The balance between on-market supply and buyer demand signals. SDB tells you who has leverage in a suburb right now — buyers or sellers.'],
                ['Forward pipeline (PHI:FPI)', 'Which properties are about to hit the market, quantified by go-to-market timelines and seller eagerness. A genuine leading indicator of supply that no other data provider captures.'],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 bg-orange-500 rounded-full mt-2" />
                  <p className="text-slate-600 text-sm leading-relaxed">
                    <span className="font-medium text-slate-900">{title}.</span> {desc}
                  </p>
                </div>
              ))}
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Resolution at every level</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              The Market Intelligence API serves data at every geographic resolution — from macro market trends at the country level, down through state, city, and suburb, all the way to individual streets. This isn&apos;t aggregated portal scraping or extrapolated ABS data. It&apos;s direct behavioural signal from real market participants, captured at the point of intent.
            </p>

            <div className="rounded-lg border border-slate-200 overflow-hidden mb-8">
              <div className="divide-y divide-slate-200">
                {[
                  ['Country', 'National PHI averages (MHI, BDI, SMI, PVI, EVS, BQI, FPI, SDB), market momentum indicators'],
                  ['State', 'State-level PHI scores, demand patterns, cross-state migration signals'],
                  ['City / Region', 'Metro vs regional PHI trends, emerging growth corridors identified by MHI and BDI'],
                  ['Suburb', 'Full 8-score PHI profile, price opinion medians, PVI per-property valuations, trending indicators'],
                  ['Street', 'Hyper-local demand signals, per-property PVI scores, engagement data, micro-market dynamics'],
                ].map(([level, desc], i) => (
                  <div key={i} className="flex items-start gap-4 px-4 py-3">
                    <span className="flex-shrink-0 w-20 text-sm font-medium text-slate-900">{level}</span>
                    <p className="text-sm text-slate-600">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">The compounding advantage.</span> Every new user on the platform — every buyer who submits a price opinion, every agent who creates a campaign — makes the data more accurate, more granular, and more valuable. This is a dataset that improves with scale and cannot be replicated by scraping historical records.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* API Overview */}
          <section id="api-overview" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">API Overview</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              The Market Intelligence API exposes Premarket&apos;s forward-looking data layer through a simple REST interface. All 8{' '}
              <button onClick={() => scrollTo('phi-overview')} className="text-orange-600 hover:text-orange-700 underline">
                PHI scores
              </button>
              {' '}(MHI, BDI, SMI, PVI, EVS, BQI, FPI, SDB), per-property valuations, heatmap data, market forecasts, trending areas, historical trends, and property-level engagement insights — all available programmatically.
            </p>

            <div className="overflow-hidden rounded-lg border border-slate-200 mb-6">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-200">
                  <tr>
                    <td className="px-4 py-3 font-medium text-slate-900 bg-slate-50 w-32">Base URL</td>
                    <td className="px-4 py-3">
                      <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">
                        https://premarket.homes
                      </code>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-slate-900 bg-slate-50">Format</td>
                    <td className="px-4 py-3 text-slate-600">JSON</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-slate-900 bg-slate-50">Auth</td>
                    <td className="px-4 py-3 text-slate-600">
                      API key via <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">x-api-key</code> header
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-slate-600 leading-relaxed text-sm">
              All location-based endpoints accept flexible parameters: a freeform{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">location</code>{' '}
              string (e.g. &quot;Bondi Beach, NSW&quot;) which is geocoded automatically, or explicit{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">suburb</code> +{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">state</code>,{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">postcode</code>, or{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">lat</code> +{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">lng</code> +{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">radius</code>{' '}
              (km, default 5).
            </p>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* Authentication */}
          <section id="authentication" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Authentication</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              All API requests require an API key passed via the{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">x-api-key</code>{' '}
              header.
            </p>

            <div className="rounded-lg overflow-hidden border border-slate-800 mb-6">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">Example request header</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`x-api-key: YOUR_API_KEY`}
              </pre>
            </div>

            <p className="text-slate-600 leading-relaxed text-sm mb-4">
              To get an API key, visit the{' '}
              <Link href="/dashboard/developers" className="text-orange-600 hover:text-orange-700 underline">
                Developer Portal
              </Link>{' '}
              in your dashboard. API keys are scoped to your account and can be revoked at any time.
            </p>

            <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg">
              <p className="text-sm font-semibold text-amber-900 mb-1">Keep your key secure</p>
              <p className="text-sm text-amber-800">
                Never expose your API key in client-side code or public repositories. Use environment variables and server-side requests.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* Endpoints */}
          <section id="endpoints" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Endpoints</h2>
            <p className="text-slate-600 leading-relaxed mb-6">
              Core endpoints covering PHI scores, property valuations, heatmap visualisation data, buyer intent, seller signals, market forecasts, trending suburbs, historical trends, and property-level insights.
            </p>

            <div className="space-y-3">
              {ENDPOINTS.map((ep) => (
                <div
                  key={ep.path}
                  className="rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-100 text-emerald-700 font-mono">
                      {ep.method}
                    </span>
                    <code className="text-sm font-mono text-slate-900">{ep.path}</code>
                  </div>
                  <p className="text-sm text-slate-600 mb-1">{ep.description}</p>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-500">Params:</span> {ep.params}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* Code Examples */}
          <section id="code-examples" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Code Examples</h2>
            <p className="text-slate-600 leading-relaxed mb-6">
              Quick examples for common languages. Replace{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">YOUR_API_KEY</code>{' '}
              with your actual API key.
            </p>

            {/* cURL — PHI Scores */}
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-4">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">cURL — Get all PHI scores for a suburb</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`curl -H "x-api-key: YOUR_API_KEY" \\
  "https://premarket.homes/api/v1/phi-scores?suburb=Bondi+Beach&state=NSW"

# Response:
# {
#   "location": "Bondi Beach, NSW, Australia",
#   "source": "cache",
#   "phi": {
#     "mhi": 78, "bdi": 82, "smi": 45, "pvi": 91,
#     "evs": 67, "bqi": 73, "fpi": 34, "sdb": 68
#   },
#   "phiBreakdown": { ... }
# }`}
              </pre>
            </div>

            {/* JavaScript — PHI Scores */}
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-4">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">JavaScript — PHI scores + property valuations</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`// Get all 8 PHI scores for a location
const phi = await fetch(
  'https://premarket.homes/api/v1/phi-scores?location=Bondi+Beach,+NSW',
  { headers: { 'x-api-key': 'YOUR_API_KEY' } }
).then(r => r.json());

console.log('Market Heat:', phi.phi.mhi);   // PHI:MHI 78
console.log('Buyer Demand:', phi.phi.bdi);  // PHI:BDI 82
console.log('Price Validity:', phi.phi.pvi); // PHI:PVI 91
console.log('Supply-Demand:', phi.phi.sdb); // PHI:SDB 68

// Get per-property valuation analysis
const valuations = await fetch(
  'https://premarket.homes/api/v1/property-valuation?location=Bondi+Beach,+NSW',
  { headers: { 'x-api-key': 'YOUR_API_KEY' } }
).then(r => r.json());

// Lists overvalued and undervalued properties with deviation %
valuations.properties.forEach(p => {
  console.log(p.address, p.status, p.deviationPercent + '%');
});`}
              </pre>
            </div>

            {/* Python — PHI Scores */}
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-4">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">Python — PHI scores</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`import requests

response = requests.get(
    'https://premarket.homes/api/v1/phi-scores',
    params={'suburb': 'Bondi Beach', 'state': 'NSW'},
    headers={'x-api-key': 'YOUR_API_KEY'}
)
data = response.json()

phi = data['phi']
print(f"PHI:MHI {phi['mhi']}")  # Market Heat Index
print(f"PHI:BDI {phi['bdi']}")  # Buyer Demand Index
print(f"PHI:SMI {phi['smi']}")  # Seller Motivation Index
print(f"PHI:PVI {phi['pvi']}")  # Price Validity Index
print(f"PHI:EVS {phi['evs']}")  # Engagement Velocity Score
print(f"PHI:BQI {phi['bqi']}")  # Buyer Quality Index
print(f"PHI:FPI {phi['fpi']}")  # Forward Pipeline Index
print(f"PHI:SDB {phi['sdb']}")  # Supply-Demand Balance`}
              </pre>
            </div>

            {/* Get API Access CTA */}
            <div className="mt-8 pt-8 border-t border-slate-200">
              <p className="text-slate-600 text-sm mb-4">
                Ready to integrate Premarket market intelligence into your application?
              </p>
              <Link
                href="/dashboard/developers"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
              >
                Get API Access
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* CRM & CONTACTS                            */}
          {/* ════════════════════════════════════════ */}

          <section id="crm-overview" className="scroll-mt-20">
            <div className="rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 sm:p-10 mb-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-purple-500/10 via-transparent to-transparent" />
              <div className="relative">
                <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">CRM & Contacts</p>
                <h2 className="text-3xl font-bold text-white mb-3">Unified Contact Model</h2>
                <p className="text-slate-300 leading-relaxed max-w-2xl">
                  The CRM aggregates buyer, seller, and agent data from across the platform into a single <code className="bg-slate-700 text-slate-200 px-1.5 py-0.5 rounded text-xs font-mono">contacts</code> collection. Each contact is identified by normalized email (or phone fallback), with computed buyer and seller scores that reveal intent signals like buyers becoming sellers.
                </p>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Key concepts</h3>
            <div className="rounded-lg border border-slate-200 overflow-hidden mb-6">
              <div className="divide-y divide-slate-200">
                {[
                  ['Contact Record', 'One document per normalized email in the contacts collection. Aggregates data from offers, properties, users, and likes.'],
                  ['Role Flags', 'Each contact has isBuyer, isHomeowner, and isAgent booleans derived from their activity. A person can have multiple roles.'],
                  ['Intent Label', 'Derived from scores: buyer (buyerScore ≥ 30), seller (sellerScore ≥ 30), both (both ≥ 30), or passive.'],
                  ['Daily Recompute', 'A cron job at 1 AM UTC rebuilds all contacts from source collections and recomputes scores.'],
                ].map(([term, desc], i) => (
                  <div key={i} className="flex items-start gap-4 px-4 py-3">
                    <span className="flex-shrink-0 w-32 text-sm font-medium text-slate-900">{term}</span>
                    <p className="text-sm text-slate-600">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="contact-scoring" className="scroll-mt-20 mt-12">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Contact Scoring</h2>
            <p className="text-slate-600 mb-6">Each contact receives a buyer score and seller score (0-100), computed from weighted factors.</p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Buyer Score Formula</h3>
            <div className="rounded-lg border border-slate-200 overflow-hidden mb-6">
              <div className="divide-y divide-slate-200">
                {[
                  ['Price Opinions', '20%', 'Count of opinions submitted (capped at 20)'],
                  ['Serious Registrations', '30%', 'Count of serious=true offers (capped at 5)'],
                  ['Seriousness Level', '20%', 'Highest level: ready_to_buy=100, very_interested=75, interested=50, just_browsing=25'],
                  ['Likes', '15%', 'Total property likes (capped at 10)'],
                  ['Recency', '15%', 'Last activity: 7d=100, 30d=60, 90d=30, older=10'],
                ].map(([factor, weight, desc], i) => (
                  <div key={i} className="flex items-start gap-4 px-4 py-3">
                    <span className="flex-shrink-0 w-40 text-sm font-medium text-slate-900">{factor}</span>
                    <span className="flex-shrink-0 w-12 text-sm font-semibold text-blue-600">{weight}</span>
                    <p className="text-sm text-slate-600">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Seller Score Formula</h3>
            <div className="rounded-lg border border-slate-200 overflow-hidden mb-6">
              <div className="divide-y divide-slate-200">
                {[
                  ['Properties as Client', '30%', 'Count of owned properties (capped at 3)'],
                  ['Eagerness', '30%', 'Average isEager: 0 (Very Serious)=100, 1 (Serious)=60, 2 (Testing)=20'],
                  ['Go-to-Market ≤30d', '25%', 'Any property with gotoMarketGoal within 30 days'],
                  ['Has Price', '15%', 'Any property with a price set'],
                ].map(([factor, weight, desc], i) => (
                  <div key={i} className="flex items-start gap-4 px-4 py-3">
                    <span className="flex-shrink-0 w-40 text-sm font-medium text-slate-900">{factor}</span>
                    <span className="flex-shrink-0 w-12 text-sm font-semibold text-orange-600">{weight}</span>
                    <p className="text-sm text-slate-600">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="crm-api" className="scroll-mt-20 mt-12">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">API: Contacts</h2>
            <div className="rounded-lg border border-slate-200 p-4 mb-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-100 text-emerald-700 font-mono">GET</span>
                <code className="text-sm font-mono text-slate-900">/api/v1/contacts</code>
              </div>
              <p className="text-sm text-slate-600 mb-3">Returns paginated CRM contacts with buyer/seller scores. Requires API key authentication.</p>
              <h4 className="text-sm font-semibold text-slate-900 mb-2">Parameters</h4>
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="divide-y divide-slate-200">
                  {[
                    ['type', 'string', 'Filter by role: agent, homeowner, or buyer'],
                    ['search', 'string', 'Search by name or email (case-insensitive)'],
                    ['limit', 'number', 'Results per page (default 100, max 500)'],
                    ['offset', 'number', 'Pagination offset (default 0)'],
                  ].map(([param, type, desc], i) => (
                    <div key={i} className="flex items-start gap-4 px-4 py-2.5">
                      <code className="flex-shrink-0 w-20 text-xs font-mono text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">{param}</code>
                      <span className="flex-shrink-0 w-16 text-xs text-slate-400">{type}</span>
                      <p className="text-sm text-slate-600">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          {/* ════════════════════════════════════════ */}
          {/* BILLING & INVOICING                      */}
          {/* ════════════════════════════════════════ */}

          <section id="invoicing-overview" className="scroll-mt-20">
            <div className="rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 sm:p-10 mb-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent" />
              <div className="relative">
                <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">Billing & Invoicing</p>
                <h2 className="text-3xl font-bold text-white mb-3">Agency Invoicing System</h2>
                <p className="text-slate-300 leading-relaxed max-w-2xl">
                  Premarket charges agencies a per-listing fee for each property campaign created on the platform. The invoicing system handles the full lifecycle: generating monthly invoice runs, reviewing and editing drafts, sending invoices via Xero, tracking payment status, and providing revenue analytics.
                </p>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Key concepts</h3>
            <div className="rounded-lg border border-slate-200 overflow-hidden mb-6">
              <div className="divide-y divide-slate-200">
                {[
                  ['Invoice Run', 'A batch of invoices for a specific date range. Each run groups billable properties by agency and calculates NET (ex GST), GST, and Gross (inc GST) totals.'],
                  ['Billing Unit', 'Agencies are identified by companyName on the agent\'s user profile. If no company name exists, the individual agent is billed directly.'],
                  ['Dry Run', 'Every invoice run starts as a draft. You can review, remove properties or entire agencies, then approve before sending to Xero.'],
                  ['Reconciliation', 'Once invoices are sent, payment status syncs back from Xero — either via manual sync or automated webhooks.'],
                ].map(([term, desc], i) => (
                  <div key={i} className="flex items-start gap-4 px-4 py-3">
                    <span className="flex-shrink-0 w-32 text-sm font-medium text-slate-900">{term}</span>
                    <p className="text-sm text-slate-600">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Admin only.</span> The invoicing system is accessible at{' '}
                <code className="bg-blue-100 text-blue-900 px-1.5 py-0.5 rounded text-xs font-mono">/dashboard/admin/invoicing</code>{' '}
                and requires superAdmin access. All API routes are guarded with admin verification.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          <section id="invoicing-how-it-works" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">How Billing Works</h2>
            <p className="text-slate-600 leading-relaxed mb-6">
              Each property campaign created on Premarket is a billable event. At the end of a billing period, the system aggregates all billable properties, groups them by agency, and generates an invoice for each.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Pricing</h3>
            <div className="rounded-lg border border-slate-200 overflow-hidden mb-6">
              <div className="divide-y divide-slate-200">
                {[
                  ['Price per listing', '$200 (GST-inclusive by default)'],
                  ['NET (ex GST)', '$181.82 per listing'],
                  ['GST (10%)', '$18.18 per listing'],
                  ['Payment terms', '14 days (configurable)'],
                ].map(([label, value], i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-slate-600">{label}</span>
                    <span className="text-sm font-medium text-slate-900 font-mono">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-slate-500 text-sm mb-6">
              All pricing values are configurable via the Settings tab. Changes apply to future invoice runs only.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Agency grouping</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Properties are grouped by the agent&apos;s <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">companyName</code> field on their user profile. All properties listed by agents at the same agency are consolidated into a single invoice. If an agent has no company name set, they are billed individually.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">What gets invoiced</h3>
            <p className="text-slate-600 leading-relaxed mb-2">A property is included in an invoice run if all of the following are true:</p>
            <ul className="list-disc list-inside text-slate-600 text-sm space-y-1 mb-6 ml-2">
              <li>Created within the selected date range</li>
              <li>Not archived and not marked inactive</li>
              <li>Not already invoiced in a previous run (tracked via <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-xs font-mono">invoicedRunIds</code>)</li>
              <li>Agent is not in the excluded agents list</li>
            </ul>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">GST handling</h3>
            <p className="text-slate-600 leading-relaxed mb-6">
              The system stores and displays three figures for every line item: <strong>NET</strong> (ex GST), <strong>GST</strong> amount, and <strong>Gross</strong> (inc GST). When invoices are sent to Xero, line items use the ex-GST unit amount with tax type <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">OUTPUT</code>, and Xero auto-calculates the 10% GST.
            </p>
          </section>

          <hr className="border-slate-200 my-12" />

          <section id="invoicing-runs" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Invoice Runs</h2>
            <p className="text-slate-600 leading-relaxed mb-6">
              An invoice run is the core unit of the invoicing workflow. Each run covers a specific date range and progresses through a series of statuses.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Creating a run</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Click <strong>New Invoice Run</strong> from the Invoice Runs tab. You&apos;ll be prompted to select a <strong>Date From</strong> and <strong>Date To</strong> — these default to the previous calendar month but can be set to any range. The system queries all billable properties within that range and generates a draft.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Editing a draft</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              While a run is in <strong>draft</strong> status, you can remove individual properties or entire agencies from the run. This is useful for excluding test listings, internal properties, or agencies with special arrangements. Removing items automatically recalculates the run totals.
            </p>
            <ul className="list-disc list-inside text-slate-600 text-sm space-y-1 mb-6 ml-2">
              <li><strong>Remove agency</strong> — deletes the entire agency line item and all its properties from the run</li>
              <li><strong>Remove property</strong> — removes a single property from an agency; if all properties are removed, the agency item is deleted</li>
            </ul>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Run lifecycle</h3>
            <div className="space-y-3 mb-6">
              {[
                { status: 'DRAFT', color: 'bg-slate-100 text-slate-600', desc: 'Initial state after creation. Can be edited, approved, or deleted.' },
                { status: 'APPROVED', color: 'bg-blue-100 text-blue-700', desc: 'Locked for editing. Ready to send to Xero.' },
                { status: 'SENDING', color: 'bg-yellow-100 text-yellow-700', desc: 'Invoices are being created and emailed via Xero.' },
                { status: 'SENT', color: 'bg-amber-100 text-amber-700', desc: 'All invoices sent. Properties marked as invoiced. Sync available.' },
                { status: 'PARTIAL', color: 'bg-orange-100 text-orange-700', desc: 'Some invoices sent, some failed. Review errors and retry.' },
                { status: 'CANCELLED', color: 'bg-slate-100 text-slate-400', desc: 'Run was cancelled. No invoices sent.' },
              ].map(({ status, color, desc }, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full flex-shrink-0 mt-0.5 ${color}`}>{status}</span>
                  <p className="text-sm text-slate-600">{desc}</p>
                </div>
              ))}
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Run detail view</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Clicking into a run shows a detailed breakdown with summary cards displaying: total properties, agencies, NET (ex GST), GST, and Gross (inc GST). Below that, an agency table shows per-agency breakdowns with expandable rows listing individual properties.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Firestore schema</h3>
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-4">
              <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">invoiceRuns/&#123;runId&#125;</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`{
  status,              // draft | approved | sending | sent | partial | cancelled
  periodStart,         // Timestamp — start of billing period
  periodEnd,           // Timestamp — end of billing period
  createdAt,           // Timestamp
  createdBy,           // adminUid or "cron"
  pricePerListing,     // number (e.g. 200)
  gstRate,             // number (e.g. 0.1)
  totalProperties,     // number
  totalAgencies,       // number
  totalAmountEx,       // NET total (ex GST)
  totalGst,            // GST total
  totalAmountInc,      // Gross total (inc GST)
  previousRunId,       // for growth comparison
  errors[]             // any send errors
}`}
              </pre>
            </div>
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-6">
              <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">invoiceRunItems/&#123;itemId&#125;</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`{
  runId,               // reference to parent invoiceRun
  agentUserId,         // the agent's user ID
  agencyName,          // grouped company name
  agentName,           // agent display name
  agentEmail,          // for Xero contact creation
  properties[],        // { propertyId, address, createdAt, price }
  propertyCount,       // number of properties
  pricePerListing,     // unit price at time of run
  subtotalEx,          // NET (ex GST)
  gstAmount,           // GST
  totalInc,            // Gross (inc GST)
  xeroInvoiceId,       // set after sending to Xero
  xeroStatus,          // AUTHORISED | PAID | VOIDED
  paidAt               // set when payment confirmed
}`}
              </pre>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          <section id="invoicing-xero" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Xero Integration</h2>
            <p className="text-slate-600 leading-relaxed mb-6">
              Invoices are created and sent through Xero&apos;s accounting API. The integration handles OAuth authentication, contact management, invoice creation, email delivery, and payment reconciliation.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Connecting Xero</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Navigate to the <strong>Settings</strong> tab and click <strong>Connect Xero</strong>. This initiates an OAuth 2.0 flow that redirects to Xero for authorization. Once approved, tokens are stored securely in Firestore and automatically refreshed when they expire.
            </p>
            <p className="text-slate-600 leading-relaxed mb-6">
              Required environment variables:
            </p>
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-6">
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`XERO_CLIENT_ID=your_client_id
XERO_CLIENT_SECRET=your_client_secret
XERO_REDIRECT_URI=https://premarket.homes/api/auth/xero/callback`}
              </pre>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Sending invoices</h3>
            <p className="text-slate-600 leading-relaxed mb-2">
              When you click <strong>Send to Xero</strong> on an approved run, the system processes each agency line item:
            </p>
            <ol className="list-decimal list-inside text-slate-600 text-sm space-y-1 mb-6 ml-2">
              <li><strong>Find or create contact</strong> — searches Xero for a matching contact by agency name; creates one if not found</li>
              <li><strong>Create invoice</strong> — creates an ACCREC invoice with one line per property, ex-GST unit amount, tax type OUTPUT</li>
              <li><strong>Send email</strong> — triggers Xero&apos;s built-in invoice email to the contact</li>
              <li><strong>Mark invoiced</strong> — adds the run ID to each property&apos;s <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-xs font-mono">invoicedRunIds</code> array to prevent double-billing</li>
            </ol>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Payment reconciliation</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Payment status syncs from Xero in two ways:
            </p>
            <ul className="list-disc list-inside text-slate-600 text-sm space-y-1 mb-6 ml-2">
              <li><strong>Manual sync</strong> — click <strong>Sync from Xero</strong> on a sent run to batch-fetch current statuses</li>
              <li><strong>Webhook</strong> — Xero sends webhook events when invoice status changes; the existing webhook handler at{' '}
                <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-xs font-mono">/api/webhooks/xero</code>{' '}
                automatically updates both user invoices and invoiceRunItems</li>
            </ul>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Token management</h3>
            <p className="text-slate-600 leading-relaxed mb-6">
              Xero access tokens expire after 30 minutes. The service layer automatically refreshes tokens on 401 responses and before expiry. Tokens are stored in the{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">settings/xeroTokens</code>{' '}
              Firestore document with access_token, refresh_token, expires_at, and tenant_id.
            </p>
          </section>

          <hr className="border-slate-200 my-12" />

          <section id="invoicing-automation" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Automation</h2>
            <p className="text-slate-600 leading-relaxed mb-6">
              The invoicing system includes a daily cron job that can automatically generate draft invoice runs on a configured day each month.
            </p>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Monthly cron job</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              The cron runs daily at 4am UTC via{' '}
              <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">/api/cron/invoice-dry-run</code>.
              On the configured day of the month, it:
            </p>
            <ol className="list-decimal list-inside text-slate-600 text-sm space-y-1 mb-6 ml-2">
              <li>Checks if <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-xs font-mono">cronEnabled</code> is true in settings</li>
              <li>Checks if today matches the configured <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-xs font-mono">cronDay</code> (1–28)</li>
              <li>Verifies no run already exists for the previous month</li>
              <li>Creates a draft run for the previous calendar month</li>
              <li>Sends a notification email to all superAdmin users with a summary and link to review</li>
            </ol>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Configuration</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              Automation is configured in the <strong>Settings</strong> tab:
            </p>
            <div className="rounded-lg border border-slate-200 overflow-hidden mb-6">
              <div className="divide-y divide-slate-200">
                {[
                  ['Auto-generate', 'Toggle on/off. When enabled, the cron creates a draft run automatically.'],
                  ['Day of month', 'Which day (1–28) the cron should trigger. Default: 1st.'],
                  ['Notification', 'SuperAdmins receive an email with property count, agency count, and total amount.'],
                ].map(([label, desc], i) => (
                  <div key={i} className="flex items-start gap-4 px-4 py-3">
                    <span className="flex-shrink-0 w-32 text-sm font-medium text-slate-900">{label}</span>
                    <p className="text-sm text-slate-600">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg">
              <p className="text-sm text-amber-800">
                <span className="font-semibold">Draft only.</span> The cron only creates draft runs — it never automatically sends invoices to Xero. A superAdmin must review, optionally edit, approve, and send manually.
              </p>
            </div>
          </section>

          <hr className="border-slate-200 my-12" />

          <section id="invoicing-api" className="scroll-mt-20">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Invoicing API Reference</h2>
            <p className="text-slate-600 leading-relaxed mb-6">
              All invoicing API routes require admin authentication via the <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">adminUid</code> parameter. The cron endpoint uses Bearer token auth with <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">CRON_SECRET</code>.
            </p>

            <div className="space-y-3 mb-6">
              {[
                { method: 'GET', path: '/api/admin/invoicing/settings', desc: 'Get invoicing settings (price, GST rate, cron config, Xero connection status)' },
                { method: 'PUT', path: '/api/admin/invoicing/settings', desc: 'Update invoicing settings' },
                { method: 'GET', path: '/api/admin/invoicing/runs', desc: 'List all invoice runs (sorted by createdAt desc, limit 50)' },
                { method: 'POST', path: '/api/admin/invoicing/runs', desc: 'Create a new dry run. Body: { adminUid, dateFrom?, dateTo? }' },
                { method: 'GET', path: '/api/admin/invoicing/runs/[runId]', desc: 'Get run detail with all agency line items' },
                { method: 'PATCH', path: '/api/admin/invoicing/runs/[runId]', desc: 'Run actions: approve, cancel, removeItems, removeProperties' },
                { method: 'DELETE', path: '/api/admin/invoicing/runs/[runId]', desc: 'Delete a draft run and all its items' },
                { method: 'POST', path: '/api/admin/invoicing/runs/[runId]/send', desc: 'Send all invoices in a run to Xero' },
                { method: 'POST', path: '/api/admin/invoicing/runs/[runId]/sync', desc: 'Sync payment statuses from Xero' },
                { method: 'GET', path: '/api/admin/invoicing/analytics', desc: 'Monthly revenue aggregates and forecast. Params: months (default 12)' },
                { method: 'GET', path: '/api/auth/xero', desc: 'Initiate Xero OAuth flow (redirects to Xero)' },
                { method: 'GET', path: '/api/auth/xero/callback', desc: 'OAuth callback — exchanges code for tokens' },
                { method: 'GET', path: '/api/cron/invoice-dry-run', desc: 'Daily cron — creates draft run on configured day (Bearer auth)' },
              ].map(({ method, path, desc }, i) => (
                <div key={i} className="rounded-lg border border-slate-200 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                      method === 'GET' ? 'bg-emerald-100 text-emerald-700'
                        : method === 'POST' ? 'bg-blue-100 text-blue-700'
                        : method === 'PUT' ? 'bg-amber-100 text-amber-700'
                        : method === 'PATCH' ? 'bg-purple-100 text-purple-700'
                        : 'bg-red-100 text-red-700'
                    }`}>{method}</span>
                    <code className="text-sm font-mono text-slate-800">{path}</code>
                  </div>
                  <p className="text-xs text-slate-500">{desc}</p>
                </div>
              ))}
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">PATCH actions</h3>
            <p className="text-slate-600 leading-relaxed mb-4">
              The <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">PATCH /runs/[runId]</code> endpoint supports multiple actions via the request body:
            </p>
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-4">
              <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">Approve a draft run</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`{ "adminUid": "...", "action": "approve" }`}
              </pre>
            </div>
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-4">
              <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">Remove entire agencies from a draft</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`{ "adminUid": "...", "action": "removeItems", "itemIds": ["item1", "item2"] }`}
              </pre>
            </div>
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-4">
              <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">Remove specific properties from an agency</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`{ "adminUid": "...", "action": "removeProperties", "itemId": "item1", "propertyIds": ["prop1", "prop2"] }`}
              </pre>
            </div>
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-6">
              <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">Cancel a run</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`{ "adminUid": "...", "action": "cancel" }`}
              </pre>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 mb-3">Settings schema</h3>
            <div className="rounded-lg overflow-hidden border border-slate-800 mb-6">
              <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-400">settings/invoicing</span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono text-slate-100 bg-slate-900 overflow-x-auto">
{`{
  "pricePerListing": 200,       // GST-inclusive price per listing
  "gstRate": 0.10,              // GST rate (10%)
  "paymentTermsDays": 14,       // invoice due date offset
  "invoicePrefix": "PM-",       // prefix for Xero invoice references
  "xeroAccountCode": "200",     // Xero revenue account code
  "cronDay": 1,                 // day of month for auto dry run
  "cronEnabled": false,          // enable/disable monthly automation
  "excludeAgentIds": []          // agent user IDs to exclude from billing
}`}
              </pre>
            </div>
          </section>

          {/* Bottom spacing */}
          <div className="h-24" />
        </div>
      </main>

      {/* ─── Admin Floating Toolbar ─── */}
      {isAdmin && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
          <button
            onClick={() => setShowLinkModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-full shadow-lg hover:bg-slate-800 transition-colors"
          >
            <LinkIcon className="w-4 h-4" />
            Generate Link
          </button>
          <Link
            href="/dashboard/admin/docs-analytics"
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-900 text-sm font-medium rounded-full shadow-lg border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
            Analytics
          </Link>
        </div>
      )}

      {/* ─── Generate Link Modal ─── */}
      {showLinkModal && (
        <GenerateLinkModal uid={user?.uid} onClose={() => setShowLinkModal(false)} />
      )}
    </div>
  );
}
