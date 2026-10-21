'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Send, RefreshCw, XCircle, CheckCircle, Trash2, Pencil, AlertTriangle, Mail } from 'lucide-react';
import InvoiceStatusBadge from './InvoiceStatusBadge';
import { authFetch } from '../../../../utils/authFetch';

export default function InvoiceRunDetail({ run, items, user, onRefresh }) {
  const [expandedAgency, setExpandedAgency] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [removingItem, setRemovingItem] = useState(null);
  const [removingProp, setRemovingProp] = useState(null);
  const [editingContact, setEditingContact] = useState(null);
  // Keyed by itemId — tracks which one failed-send row is mid-retry,
  // so its button is the only one disabled and a double-click can't
  // fire two retries for the same item at once.
  const [retryingItemId, setRetryingItemId] = useState(null);
  const [retryError, setRetryError] = useState(null);

  const failedSendItems = (items || []).filter((item) => item.status === 'email_failed');

  async function handleRetrySend(itemId) {
    if (retryingItemId) return; // one retry in flight at a time, defence in depth alongside the disabled button below
    setRetryingItemId(itemId);
    setRetryError(null);
    try {
      const res = await authFetch(`/api/admin/invoicing/runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retrySend', itemId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to retry sending this invoice');
      onRefresh?.();
    } catch (err) {
      console.error('Retry send failed:', err);
      setRetryError(err.message || 'Failed to retry sending this invoice');
    } finally {
      setRetryingItemId(null);
    }
  }

  const isDraft = run.status === 'draft';
  // Not yet sent to Xero — a correction here still changes what
  // actually gets emailed. Once sent, this is financial history.
  const canEditBillingContact = ['draft', 'approved'].includes(run.status);

  const periodStart = run.periodStart?.toDate?.()
    || (run.periodStart?._seconds ? new Date(run.periodStart._seconds * 1000) : new Date(run.periodStart));
  const periodEnd = run.periodEnd?.toDate?.()
    || (run.periodEnd?._seconds ? new Date(run.periodEnd._seconds * 1000) : new Date(run.periodEnd));

  const fmtStart = periodStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtEnd = periodEnd.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  const previousGrowth = run.previousTotalProperties
    ? Math.round(((run.totalProperties - run.previousTotalProperties) / run.previousTotalProperties) * 100)
    : null;

  async function handleAction(action) {
    setActionLoading(action);
    try {
      if (action === 'approve' || action === 'cancel') {
        await authFetch(`/api/admin/invoicing/runs/${run.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
      } else if (action === 'send') {
        await authFetch(`/api/admin/invoicing/runs/${run.id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (action === 'sync') {
        await authFetch(`/api/admin/invoicing/runs/${run.id}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      }
      onRefresh?.();
    } catch (err) {
      console.error(`Action ${action} failed:`, err);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRemoveAgency(itemId, agencyName) {
    if (!confirm(`Remove ${agencyName} from this run?`)) return;
    setRemovingItem(itemId);
    try {
      await authFetch(`/api/admin/invoicing/runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'removeItems', itemIds: [itemId] }),
      });
      onRefresh?.();
    } catch (err) {
      console.error('Remove agency error:', err);
    } finally {
      setRemovingItem(null);
    }
  }

  async function handleEditBillingContact(item) {
    const email = window.prompt(
      `Billing contact email for "${item.agencyName}" — this is who the consolidated invoice gets emailed to.`,
      item.agentEmail || ''
    );
    if (email === null) return; // cancelled
    if (!email.trim()) { alert('An email is required'); return; }
    const name = window.prompt('Billing contact name (optional):', item.agentName || '') || '';

    setEditingContact(item.billingEntityKey);
    try {
      const res = await authFetch('/api/admin/invoicing/billing-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingEntityKey: item.billingEntityKey, name: name.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Failed to update billing contact');
        return;
      }
      onRefresh?.();
    } catch (err) {
      console.error('Edit billing contact error:', err);
      alert('Failed to update billing contact');
    } finally {
      setEditingContact(null);
    }
  }

  async function handleRemoveProperty(itemId, propertyId, address) {
    if (!confirm(`Remove "${address}" from this run?`)) return;
    setRemovingProp(`${itemId}-${propertyId}`);
    try {
      await authFetch(`/api/admin/invoicing/runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'removeProperties', itemId, propertyIds: [propertyId] }),
      });
      onRefresh?.();
    } catch (err) {
      console.error('Remove property error:', err);
    } finally {
      setRemovingProp(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{fmtStart} – {fmtEnd}</h3>
          <p className="text-xs text-slate-500">Billing period</p>
        </div>
        <InvoiceStatusBadge status={run.status} />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">Properties</p>
          <p className="text-xl font-bold text-slate-900">{run.totalProperties}</p>
          {previousGrowth !== null && (
            <p className={`text-[10px] font-medium ${previousGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {previousGrowth >= 0 ? '+' : ''}{previousGrowth}% vs prev
            </p>
          )}
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">Agencies</p>
          <p className="text-xl font-bold text-slate-900">{run.totalAgencies}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">NET (ex GST)</p>
          <p className="text-xl font-bold text-slate-900">${run.totalAmountEx?.toLocaleString()}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500">GST</p>
          <p className="text-xl font-bold text-slate-900">${run.totalGst?.toLocaleString()}</p>
        </div>
        <div className="bg-orange-50 rounded-lg p-3">
          <p className="text-xs text-orange-600 font-medium">Gross (inc GST)</p>
          <p className="text-xl font-bold text-orange-700">${run.totalAmountInc?.toLocaleString()}</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {run.status === 'draft' && (
          <>
            <button
              onClick={() => handleAction('approve')}
              disabled={actionLoading === 'approve'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
            </button>
            <button
              onClick={() => handleAction('cancel')}
              disabled={actionLoading === 'cancel'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel
            </button>
          </>
        )}
        {run.status === 'approved' && (
          <button
            onClick={() => handleAction('send')}
            disabled={actionLoading === 'send'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            {actionLoading === 'send' ? 'Sending to Xero...' : 'Send to Xero'}
          </button>
        )}
        {['sent', 'partial'].includes(run.status) && (
          <button
            onClick={() => handleAction('sync')}
            disabled={actionLoading === 'sync'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === 'sync' ? 'animate-spin' : ''}`} />
            {actionLoading === 'sync' ? 'Syncing...' : 'Sync from Xero'}
          </button>
        )}
      </div>

      {/* Agency Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Agency</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Billing Contact</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Listings</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">NET</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">GST</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Gross</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(items || []).map((item) => (
                <AgencyRow
                  key={item.id}
                  item={item}
                  isDraft={isDraft}
                  canEditBillingContact={canEditBillingContact}
                  editingContact={editingContact === item.billingEntityKey}
                  onEditBillingContact={() => handleEditBillingContact(item)}
                  expanded={expandedAgency === item.id}
                  onToggle={() => setExpandedAgency(expandedAgency === item.id ? null : item.id)}
                  onRemoveAgency={() => handleRemoveAgency(item.id, item.agencyName)}
                  onRemoveProperty={(propertyId, address) => handleRemoveProperty(item.id, propertyId, address)}
                  removingItem={removingItem === item.id}
                  removingProp={removingProp}
                />
              ))}
            </tbody>
          </table>
        </div>
        {(!items || items.length === 0) && (
          <div className="text-center py-8 text-sm text-slate-400">No items in this run</div>
        )}
      </div>

      {/* Failed sends — invoice exists in Xero, email delivery failed.
          Retrying here only ever re-sends the existing invoice (see
          api/admin/invoicing/runs/[runId]/route.js's retrySend action)
          — it never creates a new invoice or a new charge. */}
      {failedSendItems.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <p className="text-sm font-semibold text-red-700">Failed Sends — invoice created, email not delivered</p>
          </div>
          {failedSendItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 bg-white border border-red-200 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {item.xeroInvoiceNumber || item.xeroInvoiceId} — {item.agencyName}
                </p>
                <p className="text-xs text-slate-500">
                  ${item.totalInc?.toLocaleString()} · <span className="text-red-600">Email failed{item.lastEmailError ? `: ${item.lastEmailError}` : ''}</span>
                </p>
              </div>
              <button
                onClick={() => handleRetrySend(item.id)}
                disabled={retryingItemId === item.id}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50 flex-shrink-0"
              >
                <Mail className={`w-3.5 h-3.5 ${retryingItemId === item.id ? 'animate-pulse' : ''}`} />
                {retryingItemId === item.id ? 'Retrying…' : 'Retry Email'}
              </button>
            </div>
          ))}
          {retryError && (
            <p className="text-xs text-red-700 pt-1">{retryError}</p>
          )}
        </div>
      )}

      {/* Errors */}
      {run.errors?.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-700 mb-2">Errors</p>
          {run.errors.map((err, i) => (
            <p key={i} className="text-xs text-red-600">
              {err.agencyName}: {err.error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// billingContactStatus is stamped onto the item at run-creation time
// (invoiceRunService.js), purely for this display — it is NOT what
// the send route trusts; that always re-resolves live. Older runs
// created before this feature shipped have no such field at all, so
// an unrecognised/missing status renders nothing rather than a
// potentially-wrong badge.
function BillingContactStatusBadge({ status }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
        Pending confirmation
      </span>
    );
  }
  if (status === 'unset' || status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
        Billing details required
      </span>
    );
  }
  return null;
}

function AgencyRow({
  item, isDraft, canEditBillingContact, editingContact, onEditBillingContact,
  expanded, onToggle, onRemoveAgency, onRemoveProperty, removingItem, removingProp,
}) {
  return (
    <>
      <tr className="hover:bg-slate-50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3 font-medium text-slate-900">
          <div className="flex items-center gap-2">
            {item.agencyName}
            <BillingContactStatusBadge status={item.billingContactStatus} />
          </div>
        </td>
        <td className="px-4 py-3 text-slate-600">
          <div className="flex items-center gap-1.5">
            <div>
              <div>{item.agentName}</div>
              <div className="text-xs text-slate-400">{item.agentEmail}</div>
            </div>
            {canEditBillingContact && (
              <button
                onClick={(e) => { e.stopPropagation(); onEditBillingContact(); }}
                disabled={editingContact}
                title="Edit billing contact"
                className="p-1 text-slate-400 hover:text-orange-500 rounded hover:bg-orange-50 transition-colors disabled:opacity-50 flex-shrink-0"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-center text-slate-600">{item.propertyCount}</td>
        <td className="px-4 py-3 text-right text-slate-600">${item.subtotalEx?.toLocaleString()}</td>
        <td className="px-4 py-3 text-right text-slate-400">${item.gstAmount?.toLocaleString()}</td>
        <td className="px-4 py-3 text-right font-semibold text-slate-900">${item.totalInc?.toLocaleString()}</td>
        <td className="px-4 py-3 text-center">
          <InvoiceStatusBadge status={item.xeroStatus || item.status || 'pending'} />
        </td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center justify-end gap-1">
            {item.xeroInvoiceUrl && (
              <a
                href={item.xeroInvoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-500 hover:text-blue-700 p-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {isDraft && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveAgency(); }}
                disabled={removingItem}
                className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                title="Remove agency from run"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {expanded
              ? <ChevronUp className="w-4 h-4 text-slate-400" />
              : <ChevronDown className="w-4 h-4 text-slate-400" />
            }
          </div>
        </td>
      </tr>
      {expanded && item.properties?.map((prop) => {
        const propKey = `${item.id}-${prop.propertyId}`;
        const isRemoving = removingProp === propKey;
        return (
          <tr key={propKey} className="bg-slate-50/50">
            <td colSpan={3} className="px-4 py-2 pl-10 text-xs text-slate-600">{prop.address}</td>
            <td colSpan={3} className="px-4 py-2 text-right text-xs text-slate-500">${item.pricePerListing} inc</td>
            <td></td>
            <td className="px-4 py-2 text-center">
              {isDraft && (
                <button
                  onClick={() => onRemoveProperty(prop.propertyId, prop.address)}
                  disabled={isRemoving}
                  className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                  title="Remove property from run"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
