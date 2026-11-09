'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Plus, ExternalLink, Eye, EyeOff, Archive, Send, Copy, Pencil, BarChart3 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { authFetch } from '../../utils/authFetch';
import BackToDashboard from '../../components/BackToDashboard';

/**
 * BSO workspace: "My Campaigns". Everything listed here comes from GET /api/bso/campaigns, which the server limits to the
 * campaigns this BSO manages (plus any they own). The agent filter below only narrows that already-restricted list.
 */
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const STATUS = {
  live: ['Link live', 'bg-emerald-100 text-emerald-700'],
  hidden: ['Link hidden', 'bg-slate-100 text-slate-600'],
  archived: ['Archived', 'bg-amber-100 text-amber-700'],
  sold: ['Sold', 'bg-sky-100 text-sky-700'],
};
const FILTERS = [['active', 'Active'], ['live', 'Link live'], ['hidden', 'Link hidden'], ['archived', 'Archived']];
const ALL = '__all__';
const buyerLink = (id) => `${typeof window !== 'undefined' ? window.location.origin : 'https://premarket.homes'}/find-property?propertyId=${encodeURIComponent(id)}`;
const btn = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold';

function BsoInner() {
  useRequireAgent();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  const params = useSearchParams();
  const [state, setState] = useState({ status: 'loading', office: null, campaigns: [] });
  const [agentKey, setAgentKey] = useState(ALL);
  const [filter, setFilter] = useState('active');
  const [notice, setNotice] = useState(params.get('created') === '1' ? 'Campaign created. Photos may take a moment to appear.' : params.get('updated') === '1' ? 'Changes saved.' : '');

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/bso/campaigns');
      if (res.status === 403) return setState({ status: 'forbidden', office: null, campaigns: [] });
      if (!res.ok) throw new Error('campaigns');
      const body = await res.json();
      setState({ status: 'ready', office: body.office, campaigns: body.campaigns || [] });
    } catch { setState((s) => ({ ...s, status: 'error' })); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- data load on mount; same pattern as office/campaigns/page.js
  useEffect(() => { if (!authLoading && uid) load(); }, [authLoading, uid, load]);

  // The agent dropdown is built from the campaigns themselves: no team or agent list to maintain.
  const agents = useMemo(() => {
    const m = new Map();
    for (const c of state.campaigns) {
      const k = c.sellingAgent?.key || 'unknown';
      const row = m.get(k) || { key: k, name: c.sellingAgent?.name || 'Agent not set', count: 0 };
      if (!c.archived) row.count += 1;
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [state.campaigns]);

  const shown = useMemo(() => state.campaigns.filter((c) => {
    if (agentKey !== ALL && (c.sellingAgent?.key || 'unknown') !== agentKey) return false;
    if (filter === 'archived') return c.archived;
    if (c.archived) return false;
    if (filter === 'live') return c.visibility;
    if (filter === 'hidden') return !c.visibility;
    return true;
  }), [state.campaigns, agentKey, filter]);

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
    setNotice(body.sent ? `Buyer link emailed to ${c.sellingAgent?.name || 'the agent'}.` : 'The email was not sent (the agent may be unsubscribed or unreachable).');
  };
  const copyLink = async (c) => {
    const link = buyerLink(c.id);
    try { await navigator.clipboard.writeText(link); setNotice(`Buyer link copied: ${link}`); } catch { setNotice(`Copy this buyer link: ${link}`); }
  };

  if (state.status === 'loading') return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (state.status !== 'ready') {
    const msg = state.status === 'forbidden' ? 'My Campaigns is for BSOs. Ask your office administrator if you need access.' : 'We could not load your campaigns. Please try again.';
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 text-center"><div><p className="text-slate-600">{msg}</p><Link href="/dashboard" className="inline-block mt-4 text-sm font-semibold text-orange-600">Back to dashboard</Link></div></div>;
  }

  const active = state.campaigns.filter((c) => !c.archived);
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <BackToDashboard className="mb-3" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Campaigns</h1>
            <p className="text-sm text-slate-500 mt-1">{state.office?.name} · {active.length} campaigns · {active.filter((c) => c.visibility).length} with a live buyer link</p>
          </div>
          <Link href="/dashboard/add?as=bso" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"><Plus className="w-4 h-4" /> New Campaign</Link>
        </div>
        {notice && <p className="mt-3 text-sm text-slate-600 break-all" role="status">{notice}</p>}

        <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <label htmlFor="agent-filter" className="text-sm font-semibold text-slate-700 shrink-0">Filter by agent</label>
          <select id="agent-filter" value={agentKey} onChange={(e) => setAgentKey(e.target.value)}
            className="w-full sm:w-72 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-200">
            <option value={ALL}>All Agents</option>
            {agents.map((a) => <option key={a.key} value={a.key}>{a.name} ({a.count})</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border ${filter === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>

        <ul className="mt-4 space-y-2" aria-label="Campaigns">
          {shown.length === 0 && (
            <li className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500 text-center">
              {state.campaigns.length === 0 ? 'No campaigns yet. Use New Campaign to upload one for a selling agent.' : 'No campaigns match.'}
            </li>
          )}
          {shown.map((c) => {
            const [label, cls] = STATUS[c.status] || STATUS.hidden;
            return (
              <li key={c.id} data-testid="bso-campaign" className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {c.imageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={c.imageUrl} alt="" className="w-16 h-12 rounded-lg object-cover bg-slate-100 shrink-0" />
                    : <div className="w-16 h-12 rounded-lg bg-slate-100 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">
                    {c.testCampaign && <span className="mr-1.5 inline-flex px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold align-middle" title="Premarket test campaign: not billed, not counted in reporting">Test</span>}
                    {c.address || 'Untitled campaign'}
                  </p>
                    <p className="text-sm text-slate-600 truncate">
                      {c.sellingAgent?.name || 'Agent not set'}
                      {c.sellingAgent?.loginStatus === 'invited' && <span className="text-slate-400"> · not logged in yet</span>}
                    </p>
                    <p className="text-xs text-slate-400">{date(c.createdAt)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:w-28">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${cls}`}>{label}</span>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end sm:max-w-md">
                  <button onClick={() => copyLink(c)} className={`${btn} text-orange-600 hover:bg-orange-50`}><Copy className="w-3.5 h-3.5" /> Copy buyer link</button>
                  <Link href={`/find-property?propertyId=${c.id}`} target="_blank" className={`${btn} text-slate-600 hover:bg-slate-100`}><ExternalLink className="w-3.5 h-3.5" /> Open</Link>
                  <Link href={`/dashboard/edit/${c.id}`} className={`${btn} text-slate-700 border border-slate-200 hover:bg-slate-50`}><Pencil className="w-3.5 h-3.5" /> Edit</Link>
                  <Link href={`/dashboard/property/${c.id}`} className={`${btn} text-slate-700 border border-slate-200 hover:bg-slate-50`}><BarChart3 className="w-3.5 h-3.5" /> Feedback &amp; report</Link>
                  {!c.archived && (c.visibility
                    ? <button onClick={() => act(c, 'hide', 'Buyer link hidden.')} className={`${btn} text-slate-700 border border-slate-200 hover:bg-slate-50`}><EyeOff className="w-3.5 h-3.5" /> Hide</button>
                    : <button onClick={() => act(c, 'show', 'Buyer link is live.')} className={`${btn} text-slate-700 border border-slate-200 hover:bg-slate-50`}><Eye className="w-3.5 h-3.5" /> Go live</button>)}
                  {!c.archived && c.access === 'bso' && (
                    <button onClick={() => { if (window.confirm(`Email the buyer link to ${c.sellingAgent?.name || 'the agent'}?`)) resendLink(c); }} className={`${btn} text-slate-700 border border-slate-200 hover:bg-slate-50`}><Send className="w-3.5 h-3.5" /> Email link to agent</button>
                  )}
                  {!c.archived && (
                    <button onClick={() => { if (window.confirm('Archive this campaign? Its buyer link will stop working.')) act(c, 'archive', 'Campaign archived.'); }} className={`${btn} text-slate-500 hover:bg-slate-100`}><Archive className="w-3.5 h-3.5" /> Archive</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default function BsoWorkspacePage() {
  return <Suspense fallback={null}><BsoInner /></Suspense>;
}
