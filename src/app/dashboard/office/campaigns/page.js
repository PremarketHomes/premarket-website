'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, Plus, Search, ExternalLink, Eye, EyeOff, Archive, Send } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useRequireAgent } from '../../../hooks/useRequireAgent';
import { authFetch } from '../../../utils/authFetch';
import BackToDashboard from '../../../components/BackToDashboard';

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const FILTERS = [['all', 'All'], ['live', 'Link live'], ['hidden', 'Link hidden'], ['managed', 'Created by office'], ['archived', 'Archived']];

function CampaignsInner() {
  useRequireAgent();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  const created = useSearchParams().get('created') === '1';
  const [state, setState] = useState({ status: 'loading', office: null, campaigns: [] });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState(created ? 'Campaign created and assigned.' : '');

  const load = useCallback(async () => {
    try {
      let mine = null;
      for (let i = 0; i < 2 && !mine; i++) {
        try { const r = await authFetch('/api/offices/mine'); if (r.ok) mine = await r.json(); } catch { /* retry */ }
      }
      if (!mine) throw new Error('office');
      if (!mine.office) return setState({ status: 'no-office', office: null, campaigns: [] });
      if (!mine.office.isOfficeAdmin) return setState({ status: 'not-admin', office: mine.office, campaigns: [] });
      const res = await authFetch(`/api/offices/${mine.office.id}/campaigns`);
      if (res.status === 403) return setState({ status: 'off', office: mine.office, campaigns: [] });
      if (!res.ok) throw new Error('campaigns');
      setState({ status: 'ready', office: mine.office, campaigns: (await res.json()).campaigns });
    } catch { setState((s) => ({ ...s, status: 'error' })); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- data load on mount; same pattern as office/team/page.js
  useEffect(() => { if (!authLoading && uid) load(); }, [authLoading, uid, load]);

  const act = async (c, action, okMsg) => {
    setNotice('');
    const res = await authFetch(`/api/properties/${c.id}/managed`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setNotice(body.error || 'That change could not be saved.');
    setNotice(okMsg); load();
  };

  const resendLink = async (c) => {
    setNotice('');
    const res = await authFetch(`/api/properties/${c.id}/campaign-link/resend`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setNotice(body.error || 'The link could not be sent.');
    setNotice(body.sent ? `Campaign link emailed to ${c.ownerName || 'the agent'}.` : 'The email was not sent (the agent may be unsubscribed or unreachable).');
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.campaigns.filter((c) => {
      if (q && !`${c.address || ''} ${c.ownerName || ''} ${c.ownerEmail || ''}`.toLowerCase().includes(q)) return false;
      if (filter === 'archived') return c.archived;
      if (c.archived) return false;
      if (filter === 'live') return c.visibility;
      if (filter === 'hidden') return !c.visibility;
      if (filter === 'managed') return c.managed;
      return true;
    });
  }, [state.campaigns, query, filter]);

  if (state.status === 'loading') return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (state.status !== 'ready') {
    const msg = state.status === 'off' ? 'Managed campaigns are not switched on yet.' : state.status === 'not-admin' ? 'Only office administrators can see office campaigns.' : state.status === 'no-office' ? 'You are not part of an office yet.' : 'We could not load the campaigns. Please try again.';
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 text-center"><div><p className="text-slate-600">{msg}</p><Link href="/dashboard" className="inline-block mt-4 text-sm font-semibold text-orange-600">Back to dashboard</Link></div></div>;
  }

  const active = state.campaigns.filter((c) => !c.archived);
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <BackToDashboard className="mb-3" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
            <p className="text-sm text-slate-500 mt-1">{state.office.name} · {active.length} campaigns · {active.filter((c) => c.visibility).length} with a live buyer link</p>
          </div>
          <Link href="/dashboard/add" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"><Plus className="w-4 h-4" /> Create campaign</Link>
        </div>
        {notice && <p className="mt-3 text-sm text-slate-600" role="status">{notice}</p>}

        <div className="relative mt-5">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by address or agent" aria-label="Search campaigns"
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border ${filter === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>

        <ul className="mt-4 space-y-2">
          {shown.length === 0 && <li className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500 text-center">No campaigns match.</li>}
          {shown.map((c) => (
            <li key={c.id} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {c.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={c.imageUrl} alt="" className="w-16 h-12 rounded-lg object-cover bg-slate-100 shrink-0" />
                  : <div className="w-16 h-12 rounded-lg bg-slate-100 shrink-0" />}
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{c.address || 'Untitled campaign'}</p>
                  <p className="text-sm text-slate-500 truncate">{c.ownerName || c.ownerEmail}{c.ownerLoginStatus === 'invited' && <span className="text-slate-400"> · not logged in yet</span>}</p>
                  <p className="text-xs text-slate-400">{date(c.createdAt)}{c.managed && ' · created by the office'}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 sm:w-32">
                <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${c.archived ? 'bg-amber-100 text-amber-700' : c.visibility ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {c.archived ? 'Archived' : c.visibility ? 'Link live' : 'Link hidden'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Link href={`/find-property?propertyId=${c.id}`} target="_blank" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-orange-600 hover:bg-orange-50"><ExternalLink className="w-3.5 h-3.5" /> Buyer link</Link>
                {!c.archived && (
                  <button onClick={() => { if (window.confirm(`Email the campaign link to ${c.ownerName || 'the agent'}?`)) resendLink(c); }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"><Send className="w-3.5 h-3.5" /> Email link to agent</button>
                )}
                {!c.archived && (c.visibility
                  ? <button onClick={() => act(c, 'hide', 'Buyer link hidden.')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"><EyeOff className="w-3.5 h-3.5" /> Hide</button>
                  : <button onClick={() => act(c, 'show', 'Buyer link is live.')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Eye className="w-3.5 h-3.5" /> Go live</button>)}
                {!c.archived && (
                  <button onClick={() => { if (window.confirm('Archive this campaign? Its buyer link will stop working.')) act(c, 'archive', 'Campaign archived.'); }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100"><Archive className="w-3.5 h-3.5" /> Archive</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function OfficeCampaignsPage() {
  return <Suspense fallback={null}><CampaignsInner /></Suspense>;
}
