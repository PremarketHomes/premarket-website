'use client';

import { useEffect, useState } from 'react';
import { Trophy, Mail, UserMinus, Loader2, ShieldCheck, X } from 'lucide-react';

const card = 'bg-white rounded-md border border-stone-200';
const eyebrow = 'text-[10px] uppercase tracking-[0.16em] text-stone-400';
const input = 'mt-1.5 w-full rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[#e38100]';
const fmt = (iso) => (iso ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—');

const STATUS_STYLE = {
  pending: 'bg-amber-50 text-amber-700', used: 'bg-emerald-50 text-emerald-700',
  revoked: 'bg-stone-100 text-stone-500', expired: 'bg-stone-100 text-stone-500',
};
const STATUS_TEXT = { pending: 'Pending', used: 'Accepted', revoked: 'Revoked', expired: 'Expired' };

function RevokeDialog({ leader, office, onCancel, onConfirm, busy }) {
  const [disable, setDisable] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Revoke leadership access">
      <div className="bg-[#faf9f7] rounded-md border border-stone-200 shadow-xl max-w-md w-full p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-serif text-2xl text-stone-900">Revoke access?</h2>
          <button onClick={onCancel} aria-label="Close" className="text-stone-400 hover:text-stone-700"><X className="w-5 h-5" strokeWidth={1.5} /></button>
        </div>
        <p className="mt-3 text-sm text-stone-600"><b className="font-medium text-stone-900">{leader.name}</b> will lose access to the <b className="font-medium text-stone-900">{office.name}</b> Leadership Hub on their very next request, and any pending invitation for them to this office is cancelled.</p>
        {leader.leadershipOnly ? (
          <label className="mt-4 flex gap-3 text-sm text-stone-700 cursor-pointer">
            <input type="checkbox" checked={disable} onChange={(e) => setDisable(e.target.checked)} className="mt-0.5 accent-[#e38100]" />
            <span>Also disable their sign-in. This account exists only for the Leadership Hub.</span>
          </label>
        ) : (
          <p className="mt-4 text-xs text-stone-500 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0 text-stone-400" strokeWidth={1.5} />This is an existing Premarket {leader.roles || ''} account. Only Hub access is removed; their account, role and office are untouched.</p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900">Cancel</button>
          <button onClick={() => onConfirm(disable)} disabled={busy} className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold rounded-md inline-flex items-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Revoke access</button>
        </div>
      </div>
    </div>
  );
}

/**
 * superAdmin screen for Leadership Hub invitations. Presentational: the container supplies `data`
 * ({ offices }) and the three actions, each of which resolves or throws an Error (with `.existing` for the
 * "this email already has an account" approval step).
 */
export default function AdminLeadershipView({ data, onInvite, onRevokeInvite, onRevokeLeader, writesDisabledNote }) {
  const [officeId, setOfficeId] = useState(data.offices[0]?.id || '');
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' });
  const [existing, setExisting] = useState(null); // { name, email, roles, office }
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { tone, text }
  const [revoking, setRevoking] = useState(null);

  useEffect(() => { if (!officeId && data.offices[0]) setOfficeId(data.offices[0].id); }, [data.offices, officeId]);
  const office = data.offices.find((o) => o.id === officeId);

  const reset = () => { setExisting(null); setApproved(false); };
  const send = async (e) => {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const out = await onInvite({ officeId, ...form, approveExisting: approved });
      setMessage({ tone: 'ok', text: out.emailSent === false ? 'The invitation was created, but the email could not be sent. Send a new invitation to try again.' : `Invitation sent to ${form.email.trim().toLowerCase()}.` });
      setForm({ firstName: '', lastName: '', email: '' });
      reset();
    } catch (err) {
      if (err.existing) { setExisting(err.existing); setMessage(null); }
      else setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3">
        <Trophy className="w-5 h-5 text-[#e38100]" strokeWidth={1.5} />
        <h1 className="font-serif text-3xl text-stone-900">Leadership Hub access</h1>
      </div>
      <p className="mt-2 text-sm text-stone-600 max-w-2xl">Invite an agency principal or coach to see their office’s Premarket performance. Leaders get a read-only view with no buyer contact details, and are not added to the agent roster, rankings or billing.</p>
      {writesDisabledNote && <p role="note" className="mt-4 text-xs rounded-md bg-[#fdf1df] border border-[#f0d9b5] text-[#7a4500] px-3 py-2">{writesDisabledNote}</p>}

      <div className="mt-6">
        <label htmlFor="office" className={`block ${eyebrow}`}>Office</label>
        <select id="office" value={officeId} onChange={(e) => { setOfficeId(e.target.value); reset(); setMessage(null); }} className={`${input} max-w-sm`}>
          {data.offices.map((o) => <option key={o.id} value={o.id} disabled={o.status !== 'active'}>{o.name}{o.status !== 'active' ? ` (${o.status})` : ''}</option>)}
        </select>
      </div>

      {office && (
        <div className="mt-6 grid lg:grid-cols-2 gap-6 items-start">
          <section className={`${card} p-6`} aria-labelledby="invite-h">
            <h2 id="invite-h" className="font-serif text-xl text-stone-900">Invite a leader</h2>
            <p className="text-xs text-stone-500 mt-1">To <b className="font-medium text-stone-700">{office.name}</b>. The invitation is personal, works once and lasts 7 days.</p>
            <form onSubmit={send} className="mt-5 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label htmlFor="ifn" className={`block ${eyebrow}`}>First name</label><input id="ifn" required className={input} value={form.firstName} onChange={(e) => { setForm({ ...form, firstName: e.target.value }); reset(); }} /></div>
                <div><label htmlFor="iln" className={`block ${eyebrow}`}>Last name</label><input id="iln" className={input} value={form.lastName} onChange={(e) => { setForm({ ...form, lastName: e.target.value }); reset(); }} /></div>
              </div>
              <div><label htmlFor="iem" className={`block ${eyebrow}`}>Email</label><input id="iem" type="email" required className={input} value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); reset(); }} /></div>

              {existing && (
                <div className="rounded-md border border-[#f0d9b5] bg-[#fdf6ec] p-4 text-sm text-stone-700">
                  <p className="font-medium text-stone-900">This email already has a Premarket account</p>
                  <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs">
                    <dt className="text-stone-500">Name</dt><dd>{existing.name || '—'}</dd>
                    <dt className="text-stone-500">Role</dt><dd>{existing.roles}</dd>
                    <dt className="text-stone-500">Office</dt><dd>{existing.office}</dd>
                  </dl>
                  <label className="mt-3 flex gap-3 cursor-pointer">
                    <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="mt-0.5 accent-[#e38100]" />
                    <span>I approve adding Leadership Hub access to this existing account. Their password, role, profile and office membership won’t change, and they must sign in and accept.</span>
                  </label>
                </div>
              )}
              {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>{message.text}</p>}
              <button type="submit" disabled={busy || (existing && !approved)} className="px-5 py-2.5 bg-[#e38100] hover:bg-[#cc7400] disabled:opacity-50 text-white text-sm font-semibold tracking-wide rounded-md inline-flex items-center gap-2 transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" strokeWidth={1.5} />}{existing ? 'Send invitation to existing account' : 'Send invitation'}
              </button>
            </form>
          </section>

          <section className={`${card} p-6`} aria-labelledby="leaders-h">
            <h2 id="leaders-h" className="font-serif text-xl text-stone-900">Current leaders</h2>
            {office.leaders.length === 0 ? <p className="mt-3 text-sm text-stone-400">No one has leadership access to {office.name} yet.</p> : (
              <ul className="mt-3 divide-y divide-stone-100">
                {office.leaders.map((l) => (
                  <li key={l.uid} className="py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-stone-900 truncate">{l.name}</p>
                      <p className="text-xs text-stone-500 truncate">{l.email || 'no email on file'} · {l.leadershipOnly ? 'Leadership-only account' : `Existing ${l.roles || ''} account`}</p>
                    </div>
                    <button onClick={() => setRevoking(l)} className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1.5"><UserMinus className="w-3.5 h-3.5" strokeWidth={1.5} />Revoke</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${card} p-6 lg:col-span-2`} aria-labelledby="inv-h">
            <h2 id="inv-h" className="font-serif text-xl text-stone-900">Invitations</h2>
            {office.invites.length === 0 ? <p className="mt-3 text-sm text-stone-400">No invitations yet.</p> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead><tr className={`${eyebrow} text-left`}><th className="pb-2 font-medium">Person</th><th className="pb-2 font-medium">Type</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Sent</th><th className="pb-2 font-medium">Expires</th><th /></tr></thead>
                  <tbody>
                    {office.invites.map((i) => (
                      <tr key={i.inviteId} className="border-t border-stone-100">
                        <td className="py-2.5"><p className="text-stone-900">{i.name || '—'}</p><p className="text-xs text-stone-500">{i.email}</p></td>
                        <td className="py-2.5 text-stone-600">{i.mode === 'existing' ? 'Existing account' : 'New account'}</td>
                        <td className="py-2.5"><span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_STYLE[i.status]}`}>{STATUS_TEXT[i.status]}</span></td>
                        <td className="py-2.5 text-stone-600">{fmt(i.createdAt)}</td>
                        <td className="py-2.5 text-stone-600">{fmt(i.expiresAt)}</td>
                        <td className="py-2.5 text-right">{i.status === 'pending' && <button onClick={async () => { try { await onRevokeInvite({ officeId, inviteId: i.inviteId }); } catch (err) { setMessage({ tone: 'error', text: err.message }); } }} className="text-xs text-red-600 hover:text-red-700">Cancel</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {revoking && office && (
        <RevokeDialog leader={revoking} office={office} busy={busy} onCancel={() => setRevoking(null)}
          onConfirm={async (disableAccount) => {
            setBusy(true);
            try {
              await onRevokeLeader({ officeId, uid: revoking.uid, disableAccount });
              setMessage({ tone: 'ok', text: `${revoking.name}’s access to ${office.name} was revoked.` });
            } catch (err) { setMessage({ tone: 'error', text: err.message }); }
            finally { setBusy(false); setRevoking(null); }
          }} />
      )}
    </div>
  );
}
