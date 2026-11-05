'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Camera, Pencil, Mail, Phone, Loader2, UserPlus, X, ImageOff } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useRequireAgent } from '../../../hooks/useRequireAgent';
import { authFetch } from '../../../utils/authFetch';

const LOGIN = {
  active: { label: 'Active', className: 'bg-emerald-100 text-emerald-700' },
  invited: { label: 'Invited', className: 'bg-amber-100 text-amber-700' },
  'not-activated': { label: 'Not activated', className: 'bg-slate-100 text-slate-600' },
};

const FILTERS = [
  ['all', 'All'],
  ['no-photo', 'Missing photo'],
  ['needs-details', 'Needs details'],
  ['active', 'Active'],
  ['invited', 'Invited'],
  ['not-activated', 'Not activated'],
];

function Avatar({ agent, size = 'w-12 h-12' }) {
  const initials = (agent.name || agent.email || '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return agent.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={agent.photoUrl} alt={agent.name || 'Agent'} className={`${size} rounded-full object-cover bg-slate-100 shrink-0`} />
  ) : (
    <div className={`${size} rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-sm font-semibold shrink-0`} title="No photo yet">
      {initials}
    </div>
  );
}

function EditModal({ officeId, agent, onClose, onSaved }) {
  const [fullName, setFullName] = useState(agent.name || '');
  const [phone, setPhone] = useState(agent.phone || '');
  const [contactEmail, setContactEmail] = useState(agent.email || '');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(agent.photoUrl || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return setError('Please choose a JPEG, PNG or WebP image.');
    if (f.size > 5 * 1024 * 1024) return setError('That photo is over 5MB.');
    setError('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const patch = { key: agent.key };
      if (fullName.trim() !== (agent.name || '')) patch.fullName = fullName;
      if (phone.trim() !== (agent.phone || '')) patch.phone = phone;
      if (contactEmail.trim().toLowerCase() !== (agent.email || '').toLowerCase()) patch.contactEmail = contactEmail;
      if (file) {
        const fd = new FormData();
        fd.append('key', agent.key);
        fd.append('file', file);
        const up = await authFetch(`/api/offices/${officeId}/agent-profile/photo`, { method: 'POST', body: fd });
        const upBody = await up.json().catch(() => ({}));
        if (!up.ok) throw new Error(upBody.error || 'The photo could not be uploaded. Nothing was changed.');
        patch.photoUrl = upBody.url;
      }
      if (Object.keys(patch).length === 1) return onClose();
      const res = await authFetch(`/api/offices/${officeId}/agent-profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save the profile.');
      onSaved();
    } catch (err) {
      setError(err.message || 'Could not save the profile.');
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200';
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Edit agent profile">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">Edit profile</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex items-center gap-4 mb-5">
          <Avatar agent={{ ...agent, photoUrl: preview, name: fullName }} size="w-20 h-20" />
          <div>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800">
              <Camera className="w-4 h-4" /> {preview ? 'Replace photo' : 'Upload photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="hidden" />
            <p className="text-xs text-slate-400 mt-1.5">JPEG, PNG or WebP, up to 5MB.</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-600">Full name
            <input className={`${input} mt-1`} value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">Professional phone
            <input className={`${input} mt-1`} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={40} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">Professional contact email
            <input className={`${input} mt-1`} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} inputMode="email" maxLength={254} />
          </label>
          {agent.loginEmail && (
            <p className="text-xs text-slate-500">
              Login email: <span className="font-semibold">{agent.loginEmail}</span> (not editable here)
            </p>
          )}
          <p className="text-xs text-slate-400">
            The professional email is for contact details only. It does not change the agent&apos;s login or where account and billing emails go, and saving never activates their account.
          </p>
          {agent.phoneHeld && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              This number was supplied with the invitation and is kept private until the agent activates. It only becomes public if you change it here.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-600 mt-3" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OfficeAgentsPage() {
  useRequireAgent();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;

  const [state, setState] = useState({ status: 'loading', office: null, agents: [], stats: null });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [team, setTeam] = useState('all');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      let mine = null;
      for (let attempt = 0; attempt < 2 && !mine; attempt++) {
        try {
          const res = await authFetch('/api/offices/mine');
          if (res.ok) mine = await res.json();
        } catch { /* retried, then reported */ }
      }
      if (!mine) throw new Error('office');
      if (!mine.office) return setState({ status: 'no-office', office: null, agents: [], stats: null });
      if (!mine.office.isOfficeAdmin) return setState({ status: 'not-admin', office: mine.office, agents: [], stats: null });
      const res = await authFetch(`/api/offices/${mine.office.id}/agent-directory`);
      if (!res.ok) throw new Error('directory');
      const body = await res.json();
      setState({ status: 'ready', office: mine.office, agents: body.agents, stats: body.stats });
    } catch {
      setState((s) => ({ ...s, status: 'error' }));
    }
  }, []);

  useEffect(() => {
    if (authLoading || !uid) return;
    load();
  }, [authLoading, uid, load]);

  const teams = useMemo(() => {
    const m = new Map();
    state.agents.forEach((a) => a.team && m.set(a.team.id, a.team.name));
    return [...m.entries()];
  }, [state.agents]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.agents.filter((a) => {
      if (q && !`${a.name || ''} ${a.email || ''}`.toLowerCase().includes(q)) return false;
      if (team !== 'all' && (team === 'none' ? a.team : a.team?.id !== team)) return false;
      if (filter === 'no-photo') return !a.photoUrl;
      if (filter === 'needs-details') return a.profileStatus === 'needs-details';
      if (['active', 'invited', 'not-activated'].includes(filter)) return a.loginStatus === filter;
      return true;
    });
  }, [state.agents, query, filter, team]);

  const resend = async (agent) => {
    setNotice('');
    try {
      const res = await authFetch(`/api/offices/${state.office.id}/agents/${agent.uid}/resend`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to resend');
      setNotice(`Invitation resent to ${agent.email}.`);
    } catch (err) {
      setNotice(err.message);
    }
  };

  if (state.status === 'loading') {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }
  if (state.status !== 'ready') {
    const msg = state.status === 'not-admin' ? 'Only office administrators can manage the agent directory.'
      : state.status === 'no-office' ? 'You are not part of an office yet.'
      : 'We could not load the agent directory. Please try again.';
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-center"><p className="text-slate-600">{msg}</p>
          <Link href="/dashboard" className="inline-block mt-4 text-sm font-semibold text-orange-600 hover:text-orange-700">Back to dashboard</Link></div>
      </div>
    );
  }

  const { stats } = state;
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-2">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Agents</h1>
            <p className="text-sm text-slate-500 mt-1">
              {state.office.name} · {stats.total} agents · {stats.missingPhoto} missing a photo · {stats.invited + stats.notActivated} not yet logged in
            </p>
          </div>
          <Link href="/dashboard/office" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800">
            <UserPlus className="w-4 h-4" /> Add Agent
          </Link>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email"
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" aria-label="Search agents" />
          </div>
          <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filter by team"
            className="px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm">
            <option value="all">All teams</option>
            <option value="none">No team</option>
            {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border ${filter === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {id === 'no-photo' && <ImageOff className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />}{label}
            </button>
          ))}
        </div>

        {notice && <p className="mt-3 text-sm text-slate-600" role="status">{notice}</p>}

        <ul className="mt-4 space-y-2">
          {shown.length === 0 && <li className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500 text-center">No agents match.</li>}
          {shown.map((a) => {
            const login = LOGIN[a.loginStatus] || LOGIN['not-activated'];
            return (
              <li key={a.key} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar agent={a} />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{a.name || <span className="text-slate-400">No name yet</span>}</p>
                    <p className="text-sm text-slate-500 truncate flex items-center gap-1"><Mail className="w-3.5 h-3.5 shrink-0" />{a.email || '—'}</p>
                    <p className="text-sm text-slate-500 truncate flex items-center gap-1"><Phone className="w-3.5 h-3.5 shrink-0" />{a.phone || '—'}</p>
                  </div>
                </div>
                <div className="sm:w-40 text-sm text-slate-600 truncate">{a.team?.name || <span className="text-slate-400">No team</span>}</div>
                <div className="flex flex-wrap gap-1.5 sm:w-44">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${a.profileStatus === 'ready' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}
                    title={a.missing?.length ? `Missing: ${a.missing.join(', ')}` : undefined}>
                    {a.profileStatus === 'ready' ? 'Ready' : 'Needs details'}
                  </span>
                  <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${login.className}`}>{login.label}</span>
                </div>
                <div className="flex gap-2 sm:justify-end">
                  <button onClick={() => setEditing(a)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    <Pencil className="w-3.5 h-3.5" /> Edit Profile
                  </button>
                  {a.canResend && (
                    <button onClick={() => resend(a)} className="px-3.5 py-2 rounded-xl text-sm font-semibold text-orange-600 hover:bg-orange-50">Resend invitation</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {editing && (
        <EditModal key={editing.key} officeId={state.office.id} agent={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setNotice('Profile saved.'); load(); }} />
      )}
    </div>
  );
}
