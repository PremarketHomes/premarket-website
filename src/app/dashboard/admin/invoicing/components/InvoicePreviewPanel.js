'use client';

import { useEffect, useState } from 'react';
import { FileSearch, Loader2, Download, ExternalLink, AlertTriangle, XCircle, FileText } from 'lucide-react';
import { authFetch } from '../../../../utils/authFetch';

const money = (n) => (typeof n === 'number'
  ? `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—');

// Xero dates are calendar days ("2026-11-23"): format them as such, never shifted by a time zone.
const day = (ymd) => (ymd
  ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : null);

/**
 * "Preview invoice" for one agency's item in a draft or approved run: the real invoice, saved in
 * Xero as a DRAFT and shown here as the PDF Xero renders (see api/admin/invoicing/runs/[runId]/preview).
 * Nothing is approved or emailed from here.
 */
export default function InvoicePreviewPanel({ runId, item, onRefresh }) {
  const [busy, setBusy] = useState(null); // 'create' | 'pdf' | null
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const hasPreview = !!item.previewXeroInvoiceId;
  const stale = hasPreview && (
    item.previewLineCount !== item.propertyCount
    || (typeof item.previewTotal === 'number' && Math.abs(item.previewTotal - (item.totalInc || 0)) > 0.005)
  );
  const xeroUrl = summary?.xeroUrl || item.previewXeroUrl || null;
  const recipient = item.agentName || 'the billing contact';

  async function loadPdf() {
    setBusy('pdf');
    setError(null);
    try {
      const res = await authFetch(`/api/admin/invoicing/runs/${runId}/preview?itemId=${encodeURIComponent(item.id)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not load the invoice PDF');
      }
      const blob = await res.blob();
      setPdfUrl(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })));
    } catch (err) {
      setError(err.message || 'Could not load the invoice PDF');
    } finally {
      setBusy(null);
    }
  }

  async function createPreview() {
    const ok = window.confirm(
      `${hasPreview ? 'Refresh the' : 'Create a'} DRAFT invoice in Xero for ${item.agencyName}, so you can see the real invoice exactly as Xero produces it?\n\n`
      + '• It is saved in Xero as a DRAFT: not approved, not emailed, not payable and not in your reports.\n'
      + `• Nothing is sent to ${recipient}.\n`
      + '• The Xero contact is created if it does not exist yet.\n'
      + '• Nothing in this run changes.\n\n'
      + 'When this run is later sent, this same draft is approved (dated that day) and emailed. No second invoice is created.',
    );
    if (!ok) return;
    setBusy('create');
    setError(null);
    try {
      const res = await authFetch(`/api/admin/invoicing/runs/${runId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The invoice preview failed');
      setSummary(data);
      onRefresh?.();
      await loadPdf();
    } catch (err) {
      setError(err.message || 'The invoice preview failed');
      setBusy(null);
    }
  }

  const fileName = `Premarket-invoice-${(summary?.invoiceNumber || item.previewXeroInvoiceNumber || 'draft').replace(/[^A-Za-z0-9._-]/g, '')}-preview.pdf`;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" data-testid="invoice-preview-panel">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <FileSearch className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Invoice preview — {item.agencyName}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              The real invoice as Xero produces it, with your Xero branding, business details, payment terms and bank details.
              It is saved in Xero as a draft: not approved, not emailed, not payable. Nothing is sent to {recipient}.
            </p>
            {hasPreview && (
              <p className="text-xs text-slate-700 mt-1.5">
                Draft {item.previewXeroInvoiceNumber || ''} in Xero
                {item.previewDate ? ` · dated ${day(item.previewDate)}` : ''}
                {item.previewDueDate ? ` · due ${day(item.previewDueDate)}` : ''}
                {typeof item.previewTotal === 'number' ? ` · ${money(item.previewTotal)}` : ''}
              </p>
            )}
            {stale && (
              <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                This run has changed since the preview. Refresh the preview to see the invoice as it stands.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasPreview && (
            <button
              onClick={loadPdf}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              View PDF
            </button>
          )}
          <button
            onClick={createPreview}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {busy === 'create' ? 'Preparing in Xero…' : hasPreview ? 'Refresh preview' : 'Preview invoice'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {summary && (
        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-700 space-y-1">
          <p>
            <span className="font-semibold">Invoice {summary.invoiceNumber || '(number assigned by Xero)'}</span>
            {' · '}Draft in Xero{summary.contactName ? ` · To ${summary.contactName}` : ''}
          </p>
          <p>
            Dated {day(summary.date)} · due {day(summary.dueDate)} ({summary.paymentTermsDays} days)
            {' · '}Subtotal {money(summary.subTotal)} · GST {money(summary.totalTax)} · <span className="font-semibold">Total {money(summary.total)}</span>
          </p>
          <ul className="list-disc pl-5">
            {(summary.lines || []).map((l, i) => (
              <li key={i}>{l.description} — {money(l.amount)}</li>
            ))}
          </ul>
          <p className="text-slate-500">If the run is sent on a later day, the invoice is dated that day and due {summary.paymentTermsDays} days after it.</p>
        </div>
      )}

      {(pdfUrl || xeroUrl) && (
        <div className="flex items-center gap-4 text-sm">
          {pdfUrl && (
            <a href={pdfUrl} download={fileName} className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800">
              <Download className="w-3.5 h-3.5" /> Download PDF
            </a>
          )}
          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800">
              <ExternalLink className="w-3.5 h-3.5" /> Open PDF in a new tab
            </a>
          )}
          {xeroUrl && (
            <a href={xeroUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800">
              <ExternalLink className="w-3.5 h-3.5" /> Open the draft in Xero
            </a>
          )}
        </div>
      )}

      {pdfUrl && (
        <iframe
          src={pdfUrl}
          title={`Invoice preview for ${item.agencyName}`}
          className="w-full h-[900px] border border-slate-200 rounded-lg bg-slate-50"
        />
      )}
    </div>
  );
}
