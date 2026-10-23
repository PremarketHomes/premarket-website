'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, ExternalLink, Search, Building2, Bed, Bath, Car } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useRequireAgent } from '../../../hooks/useRequireAgent';
import { authFetch } from '../../../utils/authFetch';

const MEMBER_STATUS = {
  active: { label: 'Active', className: 'bg-emerald-100 text-emerald-700' },
  invited: { label: 'Invited', className: 'bg-amber-100 text-amber-700' },
  'pending-acceptance': { label: 'Invited (existing account)', className: 'bg-amber-100 text-amber-700' },
  staged: { label: 'Pending Invitation', className: 'bg-indigo-100 text-indigo-700' },
  sending: { label: 'Sending…', className: 'bg-slate-100 text-slate-600' },
  'send-failed': { label: 'Send failed', className: 'bg-red-100 text-red-700' },
};

const PROPERTY_STATUS = {
  live: { label: 'Live', className: 'bg-slate-900 text-white' },
  hidden: { label: 'Hidden', className: 'bg-slate-100 text-slate-600' },
  archived: { label: 'Archived', className: 'bg-amber-100 text-amber-700' },
  sold: { label: 'Sold', className: 'bg-emerald-100 text-emerald-700' },
};

const money = (n) => (typeof n === 'number' ? `$${n.toLocaleString('en-AU')}` : '—');
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Badge({ cfg }) {
  return <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${cfg.className}`}>{cfg.label}</span>;
}

function Centered({ children }) {
  return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 text-center">{children}</div>;
}

/**
 * Office Team — office administrators see every member of THEIR office and,
 * read-only, each linked member's properties. Source of truth is the existing
 * office membership system (/api/offices/*); nothing here writes anything.
 */
export default function OfficeTeamPage() {
  useRequireAgent();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;

  const [state, setState] = useState({ status: 'loading', office: null, agents: [], error: '' });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [props, setProps] = useState({ status: 'idle', data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      let mine = null;
      for (let attempt = 0; attempt < 2 && !mine; attempt++) {
        try {
          const res = await authFetch('/api/offices/mine');
          if (res.ok) mine = await res.json();
        } catch { /* retried, then reported */ }
      }
      if (!mine) throw new Error('office');
      if (!mine.office) return setState({ status: 'no-office', office: null, agents: [], error: '' });
      if (!mine.office.isOfficeAdmin) return setState({ status: 'not-admin', office: mine.office, agents: [], error: '' });
      const res = await authFetch(`/api/offices/${mine.office.id}/agents`);
      if (!res.ok) throw new Error('roster');
      const body = await res.json();
      setState({ status: 'ready', office: mine.office, agents: body.agents, error: '' });
    } catch {
      setState((s) => ({ ...s, status: 'error' }));
    }
  }, []);

  useEffect(() => {
    if (authLoading || !uid) return;
    load();
  }, [authLoading, uid, load]);

  const openAgent = useCallback(async (agent) => {
    setSelected(agent);
    if (!agent.uid || agent.status === 'pending-acceptance') return setProps({ status: 'idle', data: null });
    setProps({ status: 'loading', data: null });
    try {
      const res = await authFetch(`/api/offices/${state.office.id}/agents/${agent.uid}/properties`);
      if (!res.ok) throw new Error('props');
      setProps({ status: 'ready', data: await res.json() });
    } catch {
      setProps({ status: 'error', data: null });
    }
  }, [state.office]);

  const agents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.agents
      .filter((a) => !q || `${a.name || ''} ${a.email || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  }, [state.agents, query]);

  if (authLoading || state.status === 'loading') {
    return <Centered><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" /></Centered>;
  }
  if (state.status === 'error') {
    return (
      <Centered>
        <div>
          <p className="text-slate-700 mb-4">We couldn't load your office team right now. Nothing has changed — please try again.</p>
          <button onClick={load} className="px-5 py-2.5 rounded-lg bg-orange-500 text-white font-semibold">Retry</button>
        </div>
      </Centered>
    );
  }
  if (state.status === 'no-office' || state.status === 'not-admin') {
    return (
      <Centered>
        <p className="text-slate-500">
          {state.status === 'no-office'
            ? 'Your account is not part of an office.'
            : <>Only administrators of <strong>{state.office.name}</strong> can view the office team.</>}
        </p>
      </Centered>
    );
  }

  const counts = state.agents.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-2">
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Team</h1>
          <p className="text-sm text-slate-500 mt-1">
            {state.office.name} · {counts.active || 0} active · {(counts.invited || 0) + (counts['pending-acceptance'] || 0)} invited · {(counts.staged || 0) + (counts['send-failed'] || 0) + (counts.sending || 0)} pending invitation
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Need your own listing-agent profiles? <Link href="/dashboard/agents" className="text-orange-600 hover:text-orange-700 font-semibold">Manage them here</Link>.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Members */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200">
            <div className="p-4 border-b border-slate-100">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or email"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
              </div>
            </div>
            {agents.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 text-center">{state.agents.length ? 'No one matches that search.' : 'No agents in your office yet.'}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {agents.map((a) => (
                  <li key={a.uid || a.key}>
                    <button
                      onClick={() => openAgent(a)}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selected && (selected.uid || selected.key) === (a.uid || a.key) ? 'bg-orange-50' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {a.name || a.email || 'Unnamed agent'}{a.isOfficeAdmin ? ' (admin)' : ''}
                        </p>
                        <Badge cfg={MEMBER_STATUS[a.status] || MEMBER_STATUS.active} />
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{a.email}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Selected agent's properties */}
          <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-5 min-h-[16rem]">
            {!selected ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-10">
                <Building2 className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-sm">Select an agent to see their properties and campaigns.</p>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <h2 className="text-lg font-bold text-slate-900">{selected.name || selected.email}</h2>
                  <p className="text-xs text-slate-500">{selected.email}</p>
                  <p className="text-xs text-slate-400 mt-1">Read-only view. Ownership and billing stay with the agent.</p>
                </div>
                {!selected.uid || selected.status === 'pending-acceptance' ? (
                  <p className="text-sm text-slate-500">
                    {!selected.uid
                      ? 'This agent has been added to your list but has not been sent an invitation yet.'
                      : "This agent hasn't accepted the office invitation yet, so there is nothing to show."}
                  </p>
                ) : props.status === 'loading' ? (
                  <div className="py-10 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-4 border-orange-500" /></div>
                ) : props.status === 'error' ? (
                  <div>
                    <p className="text-sm text-slate-600 mb-3">We couldn't load this agent's properties.</p>
                    <button onClick={() => openAgent(selected)} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold">Retry</button>
                  </div>
                ) : props.data && props.data.total === 0 ? (
                  <p className="text-sm text-slate-500">{selected.status === 'invited' ? 'This agent hasn\'t signed in yet.' : 'No properties yet.'}</p>
                ) : props.data ? (
                  <>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {Object.entries(PROPERTY_STATUS).map(([k, cfg]) => (props.data.counts[k] ? <span key={k} className="text-xs text-slate-600"><Badge cfg={cfg} /> {props.data.counts[k]}</span> : null))}
                    </div>
                    <ul className="space-y-3">
                      {props.data.properties.map((p) => (
                        <li key={p.id} className="flex gap-3 border border-slate-100 rounded-xl p-3">
                          {p.thumbnail ? (
                            <img src={p.thumbnail} alt="" className="w-20 h-16 rounded-lg object-cover shrink-0 bg-slate-100" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                          ) : <div className="w-20 h-16 rounded-lg bg-slate-100 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900 truncate">{p.address || 'Address not set'}</p>
                              <Badge cfg={PROPERTY_STATUS[p.status]} />
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {p.listingStatus === 'on-market' ? 'On market' : 'Pre-market'} · {p.status === 'sold' && p.soldPrice ? `Sold ${money(p.soldPrice)}` : money(p.price)}
                              {p.createdAt ? ` · Listed ${date(p.createdAt)}` : ''}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                              <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{p.views} views</span>
                              {p.bedrooms != null && <span className="inline-flex items-center gap-1"><Bed className="w-3.5 h-3.5" />{p.bedrooms}</span>}
                              {p.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath className="w-3.5 h-3.5" />{p.bathrooms}</span>}
                              {p.carSpaces != null && <span className="inline-flex items-center gap-1"><Car className="w-3.5 h-3.5" />{p.carSpaces}</span>}
                              <Link href={`/find-property?propertyId=${p.id}`} target="_blank" className="ml-auto inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-semibold">
                                View page <ExternalLink className="w-3 h-3" />
                              </Link>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
