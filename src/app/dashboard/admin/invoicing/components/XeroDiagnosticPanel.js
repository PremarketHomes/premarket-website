'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2 } from 'lucide-react';
import { authFetch } from '../../../../utils/authFetch';

/**
 * TEMPORARY — Xero connection diagnostic.
 *
 * One-off tool to prove the real Xero connection works before trusting
 * it with real invoices: checks connectivity/account code read-only,
 * then (only on explicit confirmation) creates exactly one $200
 * GST-free DRAFT invoice for a dedicated test contact — never
 * authorised, never emailed, never touching propertyCharges or
 * invoiceRuns. See api/admin/invoicing/xero-diagnostic/*\/route.js for
 * the full explanation.
 *
 * Delete this file and its two call sites (the import + the <XeroDiagnosticPanel />
 * line below in InvoicingSettings.js) once testing is done — or just
 * unset XERO_DIAGNOSTIC_ENABLED in Vercel to disable it immediately
 * without a code change.
 */
export default function XeroDiagnosticPanel() {
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState(null);
  const [createError, setCreateError] = useState(null);

  async function checkReadiness() {
    setChecking(true);
    setPreviewError(null);
    setCreateResult(null);
    setCreateError(null);
    try {
      const res = await authFetch('/api/admin/invoicing/xero-diagnostic/preview');
      if (res.status === 404) {
        setPreviewError('Disabled — XERO_DIAGNOSTIC_ENABLED is not set to "true" in Vercel.');
        setPreview(null);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to check readiness');
      setPreview(data);
    } catch (err) {
      console.error('Xero diagnostic preview error:', err);
      setPreviewError(err.message || 'Failed to check readiness');
    } finally {
      setChecking(false);
    }
  }

  async function createTestInvoice() {
    if (!window.confirm(
      'This will make a REAL call to your connected Xero organisation and create one $200 GST-free DRAFT invoice ' +
      'for a dedicated test contact. It will NOT be authorised, emailed, or payable. Continue?'
    )) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await authFetch('/api/admin/invoicing/xero-diagnostic/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create the test invoice');
      setCreateResult(data);
    } catch (err) {
      console.error('Xero diagnostic create error:', err);
      setCreateError(err.message || 'Failed to create the test invoice');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="bg-amber-50 border-2 border-dashed border-amber-300 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-2">
        <FlaskConical className="w-4 h-4 text-amber-700" />
        <h3 className="text-sm font-semibold text-amber-800">Xero Connection Diagnostic — TEMPORARY, admin-only</h3>
      </div>
      <p className="text-xs text-amber-700 mb-4">
        Creates exactly one real $200 GST-free DRAFT invoice in Xero for a dedicated test contact, to confirm the
        connection actually works. Never authorised, never emailed, never collects payment, never touches real
        billing data. Delete this panel (or unset XERO_DIAGNOSTIC_ENABLED) once you're done testing.
      </p>

      <button
        onClick={checkReadiness}
        disabled={checking}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-100 disabled:opacity-50"
      >
        {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        {checking ? 'Checking…' : 'Check Readiness'}
      </button>

      {previewError && (
        <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{previewError}</p>
        </div>
      )}

      {preview && (
        <div className="mt-3 bg-white border border-amber-200 rounded-lg p-4 space-y-1.5 text-xs">
          <Row label="Connected" value={preview.connected ? 'Yes' : 'No'} good={preview.connected} />
          {preview.connected && (
            <>
              <Row label="Xero organisation" value={preview.organisationName || 'Unknown'} good={!!preview.organisationName} />
              <Row
                label={`Account code "${preview.accountCode}"`}
                value={preview.accountCodeValid ? `Valid — ${preview.accountCodeName}` : 'Not found in this org\'s chart of accounts'}
                good={preview.accountCodeValid}
              />
              <Row label="Test contact" value={`${preview.testContact.name} <${preview.testContact.email}>`} good />
              {preview.existingTestContactId && (
                <Row label="Note" value="A contact with this exact test name already exists — it will be reused, not duplicated." good />
              )}
            </>
          )}

          {preview.readyToCreate && (
            <div className="pt-3 mt-2 border-t border-amber-100">
              <button
                onClick={createTestInvoice}
                disabled={creating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                {creating ? 'Creating…' : 'Create Test Draft Invoice in Xero'}
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

function Row({ label, value, good }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={good ? 'text-emerald-700 font-medium text-right' : 'text-red-600 font-medium text-right'}>{value}</span>
    </div>
  );
}
