'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, X } from 'lucide-react';
import { authFetch } from '../../../../utils/authFetch';

/**
 * "Possible Duplicate Agencies" — surfaces pairs of billing entities
 * whose names look like they might be the same real agency (see
 * billingService.findPossibleDuplicateAgencies for the heuristic and
 * its known limits: it catches abbreviations/shared prefixes, not
 * every possible spelling difference). Reviewing and merging here
 * never touches branding (agencyBrandId/agencyBrands) or any
 * already-recorded charge — only which entity each agent's FUTURE
 * charges bill under (see mergeIntoBillingEntity in billingService.js).
 */
export default function DuplicateAgenciesWarning() {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState([]);
  const [merging, setMerging] = useState(null);

  const fetchDuplicates = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/invoicing/agencies');
      const data = await res.json();
      setPairs(data.possibleDuplicates || []);
    } catch (err) {
      console.error('Fetch possible duplicate agencies error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDuplicates(); }, [fetchDuplicates]);

  async function handleMerge(pair, keep, other) {
    const reason = window.prompt(
      `Merge "${other.billingEntityName}" into "${keep.billingEntityName}"? All of "${other.billingEntityName}"'s agents will bill under "${keep.billingEntityName}" going forward. Branding and past charges are untouched. Why? (required)`
    );
    if (!reason || !reason.trim()) return;

    setMerging(`${pair.groupA.billingEntityKey}:${pair.groupB.billingEntityKey}`);
    try {
      const res = await authFetch('/api/admin/invoicing/agencies/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentUserIds: other.agents.map((a) => a.agentUserId),
          targetBillingEntityKey: keep.billingEntityKey,
          targetBillingEntityName: keep.billingEntityName,
          reason,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Failed to merge');
        return;
      }
      await fetchDuplicates();
    } catch (err) {
      console.error('Merge error:', err);
      alert('Failed to merge');
    } finally {
      setMerging(null);
    }
  }

  if (loading) return null;

  const visible = pairs.filter((p) => !dismissed.includes(`${p.groupA.billingEntityKey}:${p.groupB.billingEntityKey}`));
  if (visible.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-amber-700 flex-shrink-0" />
        <h3 className="text-sm font-semibold text-amber-800">Possible Duplicate Agencies</h3>
      </div>
      <p className="text-xs text-amber-700">
        These billing groups have similar names and might be the same real agency, billing separately by mistake.
        Review and merge if so — this only changes which entity future charges bill under, never branding or past invoices.
      </p>
      <div className="space-y-2">
        {visible.map((pair) => {
          const key = `${pair.groupA.billingEntityKey}:${pair.groupB.billingEntityKey}`;
          return (
            <div key={key} className="bg-white border border-amber-200 rounded-lg p-3 flex items-center justify-between gap-3">
              <div className="text-sm text-slate-700 min-w-0">
                <span className="font-semibold text-slate-900">{pair.groupA.billingEntityName}</span>
                <span className="text-slate-400"> ({pair.groupA.agents.length} agent{pair.groupA.agents.length === 1 ? '' : 's'})</span>
                <span className="text-slate-400 mx-2">vs</span>
                <span className="font-semibold text-slate-900">{pair.groupB.billingEntityName}</span>
                <span className="text-slate-400"> ({pair.groupB.agents.length} agent{pair.groupB.agents.length === 1 ? '' : 's'})</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleMerge(pair, pair.groupA, pair.groupB)}
                  disabled={merging === key}
                  className="text-xs font-semibold text-orange-600 hover:text-orange-700 disabled:opacity-50"
                >
                  Keep &ldquo;{pair.groupA.billingEntityName}&rdquo;
                </button>
                <button
                  onClick={() => handleMerge(pair, pair.groupB, pair.groupA)}
                  disabled={merging === key}
                  className="text-xs font-semibold text-orange-600 hover:text-orange-700 disabled:opacity-50"
                >
                  Keep &ldquo;{pair.groupB.billingEntityName}&rdquo;
                </button>
                <button
                  onClick={() => setDismissed((prev) => [...prev, key])}
                  title="Not a duplicate — dismiss"
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
