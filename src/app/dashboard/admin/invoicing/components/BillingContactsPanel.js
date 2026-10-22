'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock } from 'lucide-react';
import { authFetch } from '../../../../utils/authFetch';

/**
 * Admin review queue for billing-contact proposals — ONE ROW PER
 * AGENT, never per agency. Agents submit these from signup or their
 * dashboard (see BillingContactPrompt in dashboard/page.js); nothing
 * here becomes the live, invoice-safe contact until Approve is used.
 * Discoverable on its own, independent of any invoice run existing
 * yet — a proposal can arrive the moment an agent first sees the
 * prompt, long before their own first 30-day cycle is due.
 *
 * Two different agents can show an identical agency name, accounts
 * contact, or billing email here without being linked in any way —
 * each row is approved independently, against that one agent's own
 * `agent:{uid}` billing record.
 */
export default function BillingContactsPanel() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // billingEntityKey currently expanded for review
  const [form, setForm] = useState({ billingName: '', name: '', email: '' });
  const [actioning, setActioning] = useState(null);
  const [error, setError] = useState(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/invoicing/billing-contacts');
      const data = await res.json();
      setPending(data.pending || []);
    } catch (err) {
      console.error('Failed to load pending billing contacts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  function startReview(item) {
    setEditing(item.billingEntityKey);
    setError(null);
    setForm({
      billingName: item.proposedBillingName || item.billingEntityName || '',
      name: item.proposedName || '',
      email: item.proposedEmail || '',
    });
  }

  async function handleApprove(billingEntityKey) {
    if (!form.email.trim()) { setError('An email is required'); return; }
    setActioning(billingEntityKey);
    setError(null);
    try {
      const res = await authFetch('/api/admin/invoicing/billing-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingEntityKey,
          billingName: form.billingName.trim(),
          name: form.name.trim(),
          email: form.email.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to approve');
      setEditing(null);
      await fetchPending();
    } catch (err) {
      console.error('Approve billing contact error:', err);
      setError(err.message || 'Failed to approve');
    } finally {
      setActioning(null);
    }
  }

  async function handleReject(billingEntityKey) {
    const reason = window.prompt('Reason (shown to the agency when they resubmit):', '') || '';
    setActioning(billingEntityKey);
    setError(null);
    try {
      const res = await authFetch('/api/admin/invoicing/billing-contacts/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingEntityKey, reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to reject');
      setEditing(null);
      await fetchPending();
    } catch (err) {
      console.error('Reject billing contact error:', err);
      setError(err.message || 'Failed to reject');
    } finally {
      setActioning(null);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-400 py-8 text-center">Loading…</div>;
  }

  if (pending.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No billing-contact proposals awaiting review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pending.map((item) => (
        <div key={item.billingEntityKey} className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <Clock className="w-4.5 h-4.5 text-amber-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900 text-sm flex items-center gap-2">
                  {item.billingEntityName}
                  {item.isChangeRequest && (
                    <span className="bg-blue-100 text-blue-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                      Change request
                    </span>
                  )}
                </p>
                {item.isChangeRequest && (
                  <p className="text-xs text-slate-400">
                    Current: {item.currentBillingName || '—'} · {item.currentName || '—'} · {item.currentEmail || '—'}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  {item.isChangeRequest ? 'Requested' : 'Agency'}: {item.proposedBillingName || '—'} · Accounts contact: {item.proposedName || '—'} · Billing email: {item.proposedEmail}
                </p>
              </div>
            </div>
            {editing !== item.billingEntityKey && (
              <button
                onClick={() => startReview(item)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors flex-shrink-0"
              >
                Review
              </button>
            )}
          </div>

          {editing === item.billingEntityKey && (
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Agency billing name</label>
                  <input
                    type="text"
                    value={form.billingName}
                    onChange={(e) => setForm((f) => ({ ...f, billingName: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 bg-white placeholder:text-slate-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Accounts contact name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 bg-white placeholder:text-slate-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Accounts email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 bg-white placeholder:text-slate-400"
                  />
                </div>
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApprove(item.billingEntityKey)}
                  disabled={actioning === item.billingEntityKey}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Approve
                </button>
                <button
                  onClick={() => handleReject(item.billingEntityKey)}
                  disabled={actioning === item.billingEntityKey}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Reject
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="px-3 py-1.5 text-slate-500 rounded-lg text-sm font-medium hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
