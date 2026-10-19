'use client';

import { useState, useEffect } from 'react';
import { Save, Plug, Unplug, Loader2, AlertTriangle } from 'lucide-react';
import { authFetch } from '../../../../utils/authFetch';

const XERO_ERROR_MESSAGES = {
  no_code: 'Xero did not return an authorisation code. Try connecting again.',
  bad_state: 'The response from Xero could not be read. Try connecting again.',
  csrf: 'This connection attempt could not be verified as coming from this browser session, so it was rejected for safety. Try connecting again, and complete it in the same browser tab throughout.',
  unauthorized: 'Your admin session could not be verified. Try logging in again, then reconnect.',
  token_exchange: "Xero rejected the connection request. This usually means the Client ID, Client Secret, or Redirect URI don't match what's configured in Vercel — or Vercel hasn't redeployed since they were added.",
  unknown: 'Something went wrong connecting to Xero. Check the Vercel function logs for details.',
};

export default function InvoicingSettings({ user, xeroConnected, xeroError }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(
    xeroError ? (XERO_ERROR_MESSAGES[xeroError] || XERO_ERROR_MESSAGES.unknown) : null
  );

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await authFetch(`/api/admin/invoicing/settings`);
        const data = await res.json();
        setSettings(data.settings);
      } catch (err) {
        console.error('Fetch settings error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, [user.uid]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await authFetch('/api/admin/invoicing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error('Save settings error:', err);
    } finally {
      setSaving(false);
    }
  }

  function handleChange(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function connectXero() {
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await authFetch('/api/auth/xero');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to start Xero OAuth (${res.status})`);
      }
      const { url } = await res.json();
      if (!url) throw new Error('Xero did not return a login URL');
      window.location.href = url;
      // Intentionally leave `connecting` true — the page is navigating away.
    } catch (err) {
      console.error('Xero connect error:', err);
      setConnectError(err.message || 'Failed to start the Xero connection. Check the browser console and Vercel logs.');
      setConnecting(false);
    }
  }

  async function disconnectXero() {
    if (!confirm('Disconnect Xero? You will need to re-authenticate to send invoices.')) return;
    try {
      await authFetch('/api/admin/invoicing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: {} }),
      });
      // We store tokens separately, so we just note disconnection
      // In a full implementation we'd revoke the token
      window.location.reload();
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  const priceExGst = settings.pricePerListing / (1 + settings.gstRate);
  const gstAmount = settings.pricePerListing - priceExGst;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Xero Connection */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Xero Integration</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${xeroConnected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span className="text-sm text-slate-600">
              {xeroConnected ? 'Connected to Xero' : 'Not connected'}
            </span>
          </div>
          {xeroConnected ? (
            <button
              onClick={disconnectXero}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100"
            >
              <Unplug className="w-3.5 h-3.5" />
              Disconnect
            </button>
          ) : (
            <button
              onClick={connectXero}
              disabled={connecting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
              {connecting ? 'Connecting…' : 'Connect Xero'}
            </button>
          )}
        </div>
        {connectError && (
          <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{connectError}</p>
          </div>
        )}
      </div>

      {/* Billing Settings */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Billing Settings</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Price per listing (inc GST)</label>
            <div className="flex items-center gap-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  value={settings.pricePerListing}
                  onChange={(e) => handleChange('pricePerListing', parseFloat(e.target.value) || 0)}
                  className="pl-7 pr-3 py-2 text-slate-900 bg-white border border-slate-200 rounded-lg text-sm w-32 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
                />
              </div>
              <span className="text-xs text-slate-400">
                {settings.gstRate > 0
                  ? `= $${priceExGst.toFixed(2)} + $${gstAmount.toFixed(2)} GST`
                  : 'Not GST registered — no GST added'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Payment terms (days)</label>
              <input
                type="number"
                value={settings.paymentTermsDays}
                onChange={(e) => handleChange('paymentTermsDays', parseInt(e.target.value) || 14)}
                className="px-3 py-2 text-slate-900 bg-white border border-slate-200 rounded-lg text-sm w-full focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Invoice prefix</label>
              <input
                type="text"
                value={settings.invoicePrefix}
                onChange={(e) => handleChange('invoicePrefix', e.target.value)}
                className="px-3 py-2 text-slate-900 bg-white border border-slate-200 rounded-lg text-sm w-full focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Xero account code</label>
            <input
              type="text"
              value={settings.xeroAccountCode}
              onChange={(e) => handleChange('xeroAccountCode', e.target.value)}
              className="px-3 py-2 text-slate-900 bg-white border border-slate-200 rounded-lg text-sm w-32 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
            />
          </div>
        </div>
      </div>

      {/* Automation */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Monthly Automation</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-700">Auto-generate dry run</p>
              <p className="text-xs text-slate-400">Creates a draft invoice run on the configured day each month</p>
            </div>
            <button
              onClick={() => handleChange('cronEnabled', !settings.cronEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.cronEnabled ? 'bg-orange-600' : 'bg-slate-200'
              }`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                settings.cronEnabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {settings.cronEnabled && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Day of month</label>
              <select
                value={settings.cronDay}
                onChange={(e) => handleChange('cronDay', parseInt(e.target.value))}
                className="px-3 py-2 text-slate-900 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>{day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Excluded Agents */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Excluded Agents</h3>
        <p className="text-xs text-slate-400 mb-3">Agent user IDs to exclude from billing (comma-separated)</p>
        <textarea
          value={(settings.excludeAgentIds || []).join(', ')}
          onChange={(e) => handleChange('excludeAgentIds', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          rows={3}
          className="w-full px-3 py-2 text-slate-900 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none resize-none"
          placeholder="user_id_1, user_id_2"
        />
      </div>

      {/* Daily Market Report Recipients */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Daily Market Health Report</h3>
        <p className="text-xs text-slate-400 mb-3">
          Email addresses that receive the AI-generated daily market health report card (comma-separated)
        </p>
        <textarea
          value={(settings.marketReportRecipients || []).join(', ')}
          onChange={(e) => handleChange('marketReportRecipients', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          rows={3}
          className="w-full px-3 py-2 text-slate-900 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none resize-none"
          placeholder="admin@example.com, ceo@example.com"
        />
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  );
}
