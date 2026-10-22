'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { authFetch } from '../../utils/authFetch';
import { Upload, Loader2, UserPlus, RotateCcw, Trash2, Users } from 'lucide-react';

const STATUS_LABEL = {
  active: { text: 'Active', className: 'bg-emerald-100 text-emerald-700' },
  invited: { text: 'Invited', className: 'bg-amber-100 text-amber-700' },
  'pending-acceptance': { text: 'Pending acceptance', className: 'bg-slate-100 text-slate-600' },
};

/**
 * Office Management — deliberately minimal: office details, roster
 * with status/resend/remove, add-one-agent, CSV bulk import, and a
 * small office-branding control. No analytics suite, no permission
 * matrix — every action here maps onto exactly one authorized API
 * route (see src/app/api/offices/**), each of which independently
 * re-checks that the caller actually administers THIS office.
 */
export default function OfficeManagementPage() {
  useRequireAgent();

  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState(null);
  const [agents, setAgents] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, invited: 0, pendingAcceptance: 0 });
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const officeRes = await authFetch('/api/offices/mine');
      const officeBody = await officeRes.json();
      setOffice(officeBody.office);

      if (officeBody.office?.isOfficeAdmin) {
        const agentsRes = await authFetch(`/api/offices/${officeBody.office.id}/agents`);
        const agentsBody = await agentsRes.json();
        if (agentsRes.ok) {
          setAgents(agentsBody.agents);
          setStats(agentsBody.stats);
        }
      }
    } catch (err) {
      setError('Failed to load office details');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (!office) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <p className="text-slate-500">You're not currently part of an office account.</p>
      </div>
    );
  }

  if (!office.isOfficeAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 text-center">
        <p className="text-slate-500">
          You're a member of <strong>{office.name}</strong>, but only office administrators can manage it.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{office.name}</h1>
          <p className="text-sm text-slate-500 mt-1">Office Management</p>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <StatsRow stats={stats} />
        <OfficeBrandingCard officeId={office.id} hasBrand={!!office.agencyBrandId} onSaved={loadAll} />
        <AddAgentCard officeId={office.id} onAdded={loadAll} />
        <CsvImportCard officeId={office.id} onImported={loadAll} />
        <RosterTable officeId={office.id} agents={agents} onChanged={loadAll} />
      </div>
    </div>
  );
}

function StatsRow({ stats }) {
  const items = [
    { label: 'Total Agents', value: stats.total },
    { label: 'Activated', value: stats.active },
    { label: 'Invited', value: stats.invited + stats.pendingAcceptance },
  ];
  return (
    <div className="grid grid-cols-3 gap-4">
      {items.map((item) => (
        <div key={item.label} className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-slate-900">{item.value}</p>
          <p className="text-xs text-slate-500 mt-1">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function OfficeBrandingCard({ officeId, hasBrand, onSaved }) {
  const [logoUrl, setLogoUrl] = useState('');
  const [primary, setPrimary] = useState('#e48900');
  const [secondary, setSecondary] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await authFetch(`/api/offices/${officeId}/branding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoUrl: logoUrl || undefined, primary, secondary: secondary || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save branding');
      setSaved(true);
      onSaved();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-900 mb-1">Office Branding</h2>
      <p className="text-sm text-slate-500 mb-4">
        {hasBrand
          ? 'Your office already has a shared brand. Saving here updates it for every member.'
          : "Set this once — every agent in your office inherits it automatically, unless they set their own personal override."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Logo URL</label>
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Primary Colour</label>
          <div className="flex items-center gap-2">
            <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="w-9 h-9 rounded-lg border border-slate-200" />
            <input type="text" value={primary} onChange={(e) => setPrimary(e.target.value)} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-900" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Secondary Colour (optional)</label>
          <div className="flex items-center gap-2">
            <input type="color" value={secondary || '#ffffff'} onChange={(e) => setSecondary(e.target.value)} className="w-9 h-9 rounded-lg border border-slate-200" />
            <input type="text" value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="optional" className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-900 placeholder:text-slate-400" />
          </div>
        </div>
      </div>
      {saveError && <p className="text-red-600 text-sm mt-3">{saveError}</p>}
      {saved && <p className="text-emerald-600 text-sm mt-3">Office branding saved.</p>}
      <button
        onClick={handleSave}
        disabled={saving || !primary}
        className="mt-4 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold text-sm disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save Office Branding'}
      </button>
    </div>
  );
}

function AddAgentCard({ officeId, onAdded }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await authFetch(`/api/offices/${officeId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to add agent');
      setMessage({ type: 'success', text: `Invitation sent to ${email}.` });
      setName('');
      setEmail('');
      setPhone('');
      onAdded();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <UserPlus className="w-4 h-4" /> Add an Agent
      </h2>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="sm:col-span-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400" />
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="sm:col-span-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400" />
        <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="sm:col-span-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400" />
        <button type="submit" disabled={submitting} className="sm:col-span-1 px-4 py-2.5 rounded-lg bg-slate-900 text-white font-semibold text-sm disabled:opacity-50">
          {submitting ? 'Adding…' : 'Add Agent'}
        </button>
      </form>
      {message && (
        <p className={`text-sm mt-3 ${message.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>{message.text}</p>
      )}
    </div>
  );
}

function CsvImportCard({ officeId, onImported }) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null); // { importId, rows, summary }
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError('');
    setPreview(null);
    setResult(null);
    try {
      const res = await authFetch(`/api/offices/${officeId}/import/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to preview import');
      setPreview(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleCommit = async () => {
    setCommitting(true);
    setError('');
    try {
      const res = await authFetch(`/api/offices/${officeId}/import/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: preview.importId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to import agents');
      setResult(body.summary);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
        <Upload className="w-4 h-4" /> Bulk Import via CSV
      </h2>
      <p className="text-sm text-slate-500 mb-4">Columns: name, email, phone. A header row is optional.</p>

      <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-orange-400 transition-colors">
        <Upload className="w-5 h-5 text-slate-400" />
        <span className="text-sm text-slate-500">{fileName || 'Click to choose a CSV file'}</span>
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      </label>

      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

      {csvText && !preview && (
        <button onClick={handlePreview} disabled={previewing} className="mt-4 px-5 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm disabled:opacity-50">
          {previewing ? (
            <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Validating…</span>
          ) : 'Preview Import'}
        </button>
      )}

      {preview && !result && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-3 text-xs flex-wrap">
            {Object.entries(preview.summary).map(([status, count]) => (
              <span key={status} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                {status}: {count}
              </span>
            ))}
          </div>
          <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowIndex} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-700">{row.name}</td>
                    <td className="px-3 py-2 text-slate-700">{row.email}</td>
                    <td className="px-3 py-2 text-slate-500">{row.previewStatus}{row.invalidReason ? ` — ${row.invalidReason}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCommit} disabled={committing} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold text-sm disabled:opacity-50">
              {committing ? 'Importing…' : 'Confirm & Invite Agents'}
            </button>
            <button onClick={() => { setPreview(null); setCsvText(''); setFileName(''); }} className="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4">
          <p className="text-emerald-600 text-sm font-semibold mb-2">Import complete.</p>
          <div className="flex gap-3 text-xs flex-wrap">
            {Object.entries(result).map(([outcome, count]) => (
              <span key={outcome} className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                {outcome}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RosterTable({ officeId, agents, onChanged }) {
  const [busyUid, setBusyUid] = useState(null);
  const [message, setMessage] = useState(null);

  const handleResend = async (uid) => {
    setBusyUid(uid);
    setMessage(null);
    try {
      const res = await authFetch(`/api/offices/${officeId}/agents/${uid}/resend`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to resend');
      setMessage({ type: 'success', text: 'Invitation resent.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusyUid(null);
    }
  };

  const handleRemove = async (uid) => {
    if (!confirm('Remove this agent from the office? Their account, properties and billing are not affected.')) return;
    setBusyUid(uid);
    setMessage(null);
    try {
      const res = await authFetch(`/api/offices/${officeId}/agents/${uid}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to remove agent');
      onChanged();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <Users className="w-4 h-4" /> Agents ({agents.length})
      </h2>
      {message && (
        <p className={`text-sm mb-3 ${message.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>{message.text}</p>
      )}
      {agents.length === 0 ? (
        <p className="text-sm text-slate-400">No agents yet — add one above or import a CSV.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-left border-b border-slate-100">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const statusInfo = STATUS_LABEL[agent.status] || { text: agent.status, className: 'bg-slate-100 text-slate-600' };
                return (
                  <tr key={agent.uid} className="border-b border-slate-50">
                    <td className="py-2.5 pr-4 text-slate-700">{agent.name || '—'}{agent.isOfficeAdmin ? ' (admin)' : ''}</td>
                    <td className="py-2.5 pr-4 text-slate-500">{agent.email || '—'}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>{statusInfo.text}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-right whitespace-nowrap">
                      {agent.status !== 'active' && (
                        <button
                          onClick={() => handleResend(agent.uid)}
                          disabled={busyUid === agent.uid}
                          className="text-xs font-semibold text-orange-600 hover:text-orange-700 mr-3 inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" /> Resend
                        </button>
                      )}
                      {agent.status !== 'pending-acceptance' && (
                        <button
                          onClick={() => handleRemove(agent.uid)}
                          disabled={busyUid === agent.uid}
                          className="text-xs font-semibold text-red-500 hover:text-red-600 inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
