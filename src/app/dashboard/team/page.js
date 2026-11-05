'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeft, Eye, ExternalLink, Users, UserPlus, Mail, Check, X, LogOut, BarChart3, Bed, Bath, Car, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { authFetch } from '../../utils/authFetch';
import { db } from '../../firebase/clientApp';

const PROPERTY_STATUS = {
  live: { label: 'Live', className: 'bg-slate-900 text-white' },
  hidden: { label: 'Hidden', className: 'bg-slate-100 text-slate-600' },
  archived: { label: 'Archived', className: 'bg-amber-100 text-amber-700' },
  sold: { label: 'Sold', className: 'bg-emerald-100 text-emerald-700' },
};

const money = (n) => (typeof n === 'number' ? `$${n.toLocaleString('en-AU')}` : '—');
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Same status rule the dashboard badges use (sold > archived > live > hidden).
function statusOf(p) {
  if (p.archivedReason === 'sold') return 'sold';
  if (p.archived === true) return 'archived';
  return p.visibility === true ? 'live' : 'hidden';
}

const toIso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);

function Badge({ cfg }) {
  return <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${cfg.className}`}>{cfg.label}</span>;
}

function Centered({ children }) {
  return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 text-center">{children}</div>;
}

async function readError(res, fallback) {
  try { return (await res.json()).error || fallback; } catch { return fallback; }
}

/**
 * My Team — colleagues in the SAME verified office who have accepted each
 * other's invitation. Everything is server-authorised (/api/teams/*); this page
 * only ever reads. Teammates' properties open the existing report in read-only,
 * buyer-redacted mode. Each agent keeps their own account, listings and billing.
 */
export default function MyTeamPage() {
  useRequireAgent();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;

  const [overview, setOverview] = useState({ status: 'loading', data: null });
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState(null); // { tone: 'ok' | 'error', text }
  const [busy, setBusy] = useState(null);     // key of the action in flight
  const [confirm, setConfirm] = useState(null); // { kind: 'leave' | 'remove', uid?, name? }

  const [tab, setTab] = useState('team'); // 'team' | 'mine'
  const [teamProps, setTeamProps] = useState({ status: 'idle', data: null });
  const [myProps, setMyProps] = useState({ status: 'idle', data: null });
  const [ownerFilter, setOwnerFilter] = useState('all');
  // Team creators can create campaigns for the agents in their own team (server decides; others see nothing).
  const [canCreateForTeam, setCanCreateForTeam] = useState(false);
  useEffect(() => {
    if (!user) return undefined; // wait for the signed-in user, or the request never starts
    let cancelled = false;
    authFetch('/api/properties/managed/agents')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (!cancelled && b?.role === 'teamAdmin' && b.agents.length > 0) setCanCreateForTeam(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/teams/mine');
      if (!res.ok) throw new Error('mine');
      setOverview({ status: 'ready', data: await res.json() });
    } catch {
      setOverview((o) => ({ status: o.data ? 'ready' : 'error', data: o.data }));
    }
  }, []);

  useEffect(() => {
    if (authLoading || !uid) return;
    load();
  }, [authLoading, uid, load]);

  const hasTeam = !!overview.data?.team;

  const loadTeamProps = useCallback(async () => {
    setTeamProps({ status: 'loading', data: null });
    try {
      const res = await authFetch('/api/teams/properties');
      if (!res.ok) throw new Error('props');
      setTeamProps({ status: 'ready', data: await res.json() });
    } catch {
      setTeamProps({ status: 'error', data: null });
    }
  }, []);

  const loadMyProps = useCallback(async () => {
    setMyProps({ status: 'loading', data: null });
    try {
      const snap = await getDocs(query(collection(db, 'properties'), where('userId', '==', uid)));
      const properties = snap.docs
        .map((d) => {
          const p = d.data();
          return {
            id: d.id,
            address: p.formattedAddress || p.address || null,
            status: statusOf(p),
            listingStatus: p.listingStatus === 'on-market' ? 'on-market' : 'pre-market',
            price: p.price ?? null,
            soldPrice: p.soldPrice ?? null,
            bedrooms: p.bedrooms ?? null,
            bathrooms: p.bathrooms ?? null,
            carSpaces: p.carSpaces ?? null,
            views: p.stats?.views || 0,
            thumbnail: Array.isArray(p.imageUrls) && p.imageUrls.length ? p.imageUrls[0] : null,
            createdAt: toIso(p.createdAt),
          };
        })
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setMyProps({ status: 'ready', data: { properties, total: properties.length } });
    } catch {
      setMyProps({ status: 'error', data: null });
    }
  }, [uid]);

  // Team listings are fetched whenever we know we're in a team; own listings on demand.
  useEffect(() => {
    if (overview.status !== 'ready') return;
    if (hasTeam) loadTeamProps();
    else setTeamProps({ status: 'idle', data: null });
  }, [overview.status, hasTeam, loadTeamProps]);

  useEffect(() => {
    if (tab === 'mine' && myProps.status === 'idle' && uid) loadMyProps();
  }, [tab, myProps.status, uid, loadMyProps]);

  const act = async (key, request, { success, onDone } = {}) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await request();
      if (!res.ok) {
        setNotice({ tone: 'error', text: await readError(res, 'Something went wrong. Nothing was changed.') });
      } else {
        const body = await res.json().catch(() => ({}));
        if (success) setNotice({ tone: 'ok', text: typeof success === 'function' ? success(body) : success });
        onDone?.(body);
      }
    } catch {
      setNotice({ tone: 'error', text: 'We couldn’t reach the server. Nothing was changed — please try again.' });
    } finally {
      setBusy(null);
      setConfirm(null);
      await load();
    }
  };

  const invite = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    act('invite', () => authFetch('/api/teams/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }), {
      success: (b) => b.message,
      onDone: () => setEmail(''),
    });
  };

  const respond = (id, action, success) =>
    act(`${action}:${id}`, () => authFetch(`/api/teams/invites/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }), { success });

  const visibleProps = useMemo(() => {
    const data = teamProps.data;
    if (!data) return [];
    return ownerFilter === 'all' ? data.properties : data.properties.filter((p) => p.owner.uid === ownerFilter);
  }, [teamProps.data, ownerFilter]);

  if (authLoading || overview.status === 'loading') {
    return <Centered><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" /></Centered>;
  }
  if (overview.status === 'error') {
    return (
      <Centered>
        <div>
          <p className="text-slate-700 mb-4">We couldn&apos;t load your team right now. Nothing has changed — please try again.</p>
          <button onClick={load} className="px-5 py-2.5 rounded-lg bg-orange-500 text-white font-semibold">Retry</button>
        </div>
      </Centered>
    );
  }

  const { eligible, office, team, incoming, outgoing } = overview.data;

  if (!eligible) {
    return (
      <Centered>
        <div className="max-w-sm">
          <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-700 font-semibold">Teams are for agents in a verified agency</p>
          <p className="text-sm text-slate-500 mt-1">Your account isn&apos;t part of an active office yet, so there&apos;s no one to team up with. Ask your office administrator to add you.</p>
          <Link href="/dashboard" className="inline-block mt-4 text-sm font-semibold text-orange-600 hover:text-orange-700">Back to dashboard</Link>
        </div>
      </Centered>
    );
  }

  const listing = tab === 'team' ? teamProps : myProps;
  const rows = tab === 'team' ? visibleProps : myProps.data?.properties || [];
  const mates = team ? team.members.filter((m) => !m.isYou) : [];

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-2">
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">My Team</h1>
          {canCreateForTeam && (
            <Link href="/dashboard/add" className="inline-flex items-center gap-1 mt-2 text-sm font-semibold text-orange-600 hover:text-orange-700">
              Create a campaign for a teammate
            </Link>
          )}
          {canCreateForTeam && (
            <Link href="/dashboard/office/registrations" className="inline-flex items-center gap-1 mt-2 ml-4 text-sm font-semibold text-orange-600 hover:text-orange-700">
              View team registrations
            </Link>
          )}
          <p className="text-sm text-slate-500 mt-1">
            {office.name} · Teammates can see each other&apos;s campaigns and buyer feedback, read-only. Everyone keeps their own account, properties and billing.
          </p>
        </div>

        {notice && (
          <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {notice.text}
          </div>
        )}

        {/* Invitations received */}
        {incoming.length > 0 && (
          <section className="bg-white rounded-xl border border-orange-200 p-5">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Mail className="w-4 h-4 text-orange-500" /> Invitations for you</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {incoming.map((i) => (
                <li key={i.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{i.fromName || 'A colleague'} invited you to their team</p>
                    <p className="text-xs text-slate-500">{i.officeName} · Expires {date(i.expiresAt)}</p>
                    {i.blocked && <p className="text-xs text-amber-700 mt-1">You&apos;re already in a team. Leave it first to join this one — teams are never merged automatically.</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => respond(i.id, 'accept', 'You’ve joined the team.')}
                      disabled={i.blocked || busy !== null}
                      className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    ><Check className="w-4 h-4" /> Accept</button>
                    <button
                      onClick={() => respond(i.id, 'decline', 'Invitation declined.')}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40"
                    ><X className="w-4 h-4" /> Decline</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Team + invite */}
          <div className="lg:col-span-2 space-y-6">
            <section className="bg-white rounded-xl border border-slate-200">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Users className="w-4 h-4 text-slate-400" /> {team ? `Your team (${team.members.length})` : 'Your team'}</h2>
                {team && (
                  <button onClick={() => setConfirm({ kind: 'leave' })} disabled={busy !== null} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-600">
                    <LogOut className="w-3.5 h-3.5" /> Leave team
                  </button>
                )}
              </div>
              {team ? (
                <ul className="divide-y divide-slate-100">
                  {team.members.map((m) => (
                    <li key={m.uid} className="px-4 py-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {m.name || m.email || 'Agent'}
                          {m.isYou && <span className="ml-2 text-xs font-medium text-slate-400">You</span>}
                          {m.isCreator && <span className="ml-2 inline-flex px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold align-middle">Creator</span>}
                        </p>
                        {m.name && m.email && <p className="text-xs text-slate-500 truncate">{m.email}</p>}
                      </div>
                      {m.canRemove && (
                        <button onClick={() => setConfirm({ kind: 'remove', uid: m.uid, name: m.name || m.email || 'this agent' })} disabled={busy !== null} className="text-xs font-semibold text-slate-400 hover:text-red-600 shrink-0">
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-5 text-sm text-slate-500">You&apos;re not in a team yet. Invite a colleague from your office by email — once they accept, you&apos;ll both see each other&apos;s campaigns.</p>
              )}
            </section>

            <section className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><UserPlus className="w-4 h-4 text-slate-400" /> Invite a colleague</h2>
              <form onSubmit={invite} className="mt-3 flex gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@youragency.com"
                  autoComplete="off"
                  className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
                <button type="submit" disabled={busy !== null || !email.trim()} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-40">
                  {busy === 'invite' ? 'Sending…' : 'Invite'}
                </button>
              </form>
              <p className="text-xs text-slate-400 mt-2">They must be an active agent in {office.name}. Nothing is shared until they accept.</p>

              {outgoing.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pending invitations</p>
                  <ul className="mt-2 space-y-2">
                    {outgoing.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-800 truncate">{i.toName || i.toEmail}</p>
                          <p className="text-xs text-slate-400 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Expires {date(i.expiresAt)}</p>
                        </div>
                        <button onClick={() => respond(i.id, 'cancel', 'Invitation cancelled.')} disabled={busy !== null} className="text-xs font-semibold text-slate-400 hover:text-red-600 shrink-0">Cancel</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          {/* Properties */}
          <section className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-5 min-h-[16rem]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div role="tablist" aria-label="Which properties" className="inline-flex rounded-lg bg-slate-100 p-1 text-sm font-semibold">
                {[['team', 'Team properties'], ['mine', 'My properties']].map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`px-3.5 py-1.5 rounded-md ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >{label}</button>
                ))}
              </div>
              {tab === 'team' && mates.length > 1 && (
                <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white" aria-label="Filter by agent">
                  <option value="all">All teammates</option>
                  {mates.map((m) => <option key={m.uid} value={m.uid}>{m.name || m.email}</option>)}
                </select>
              )}
            </div>

            <p className="text-xs text-slate-400 mb-4">
              {tab === 'team'
                ? 'Your teammates’ listings — read-only. Reports hide buyer names and contact details, and only the listing agent can edit or manage a property.'
                : 'Your own listings. Manage them from your dashboard.'}
            </p>

            {tab === 'team' && !hasTeam ? (
              <div className="py-10 text-center text-slate-500">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm">Join or start a team to see your teammates&apos; properties here.</p>
              </div>
            ) : listing.status === 'loading' ? (
              <div className="py-10 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-4 border-orange-500" /></div>
            ) : listing.status === 'error' ? (
              <div>
                <p className="text-sm text-slate-600 mb-3">We couldn&apos;t load these properties.</p>
                <button onClick={tab === 'team' ? loadTeamProps : loadMyProps} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold">Retry</button>
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-slate-500">{tab === 'team' ? 'Your teammates have no properties to show yet.' : 'You have no properties yet.'}</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((p) => (
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
                        <span className="font-semibold text-slate-700">{tab === 'team' ? p.owner.name : 'You'}</span>
                        {' · '}{p.listingStatus === 'on-market' ? 'On market' : 'Pre-market'} · {p.status === 'sold' && p.soldPrice ? `Sold ${money(p.soldPrice)}` : money(p.price)}
                        {p.createdAt ? ` · Listed ${date(p.createdAt)}` : ''}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                        <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{p.views} views</span>
                        {p.bedrooms != null && <span className="inline-flex items-center gap-1"><Bed className="w-3.5 h-3.5" />{p.bedrooms}</span>}
                        {p.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath className="w-3.5 h-3.5" />{p.bathrooms}</span>}
                        {p.carSpaces != null && <span className="inline-flex items-center gap-1"><Car className="w-3.5 h-3.5" />{p.carSpaces}</span>}
                        <span className="ml-auto inline-flex items-center gap-3">
                          <Link href={`/dashboard/property/${p.id}`} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-semibold">
                            {tab === 'team' ? 'View report (read-only)' : 'View report'} <BarChart3 className="w-3 h-3" />
                          </Link>
                          <Link href={`/find-property?propertyId=${p.id}`} target="_blank" className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-semibold">
                            View page <ExternalLink className="w-3 h-3" />
                          </Link>
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">{confirm.kind === 'leave' ? 'Leave this team?' : `Remove ${confirm.name}?`}</h3>
            <p className="text-sm text-slate-500 mt-2">
              {confirm.kind === 'leave'
                ? 'You’ll immediately stop seeing your teammates’ properties, and they’ll stop seeing yours. Your own properties and account are unaffected.'
                : 'They’ll immediately stop seeing the team’s properties, and the team will stop seeing theirs. Their account and properties are unaffected.'}
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button
                onClick={() => (confirm.kind === 'leave'
                  ? act('leave', () => authFetch('/api/teams/leave', { method: 'POST' }), { success: 'You’ve left the team.', onDone: () => { setTab('mine'); } })
                  : act(`remove:${confirm.uid}`, () => authFetch(`/api/teams/members/${confirm.uid}`, { method: 'DELETE' }), { success: `${confirm.name} was removed from the team.` }))}
                disabled={busy !== null}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
              >{confirm.kind === 'leave' ? 'Leave team' : 'Remove'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
