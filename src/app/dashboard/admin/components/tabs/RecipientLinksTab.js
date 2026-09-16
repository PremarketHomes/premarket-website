'use client';

import { useState } from 'react';
import { Link2, Loader2, Copy, Check } from 'lucide-react';
import { authFetch } from '../../../../utils/authFetch';
import { useToast } from '../ToastProvider';

/**
 * Phase 2 internal verification tool — deliberately minimal (per spec:
 * "do not build the full agent dashboard yet"). Lets an admin:
 *  1. Create a small set of test recipients + personalised links for a
 *     property.
 *  2. Simulate opens against those links (exercises the real
 *     attribution logic without touching the property's real Views
 *     count) to prove Recipient A and Recipient B are tracked
 *     separately.
 *  3. Load the current per-recipient engagement table for a property.
 *
 * This is a developer/admin proving-ground, not the Phase 3 buyer
 * engagement dashboard.
 */
export default function RecipientLinksTab() {
  const toast = useToast();
  const [propertyId, setPropertyId] = useState('');
  const [recipientRows, setRecipientRows] = useState('Luke Wilson, luke@example.com\nSarah Smith, sarah@example.com');
  const [creating, setCreating] = useState(false);
  const [links, setLinks] = useState([]);
  const [copiedToken, setCopiedToken] = useState(null);

  const [engagementPropertyId, setEngagementPropertyId] = useState('');
  const [loadingEngagement, setLoadingEngagement] = useState(false);
  const [engagementRows, setEngagementRows] = useState(null);

  const [simulating, setSimulating] = useState(null);

  const parseRecipients = () => {
    return recipientRows
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, email] = line.split(',').map((s) => s?.trim());
        return { name: name || null, email: email || null };
      });
  };

  const handleCreate = async () => {
    if (!propertyId.trim()) {
      toast?.error?.('Enter a propertyId first');
      return;
    }
    const recipients = parseRecipients();
    if (recipients.length === 0) {
      toast?.error?.('Add at least one recipient (one per line: Name, email)');
      return;
    }
    setCreating(true);
    try {
      const res = await authFetch('/api/admin/recipient-links/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: propertyId.trim(), recipients, isTest: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create links');
      setLinks(data.links);
      setEngagementPropertyId(propertyId.trim());
      toast?.success?.(`Created ${data.links.length} test recipient link(s)`);
    } catch (err) {
      toast?.error?.(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (token, url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {
      // clipboard API unavailable — non-critical, user can select the text manually
    }
  };

  const handleSimulateOpen = async (link, scanner = false) => {
    setSimulating(link.token);
    try {
      const res = await authFetch('/api/admin/recipient-links/simulate-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: link.token,
          propertyId,
          ...(scanner ? { userAgent: 'facebookexternalhit/1.1' } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Simulate failed');
      toast?.success?.(
        data.attributed
          ? `Simulated open for ${link.name || link.email} — ${scanner ? 'scanner-suspected, excluded from meaningful counts' : data.isNewSession ? 'new session' : 'same session'}`
          : `Not attributed (${data.reason})`
      );
      if (engagementPropertyId) await loadEngagement(engagementPropertyId);
    } catch (err) {
      toast?.error?.(err.message);
    } finally {
      setSimulating(null);
    }
  };

  const loadEngagement = async (pid) => {
    if (!pid?.trim()) return;
    setLoadingEngagement(true);
    try {
      const res = await authFetch(`/api/admin/recipient-links/engagement?propertyId=${encodeURIComponent(pid.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load engagement');
      setEngagementRows(data.rows);
    } catch (err) {
      toast?.error?.(err.message);
    } finally {
      setLoadingEngagement(false);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Link2 size={16} /> Create test recipient links
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Internal testing only — creates recipients marked <code>isTest: true</code> and issues
          one personalised link per recipient for the property below. Max 25 per batch.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Property ID</label>
            <input
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              placeholder="e.g. 0LNu31wBs4hjGz8ofSd9"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Recipients (one per line: Name, email)</label>
            <textarea
              value={recipientRows}
              onChange={(e) => setRecipientRows(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            Create links
          </button>
        </div>

        {links.length > 0 && (
          <div className="mt-5 space-y-2">
            {links.map((link) => (
              <div key={link.token} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800">{link.name || link.email || link.recipientId}</div>
                  <div className="truncate text-slate-500">{link.url}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleCopy(link.token, link.url)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-slate-700"
                  >
                    {copiedToken === link.token ? <Check size={12} /> : <Copy size={12} />}
                    Copy
                  </button>
                  <button
                    onClick={() => handleSimulateOpen(link)}
                    disabled={simulating === link.token}
                    className="rounded-md border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-50"
                  >
                    Simulate open
                  </button>
                  <button
                    onClick={() => handleSimulateOpen(link, true)}
                    disabled={simulating === link.token}
                    className="rounded-md border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-50"
                    title="Simulates a scanner/bot User-Agent opening this link"
                  >
                    Simulate scanner
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Recipient engagement (verification view)</h2>
        <p className="text-xs text-slate-500 mt-1">
          Reads the real attribution records — the same ones a genuine personalised-link open
          writes to. Not the Phase 3 dashboard; just enough to prove attribution is separated
          correctly per recipient.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={engagementPropertyId}
            onChange={(e) => setEngagementPropertyId(e.target.value)}
            placeholder="Property ID"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={() => loadEngagement(engagementPropertyId)}
            disabled={loadingEngagement}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loadingEngagement ? <Loader2 size={14} className="animate-spin" /> : 'Load'}
          </button>
        </div>

        {engagementRows && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3">Recipient</th>
                  <th className="py-2 pr-3">Opens</th>
                  <th className="py-2 pr-3">Sessions</th>
                  <th className="py-2 pr-3">Scanner-suspected</th>
                  <th className="py-2 pr-3">First viewed</th>
                  <th className="py-2 pr-3">Last viewed</th>
                </tr>
              </thead>
              <tbody>
                {engagementRows.length === 0 && (
                  <tr><td colSpan={6} className="py-3 text-slate-400">No engagement recorded yet for this property.</td></tr>
                )}
                {engagementRows.map((row) => (
                  <tr key={row.recipientId} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-800">
                      {row.name || row.email || row.recipientId} {row.isTest && <span className="text-slate-400">(test)</span>}
                    </td>
                    <td className="py-2 pr-3">{row.attributableOpens}</td>
                    <td className="py-2 pr-3">{row.meaningfulSessionCount}</td>
                    <td className="py-2 pr-3">{row.scannerSuspectedOpens}</td>
                    <td className="py-2 pr-3">{row.firstViewedAt ? new Date(row.firstViewedAt).toLocaleString() : '—'}</td>
                    <td className="py-2 pr-3">{row.lastViewedAt ? new Date(row.lastViewedAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
