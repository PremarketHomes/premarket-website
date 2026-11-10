'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Plus, Pencil, UserMinus, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useRequireAgent } from '../../../hooks/useRequireAgent';
import { authFetch } from '../../../utils/authFetch';
import BackToDashboard from '../../../components/BackToDashboard';
import { OfficePageSkeleton } from '../../components/PageSkeletons';

function Avatar({ m, size = 'w-9 h-9' }) {
  const initials = (m.name || m.email || '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return m.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.photoUrl} alt="" className={`${size} rounded-full object-cover bg-slate-100 shrink-0`} />
  ) : (
    <div className={`${size} rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-xs font-semibold shrink-0`}>{initials}</div>
  );
}

const field = 'px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-900';

function CreateTeamModal({ unassigned, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (uid) => setPicked((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : [...p, uid]));
  const submit = async () => {
    setBusy(true); setError('');
    // Teams are organisational only; the Team Admin role is retired, so no administrator is chosen here. The server still
    // records the first member as the team's creator (existing data model).
    const err = await onCreate({ name, memberUids: picked, adminUid: picked[0] });
    if (err) { setError(err); setBusy(false); }
  };
  const assignable = unassigned.filter((a) => a.canAssign);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Create team">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">Create team</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <input className={`${field} w-full mb-3`} placeholder="Team name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Team name" />
        <p className="text-xs font-semibold text-slate-600 mb-1">Choose at least two agents without a team</p>
        <ul className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
          {assignable.length === 0 && <li className="p-3 text-sm text-slate-500">Everyone with an account is already in a team.</li>}
          {assignable.map((a) => (
            <li key={a.uid}>
              <label className="flex items-center gap-3 p-2.5 cursor-pointer">
                <input type="checkbox" checked={picked.includes(a.uid)} onChange={() => toggle(a.uid)} />
                <Avatar m={a} /> <span className="text-sm text-slate-800 truncate">{a.name || a.email}</span>
              </label>
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-red-600 mt-3" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={submit} disabled={busy || picked.length < 2} className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Create team
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OfficeTeamsPage() {
  useRequireAgent();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  const [state, setState] = useState({ status: 'loading', office: null, teams: [], unassigned: [] });
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(null); // { id, value }

  const load = useCallback(async () => {
    try {
      let mine = null;
      for (let i = 0; i < 2 && !mine; i++) {
        try { const r = await authFetch('/api/offices/mine'); if (r.ok) mine = await r.json(); } catch { /* retry */ }
      }
      if (!mine) throw new Error('office');
      if (!mine.office) return setState({ status: 'no-office', office: null, teams: [], unassigned: [] });
      if (!mine.office.isOfficeAdmin) return setState({ status: 'not-admin', office: mine.office, teams: [], unassigned: [] });
      const res = await authFetch(`/api/offices/${mine.office.id}/teams`);
      if (!res.ok) throw new Error('teams');
      const body = await res.json();
      setState({ status: 'ready', office: mine.office, teams: body.teams, unassigned: body.unassigned });
    } catch { setState((s) => ({ ...s, status: 'error' })); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- data load on mount; same pattern as office/team/page.js
  useEffect(() => { if (!authLoading && uid) load(); }, [authLoading, uid, load]);

  const officeId = state.office?.id;
  const call = async (path, method, body, okMsg) => {
    setNotice('');
    const res = await authFetch(`/api/offices/${officeId}/teams${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.code === 'would-dissolve') {
      if (typeof window !== 'undefined' && window.confirm(`${data.error}\n\nThe remaining member will become unassigned. Continue?`)) {
        return call(path.includes('?') ? `${path}&confirmDissolve=1` : path, method, body ? { ...body, confirmDissolve: true } : body, okMsg);
      }
      return null;
    }
    if (!res.ok) { setNotice(data.error || 'That change could not be saved.'); return data.error || 'failed'; }
    setNotice(okMsg); await load(); return null;
  };

  if (state.status === 'loading') return <OfficePageSkeleton />;
  if (state.status !== 'ready') {
    const msg = state.status === 'not-admin' ? 'Only office administrators can manage teams here.' : state.status === 'no-office' ? 'You are not part of an office yet.' : 'We could not load the teams. Please try again.';
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 text-center"><div><p className="text-slate-600">{msg}</p><Link href="/dashboard" className="inline-block mt-4 text-sm font-semibold text-orange-600">Back to dashboard</Link></div></div>;
  }

  const { teams, unassigned } = state;
  const memberCount = teams.reduce((n, t) => n + t.members.length, 0);
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <BackToDashboard className="mb-3" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Teams</h1>
            <p className="text-sm text-slate-500 mt-1">{state.office.name} · {teams.length} teams · {memberCount} agents in teams · {unassigned.length} without a team</p>
          </div>
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"><Plus className="w-4 h-4" /> Create team</button>
        </div>
        {notice && <p className="mt-3 text-sm text-slate-600" role="status">{notice}</p>}

        <div className="mt-5 space-y-4">
          {teams.length === 0 && <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500 text-center">No teams yet.</div>}
          {teams.map((t) => (
            <section key={t.id} className="bg-white rounded-xl border border-slate-200 p-4" aria-label={t.displayName}>
              <div className="flex items-center justify-between gap-2">
                {renaming?.id === t.id ? (
                  <form className="flex gap-2 flex-1" onSubmit={async (e) => { e.preventDefault(); const err = await call(`/${t.id}`, 'PATCH', { name: renaming.value }, 'Team renamed.'); if (!err) setRenaming(null); }}>
                    <input className={`${field} flex-1`} value={renaming.value} onChange={(e) => setRenaming({ id: t.id, value: e.target.value })} maxLength={80} aria-label="Team name" autoFocus />
                    <button className="px-3 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold">Save</button>
                    <button type="button" onClick={() => setRenaming(null)} className="px-3 py-2 text-sm text-slate-500">Cancel</button>
                  </form>
                ) : (
                  <>
                    <h2 className="font-bold text-slate-900">{t.displayName} <span className="text-xs font-normal text-slate-400">· {t.members.length} members</span></h2>
                    <button onClick={() => setRenaming({ id: t.id, value: t.name || '' })} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900"><Pencil className="w-3.5 h-3.5" /> Rename</button>
                  </>
                )}
              </div>
              <ul className="mt-3 divide-y divide-slate-100">
                {t.members.map((m) => (
                  <li key={m.uid} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Avatar m={m} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{m.name || m.email}
                          {m.loginStatus !== 'active' && <span className="ml-2 text-xs font-medium text-slate-400">not logged in yet</span>}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      {teams.length > 1 && (
                        <select aria-label={`Move ${m.name || m.email}`} value="" onChange={(e) => e.target.value && call(`/members/${m.uid}`, 'PATCH', { toTeamId: e.target.value }, 'Agent moved.')} className={`${field} !py-1.5 text-xs`}>
                          <option value="">Move to…</option>
                          {teams.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
                        </select>
                      )}
                      <button onClick={() => call(`/members/${m.uid}`, 'DELETE', null, 'Agent removed from team.')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50"><UserMinus className="w-3.5 h-3.5" /> Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="mt-6" aria-label="Agents without a team">
          <h2 className="font-bold text-slate-900 mb-2">Without a team <span className="text-xs font-normal text-slate-400">· {unassigned.length}</span></h2>
          <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {unassigned.length === 0 && <li className="p-4 text-sm text-slate-500">Everyone is in a team.</li>}
            {unassigned.map((a) => (
              <li key={a.key} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex items-center gap-3 flex-1 min-w-0"><Avatar m={a} /><div className="min-w-0"><p className="text-sm font-semibold text-slate-900 truncate">{a.name || a.email}</p><p className="text-xs text-slate-500 truncate">{a.email}</p></div></div>
                {a.canAssign && teams.length > 0 ? (
                  <select aria-label={`Add ${a.name || a.email} to a team`} value="" onChange={(e) => e.target.value && call(`/${e.target.value}/members`, 'POST', { uid: a.uid }, 'Agent added to team.')} className={`${field} !py-1.5 text-xs`}>
                    <option value="">Add to team…</option>
                    {teams.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
                  </select>
                ) : !a.canAssign ? <span className="text-xs text-slate-400">Can be added once their invitation creates an account</span> : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
      {creating && <CreateTeamModal unassigned={unassigned} onClose={() => setCreating(false)} onCreate={async (b) => { const err = await call('', 'POST', b, 'Team created.'); if (!err) setCreating(false); return err; }} />}
    </div>
  );
}
