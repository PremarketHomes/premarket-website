'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock } from 'lucide-react';
import { authFetch } from '../../../../utils/authFetch';

/**
 * Admin review queue for agency membership — both explicit requests
 * (an agent clicked "Apply Branding" on an existing agency) and
 * "legacy" accounts (agencyBrandId set before this verification
 * system existed, never reviewed). Branding only: approving or
 * rejecting here only affects agencyBrandId (visual branding/logo
 * display). It has no effect on billing, charges, or invoicing — every
 * agent bills independently under their own Firebase UID regardless
 * of agency membership (see billingService.js).
 */
export default function AgencyMembershipsPanel() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(null);
  const [error, setError] = useState(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/agency-memberships');
      const data = await res.json();
      setPending(data.pending || []);
    } catch (err) {
      console.error('Failed to load pending agency memberships:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  async function handleApprove(uid) {
    setActioning(uid);
    setError(null);
    try {
      const res = await authFetch('/api/admin/agency-memberships/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to approve');
      await fetchPending();
    } catch (err) {
      console.error('Approve agency membership error:', err);
      setError(err.message || 'Failed to approve');
    } finally {
      setActioning(null);
    }
  }

  async function handleReject(uid) {
    const reason = window.prompt('Reason (kept on record; clears this account\'s agency branding too):', '') || '';
    setActioning(uid);
    setError(null);
    try {
      const res = await authFetch('/api/admin/agency-memberships/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to reject');
      await fetchPending();
    } catch (err) {
      console.error('Reject agency membership error:', err);
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
        <p className="text-sm text-slate-500">No agency membership requests awaiting review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {pending.map((item) => (
        <div key={item.uid} className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <Clock className="w-4.5 h-4.5 text-amber-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900 text-sm">
                  {item.requestedCompanyName || item.uid}
                  <span className="ml-2 inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                    {item.source === 'legacy' ? 'Pre-existing link' : 'New request'}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  Wants to join: <span className="font-medium text-slate-700">{item.agencyBrandName}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleApprove(item.uid)}
                disabled={actioning === item.uid}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Approve
              </button>
              <button
                onClick={() => handleReject(item.uid)}
                disabled={actioning === item.uid}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
