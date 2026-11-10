'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Search, Mail, Phone } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useRequireAgent } from '../../../hooks/useRequireAgent';
import { authFetch } from '../../../utils/authFetch';
import BackToDashboard from '../../../components/BackToDashboard';
import { OfficePageSkeleton } from '../../components/PageSkeletons';

const ACTIONS = { contact: 'Wants to be contacted', inspect: 'Wants an inspection', price: 'Wants the price guide', offer: 'Wants to make an offer' };
const TIMEFRAMES = { now: 'Right away', '1-month': 'Within a month', '3-months': 'Within 3 months', '6-months': 'Within 6 months', later: 'Later' };
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function RegistrationsPage() {
  useRequireAgent();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  const [state, setState] = useState({ status: 'loading', scope: null, office: null, registrations: [] });
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/registrations/managed');
      if (res.status === 403) return setState({ status: 'forbidden', scope: null, office: null, registrations: [] });
      if (!res.ok) throw new Error('registrations');
      const b = await res.json();
      setState({ status: 'ready', scope: b.scope, office: b.office, registrations: b.registrations });
    } catch { setState((s) => ({ ...s, status: 'error' })); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- data load on mount; same pattern as office/team/page.js
  useEffect(() => { if (!authLoading && uid) load(); }, [authLoading, uid, load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.registrations.filter((r) => !q || `${r.buyerName || ''} ${r.address || ''} ${r.agentName || ''}`.toLowerCase().includes(q));
  }, [state.registrations, query]);

  if (state.status === 'loading') return <OfficePageSkeleton />;
  if (state.status !== 'ready') {
    const msg = state.status === 'forbidden' ? 'The registrations overview is not switched on yet. Each campaign\'s own report still shows its registrations.' : 'We could not load the registrations. Please try again.';
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 text-center"><div><p className="text-slate-600">{msg}</p><Link href="/dashboard" className="inline-block mt-4 text-sm font-semibold text-orange-600">Back to dashboard</Link></div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <BackToDashboard className="mb-3" />
        <h1 className="text-2xl font-bold text-slate-900">Registrations</h1>
        <p className="text-sm text-slate-500 mt-1">
          {state.office.name} · {state.scope === 'office' ? 'all agents in the office' : 'your team'} · {state.registrations.length} buyers registered interest
        </p>
        <p className="text-xs text-slate-400 mt-1">Buyers who formally registered interest. Price opinions are anonymous and are never shown here.</p>

        <div className="relative mt-5">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by buyer, address or agent" aria-label="Search registrations"
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
        </div>

        <ul className="mt-4 space-y-2">
          {shown.length === 0 && <li className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500 text-center">No registrations yet.</li>}
          {shown.map((r) => (
            <li key={r.id} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 truncate">{r.buyerName || 'Buyer'}</p>
                {r.buyerEmail && <p className="text-sm text-slate-500 truncate flex items-center gap-1"><Mail className="w-3.5 h-3.5 shrink-0" /><a href={`mailto:${r.buyerEmail}`} className="hover:underline">{r.buyerEmail}</a></p>}
                {r.buyerPhone && <p className="text-sm text-slate-500 truncate flex items-center gap-1"><Phone className="w-3.5 h-3.5 shrink-0" /><a href={`tel:${r.buyerPhone}`} className="hover:underline">{r.buyerPhone}</a></p>}
              </div>
              <div className="sm:w-64 min-w-0">
                <p className="text-sm text-slate-800 truncate">{r.address || 'Property'}</p>
                <p className="text-xs text-slate-500 truncate">Agent: {r.agentName || '—'} · {date(r.createdAt)}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 sm:w-52">
                <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-700">{ACTIONS[r.nextAction] || ACTIONS.contact}</span>
                {TIMEFRAMES[r.timeframe] && <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">{TIMEFRAMES[r.timeframe]}</span>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
