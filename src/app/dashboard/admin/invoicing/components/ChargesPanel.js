'use client';

import { useState, useEffect, useCallback } from 'react';
import { Building2, User, AlertTriangle } from 'lucide-react';
import InvoiceStatusBadge from './InvoiceStatusBadge';
import { authFetch } from '../../../../utils/authFetch';

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'excluded', label: 'Excluded' },
  { key: 'reversed', label: 'Reversed' },
];

/**
 * Admin review of the propertyCharges ledger — what's about to be
 * billed (pending), and a permanent audit trail of adjustments
 * (excluded/reversed). Excluding or reversing a charge never deletes
 * it; both actions require a reason, which is shown here alongside
 * who made the call and when.
 */
export default function ChargesPanel() {
  const [tab, setTab] = useState('pending');
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState(null);

  const fetchCharges = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/admin/invoicing/charges?status=${tab}`);
      const data = await res.json();
      setCharges(data.charges || []);
    } catch (err) {
      console.error('Fetch charges error:', err);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchCharges(); }, [fetchCharges]);

  async function handleExclude(chargeId) {
    const reason = window.prompt('Why is this charge being excluded? (required)');
    if (!reason || !reason.trim()) return;
    setActioningId(chargeId);
    try {
      const res = await authFetch(`/api/admin/invoicing/charges/${chargeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'exclude', reason }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Failed to exclude charge');
        return;
      }
      await fetchCharges();
    } catch (err) {
      console.error('Exclude charge error:', err);
      alert('Failed to exclude charge');
    } finally {
      setActioningId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Every property charge ever recorded, one per property, never deleted. Pending charges
        are what the next invoice run will bill — exclude one here if it was created by mistake,
        before it's ever invoiced.
      </p>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
        </div>
      ) : charges.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-500 text-sm">No {tab} charges.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">Billed to</th>
                <th className="px-4 py-2 font-medium text-right">Amount (inc GST)</th>
                <th className="px-4 py-2 font-medium">Status</th>
                {tab === 'pending' && <th className="px-4 py-2 font-medium"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {charges.map((charge) => (
                <tr key={charge.id}>
                  <td className="px-4 py-2.5 text-slate-700">{charge.propertyAddress}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      {charge.billingEntityType === 'independent' ? (
                        <User className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      {charge.billingEntityName}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                    ${charge.totalInc?.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <InvoiceStatusBadge status={charge.status} />
                    {charge.requiresCreditNote && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-red-600 font-semibold">
                        <AlertTriangle className="w-3 h-3" />
                        Needs credit note
                      </span>
                    )}
                  </td>
                  {tab === 'pending' && (
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleExclude(charge.id)}
                        disabled={actioningId === charge.id}
                        className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        Exclude
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {tab !== 'pending' && (
            <div className="px-4 py-3 border-t border-slate-100 space-y-1.5">
              {charges.filter((c) => c.adjustment).map((c) => (
                <p key={c.id} className="text-xs text-slate-400">
                  <span className="font-medium text-slate-600">{c.propertyAddress}:</span> &ldquo;{c.adjustment.reason}&rdquo;
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
