'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2 } from 'lucide-react';
import { authFetch } from '../../../../utils/authFetch';

const PHIL_EMAIL = 'phil@propertyhubgc.com.au';

/**
 * TEMPORARY — Phil Chillemi (Harcourts Property Hub) test invoice.
 *
 * One-off tool to inspect the real Xero invoice format using Phil's
 * five actual properties before any genuine agency is billed. Loads
 * the proposed $1,000 / 5-line / $0 GST invoice from the already-built
 * xero-test-invoice preview endpoint (read-only — never creates
 * anything on its own), and only shows the create button when that
 * preview confirms no matching test draft already exists. Creation
 * goes through the same endpoint the earlier manual curl-based test
 * used, attaches to the existing Xero diagnostic's dedicated test
 * contact (never Phil's real agency billing contact), and is always
 * Status: DRAFT — never authorised, emailed, or made payable. See
 * api/admin/invoicing/xero-test-invoice/*\/route.js and
 * xeroTestInvoiceService.js for the full explanation and the tests
 * proving those guarantees.
 *
 * Delete this file and its one call site (the import + the
 * <PhilTestInvoicePanel /> line in InvoicingSettings.js) once this
 * test is done — or unset XERO_DIAGNOSTIC_ENABLED in Vercel to
 * disable it immediately without a code change (same switch the Xero
 * connection diagnostic above it already uses).
 */
export default function PhilTestInvoicePanel() {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState(null);
  const [createError, setCreateError] = useState(null);

  async function loadPreview() {
    setLoading(true);
    setPreviewError(null);
    setCreateResult(null);
    setCreateError(null);
    try {
      const res = await authFetch(`/api/admin/invoicing/xero-test-invoice/preview?email=${encodeURIComponent(PHIL_EMAIL)}`);
      if (res.status === 404) {
        setPreviewError('Disabled — XERO_DIAGNOSTIC_ENABLED is not set to "true" in Vercel.');
        setPreview(null);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load the preview');
      setPreview(data);
    } catch (err) {
      console.error('Phil test invoice preview error:', err);
      setPreviewError(err.message || 'Failed to load the preview');
    } finally {
      setLoading(false);
    }
  }

  async function createDraft() {
    // Belt-and-suspenders against a double-click or double-submit:
    // the button itself is removed from the page the instant preview
    // no longer shows alreadyExists: false (see the render below), and
    // `creating` disables it for the duration of this one request —
    // but the real backstop is server-side (the create route's own
    // Reference-based check plus its Idempotency-Key), not this.
    if (creating) return;

    if (!window.confirm(
      "This will make a REAL call to Premarket Group Pty Ltd's connected Xero organisation and create one DRAFT " +
      'invoice — 5 line items at $200 each, $1,000 total, $0 GST — against the existing diagnostic test contact ' +
      '("PREMARKET DIAGNOSTIC TEST — DO NOT USE"), never Phil\'s real agency contact. It will NOT be authorised, ' +
      'emailed, or payable, and will NOT create propertyCharges or invoiceRuns. Continue?'
    )) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await authFetch('/api/admin/invoicing/xero-test-invoice/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: PHIL_EMAIL, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create the test invoice');
      if (data.created === false) {
        // The preview we loaded was stale (e.g. created in another tab
        // since) — the server's own check caught it. Re-load the
        // preview so the UI reflects reality instead of showing a
        // blank success message.
        setCreateError(
          `A matching test draft already exists — Invoice ${data.existingInvoice?.invoiceNumber || data.existingInvoice?.invoiceId} ` +
          `(${data.existingInvoice?.status}). Not created again.`
        );
        await loadPreview();
        return;
      }
      setCreateResult(data);
    } catch (err) {
      console.error('Phil test invoice create error:', err);
      setCreateError(err.message || 'Failed to create the test invoice');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="bg-amber-50 border-2 border-dashed border-amber-300 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-2">
        <FlaskConical className="w-4 h-4 text-amber-700" />
        <h3 className="text-sm font-semibold text-amber-800">Phil Chillemi Test Invoice — TEMPORARY, admin-only</h3>
      </div>
      <p className="text-xs text-amber-700 mb-4">
        Previews, then (only on explicit confirmation) creates, one real DRAFT Xero invoice using Phil Chillemi's
        five actual Premarket properties — to visually inspect the real invoice format before any genuine agency is
        billed. Never authorised, never emailed, never collects payment, never touches propertyCharges or
        invoiceRuns. Delete this panel (or unset XERO_DIAGNOSTIC_ENABLED) once you&apos;re done testing.
      </p>

      <button
        onClick={loadPreview}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-100 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        {loading ? 'Loading…' : 'Load Phil\'s Test Invoice Preview'}
      </button>

      {previewError && (
        <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{previewError}</p>
        </div>
      )}

      {preview && (
        <div className="mt-3 bg-white border border-amber-200 rounded-lg p-4 space-y-2 text-xs">
          <div>
            <p className="font-medium text-slate-700 mb-1.5">
              {preview.preview.agencyName} — {preview.preview.propertyCount} properties
            </p>
            <ul className="space-y-1">
              {preview.preview.properties.map((p) => (
                <li key={p.propertyId} className="flex items-center justify-between gap-3 text-slate-600">
                  <span>{p.address}</span>
                  <span className="font-medium text-slate-800 whitespace-nowrap">${p.totalInc.toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 pt-2 mt-2 border-t border-amber-100 font-semibold text-slate-800">
              <span>Total (GST $0.00)</span>
              <span>${preview.preview.totalInc.toFixed(2)}</span>
            </div>
          </div>

          {preview.alreadyExists ? (
            <div className="pt-3 mt-2 border-t border-amber-100 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-amber-700">
                A matching test draft already exists in Xero — Invoice{' '}
                {preview.existingInvoice?.invoiceNumber || preview.existingInvoice?.invoiceId} ({preview.existingInvoice?.status}).
                Not creating a second one. Delete the existing draft in Xero first if a fresh one is needed.
              </p>
            </div>
          ) : (
            <div className="pt-3 mt-2 border-t border-amber-100">
              <button
                onClick={createDraft}
                disabled={creating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                {creating ? 'Creating…' : "Create Phil's Test Draft in Xero"}
              </button>
            </div>
          )}
        </div>
      )}

      {createError && (
        <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{createError}</p>
        </div>
      )}

      {createResult && (
        <div className="mt-3 flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-800">
            <p className="font-medium">Created as {createResult.status} in Xero — Invoice {createResult.invoiceNumber || createResult.invoiceId}.</p>
            <p className="mt-1">{createResult.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
