'use client';

import { useState } from 'react';
import { ShieldCheck, Loader2, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { authFetch } from '../../../../utils/authFetch';

const ICON = {
  pass: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
  fail: <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />,
};

/**
 * Runs the read-only Xero readiness check. Nothing happens until the admin presses the button
 * AND confirms; it never runs on page load. It creates, sends, voids and deletes nothing in Xero.
 */
export default function XeroReadinessPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    if (!window.confirm('Run the read-only Xero readiness check?\n\nIt only READS from Xero. It creates, sends, voids and deletes nothing. A normal login-token refresh may occur.')) return;
    setRunning(true); setError(null); setResult(null);
    try {
      const res = await authFetch('/api/admin/invoicing/xero-readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) setError('The readiness check is switched off on this deployment.');
      else if (!res.ok) setError(data.error || 'The readiness check failed.');
      else setResult(data);
    } catch (err) {
      setError(err.message || 'The readiness check failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6" data-testid="xero-readiness-panel">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-slate-500 mt-0.5" />
          <div>
            <h3 className="font-semibold text-slate-900">Xero readiness check</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Read-only. Confirms the connected organisation, the revenue account code, the no-GST tax type, the HPH contact, and whether any old test records remain. Creates and sends nothing.
            </p>
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {running ? 'Checking…' : 'Run check'}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {result && result.connected === false && (
        <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> Xero is not connected.
        </div>
      )}

      {result && result.checks && (
        <div className="mt-4 space-y-3" data-testid="xero-readiness-result">
          <p className={`text-sm font-semibold ${result.ready ? 'text-emerald-700' : 'text-red-700'}`}>
            {result.ready ? 'Ready: no blockers found.' : `Not ready: ${result.blockers.length} blocker${result.blockers.length === 1 ? '' : 's'}.`}
            {result.warnings?.length ? ` ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.` : ''}
            {result.optionalTasks?.length ? ` ${result.optionalTasks.length} optional tidy-up${result.optionalTasks.length === 1 ? '' : 's'}.` : ''}
          </p>
          <ul className="space-y-2">
            {result.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                {ICON[c.status] || <Info className="w-4 h-4 text-slate-400 mt-0.5" />}
                <div>
                  <span className="font-medium text-slate-900">{c.label}</span>
                  <span className="text-slate-600"> — {c.detail}</span>
                  {c.cleanup && (
                    <ol className="list-decimal ml-5 mt-1 text-slate-500">
                      {c.cleanup.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400">Checked {new Date(result.checkedAt).toLocaleString('en-AU')} · read-only</p>
        </div>
      )}
    </div>
  );
}
