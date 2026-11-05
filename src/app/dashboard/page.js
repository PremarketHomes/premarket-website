'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useOfficeBrand } from '../utils/officeBrand';
import { isPlaceholderAvatar } from '../utils/avatar';
import AgentGreeting from './components/AgentGreeting';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import { isBuyerOnly } from '../utils/roles';
import { teamPropertiesFrom, listForView, computeStats } from '../utils/teamPortfolio';
import { db } from '../firebase/clientApp';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, orderBy, deleteField, serverTimestamp } from 'firebase/firestore';
import { formatPrice, formatDate } from '../utils/formatters';
import { normalizeE164, formatDisplayPhone } from '../utils/phone';
import { shouldShowMobilePrompt } from '../utils/mobileConfirmation';
import {
  LayoutDashboard,
  Trophy,
  Users,
  Mail,
  Home,
  Plus,
  LogOut,
  Menu,
  X,
  Eye,
  Heart,
  ChevronRight,
  Bed,
  Bath,
  Car,
  Shield,
  BookOpen,
  Video,
  Pencil,
  Archive,
  CheckCircle,
  Upload,
  Settings,
  User,
  Trash2,
  ExternalLink,
  Camera,
  Building2,
  Loader2,
  Megaphone,
  Clock,
  Building,
  UserPlus,
} from 'lucide-react';
import { loginUrlForCurrentPage } from '../utils/loginRedirect';

// --- Shimmer Image Wrapper ---
function ShimmerImage({ src, alt, ...props }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse" />
      )}
      <Image
        src={src}
        alt={alt}
        {...props}
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
      />
    </>
  );
}

// --- Sidebar ---
function Sidebar({ active, onNavigate, onSignOut, sidebarOpen, setSidebarOpen, userName, userData }) {
  // Office-linked agents show their office's agency title, resolved
  // live — a neutral placeholder while it loads and a retry if it
  // fails, NEVER their old personal company name.
  const sidebarOfficeId = userData?.officeId || null;
  const officeBrand = useOfficeBrand(sidebarOfficeId);
  const agencyTitle = sidebarOfficeId ? null : userData?.companyName;
  // Leadership is authorised server-side only; this just decides whether to show the link.
  const [isLeader, setIsLeader] = useState(false);
  // The office Registrations overview is gated server-side (OFFICE_REGISTRATIONS_ENABLED); this only decides whether to show the link.
  const [registrationsOn, setRegistrationsOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/features').then((r) => (r.ok ? r.json() : null)).then((b) => { if (!cancelled && b?.officeRegistrations === true) setRegistrationsOn(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    authFetch('/api/leadership/access')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (!cancelled && b?.leader === true) setIsLeader(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const navItems = [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sold', label: 'Sold', icon: CheckCircle },
    { id: 'archived', label: 'Archive', icon: Archive },
    { id: 'add', label: 'Add Property', icon: Plus, href: '/dashboard/add' },
    { id: 'user-manual', label: 'User Manual', icon: BookOpen, href: '/dashboard/user-manual' },
    // Colleagues in the same verified office can share read-only sight of each
    // other's campaigns. Only offered to office-linked agents.
    ...(userData?.officeId
      ? [{ id: 'my-team', label: 'My Team', icon: UserPlus, href: '/dashboard/team' }]
      : []),
    { id: 'settings', label: 'Settings', icon: Settings, href: '/dashboard/settings' },
    ...(userData?.isOfficeAdmin === true
      ? [
          { id: 'office', label: 'Office', icon: Building2, href: '/dashboard/office' },
          { id: 'office-agents', label: 'Agents', icon: Users, href: '/dashboard/office/agents' },
          { id: 'office-teams', label: 'Teams', icon: UserPlus, href: '/dashboard/office/teams' },
          { id: 'office-campaigns', label: 'Campaigns', icon: LayoutDashboard, href: '/dashboard/office/campaigns' },
        ]
      : []),
    ...(userData?.isOfficeAdmin === true && registrationsOn
      ? [{ id: 'office-registrations', label: 'Registrations', icon: Mail, href: '/dashboard/office/registrations' }]
      : []),
    ...(isLeader
      ? [{ id: 'leadership', label: 'Leadership Hub', icon: Trophy, href: '/dashboard/leadership' }]
      : []),
    ...(userData?.superAdmin === true
      ? [{ id: 'admin', label: 'Admin', icon: Shield, href: '/dashboard/admin' }]
      : []),
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#fdfcfb]">
      {/* Logo */}
      <div className="px-7 pt-8 pb-7">
        <Link href="/">
          <Image
            src="https://premarketvideos.b-cdn.net/assets/logo.png"
            alt="Premarket"
            width={140}
            height={35}
            className="h-6 w-auto"
            unoptimized
          />
        </Link>
      </div>

      {/* User Info */}
      <div className="px-7 pb-6 border-b border-stone-200">
        <div className="flex items-center gap-3.5">
          {userData?.avatar ? (
            <img
              src={userData.avatar}
              alt=""
              className="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-stone-200"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-stone-100 ring-1 ring-stone-200 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-stone-500" strokeWidth={1.5} />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-stone-400">Welcome back,</p>
            {/* The greeting is always the person's own name — agency/office
                branding is shown beneath it and never replaces it. */}
            <p className="mt-0.5 font-serif text-[17px] leading-snug text-stone-900 truncate">{userName}</p>
            {sidebarOfficeId ? (
              officeBrand.status === 'loading' ? (
                <div className="h-3 w-24 rounded bg-stone-200 animate-pulse mt-1" aria-label="Loading agency" />
              ) : officeBrand.status === 'failed' ? (
                <button onClick={officeBrand.retry} className="text-[#c64500] hover:text-[#a63a00] text-xs font-medium">
                  Agency unavailable — retry
                </button>
              ) : (
                <p className="text-xs text-stone-500 truncate">{officeBrand.brand?.name || 'Your office'}</p>
              )
            ) : agencyTitle ? (
              <p className="text-xs text-stone-500 truncate">{agencyTitle}</p>
            ) : (
              <Link href="/dashboard/settings" className="text-[#c64500] hover:text-[#a63a00] text-xs font-medium">
                Add Agency Details
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          if (item.href) {
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`relative flex items-center gap-3 px-4 py-2.5 rounded-md text-[13px] font-medium tracking-wide transition-colors ${
                  isActive
                    ? 'text-stone-900 bg-stone-100/80 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-full before:bg-[#c64500]'
                    : 'text-stone-500 hover:text-stone-900 hover:bg-stone-100/60'
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.5} />
                {item.label}
              </Link>
            );
          }
          return (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                setSidebarOpen(false);
              }}
              className={`w-full relative flex items-center gap-3 px-4 py-2.5 rounded-md text-[13px] font-medium tracking-wide transition-colors ${
                isActive
                  ? 'text-stone-900 bg-stone-100/80 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-full before:bg-[#c64500]'
                  : 'text-stone-500 hover:text-stone-900 hover:bg-stone-100/60'
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.5} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="px-4 py-4 border-t border-stone-200 space-y-1">
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-[13px] font-medium tracking-wide text-stone-500 hover:bg-stone-100/60 hover:text-stone-900 transition-colors"
        >
          <LogOut className="w-4 h-4" strokeWidth={1.5} />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#fdfcfb] border-r border-stone-200 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-stone-900/40 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-64 bg-[#fdfcfb] border-r border-stone-200 z-50 lg:hidden"
            >
              <button
                onClick={() => setSidebarOpen(false)}
                className="absolute top-4 right-4 p-2 text-stone-400 hover:text-stone-900"
              >
                <X className="w-5 h-5" strokeWidth={1.5} />
              </button>
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// --- Stat (one cell of the overview strip) ---
// Four figures share a single hairline-divided panel rather than four
// separate cards: quieter, and it reads as one summary of the portfolio.
function StatCard({ label, value }) {
  return (
    <div className="bg-white px-5 py-5 sm:px-7 sm:py-6">
      <div className="text-[11px] uppercase tracking-[0.14em] text-stone-500">{label}</div>
      <div className="mt-2 font-serif text-3xl sm:text-4xl leading-none text-stone-900 tabular-nums">{value}</div>
    </div>
  );
}

// --- Property Card ---
function PropertyCard({ property, onToggleVisibility, toggling, onArchive, archiving, isArchived, isSold, onHide, teamAgents, showListedBy }) {
  // A teammate's listing is a read-only copy: it can be previewed and its (redacted)
  // report opened, but never edited, archived or hidden from here.
  const isTeamListing = property.isTeamListing === true;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-stone-200 rounded-md overflow-hidden hover:border-stone-300 transition-colors flex flex-col"
    >
      {/* Image — clickable to preview listing */}
      <a
        href={`/find-property?propertyId=${property.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block relative aspect-[4/3] bg-stone-100 cursor-pointer group"
      >
        {property.imageUrls?.[0] ? (
          <ShimmerImage
            src={property.imageUrls[0]}
            alt={property.address || 'Property'}
            fill
            className="object-cover group-hover:scale-[1.015] transition-transform duration-500"
            unoptimized
          />
        ) : property.imageUploadProgress?.inProgress ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-stone-50">
            <div className="w-8 h-8 border-2 border-[#c64500] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-stone-500">Uploading media...</p>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Home className="w-10 h-10 text-stone-300" strokeWidth={1.25} />
          </div>
        )}
        {/* Status Badge */}
        <div className="absolute top-3 left-3">
          <span className={`inline-flex px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] rounded-sm ${
            isSold
              ? 'bg-emerald-800 text-white'
              : property.archived === true
                ? 'bg-white/90 text-stone-600'
                : property.visibility === true
                  ? 'bg-stone-900 text-white'
                  : 'bg-white/90 text-stone-600'
          }`}>
            {isSold ? 'Sold' : property.archived === true ? 'Archived' : property.visibility === true ? 'Public' : 'Private'}
          </span>
        </div>
        {/* Top-right badges */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <span className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] rounded-sm ${
            property.listingStatus === 'on-market'
              ? 'bg-white/90 text-stone-800'
              : 'bg-white/90 text-[#c64500]'
          }`}>
            {property.listingStatus === 'on-market' ? 'On Market' : 'Pre-Market'}
          </span>
          {(property.videoUrl || property.aiVideo?.url) && (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-sm bg-stone-900/70 text-white">
              <Video className="w-3 h-3" />
            </span>
          )}
        </div>
        {/* Upload Progress Bar */}
        {property.imageUploadProgress?.inProgress && (
          <div className="absolute bottom-0 left-0 right-0">
            <div className="h-0.5 bg-stone-200">
              <div
                className="h-full bg-[#c64500] transition-all duration-500"
                style={{ width: `${property.imageUploadProgress.total > 0 ? (property.imageUploadProgress.uploaded / property.imageUploadProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </a>

      {/* Details — address clickable to preview listing */}
      <div className="p-5 flex flex-col flex-1">
        {showListedBy && (
          <p className="text-[10px] uppercase tracking-[0.14em] text-stone-400 mb-2 truncate">
            Listed by {isTeamListing ? property.listedBy : 'you'}
          </p>
        )}
        <a
          href={`/find-property?propertyId=${property.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-stone-900 text-sm truncate mb-1 block hover:text-[#c64500] transition-colors"
        >
          {property.formattedAddress || property.address || 'No address'}
        </a>
        {property.agentId && teamAgents?.length > 0 && (() => {
          const agent = teamAgents.find(a => a.id === property.agentId);
          return agent ? <p className="text-xs text-stone-500 mb-0.5">{agent.name}</p> : null;
        })()}
        <p className="font-serif text-xl text-stone-900 mb-3">{formatPrice(property.price)}</p>
        {isSold && (
          <p className="text-xs font-medium text-emerald-800 mb-3 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
            {property.soldPrice ? `Sold ${formatPrice(property.soldPrice)}` : 'Sold'}
            {property.soldAt ? ` · ${formatDate(property.soldAt)}` : ''}
          </p>
        )}

        <div className="flex items-center gap-4 text-xs text-stone-500 mb-2">
          {property.bedrooms != null && (
            <span className="flex items-center gap-1.5"><Bed className="w-3.5 h-3.5" strokeWidth={1.5} />{property.bedrooms}</span>
          )}
          {property.bathrooms != null && (
            <span className="flex items-center gap-1.5"><Bath className="w-3.5 h-3.5" strokeWidth={1.5} />{property.bathrooms}</span>
          )}
          {property.carSpaces != null && (
            <span className="flex items-center gap-1.5"><Car className="w-3.5 h-3.5" strokeWidth={1.5} />{property.carSpaces}</span>
          )}
        </div>

        {/* Stats Row */}
        <div className="flex items-center gap-4 text-xs text-stone-500 mb-5">
          <span className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" strokeWidth={1.5} />{property.stats?.views || 0} views</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-auto pt-4 border-t border-stone-100">
          <Link
            href={`/dashboard/property/${property.id}`}
            className="flex-1 text-center px-3 py-2 text-xs font-medium tracking-wide text-stone-900 border border-stone-300 hover:border-stone-900 hover:bg-stone-50 rounded-md transition-colors"
          >
            View Report
          </Link>
          {!isTeamListing && (
            <Link
              href={`/dashboard/edit/${property.id}`}
              className="px-3 py-2 text-xs font-medium tracking-wide text-stone-500 hover:text-stone-900 rounded-md transition-colors flex items-center gap-1.5"
            >
              <Pencil className="w-3 h-3" strokeWidth={1.5} />
              Edit
            </Link>
          )}
          {!isTeamListing && isArchived && !isSold && onHide && (
            <button
              onClick={() => onHide(property)}
              className="px-3 py-2 text-xs font-medium text-stone-400 hover:text-red-700 rounded-md transition-colors flex items-center gap-1"
              title="Hide from archive"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// --- Billing Announcement Banner ---
// Versioned announcement id — a FUTURE announcement uses a different
// id (e.g. 'something-else-v1'), stored as its own independent key
// (see acknowledge-announcement/route.js's own comment on why a
// plain merge would be wrong here), so this one and any later one can
// never clobber each other's acknowledgement.
const BILLING_ANNOUNCEMENT_ID = 'billing-announcement-v1';

function BillingAnnouncementBanner({ userData, onAcknowledged }) {
  const [saving, setSaving] = useState(false);

  // No extra Firestore read at all — userData is already loaded by
  // AuthContext for every other use on this page; visibility is
  // computed from data already in memory.
  const acknowledged = !!userData?.acknowledgedAnnouncements?.[BILLING_ANNOUNCEMENT_ID];
  if (acknowledged) return null;

  const handleGotIt = async () => {
    if (saving) return; // one acknowledgement in flight at a time
    setSaving(true);
    try {
      const res = await authFetch('/api/users/acknowledge-announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcementId: BILLING_ANNOUNCEMENT_ID }),
      });
      if (!res.ok) throw new Error('Failed to acknowledge');
      // Optimistic local update — one write, no re-fetch needed to
      // hide the banner immediately.
      onAcknowledged(BILLING_ANNOUNCEMENT_ID);
    } catch (err) {
      console.error('Failed to acknowledge billing announcement:', err);
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-white rounded-xl border border-orange-200 p-4 mb-6"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Megaphone className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 text-sm">Premarket Billing Is Now Active</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              From 21 October 2026, new property submissions incur a $200 campaign fee (no GST).
            </p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Charges are consolidated into one invoice every 30 days, with payment due within 14 days.
            </p>
          </div>
        </div>
        <button
          onClick={handleGotIt}
          disabled={saving}
          className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 disabled:opacity-60 transition-colors flex-shrink-0"
        >
          {saving ? 'Saving…' : 'Got it'}
        </button>
      </div>
    </motion.div>
  );
}

// --- Billing Contact Prompt ---
// Unlike BillingAnnouncementBanner above (one-time, dismissed purely
// client-side), this one's "dismissed" state lives server-side, in
// billingContacts/agent:{uid} — see /api/agency/billing-contact-status.
// It is always THIS agent's own status, never shared with or
// satisfied by any other agent — even one at the same named agency —
// so two agents who both type "Harcourts" as their agency name each
// see, and must each individually clear, their own prompt. "Remind me
// later" is a purely personal, per-device snooze of the UNSET-state
// form only; it never hides the "pending confirmation" strip once a
// proposal exists, since that's no longer this agent's call to
// dismiss.
const BILLING_CONTACT_REMIND_KEY = 'billing_contact_prompt_remind_after';

function BillingContactPrompt() {
  const [loading, setLoading] = useState(true);
  const [applicable, setApplicable] = useState(false);
  const [status, setStatus] = useState('unset');
  const [rejectionReason, setRejectionReason] = useState(null);
  const [snoozed, setSnoozed] = useState(false);

  const [billingName, setBillingName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(BILLING_CONTACT_REMIND_KEY);
      if (stored && Date.now() < Number(stored)) setSnoozed(true);
    } catch {
      // ignore — localStorage can throw in a private window; default to not-snoozed
    }
  }, []);

  useEffect(() => {
    let active = true;
    authFetch('/api/agency/billing-contact-status')
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        // Office billing is managed in Settings → Billing Details, never via this prompt.
        setApplicable(!!data.applicable && data.billingEntityType !== 'office');
        setStatus(data.status || 'unset');
        setRejectionReason(data.rejectionReason || null);
        setBillingName((prev) => prev || data.billingEntityName || '');
      })
      .catch((err) => console.error('Failed to load billing contact status:', err))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const remindLater = () => {
    try {
      const remindAfter = Date.now() + 1000 * 60 * 60 * 24 * 3;
      localStorage.setItem(BILLING_CONTACT_REMIND_KEY, String(remindAfter));
    } catch {
      // ignore
    }
    setSnoozed(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!contactEmail.trim()) {
      setSubmitError('An accounts email address is required');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await authFetch('/api/agency/propose-billing-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingName: billingName.trim(),
          contactName: contactName.trim(),
          contactEmail: contactEmail.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to submit billing details');
      setStatus('pending');
    } catch (err) {
      console.error('Propose billing contact error:', err);
      setSubmitError(err.message || 'Failed to submit billing details');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !applicable) return null;
  if (status === 'confirmed') return null;

  // Non-dismissible by design once a proposal exists — only a
  // Premarket admin acting on THIS agent's own proposal clears it.
  if (status === 'pending') {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-amber-50 rounded-xl border border-amber-200 p-4 mb-6 flex items-center gap-3"
      >
        <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <Clock className="w-5 h-5 text-amber-600" />
        </div>
        <p className="text-sm text-amber-800">
          <span className="font-semibold">Billing details pending confirmation</span> — your accounts contact has been submitted and is awaiting Premarket's review.
        </p>
      </motion.div>
    );
  }

  // status is 'unset' or 'rejected' — show the form. A personal "remind
  // me later" snooze only applies here.
  if (snoozed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-slate-200 p-5 mb-6"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <Building className="w-5 h-5 text-slate-600" />
        </div>
        <div>
          <p className="font-semibold text-slate-900 text-sm">Confirm Your Billing Details</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Premarket invoices are issued to you individually, as your own billing account. Please confirm the correct accounts contact to ensure invoices reach the right person.
          </p>
          {status === 'rejected' && (
            <p className="text-xs text-red-600 mt-2">
              Your previous submission needs changes{rejectionReason ? `: ${rejectionReason}` : '.'} Please resubmit below.
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Agency billing name</label>
            <input
              type="text"
              value={billingName}
              onChange={(e) => setBillingName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Accounts contact name</label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Accounts email address</label>
          <input
            type="email"
            required
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        {submitError && <p className="text-xs text-red-600">{submitError}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 disabled:opacity-60 transition-colors"
          >
            {submitting ? 'Submitting…' : 'Confirm details'}
          </button>
          <button
            type="button"
            onClick={remindLater}
            disabled={submitting}
            className="px-4 py-2 text-slate-500 rounded-lg text-sm font-medium hover:bg-slate-100 transition-colors"
          >
            Remind me later
          </button>
        </div>
      </form>
    </motion.div>
  );
}

// --- Empty State ---
function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-md border border-stone-200 px-6 py-16 sm:py-20 text-center"
    >
      <div className="mx-auto mb-7 h-px w-10 bg-[#c64500]" aria-hidden="true" />
      <h3 className="font-serif text-2xl text-stone-900 mb-3">No properties yet</h3>
      <p className="text-sm text-stone-500 leading-relaxed mb-8 max-w-sm mx-auto">
        Add your first property to start collecting buyer opinions and market insights.
      </p>
      <Link
        href="/dashboard/add"
        className="add-property-pulse inline-flex items-center gap-2 px-6 py-3 bg-[#e38100] hover:bg-[#cc7400] text-white text-sm font-semibold tracking-wide rounded-md transition-colors"
      >
        <Plus className="w-4 h-4" strokeWidth={1.75} />
        Add Your First Property
      </Link>
    </motion.div>
  );
}

// --- Logo Upload Modal ---
function LogoUploadModal({ show, onClose, user, userData, setUserData }) {
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(userData?.logoUrl || '');
  const [file, setFile] = useState(null);
  const [agencyTitle, setAgencyTitle] = useState(userData?.companyName || '');
  const [uploading, setUploading] = useState(false);

  if (!show) return null;

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPreview(URL.createObjectURL(f));
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file && !agencyTitle.trim()) return;
    setUploading(true);
    try {
      const updates = {};
      if (agencyTitle.trim()) updates.companyName = agencyTitle.trim();
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await authFetch('/api/upload-image', { method: 'POST', body: formData });
        if (res.ok) {
          const { url } = await res.json();
          updates.logoUrl = url;
        }
      }
      if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, 'users', user.uid), updates);
        setUserData((prev) => ({ ...prev, ...updates }));
      }
      onClose();
    } catch (err) {
      console.error('Logo upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem('logo_onboarding_dismissed', 'true');
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleSkip(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
      >
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-lg font-bold text-slate-900 mb-1">Add your agency logo</h2>
          <p className="text-sm text-slate-500 mb-5">
            Your logo will appear across the platform:
          </p>
          <ul className="text-xs text-slate-500 space-y-1 mb-5">
            <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-orange-400" />Property listing cards</li>
            <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-orange-400" />TV display mode</li>
            <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-orange-400" />Property detail pages</li>
          </ul>

          <div className="flex flex-col items-center gap-4 mb-5">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {preview ? (
                <img src={preview} alt="Logo preview" className="w-24 h-24 rounded-xl object-cover" />
              ) : (
                <div className="w-24 h-24 rounded-xl bg-slate-100 flex items-center justify-center">
                  <Building2 className="w-10 h-10 text-slate-300" />
                </div>
              )}
              <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all">
                <Camera className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-sm font-semibold text-orange-600 hover:text-orange-700"
            >
              {preview ? 'Choose different image' : 'Select logo image'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          </div>

          <div className="px-0">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Agency Title</label>
            <input
              type="text"
              value={agencyTitle}
              onChange={(e) => setAgencyTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
              placeholder="e.g. Ray White, LJ Hooker"
            />
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={handleSkip}
            className="flex-1 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Skip for now
          </button>
          <button
            onClick={handleUpload}
            disabled={(!file && !agencyTitle.trim()) || uploading}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#e48900] to-[#c64500] rounded-xl shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : 'Save'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Logo Nudge Pill ---
function LogoNudge({ onClick }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes logo-nudge-glow {
          0%, 100% { box-shadow: 0 4px 14px rgba(234, 137, 0, 0.2); }
          50% { box-shadow: 0 4px 20px rgba(234, 137, 0, 0.45); }
        }
      `}} />
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        onClick={onClick}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 bg-white border border-orange-200 rounded-full shadow-lg hover:shadow-orange-500/40 transition-all cursor-pointer"
        style={{ animation: 'logo-nudge-glow 2s ease-in-out infinite' }}
      >
        <Building2 className="w-4 h-4 text-orange-500" />
        <span className="text-sm font-semibold text-slate-700">Add logo</span>
      </motion.button>
    </>
  );
}

// --- Agency Branding Nudge ---
// Optional, dismissible, account-upgrade prompt — never blocks normal
// Premarket use. Copy varies depending on whether this agent already has
// a personal logo uploaded (userData.logoUrl), per the two variants
// specified for this feature.
function BrandingNudge({ hasLogo, onDismiss }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center gap-4"
    >
      <div className="flex-1">
        <p className="font-semibold text-slate-900 mb-1">Personalise your Premarket campaigns</p>
        <p className="text-sm text-slate-500">
          {hasLogo
            ? 'We found your agency logo. Create a branded Premarket experience using your agency colours.'
            : 'Upload your agency logo and we\'ll create a branded campaign experience using your agency colours.'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onDismiss}
          className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors"
        >
          Not now
        </button>
        <Link
          href="/dashboard/branding"
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold text-sm hover:shadow-lg transition-all whitespace-nowrap"
        >
          {hasLogo ? 'Create Branding' : 'Set Up Branding'}
        </Link>
      </div>
    </motion.div>
  );
}

// --- Profile Photo Prompt (office agents only) ---
// An office agent's name/phone/office/branding are all already
// populated the moment their invitation is accepted — this is the one
// remaining personalisation step, so it's deliberately simple: no logo/
// colour choices here (that's the office admin's job, via Office
// Management), just a link to the existing avatar upload already on
// Account Settings — reused as-is, not rebuilt here.
function ProfilePhotoPrompt({ onDismiss }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center gap-4"
    >
      <div className="flex-1">
        <p className="font-semibold text-slate-900 mb-1">Add your profile photo</p>
        <p className="text-sm text-slate-500">Your office branding is already set up — upload your own photo to finish personalising your profile.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onDismiss}
          className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors"
        >
          Not now
        </button>
        <Link
          href="/dashboard/settings"
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold text-sm hover:shadow-lg transition-all whitespace-nowrap"
        >
          Upload Photo
        </Link>
      </div>
    </motion.div>
  );
}

// --- Mobile Number Confirmation Prompt ---
// Shown once per account until the agent confirms or updates their
// number (see utils/mobileConfirmation.js for exactly what gates this).
// Writes only `phone` and `mobileConfirmedAt` on the agent's own
// users/{uid} document — both already writable by the agent under the
// existing Firestore rules, no rules change needed.
function MobileNumberPrompt({ userData, uid, onConfirmed }) {
  const [editing, setEditing] = useState(!userData?.phone);
  const [value, setValue] = useState(userData?.phone ? formatDisplayPhone(userData.phone) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const confirmExisting = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', uid), { mobileConfirmedAt: serverTimestamp() });
      onConfirmed({ mobileConfirmedAt: new Date() });
    } catch (err) {
      console.error('Error confirming mobile number:', err);
      setError('Something went wrong — please try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveNewNumber = async () => {
    const normalized = normalizeE164(value);
    if (!normalized) {
      setError('Please enter a valid mobile number.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateDoc(doc(db, 'users', uid), { phone: normalized, mobileConfirmedAt: serverTimestamp() });
      onConfirmed({ phone: normalized, mobileConfirmedAt: new Date() });
    } catch (err) {
      console.error('Error updating mobile number:', err);
      setError('Something went wrong — please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="bg-white rounded-xl border border-slate-200 p-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <p className="font-semibold text-slate-900 mb-1">
            {userData?.phone ? 'Is your mobile number up to date?' : 'Add your mobile number'}
          </p>
          <p className="text-sm text-slate-500">
            Your mobile number is now displayed on your Premarket property campaigns.
          </p>
        </div>

        {!editing && userData?.phone && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-medium text-slate-700 mr-1">{formatDisplayPhone(userData.phone)}</span>
            <button
              onClick={confirmExisting}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Yes, this is correct'}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors"
            >
              Update number
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="tel"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="04XX XXX XXX"
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={saveNewNumber}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save number'}
            </button>
            {userData?.phone && (
              <button
                onClick={() => { setEditing(false); setError(''); }}
                className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </motion.div>
  );
}

// --- Main Dashboard ---
export default function DashboardPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    }>
      <DashboardPage />
    </Suspense>
  );
}

function DashboardPage() {
  const { user, userData, setUserData, loading, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [properties, setProperties] = useState([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [opinionsCount, setOpinionsCount] = useState(0);
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [successModal, setSuccessModal] = useState(null); // 'created' | 'updated' | null
  const [officeJoinedBanner, setOfficeJoinedBanner] = useState(null); // office name, or null
  const greetingOfficeBrand = useOfficeBrand(userData?.officeId || null);
  const [showLogoModal, setShowLogoModal] = useState(false);
  const [brandingNudgeDismissed, setBrandingNudgeDismissed] = useState(true);
  const [teamAgents, setTeamAgents] = useState([]);
  const [filterAgentId, setFilterAgentId] = useState('');
  // Shared team portfolio: teammates' read-only listings (server-authorised) and the chosen view.
  const [teamRows, setTeamRows] = useState([]);
  const [teamView, setTeamView] = useState('all'); // 'all' | 'mine' | 'team'

  // Logo onboarding for agents without a logo
  useEffect(() => {
    if (!userData) return;
    if ((userData.isAgent || userData.agent) && !userData.officeId && !userData.logoUrl && !localStorage.getItem('logo_onboarding_dismissed')) {
      setShowLogoModal(true);
    }
  }, [userData]);

  // Agency branding nudge — optional, dismissible, never blocks normal
  // use. Doesn't show at all once the agent already has branding set up
  // (userData.agencyBrandId), or after they've dismissed it once.
  useEffect(() => {
    if (!localStorage.getItem('branding_nudge_dismissed')) {
      setBrandingNudgeDismissed(false);
    }
  }, []);
  const dismissBrandingNudge = () => {
    setBrandingNudgeDismissed(true);
    localStorage.setItem('branding_nudge_dismissed', 'true');
  };

  // Automatically establish (or join) agency branding for an existing
  // agent who already has a logo on file — no separate login/approval
  // step required. Simply calling GET /api/branding/mine is enough to
  // trigger it (see autoEstablishBrandForUser); this just does so once,
  // silently, the first time the dashboard loads for an agent who has a
  // logo but no brand yet, and reflects the result immediately without
  // needing a page refresh. No-ops entirely (server-side) for anyone who
  // already has a brand, has no logo, or has no company name — the
  // dashboard branding page remains available either way for manual
  // review/adjustment.
  useEffect(() => {
    if (!userData) return;
    if (!(userData.isAgent || userData.agent)) return;
    if (userData.agencyBrandId || !userData.logoUrl) return;
    let cancelled = false;
    authFetch('/api/branding/mine')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.brand?.id) {
          setUserData((prev) => (prev ? { ...prev, agencyBrandId: data.brand.id } : prev));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userData?.id, userData?.agencyBrandId, userData?.logoUrl, userData?.isAgent, userData?.agent]);

  // Show success modal from URL params
  useEffect(() => {
    const created = searchParams.get('created');
    const updated = searchParams.get('updated');
    if (created) setSuccessModal('created');
    else if (updated) setSuccessModal('updated');
    // Clean up URL params
    if (created || updated) {
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [searchParams]);

  // Office-invite acceptance (see office-invite/page.js) lands here
  // with a plain confirmation banner — deliberately NOT the property
  // success modal above, which is specifically about media
  // uploading/listing visibility and doesn't apply here.
  useEffect(() => {
    if (searchParams.get('officeJoined') === '1') {
      setOfficeJoinedBanner(searchParams.get('officeName') || 'your office');
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [searchParams]);

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.replace(loginUrlForCurrentPage());
    }
  }, [user, loading, router]);

  // Buyers belong on /buyer-dashboard, not the agent dashboard
  useEffect(() => {
    if (!loading && userData && isBuyerOnly(userData)) {
      router.replace('/buyer-dashboard');
    }
  }, [loading, userData, router]);

  // Real-time properties listener
  useEffect(() => {
    if (!user) return;
    setPropertiesLoading(true);
    const q = query(collection(db, 'properties'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
    let isFirst = true;
    const unsub = onSnapshot(q, async (snapshot) => {
      const props = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setProperties(props);
      if (isFirst) {
        setPropertiesLoading(false);
        isFirst = false;
        // Fetch buyer opinions count once
        const propertyIds = props.map(p => p.id);
        if (propertyIds.length > 0) {
          let totalOpinions = 0;
          for (let i = 0; i < propertyIds.length; i += 30) {
            const batch = propertyIds.slice(i, i + 30);
            const offersSnap = await getDocs(
              query(collection(db, 'offers'), where('propertyId', 'in', batch))
            );
            totalOpinions += offersSnap.docs.filter(d => d.data().type === 'opinion').length;
          }
          setOpinionsCount(totalOpinions);
        }
      }
    }, (err) => {
      console.error('Error fetching properties:', err);
      setPropertiesLoading(false);
    });
    return () => unsub();
  }, [user]);

  // Fetch team agents
  useEffect(() => {
    if (!user) return;
    const fetchAgents = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'agents'), where('userId', '==', user.uid)));
        setTeamAgents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error fetching agents:', err);
      }
    };
    fetchAgents();
  }, [user]);

  // Teammates' listings. Teams only exist inside an office, so only office-linked agents
  // ask. The SERVER decides membership on every call (userData is read once at sign-in, so
  // `teamId` here can be stale after joining/leaving): no team, or a team just left, answers
  // 403 and the shared rows simply disappear. Re-fetched when the tab regains focus.
  const inOffice = !!userData?.officeId;
  useEffect(() => {
    if (!user || !inOffice) {
      setTeamRows([]);
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await authFetch('/api/teams/properties');
        if (!res.ok) throw new Error(`team properties ${res.status}`);
        const data = await res.json();
        if (!cancelled) setTeamRows(Array.isArray(data.properties) ? data.properties : []);
      } catch (err) {
        // Not in a team (403) or a transient error: never blocks the dashboard.
        if (!cancelled) setTeamRows([]);
      }
    };
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, inOffice]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  const toggleVisibility = async (property) => {
    setToggling(true);
    try {
      const newVisibility = !property.visibility;
      await updateDoc(doc(db, 'properties', property.id), { visibility: newVisibility });
      setProperties(prev =>
        prev.map(p => p.id === property.id ? { ...p, visibility: newVisibility } : p)
      );
    } catch (err) {
      console.error('Error toggling visibility:', err);
    } finally {
      setToggling(false);
    }
  };

  const archiveProperty = async (property) => {
    setArchiving(true);
    try {
      await updateDoc(doc(db, 'properties', property.id), { archived: true, visibility: false });
      setProperties(prev =>
        prev.map(p => p.id === property.id ? { ...p, archived: true, visibility: false } : p)
      );
    } catch (err) {
      console.error('Error archiving property:', err);
    } finally {
      setArchiving(false);
    }
  };

  const unarchiveProperty = async (property) => {
    setArchiving(true);
    try {
      // If this was a sold property, fully clear the sold state — badge,
      // sold price/date, everything — so it looks like a normal active
      // property that was never marked sold. Deleting fields that were
      // never set (a plain, never-sold archived property) is a no-op.
      const restoredVisibility = property.preSoldVisibility === true;
      await updateDoc(doc(db, 'properties', property.id), {
        archived: false,
        active: true,
        visibility: restoredVisibility,
        archivedReason: deleteField(),
        soldPrice: deleteField(),
        soldAt: deleteField(),
        archivedAt: deleteField(),
        preSoldVisibility: deleteField(),
      });
      setProperties(prev =>
        prev.map(p => {
          if (p.id !== property.id) return p;
          const next = { ...p, archived: false, active: true, visibility: restoredVisibility };
          delete next.archivedReason;
          delete next.soldPrice;
          delete next.soldAt;
          delete next.archivedAt;
          delete next.preSoldVisibility;
          return next;
        })
      );
    } catch (err) {
      console.error('Error unarchiving property:', err);
    } finally {
      setArchiving(false);
    }
  };

  const handleHideProperty = async (property) => {
    try {
      await updateDoc(doc(db, 'properties', property.id), { hidden: true });
      setProperties(prev => prev.filter(p => p.id !== property.id));
    } catch (err) {
      console.error('Error hiding property:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#c64500] border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  // Always the signed-in person's own name — never the agency/company name.
  const userName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || user?.displayName || 'there';
  // The agent's own properties plus teammates' (never the same id twice), narrowed by the
  // All / Mine / Team switch. Teammate rows are read-only copies; ownership is untouched.
  const isActiveP = (p) => p.archived !== true && p.hidden !== true;
  // Sold is a distinct reason for being archived — kept separate from the
  // general Archive tab so the two features don't overlap.
  const isSoldP = (p) => p.archived === true && p.archivedReason === 'sold' && p.hidden !== true;
  const isArchivedP = (p) => p.archived === true && p.archivedReason !== 'sold' && p.hidden !== true;
  const teamProperties = teamPropertiesFrom(teamRows, properties, user?.uid);
  const hasTeamListings = teamProperties.length > 0;
  const view = hasTeamListings ? teamView : 'mine';
  const viewProperties = listForView(view, properties, teamProperties);
  const activeProperties = viewProperties.filter(isActiveP);
  const soldProperties = viewProperties.filter(isSoldP);
  const archivedProperties = viewProperties.filter(isArchivedP);
  const stats = computeStats({
    view,
    ownActive: properties.filter(isActiveP),
    teamActive: teamProperties.filter(isActiveP),
    ownOpinions: opinionsCount,
    teamAll: teamProperties,
  });
  const tabFilter = activeTab === 'sold' ? isSoldP : activeTab === 'archived' ? isArchivedP : isActiveP;
  const viewCounts = {
    mine: properties.filter(tabFilter).length,
    team: teamProperties.filter(tabFilter).length,
  };
  const currentTabProperties = activeTab === 'sold' ? soldProperties : activeTab === 'archived' ? archivedProperties : activeProperties;
  const agentFilteredProperties = filterAgentId
    ? currentTabProperties.filter(p => p.agentId === filterAgentId)
    : currentTabProperties;
  const displayProperties = agentFilteredProperties;

  return (
    <div className="min-h-screen bg-[#faf9f7] text-stone-900">
      <Sidebar
        active={activeTab}
        onNavigate={setActiveTab}
        onSignOut={handleSignOut}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        userName={userName}
        userData={userData}
      />

      {/* Main Content */}
      <div className="lg:pl-64">
        {/* Mobile Header */}
        <div className="sticky top-0 z-20 bg-[#fdfcfb]/95 backdrop-blur border-b border-stone-200 lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-stone-100 rounded-md" aria-label="Open menu">
              <Menu className="w-5 h-5 text-stone-700" strokeWidth={1.5} />
            </button>
            <span className="font-serif text-lg text-stone-900">Dashboard</span>
            <Link href="/dashboard/add" className="p-2 hover:bg-stone-100 rounded-md" aria-label="Add property">
              <Plus className="w-5 h-5 text-[#e38100]" strokeWidth={2} />
            </Link>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10 py-7 sm:py-10 space-y-8">
          {/* Office-linked agents are onboarded by their office: no
              billing-details prompt or "invoicing is activated"
              announcement. Display-only — billing itself is untouched. */}
          {!userData?.officeId && (
            <>
              <BillingAnnouncementBanner
                userData={userData}
                onAcknowledged={(announcementId) => {
                  setUserData((prev) => ({
                    ...prev,
                    acknowledgedAnnouncements: { ...(prev?.acknowledgedAnnouncements || {}), [announcementId]: true },
                  }));
                }}
              />
              <BillingContactPrompt />
            </>
          )}

          {/* Page Header */}
          <div className="flex items-end justify-between gap-6 pb-7 border-b border-stone-200">
            <div className="min-w-0">
              {/* Mobile greeting: profile photo + first name, office underneath.
                  Desktop keeps the existing text greeting below (its sidebar already shows the photo). */}
              {activeTab !== 'archived' && activeTab !== 'sold' && (
                <AgentGreeting
                  userData={userData}
                  officeName={greetingOfficeBrand.brand?.name || null}
                  officeStatus={greetingOfficeBrand.status}
                  className="sm:hidden mb-6"
                />
              )}
              <h1 className="font-serif text-3xl sm:text-4xl leading-tight text-stone-900">
                {activeTab === 'archived' ? 'Archived Properties' : activeTab === 'sold' ? 'Sold Properties' : 'Dashboard'}
              </h1>
              <p className={`text-sm text-stone-500 mt-2 ${activeTab === 'archived' || activeTab === 'sold' ? '' : 'hidden sm:block'}`}>
                {activeTab === 'archived'
                  ? `${archivedProperties.length} ${archivedProperties.length === 1 ? 'property' : 'properties'}`
                  : activeTab === 'sold'
                  ? `${soldProperties.length} ${soldProperties.length === 1 ? 'property' : 'properties'}`
                  : <span>
                      Welcome back, {userName}
                      {!userData?.officeId && !userData?.companyName && (
                        <> · <Link href="/dashboard/settings" className="text-[#c64500] hover:text-[#a63a00] font-medium">Add Agency Details</Link></>
                      )}
                    </span>}
              </p>
            </div>
            <Link
              href="/dashboard/add"
              className="add-property-pulse hidden sm:inline-flex shrink-0 items-center gap-2 px-6 py-3 bg-[#e38100] hover:bg-[#cc7400] text-white text-sm font-semibold tracking-wide rounded-md transition-colors"
            >
              <Plus className="w-4 h-4" strokeWidth={1.75} />
              Add Property
            </Link>
          </div>

          {officeJoinedBanner && (
            <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-emerald-800 font-semibold">You've joined {officeJoinedBanner}</p>
                <p className="text-xs text-emerald-700 mt-0.5">Their branding now applies to your campaigns, unless you set your own.</p>
              </div>
              <button onClick={() => setOfficeJoinedBanner(null)} className="text-emerald-600 hover:text-emerald-800 text-xs font-semibold shrink-0">
                Dismiss
              </button>
            </div>
          )}

          {/* Agent Filter */}
          {teamAgents.length > 0 && (
            <div className="flex items-center gap-3">
              <select
                value={filterAgentId}
                onChange={(e) => setFilterAgentId(e.target.value)}
                className="px-3 py-2 rounded-md border border-stone-300 text-sm text-stone-700 bg-white focus:outline-none focus:ring-1 focus:ring-stone-900 focus:border-stone-900"
              >
                <option value="">All agents</option>
                {teamAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Team portfolio switch — only when teammates have listings to show */}
          {hasTeamListings && (
            <div className="flex items-center gap-1 -mt-2" role="tablist" aria-label="Property view">
              {[
                ['all', 'All', viewCounts.mine + viewCounts.team],
                ['mine', 'Mine', viewCounts.mine],
                ['team', 'Team', viewCounts.team],
              ].map(([id, label, count]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={view === id}
                  onClick={() => setTeamView(id)}
                  className={`px-3 py-1.5 text-[13px] tracking-wide rounded-md transition-colors ${
                    view === id ? 'bg-stone-900 text-white' : 'text-stone-500 hover:text-stone-900 hover:bg-stone-100/70'
                  }`}
                >
                  {label} <span className={view === id ? 'text-stone-300' : 'text-stone-400'}>{count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Overview Stats */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-stone-200 border border-stone-200 rounded-md overflow-hidden">
              <StatCard label="Total Properties" value={propertiesLoading ? '...' : stats.properties} />
              <StatCard label="Public Listings" value={propertiesLoading ? '...' : stats.live} />
              <StatCard label="Total Views" value={propertiesLoading ? '...' : stats.views} />
              <StatCard label="Buyer Opinions" value={propertiesLoading ? '...' : stats.opinions} />
            </div>
          )}

          {/* Agency Branding Nudge (overview only) — independent agents
              only. An office agent inherits branding through officeId
              (see resolveBrandIdForUser) and never has their own
              agencyBrandId set at all, by design — showing this same
              "upload YOUR agency logo" nudge to them would be both
              wrong (they already have branding, via their office) and
              misleading about what action it would even take (their
              own /dashboard/branding page only ever lets them set a
              PERSONAL override there, never the office's shared
              default). Office agents get ProfilePhotoPrompt instead. */}
          {activeTab === 'overview' && !brandingNudgeDismissed && userData && (userData.isAgent || userData.agent) && (
            userData.officeId ? (
              isPlaceholderAvatar(userData.avatar) && (
                <ProfilePhotoPrompt onDismiss={dismissBrandingNudge} />
              )
            ) : (
              !userData.agencyBrandId && (
                <BrandingNudge hasLogo={!!userData.logoUrl} onDismiss={dismissBrandingNudge} />
              )
            )
          )}

          {/* Mobile Number Confirmation Prompt (overview only) */}
          {activeTab === 'overview' && user && shouldShowMobilePrompt(userData) && (
            <MobileNumberPrompt
              userData={userData}
              uid={user.uid}
              onConfirmed={(patch) => setUserData({ ...userData, ...patch })}
            />
          )}

          {/* Quick Actions (overview only) — phones only: from tablet up the same
              link lives in the page header and the sidebar. */}
          {activeTab === 'overview' && !propertiesLoading && properties.length > 0 && (
            <Link
              href="/dashboard/add"
              className="sm:hidden bg-white rounded-md border border-stone-200 px-5 py-4 flex items-center gap-4 hover:border-stone-300 transition-colors group"
            >
              <Plus className="w-5 h-5 text-[#e38100]" strokeWidth={1.5} />
              <div className="flex-1">
                <p className="text-sm font-medium text-stone-900">Add Property</p>
                <p className="text-xs text-stone-500">List a new property for your client</p>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-300" strokeWidth={1.5} />
            </Link>
          )}

          {/* Properties Grid */}
          {propertiesLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#c64500] border-t-transparent" />
            </div>
          ) : activeTab !== 'archived' && activeTab !== 'sold' && properties.length === 0 && !hasTeamListings ? (
            <EmptyState />
          ) : displayProperties.length === 0 ? (
            <div className="bg-white rounded-md border border-stone-200 px-6 py-16 text-center">
              {activeTab === 'sold' ? (
                <>
                  <CheckCircle className="w-8 h-8 text-stone-300 mx-auto mb-4" strokeWidth={1.25} />
                  <p className="text-sm text-stone-500">No sold properties yet</p>
                </>
              ) : activeTab === 'overview' ? (
                <p className="text-sm text-stone-500">No properties in this view</p>
              ) : (
                <>
                  <Archive className="w-8 h-8 text-stone-300 mx-auto mb-4" strokeWidth={1.25} />
                  <p className="text-sm text-stone-500">No archived properties</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
              {displayProperties.map(property => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  onToggleVisibility={toggleVisibility}
                  toggling={toggling}
                  onArchive={(activeTab === 'archived' || activeTab === 'sold') ? unarchiveProperty : archiveProperty}
                  archiving={archiving}
                  isArchived={property.archived === true}
                  isSold={property.archivedReason === 'sold'}
                  onHide={handleHideProperty}
                  teamAgents={teamAgents}
                  showListedBy={hasTeamListings}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Logo Upload Modal */}
      <AnimatePresence>
        {showLogoModal && (
          <LogoUploadModal
            show={showLogoModal}
            onClose={() => setShowLogoModal(false)}
            user={user}
            userData={userData}
            setUserData={setUserData}
          />
        )}
      </AnimatePresence>

      {/* Logo Nudge */}
      <AnimatePresence>
        {(userData?.isAgent || userData?.agent) && !userData?.officeId && !userData?.logoUrl && !showLogoModal && (
          <LogoNudge onClick={() => setShowLogoModal(true)} />
        )}
      </AnimatePresence>

      {/* Success Modal */}
      <AnimatePresence>
        {successModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setSuccessModal(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#faf9f7] rounded-md border border-stone-200 shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="px-8 pt-9 pb-2 text-center">
                <div className="mx-auto mb-5 h-px w-10 bg-[#e38100]" aria-hidden="true" />
                <CheckCircle className="w-7 h-7 text-[#e38100] mx-auto mb-3" />
                <h2 className="font-serif text-2xl text-stone-900">
                  {successModal === 'created' ? 'Property created' : 'Changes saved'}
                </h2>
              </div>

              <div className="px-8 py-6 space-y-4">
                <div className="flex items-start gap-3 border-t border-stone-200 pt-5">
                  <Upload className="w-4 h-4 text-stone-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-stone-900">Media uploading in the background</p>
                    <p className="text-xs text-stone-500 mt-1 leading-relaxed">Your photos and video are being uploaded. This may take a minute depending on file sizes. You can keep using the dashboard while this happens.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 border-t border-stone-200 pt-5">
                  <Eye className="w-4 h-4 text-stone-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-stone-900">Your listing is set to Private</p>
                    <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                      {successModal === 'created'
                        ? 'New listings start as private so you can review everything first. When you\'re ready for buyers to see it, tap the'
                        : 'Your listing is currently private. To make it visible to buyers, tap the'
                      }
                      {' '}<span className="font-medium text-stone-900">Set Public</span> button on your property card.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setSuccessModal(null)}
                  className="w-full mt-2 py-3 bg-[#e38100] hover:bg-[#cc7400] text-white text-sm font-medium tracking-wide rounded-md transition-colors"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
