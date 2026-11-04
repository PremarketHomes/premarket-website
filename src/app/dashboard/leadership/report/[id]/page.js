'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../../context/AuthContext';
import { useRequireAgent } from '../../../../hooks/useRequireAgent';
import { authFetch } from '../../../../utils/authFetch';
import { fmtDate, fmtInt, fmtPrice, campaignPrice, STATUS_LABEL } from '../../format';

/** Read-only, buyer-redacted campaign report for the Leadership Hub. Offers no actions of any kind. */
export default function LeadershipReportPage({ params }) {
  useRequireAgent();
  const { id } = use(params);
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState({ status: 'loading', report: null });
  const uid = user?.uid;

  useEffect(() => {
    if (authLoading || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/leadership/properties/${encodeURIComponent(id)}/report`);
        if (cancelled) return;
        if (res.status === 403 || res.status === 404) return setState({ status: 'missing', report: null });
        if (!res.ok) throw new Error('failed');
        setState({ status: 'ready', report: await res.json() });
      } catch {
        if (!cancelled) setState({ status: 'error', report: null });
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, uid, id]);

  const r = state.report;
  const p = r?.property;
  return (
    <div className="min-h-screen bg-[#faf9f7] text-stone-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8">
        <Link href="/dashboard/leadership" className="inline-flex items-center gap-2 text-[13px] text-stone-500 hover:text-stone-900"><ArrowLeft className="w-4 h-4" strokeWidth={1.5} />Leadership Hub</Link>

        {state.status === 'loading' && <div className="mt-20 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#e38100]" /></div>}
        {state.status === 'missing' && <p className="mt-16 text-center text-stone-600">That campaign isn't available.</p>}
        {state.status === 'error' && <p className="mt-16 text-center text-stone-600">We couldn't load this report. Please try again.</p>}

        {state.status === 'ready' && (
          <>
            <div className="mt-6 flex items-start gap-3 rounded-md border border-stone-200 bg-white px-4 py-3 text-xs text-stone-500">
              <ShieldCheck className="w-4 h-4 mt-0.5 text-[#e38100] shrink-0" strokeWidth={1.5} />
              Read-only report. Buyer names and contact details are not shown.
            </div>
            {p.imageUrls?.[0] && <img src={p.imageUrls[0]} alt="" className="mt-6 w-full h-64 object-cover rounded-md border border-stone-200" />}
            <h1 className="mt-6 font-serif text-3xl text-stone-900">{p.formattedAddress || p.address || 'Address unavailable'}</h1>
            <p className="text-sm text-stone-500 mt-1">{r.listingAgent.name} · {STATUS_LABEL[p.status]} · Created {fmtDate(p.createdAt)} · {campaignPrice(p).text}</p>

            <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[['Opinions', r.totals.opinions], ['Registered', r.totals.registrations], ['Likes', r.totals.likes], ['Views', p.views]].map(([label, value]) => (
                <div key={label} className="bg-white rounded-md border border-stone-200 p-4">
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-stone-400">{label}</dt>
                  <dd className="mt-1 font-serif text-3xl tabular-nums">{fmtInt(value)}</dd>
                </div>
              ))}
            </dl>

            <h2 className="mt-10 mb-3 font-serif text-2xl">Buyer opinions</h2>
            <div className="bg-white rounded-md border border-stone-200 overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead><tr className="border-b border-stone-200 bg-[#fdfcfb] text-left text-[10px] uppercase tracking-[0.16em] text-stone-400">
                  <th className="px-4 py-3 font-medium">Buyer</th><th className="px-4 py-3 font-medium">Opinion</th><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Interest</th><th className="px-4 py-3 font-medium">Timeframe</th>
                </tr></thead>
                <tbody>
                  {r.opinions.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-400">No opinions yet.</td></tr>}
                  {r.opinions.map((o, i) => (
                    <tr key={o.id} className="border-b border-stone-100 last:border-b-0">
                      <td className="px-4 py-3 text-stone-700">{o.buyerName || `Buyer ${i + 1}`}</td>
                      <td className="px-4 py-3 tabular-nums">{fmtPrice(o.offerAmount, '—')}</td>
                      <td className="px-4 py-3 text-stone-600">{fmtDate(o.createdAt)}</td>
                      <td className="px-4 py-3">{o.serious ? <span className="px-2 py-0.5 rounded text-xs bg-[#fdf1df] text-[#a85f00]">Registered</span> : <span className="text-stone-400">Opinion only</span>}</td>
                      <td className="px-4 py-3 text-stone-600">{o.timeframe || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
