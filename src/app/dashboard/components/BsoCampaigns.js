'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Eye, EyeOff, Archive, Send, Copy, Pencil, BarChart3, CheckCircle } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { BSO_TAB_FILTERS } from '../../utils/bsoDashboard';

/**
 * The BSO's campaigns, shown on their Dashboard (formerly the separate "My Campaigns" page). Everything comes from
 * GET /api/bso/campaigns, which the server limits to the campaigns this BSO manages (managedByUid, whoever uploaded
 * them) plus any they own. Every action goes through the same server routes and permission checks as before.
 */

// Last role the server confirmed for this user on this device: a display hint only (which layout to hold while the
// answer is on its way). The server decides every time; nothing is granted from this value.
const roleHintKey = (uid) => `premarket_dash_role:${uid}`;
export function readDashboardRoleHint(uid) { return readRoleHint(uid); }
function readRoleHint(uid) {
  if (!uid || typeof window === 'undefined') return null;
  try { const v = window.localStorage.getItem(roleHintKey(uid)); return v === 'bso' || v === 'agent' ? v : null; } catch { return null; }
}
function writeRoleHint(uid, role) {
  if (!uid || typeof window === 'undefined') return;
  try { window.localStorage.setItem(roleHintKey(uid), role); } catch { /* storage unavailable: hint only */ }
}

/**
 * BSO role and campaigns. Users with no office are never BSOs and make no request. A user this device already knows
 * as a BSO goes straight to GET /api/bso/campaigns (one request: 200 = BSO with campaigns, 403 = no longer a BSO).
 * Everyone else asks the lightweight GET /api/bso/access first and only loads campaigns if the server says BSO, so
 * regular agents and office admins never pay for the heavier campaign route. The server decides every time.
 * `role` stays 'unknown' only while that answer is pending.
 */
export function useBsoDashboard({ uid, officeId, authLoading }) {
  const [state, setState] = useState({ role: 'unknown', status: 'idle', office: null, campaigns: [] });
  const hint = useMemo(() => readRoleHint(uid), [uid]);
  const load = useCallback(async () => {
    try {
      if (hint !== 'bso') {
        const access = await authFetch('/api/bso/access');
        const body = access.ok ? await access.json() : null;
        if (body?.bso !== true) {
          writeRoleHint(uid, 'agent');
          return setState({ role: 'agent', status: 'ready', office: null, campaigns: [] });
        }
      }
      const res = await authFetch('/api/bso/campaigns');
      if (res.status === 403) {
        writeRoleHint(uid, 'agent');
        return setState({ role: 'agent', status: 'ready', office: null, campaigns: [] });
      }
      if (!res.ok) throw new Error(`campaigns ${res.status}`);
      const body = await res.json();
      writeRoleHint(uid, 'bso');
      setState({ role: 'bso', status: 'ready', office: body.office, campaigns: body.campaigns || [] });
    } catch {
      // Unknown failure: a known BSO sees the campaign error (with retry); anyone else the agent dashboard, as before.
      setState((s) => ({ ...s, role: s.role === 'bso' || hint === 'bso' ? 'bso' : 'agent', status: 'error' }));
    }
  }, [uid, hint]);
  useEffect(() => {
    if (authLoading || !uid) return;
    if (!officeId) { setState({ role: 'agent', status: 'ready', office: null, campaigns: [] }); return; }
    setState((s) => (s.status === 'idle' ? { ...s, status: 'loading' } : s));
    load();
  }, [authLoading, uid, officeId, load]);
  return { ...state, hint, reload: load };
}

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const STATUS = {
  live: ['Link live', 'bg-emerald-100 text-emerald-700'],
  hidden: ['Link hidden', 'bg-slate-100 text-slate-600'],
  archived: ['Archived', 'bg-amber-100 text-amber-700'],
  sold: ['Sold', 'bg-sky-100 text-sky-700'],
};
const OVERVIEW_FILTERS = [['active', 'All'], ['live', 'Link live'], ['hidden', 'Link hidden']];
const ALL = '__all__';
const buyerLink = (id) => `${typeof window !== 'undefined' ? window.location.origin : 'https://premarket.homes'}/find-property?propertyId=${encodeURIComponent(id)}`;
const btn = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold';

export function BsoCampaignList({ campaigns, tab = 'overview', onChanged }) {
  const [agentKey, setAgentKey] = useState(ALL);
  const [filter, setFilter] = useState('active');
  const [notice, setNotice] = useState('');
  const inTab = useMemo(() => campaigns.filter(BSO_TAB_FILTERS[tab] || BSO_TAB_FILTERS.overview), [campaigns, tab]);

  // The agent dropdown is built from the campaigns themselves: no team or agent list to maintain.
  const agents = useMemo(() => {
    const m = new Map();
    for (const c of inTab) {
      const k = c.sellingAgent?.key || 'unknown';
      const row = m.get(k) || { key: k, name: c.sellingAgent?.name || 'Agent not set', count: 0 };
      row.count += 1;
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [inTab]);

  const shown = useMemo(() => inTab.filter((c) => {
    if (agentKey !== ALL && (c.sellingAgent?.key || 'unknown') !== agentKey) return false;
    if (tab === 'overview' && filter === 'live') return c.visibility;
    if (tab === 'overview' && filter === 'hidden') return !c.visibility;
    return true;
  }), [inTab, agentKey, filter, tab]);

  const act = async (c, action, okMsg) => {
    setNotice('');
    const res = await authFetch(`/api/properties/${c.id}/managed`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setNotice(body.error || 'That change could not be saved.');
    setNotice(okMsg); onChanged?.();
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

  const emptyText = tab === 'sold' ? 'No sold campaigns yet' : tab === 'archived' ? 'No archived campaigns' : 'No campaigns match.';
  return (
    <div data-testid="bso-campaigns">
      {notice && <p className="mb-3 text-sm text-slate-600 break-all" role="status">{notice}</p>}
      {inTab.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label htmlFor="agent-filter" className="text-sm font-semibold text-slate-700 shrink-0">Filter by agent</label>
          <select id="agent-filter" value={agentKey} onChange={(e) => setAgentKey(e.target.value)}
            className="w-full sm:w-72 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-200">
            <option value={ALL}>All Agents</option>
            {agents.map((a) => <option key={a.key} value={a.key}>{a.name} ({a.count})</option>)}
          </select>
        </div>
      )}
      {tab === 'overview' && inTab.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {OVERVIEW_FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border ${filter === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>
      )}

      <ul className="mt-4 space-y-2" aria-label="Campaigns">
        {shown.length === 0 && (
          <li className="bg-white rounded-md border border-stone-200 px-6 py-16 text-center">
            {tab === 'sold' && <CheckCircle className="w-8 h-8 text-stone-300 mx-auto mb-4" strokeWidth={1.25} />}
            {tab === 'archived' && <Archive className="w-8 h-8 text-stone-300 mx-auto mb-4" strokeWidth={1.25} />}
            <p className="text-sm text-stone-500">{emptyText}</p>
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
                  <p className="text-sm text-slate-600 truncate" data-testid="bso-campaign-agent">
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
  );
}
