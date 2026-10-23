'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { authFetch } from '../../utils/authFetch';
import { db } from '../../firebase/clientApp';
import { collection, doc, getDoc, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import PropertyPageClient from '../../components/PropertyPageClient';
import { Upload, Loader2, UserPlus, RotateCcw, Trash2, Users, AlertCircle } from 'lucide-react';

const STATUS_LABEL = {
  active: { text: 'Active', className: 'bg-emerald-100 text-emerald-700' },
  invited: { text: 'Invited', className: 'bg-amber-100 text-amber-700' },
  'pending-acceptance': { text: 'Invited (existing account)', className: 'bg-amber-100 text-amber-700' },
  staged: { text: 'Pending Invitation', className: 'bg-indigo-100 text-indigo-700' },
  sending: { text: 'Sending…', className: 'bg-slate-100 text-slate-600' },
  'send-failed': { text: 'Send failed', className: 'bg-red-100 text-red-700' },
};

/** Plain-English labels for how the CSV validator classified each row. */
const IMPORT_ROW_LABEL = {
  new: { text: 'New account', ok: true },
  'existing-account': { text: 'Existing Premarket user — will get a join invitation', ok: true },
  'already-active-member': { text: 'Already an active member — skipped', ok: false },
  'already-invited': { text: 'Already invited — skipped', ok: false },
  'already-staged': { text: 'Already staged — skipped', ok: false },
  'in-other-office': { text: 'Belongs to another office — skipped', ok: false },
  'duplicate-in-csv': { text: 'Duplicate email in this file — skipped', ok: false },
  invalid: { text: 'Invalid', ok: false },
};

/** 'warning' is distinct from 'error' on purpose — it means the
 * underlying record (agent/invite) WAS created, only the email failed
 * to send, which is a different, less alarming fact than nothing
 * having happened at all. */
function messageClassName(type) {
  if (type === 'error') return 'text-red-600';
  if (type === 'warning') return 'text-amber-600';
  return 'text-emerald-600';
}

/**
 * Office Management — deliberately minimal: office details, roster
 * with status/resend/remove, add-one-agent, CSV bulk import, and a
 * small office-branding control. No analytics suite, no permission
 * matrix — every action here maps onto exactly one authorized API
 * route (see src/app/api/offices/**), each of which independently
 * re-checks that the caller actually administers THIS office.
 */
export default function OfficeManagementPage() {
  useRequireAgent();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState(null);
  const [agents, setAgents] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, invited: 0, pendingAcceptance: 0 });
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  // `silent` (true for every refresh AFTER the first) skips the
  // top-level loading flag — without this, every action on this page
  // (add agent, resend, CSV import, AND saving office branding) briefly
  // unmounted this entire page down to a spinner and back, which reset
  // every child card's own local state to its initial defaults in the
  // process. That's the actual root cause behind "Save Office Branding
  // resets the primary colour to Premarket orange" — OfficeBrandingCard
  // was getting fully remounted by its own save succeeding.
  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      // Only a successful response whose body says `office: null` means
      // "no office". Any failure (auth not ready, 401/500, network) is
      // retried once and then surfaced as an error — it must NEVER fall
      // through to the "Set Up Your Office" form.
      let officeBody = null;
      for (let attempt = 0; attempt < 2 && !officeBody; attempt++) {
        try {
          const officeRes = await authFetch('/api/offices/mine');
          if (officeRes.ok) {
            const body = await officeRes.json();
            if (body && body.office !== undefined) officeBody = body;
          }
        } catch { /* retried below, then reported */ }
      }
      if (!officeBody) throw new Error('office-load-failed');
      setLoadFailed(false);
      setOffice(officeBody.office);

      if (officeBody.office?.isOfficeAdmin) {
        const agentsRes = await authFetch(`/api/offices/${officeBody.office.id}/agents`);
        if (agentsRes.ok) {
          const agentsBody = await agentsRes.json();
          setAgents(agentsBody.agents);
          setStats(agentsBody.stats);
        } else {
          // Keep whatever roster is already showing rather than
          // presenting a failed load as an empty/shrunken roster.
          setError('Could not load your agent roster. Showing the last loaded list — please retry.');
        }
      }
    } catch (err) {
      if (silent) setError('Failed to refresh office details');
      else setLoadFailed(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => loadAll(true), [loadAll]);

  // Wait for Firebase Auth to finish initializing: authFetch throws
  // while auth.currentUser is still null on a hard refresh.
  const uid = user?.uid;
  useEffect(() => {
    if (authLoading || !uid) return;
    loadAll();
  }, [authLoading, uid, loadAll]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 text-center">
        <div>
          <p className="text-slate-700 mb-4">We couldn't load your office right now. Your office and agents are safe — please try again.</p>
          <button onClick={() => loadAll()} className="px-5 py-2.5 rounded-lg bg-orange-500 text-white font-semibold">Retry</button>
        </div>
      </div>
    );
  }

  if (!office) {
    return <CreateOfficeCard onCreated={loadAll} />;
  }

  if (!office.isOfficeAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 text-center">
        <p className="text-slate-500">
          You're a member of <strong>{office.name}</strong>, but only office administrators can manage it.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{office.name}</h1>
          <p className="text-sm text-slate-500 mt-1">Office Management</p>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <StatsRow stats={stats} />
        <OfficeBrandingCard officeId={office.id} agencyBrandId={office.agencyBrandId} onSaved={refresh} />
        <AddAgentCard officeId={office.id} onAdded={refresh} />
        <CsvImportCard officeId={office.id} onImported={refresh} />
        <StagedInvitationsCard officeId={office.id} agents={agents} onChanged={refresh} />
        <RosterTable officeId={office.id} agents={agents} onChanged={refresh} />
      </div>
    </div>
  );
}

/**
 * Shown to any signed-in agent with no office yet — including, most
 * importantly, someone whose office signup DID create their Firebase
 * Auth account + profile but then failed on the actual office-creation
 * call (see join/page.js's handleOfficeSubmit). That failure redirects
 * here rather than leaving them stuck on the signup form, and this
 * card is the one-click retry: same /api/offices call, same
 * collision handling, safe to submit again. `pendingOfficeName`
 * (sessionStorage) just saves them re-typing it — it's a convenience,
 * not a requirement, and is cleared once the call succeeds.
 */
function CreateOfficeCard({ onCreated }) {
  const { refreshUserData } = useAuth();
  const [name, setName] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('pendingOfficeName');
      if (pending) {
        setName(pending);
        setRecovering(true);
      }
    } catch { /* sessionStorage unavailable — just show the blank form */ }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await authFetch('/api/offices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to create office');
      try { sessionStorage.removeItem('pendingOfficeName'); } catch { /* ignore */ }
      if (body.status === 'exists') {
        setError(`An office named "${body.officeName}" already exists. We've filed a request for that office's administrators to review.`);
        return;
      }
      // Office exists now; if the refresh fails, a full page load
      // re-reads userData instead of leaving the sidebar stale.
      if (!(await refreshUserData())) {
        window.location.assign('/dashboard/office');
        return;
      }
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full">
        {recovering && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            Your account was created, but office setup didn't finish. Confirm your office name below to finish setting up.
          </p>
        )}
        <h1 className="font-semibold text-slate-900 mb-1">Set Up Your Office</h1>
        <p className="text-sm text-slate-500 mb-4">You'll become this office's initial administrator.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Office name"
            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold text-sm disabled:opacity-50"
          >
            {submitting ? 'Setting up…' : 'Create Office'}
          </button>
        </form>
      </div>
    </div>
  );
}

function StatsRow({ stats }) {
  const items = [
    { label: 'Total Agents', value: stats.total },
    { label: 'Activated', value: stats.active },
    { label: 'Invited', value: stats.invited + stats.pendingAcceptance },
    { label: 'Pending Invitation', value: (stats.staged || 0) + (stats.sendFailed || 0) },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {items.map((item) => (
        <div key={item.label} className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-slate-900">{item.value}</p>
          <p className="text-xs text-slate-500 mt-1">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Office Branding — pastes-a-URL version of the exact same reusable
 * extraction/preview pieces the personal branding page
 * (dashboard/branding/page.js) already uses: the same
 * /api/branding/extract-colors endpoint (now hardened against SSRF —
 * see safeExternalFetch.js — since this is a NEW caller of it), and
 * the same PropertyPageClient + previewBrand live-preview pattern.
 * Nothing is persisted until "Save Office Branding" is clicked —
 * everything above that is local state / a read-only preview.
 */
function OfficeBrandingCard({ officeId, agencyBrandId, onSaved }) {
  const { user } = useAuth();
  const hasBrand = !!agencyBrandId;
  const [logoUrl, setLogoUrl] = useState('');
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [primary, setPrimary] = useState('#e48900');
  const [secondary, setSecondary] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loadedBrandOnce, setLoadedBrandOnce] = useState(false);

  const [previewProperty, setPreviewProperty] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  // Pre-fills from whatever is ALREADY persisted (agencyBrands is
  // public-read, same as PropertyPageClient/the personal branding page
  // already rely on) — this is the fix for branding not surviving a
  // refresh/re-login: without it, this card always started from the
  // hardcoded default colour, never what was actually saved. Runs once
  // per distinct brand id, not on every render, so it never clobbers
  // whatever the admin is actively typing.
  useEffect(() => {
    if (!agencyBrandId || loadedBrandOnce) return;
    setLoadedBrandOnce(true);
    (async () => {
      try {
        const brandDoc = await getDoc(doc(db, 'agencyBrands', agencyBrandId));
        if (brandDoc.exists()) {
          const brand = brandDoc.data();
          if (brand.colors?.primary) {
            setPrimary(brand.colors.primary);
            setSecondary(brand.colors.secondary || '');
          }
          if (brand.logoUrl) setLogoUrl(brand.logoUrl);
        }
      } catch (err) {
        console.error('Failed to load existing office branding:', err);
      }
    })();
  }, [agencyBrandId, loadedBrandOnce]);

  // Load one of the office admin's own properties to preview against —
  // read-only, same pattern as the personal branding page.
  useEffect(() => {
    if (!user) return;
    const fetchPreviewProperty = async () => {
      setPreviewLoading(true);
      try {
        const q = query(collection(db, 'properties'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) setPreviewProperty({ id: snap.docs[0].id, ...snap.docs[0].data() });
      } catch (err) {
        console.error('Failed to load a property to preview against:', err);
      } finally {
        setPreviewLoading(false);
      }
    };
    fetchPreviewProperty();
  }, [user]);

  // Debounced auto-extraction: fires ~600ms after the pasted/typed URL
  // settles, so a paste doesn't trigger a server call per keystroke.
  // Reuses /api/branding/extract-colors exactly as-is — no second,
  // competing extraction path.
  const extractTimerRef = useRef(null);
  useEffect(() => {
    setLogoLoadFailed(false);
    setExtractionMessage('');
    if (extractTimerRef.current) clearTimeout(extractTimerRef.current);
    const trimmed = logoUrl.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) return;

    extractTimerRef.current = setTimeout(async () => {
      setExtracting(true);
      try {
        const res = await authFetch('/api/branding/extract-colors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logoUrl: trimmed }),
        });
        const body = await res.json();
        if (!res.ok) {
          setExtractionMessage(body.error || 'Could not load this logo — double check the URL.');
          return;
        }
        if (body.usable) {
          setPrimary(body.primary.hex);
          setSecondary(body.secondary?.hex || '');
        } else {
          setExtractionMessage(body.message || "Couldn't confidently pick colours from this logo — choose them manually below.");
        }
      } catch (err) {
        setExtractionMessage('Something went wrong analysing this logo — you can still pick colours manually.');
      } finally {
        setExtracting(false);
      }
    }, 600);

    return () => clearTimeout(extractTimerRef.current);
  }, [logoUrl]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await authFetch(`/api/offices/${officeId}/branding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoUrl: logoUrl.trim() || undefined, primary, secondary: secondary || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save branding');
      // Sync straight from what the server actually persisted (it may
      // have joined an existing colliding brand instead of creating a
      // new one — see createBrand's race handling) rather than just
      // trusting the locally-typed values are what's now live.
      if (body.colors?.primary) {
        setPrimary(body.colors.primary);
        setSecondary(body.colors.secondary || '');
      }
      setSaved(true);
      onSaved();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const trimmedLogoUrl = logoUrl.trim();
  const proposedBrand = primary
    ? {
        logoUrl: trimmedLogoUrl && !logoLoadFailed ? trimmedLogoUrl : null,
        colors: { primary, primaryDark: primary, secondary: secondary || undefined, primaryText: '#ffffff' },
      }
    : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-900 mb-1">Office Branding</h2>
      <p className="text-sm text-slate-500 mb-4">
        {hasBrand
          ? 'Your office already has a shared brand. Saving here updates it for every member.'
          : "Set this once — every agent in your office inherits it automatically, unless they set their own personal override."}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Logo URL</label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400"
            />
            {trimmedLogoUrl && (
              <div className="mt-2 flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                  {logoLoadFailed ? (
                    <AlertCircle className="w-5 h-5 text-slate-300" />
                  ) : (
                    // Plain <img> — browsers render cross-origin images fine for
                    // display regardless of CORS (CORS only restricts pixel/canvas
                    // access, which this never needs); onError catches a genuinely
                    // broken/unreachable URL.
                    <img
                      src={trimmedLogoUrl}
                      alt="Logo preview"
                      className="w-full h-full object-contain"
                      onLoad={() => setLogoLoadFailed(false)}
                      onError={() => setLogoLoadFailed(true)}
                    />
                  )}
                </div>
                <div className="text-xs">
                  {extracting ? (
                    <span className="flex items-center gap-1.5 text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing colours…</span>
                  ) : logoLoadFailed ? (
                    <span className="text-red-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Couldn't load this image — check the URL</span>
                  ) : extractionMessage ? (
                    <span className="text-amber-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {extractionMessage}</span>
                  ) : (
                    <span className="text-emerald-600">Colours updated below — adjust manually if needed</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Primary Colour</label>
              <div className="flex items-center gap-2">
                <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="w-9 h-9 rounded-lg border border-slate-200" />
                <input type="text" value={primary} onChange={(e) => setPrimary(e.target.value)} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-900" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Secondary Colour (optional)</label>
              <div className="flex items-center gap-2">
                <input type="color" value={secondary || '#ffffff'} onChange={(e) => setSecondary(e.target.value)} className="w-9 h-9 rounded-lg border border-slate-200" />
                <input type="text" value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="optional" className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-900 placeholder:text-slate-400" />
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-400">This is only a preview. Nothing changes until you save below.</p>
          {saveError && <p className="text-red-600 text-sm">{saveError}</p>}
          {saved && <p className="text-emerald-600 text-sm">Office branding saved.</p>}
          <button
            onClick={handleSave}
            disabled={saving || !primary}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Office Branding'}
          </button>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600">Live preview — exactly what buyers will see</p>
          </div>
          <div className="h-[420px] overflow-y-auto">
            {previewLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-4 border-orange-500" />
              </div>
            ) : previewProperty ? (
              <PropertyPageClient previewPropertyId={previewProperty.id} previewBrand={proposedBrand} />
            ) : (
              <div className="h-full flex items-center justify-center text-center px-6">
                <p className="text-xs text-slate-400">Add a property to your own account first to see a live preview here.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddAgentCard({ officeId, onAdded }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await authFetch(`/api/offices/${officeId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to add agent');
      // The agent record/invite is created the moment the server
      // responds success — that part never failed. Whether the EMAIL
      // itself went out is a separate fact (see processOneRow's
      // emailSent), and must be reported as such rather than folded
      // into one blanket "sent" message that could be wrong.
      if (body.emailSent === false) {
        setMessage({
          type: 'warning',
          text: `${name} was added to the roster, but the invitation email failed to send${body.emailError ? `: ${body.emailError}` : ''}. Use Resend below once it's set up correctly.`,
        });
      } else {
        setMessage({ type: 'success', text: `Invitation sent to ${email}.` });
      }
      setName('');
      setEmail('');
      setPhone('');
      onAdded();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <UserPlus className="w-4 h-4" /> Add an Agent
      </h2>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="sm:col-span-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400" />
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="sm:col-span-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400" />
        <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="sm:col-span-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400" />
        <button type="submit" disabled={submitting} className="sm:col-span-1 px-4 py-2.5 rounded-lg bg-slate-900 text-white font-semibold text-sm disabled:opacity-50">
          {submitting ? 'Adding…' : 'Add Agent'}
        </button>
      </form>
      {message && (
        <p className={`text-sm mt-3 ${messageClassName(message.type)}`}>{message.text}</p>
      )}
    </div>
  );
}

function CsvImportCard({ officeId, onImported }) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null); // { importId, rows, summary }
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError('');
    setPreview(null);
    setResult(null);
    try {
      const res = await authFetch(`/api/offices/${officeId}/import/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to preview import');
      setPreview(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const eligibleCount = preview ? preview.rows.filter((r) => IMPORT_ROW_LABEL[r.previewStatus]?.ok).length : 0;

  // Staging only SAVES the validated list. No accounts are created and no emails are sent.
  const handleStage = async () => {
    setCommitting(true);
    setError('');
    try {
      const res = await authFetch(`/api/offices/${officeId}/import/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: preview.importId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to stage agents');
      setResult({ staged: body.staged });
      setPreview(null);
      setCsvText('');
      setFileName('');
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
        <Upload className="w-4 h-4" /> Bulk Import via CSV
      </h2>
      <p className="text-sm text-slate-500 mb-4">Columns: name, email, phone. A header row is optional.</p>

      <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-orange-400 transition-colors">
        <Upload className="w-5 h-5 text-slate-400" />
        <span className="text-sm text-slate-500">{fileName || 'Click to choose a CSV file'}</span>
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      </label>

      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

      {csvText && !preview && (
        <button onClick={handlePreview} disabled={previewing} className="mt-4 px-5 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm disabled:opacity-50">
          {previewing ? (
            <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Validating…</span>
          ) : 'Preview Import'}
        </button>
      )}

      {preview && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2 text-xs flex-wrap">
            {Object.entries(preview.summary).map(([status, count]) => (
              <span key={status} className={`px-2.5 py-1 rounded-full font-medium ${IMPORT_ROW_LABEL[status]?.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {(IMPORT_ROW_LABEL[status]?.text || status).split(' — ')[0]}: {count}
              </span>
            ))}
          </div>
          <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">What will happen</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const info = IMPORT_ROW_LABEL[row.previewStatus];
                  return (
                    <tr key={row.rowIndex} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{row.name}</td>
                      <td className="px-3 py-2 text-slate-700">{row.email}</td>
                      <td className={`px-3 py-2 ${info?.ok ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {info?.text || row.previewStatus}{row.invalidReason ? ` — ${row.invalidReason}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Staging saves this list only. <strong>No emails are sent</strong> until you press “Send All Invitations”.</p>
          <div className="flex gap-3">
            <button onClick={handleStage} disabled={committing || eligibleCount === 0} className="px-5 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm disabled:opacity-50">
              {committing ? 'Staging…' : `Stage ${eligibleCount} agent${eligibleCount === 1 ? '' : 's'} (no emails sent)`}
            </button>
            <button onClick={() => { setPreview(null); setCsvText(''); setFileName(''); }} className="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className="mt-4 text-sm font-semibold text-emerald-700">
          {result.staged} agent{result.staged === 1 ? '' : 's'} staged with “Pending Invitation”. Review them below, then press “Send All Invitations”.
        </p>
      )}
    </div>
  );
}

/**
 * Sends staged invitations only after an explicit confirmation. Works in short server chunks
 * (the page loops), so 50+ agents never hit a request timeout. "Send All" never touches failed
 * rows; "Retry failed" never touches successful ones.
 */
function StagedInvitationsCard({ officeId, agents, onChanged }) {
  const staged = agents.filter((a) => a.status === 'staged').length;
  const failed = agents.filter((a) => a.status === 'send-failed').length;
  const [confirm, setConfirm] = useState(null); // { mode, count }
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState(null);

  const run = async (mode, total) => {
    setConfirm(null);
    setBusy(true);
    setMessage(null);
    const totals = { sent: 0, failed: 0, skipped: 0 };
    setProgress({ done: 0, total });
    try {
      for (let guard = 0; guard < 200; guard++) {
        const res = await authFetch(`/api/offices/${officeId}/import/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to send invitations');
        totals.sent += body.sent; totals.failed += body.failed; totals.skipped += body.skipped || 0;
        setProgress({ done: totals.sent + totals.failed, total });
        if (body.processed === 0 || body.remaining === 0) break;
      }
      setMessage({
        type: totals.failed ? 'warning' : 'success',
        text: `${totals.sent} invitation${totals.sent === 1 ? '' : 's'} sent${totals.failed ? `, ${totals.failed} failed — use “Retry failed” (successful ones are never resent)` : ''}${totals.skipped ? `, ${totals.skipped} skipped (already in another office)` : ''}.`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: `${err.message}. Nothing is lost — press the button again to continue; agents already invited will not be emailed twice.` });
    } finally {
      setBusy(false);
      setProgress(null);
      onChanged();
    }
  };

  if (staged === 0 && failed === 0 && !message) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-900 mb-1">Invitations</h2>
      <p className="text-sm text-slate-500 mb-4">
        {staged > 0
          ? `${staged} agent${staged === 1 ? ' is' : 's are'} staged and have not been emailed yet.`
          : failed > 0 ? `${failed} invitation${failed === 1 ? '' : 's'} could not be sent.` : 'All staged invitations have been processed.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {staged > 0 && (
          <button
            onClick={() => setConfirm({ mode: 'new', count: staged })}
            disabled={busy}
            className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 disabled:opacity-50"
          >
            Send All Invitations ({staged})
          </button>
        )}
        {failed > 0 && (
          <button
            onClick={() => setConfirm({ mode: 'retry', count: failed })}
            disabled={busy}
            className="px-5 py-3 rounded-xl bg-white border border-red-300 text-red-700 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
          >
            Retry failed ({failed})
          </button>
        )}
        {busy && progress && (
          <span className="text-sm text-slate-600 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Sending… {progress.done} of {progress.total}
          </span>
        )}
      </div>
      {message && <p className={`text-sm mt-3 ${messageClassName(message.type)}`}>{message.text}</p>}

      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-2">
              {confirm.mode === 'retry' ? 'Retry failed invitations?' : 'Send invitations now?'}
            </h3>
            <p className="text-sm text-slate-600 mb-5">
              {confirm.mode === 'retry'
                ? `${confirm.count} invitation email${confirm.count === 1 ? '' : 's'} that failed earlier will be sent again. Agents who were already invited will not be emailed again.`
                : `You are about to email ${confirm.count} invitation${confirm.count === 1 ? '' : 's'}. Each agent will receive an email from your office. This cannot be undone.`}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirm(null)} className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm">Cancel</button>
              <button onClick={() => run(confirm.mode, confirm.count)} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm">
                {confirm.mode === 'retry' ? `Yes, retry ${confirm.count}` : `Yes, send ${confirm.count} invitation${confirm.count === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RosterTable({ officeId, agents, onChanged }) {
  const [busyUid, setBusyUid] = useState(null);
  const [message, setMessage] = useState(null);

  const handleResend = async (uid) => {
    setBusyUid(uid);
    setMessage(null);
    try {
      const res = await authFetch(`/api/offices/${officeId}/agents/${uid}/resend`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to resend');
      if (body.emailSent === false) {
        setMessage({ type: 'warning', text: `Resend failed${body.emailError ? `: ${body.emailError}` : ''}.` });
      } else {
        setMessage({ type: 'success', text: 'Invitation resent.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusyUid(null);
    }
  };

  const handleRemove = async (uid, isPending) => {
    const confirmText = isPending
      ? 'Revoke this pending invitation? The link in their email will stop working.'
      : 'Remove this agent from the office? Their account, properties and billing are not affected.';
    if (!confirm(confirmText)) return;
    setBusyUid(uid);
    setMessage(null);
    try {
      const res = await authFetch(`/api/offices/${officeId}/agents/${uid}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to remove agent');
      onChanged();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <Users className="w-4 h-4" /> Agents ({agents.length})
      </h2>
      {message && (
        <p className={`text-sm mb-3 ${messageClassName(message.type)}`}>{message.text}</p>
      )}
      {agents.length === 0 ? (
        <p className="text-sm text-slate-400">No agents yet — add one above or import a CSV.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-left border-b border-slate-100">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const statusInfo = STATUS_LABEL[agent.status] || { text: agent.status, className: 'bg-slate-100 text-slate-600' };
                return (
                  <tr key={agent.uid || agent.key} className="border-b border-slate-50">
                    <td className="py-2.5 pr-4 text-slate-700">{agent.name || '—'}{agent.isOfficeAdmin ? ' (admin)' : ''}</td>
                    <td className="py-2.5 pr-4 text-slate-500">{agent.email || '—'}</td>
                    <td className="py-2.5 pr-4">
                      <span title={agent.error || undefined} className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>{statusInfo.text}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-right whitespace-nowrap">
                      {!agent.uid ? (
                        <span className="text-xs text-slate-400">{agent.status === 'staged' ? 'Not sent yet' : ''}</span>
                      ) : (<>
                      {agent.status !== 'active' && (
                        <button
                          onClick={() => handleResend(agent.uid)}
                          disabled={busyUid === agent.uid}
                          className="text-xs font-semibold text-orange-600 hover:text-orange-700 mr-3 inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" /> Resend
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(agent.uid, agent.status === 'pending-acceptance')}
                        disabled={busyUid === agent.uid}
                        className="text-xs font-semibold text-red-500 hover:text-red-600 inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> {agent.status === 'pending-acceptance' ? 'Revoke' : 'Remove'}
                      </button>
                      </>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
