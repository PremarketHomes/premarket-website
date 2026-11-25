'use client';

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Maximize, Printer, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { authFetch } from '../../../utils/authFetch';
import EntranceSign, { SIGN_FORMATS } from '../../../concepts/open-home/_components/EntranceSign';
import { partnerFromBrand, openHomeVisitUrl } from '../../../utils/openHome/brand';

/** Printable entrance QR sign for one of the signed-in pilot agent's open homes (same design as the concept). */
function SignStudio() {
  const params = useSearchParams();
  const sessionId = params.get('session') || '';
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [format, setFormat] = useState('a4');
  const [theme, setTheme] = useState('dark');
  const [presenting, setPresenting] = useState(false);
  const [fitW, setFitW] = useState(0);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const stageRef = useRef(null);

  useEffect(() => {
    if (loading || !user) return;
    Promise.all([
      authFetch(`/api/open-home/sessions/${encodeURIComponent(sessionId)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('This open home isn’t available.')))),
      fetch(`/api/open-home/visit/${encodeURIComponent(sessionId)}`, { cache: 'no-store', credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([report, visit]) => setData({ report, visit })).catch((e) => setError(e.message));
  }, [loading, user, sessionId]);

  const f = SIGN_FORMATS[format];
  const aspect = f.mm[0] / f.mm[1];
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || !data) return undefined;
    const measure = () => { const r = el.getBoundingClientRect(); setFitW(Math.max(200, Math.floor(Math.min(r.width, r.height * aspect)))); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, aspect]);
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  if (!loading && !user) return <p className="p-8 text-center text-slate-600">Please sign in to print your open home sign.</p>;
  if (error) return <p className="p-8 text-center text-red-700">{error}</p>;
  if (!data) return <div className="grid min-h-dvh place-items-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" /></div>;

  const { report, visit } = data;
  const property = { street: report.property.street, suburb: report.property.suburb, agentName: visit?.property?.agentName || 'the agent' };
  const partner = partnerFromBrand(visit?.brand);
  const url = openHomeVisitUrl(report.session.id);
  const [mmW, mmH] = f.mm;
  const presentFormat = vp.w >= vp.h ? 'ipad' : 'a4';
  const pAspect = SIGN_FORMATS[presentFormat].mm[0] / SIGN_FORMATS[presentFormat].mm[1];

  return (
    <div className="flex h-dvh flex-col bg-slate-100 print:block print:h-auto print:bg-white">
      <style>{`
        @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; }
          .oh-sign-print { width: ${mmW}mm !important; height: ${mmH - 0.6}mm !important; aspect-ratio: auto !important; font-size: calc(${mmW}mm / 100) !important; box-shadow: none !important; border-radius: 0 !important; }
        }
      `}</style>
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3 print:hidden">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-slate-900">Entrance QR sign{report.session.mode === 'test' ? ' (TEST)' : ''}</p>
          <p className="truncate text-xs text-slate-500">{property.street}{property.suburb ? `, ${property.suburb}` : ''}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {Object.entries(SIGN_FORMATS).map(([value, o]) => (
              <button key={value} type="button" onClick={() => setFormat(value)} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${format === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{o.label}</button>
            ))}
          </div>
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {['dark', 'light'].map((t) => (
              <button key={t} type="button" onClick={() => setTheme(t)} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold capitalize ${theme === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{t}</button>
            ))}
          </div>
          <button type="button" onClick={() => setPresenting(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700"><Maximize className="h-4 w-4" aria-hidden="true" /> Full screen</button>
          <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3.5 text-[13px] font-semibold text-white"><Printer className="h-4 w-4" aria-hidden="true" /> Print or save PDF</button>
        </div>
      </header>
      <main className="min-h-0 flex-1 p-6 print:p-0">
        <div ref={stageRef} className="flex h-full w-full items-center justify-center print:block print:h-auto">
          {fitW > 0 && (
            <EntranceSign className="oh-sign-print rounded-md shadow-[0_30px_60px_-30px_rgba(15,23,42,0.5)]" property={property} partner={partner} url={url} format={format} theme={theme} width={`${fitW}px`} />
          )}
        </div>
      </main>
      {presenting && vp.w > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black print:hidden">
          <EntranceSign property={property} partner={partner} url={url} format={presentFormat} theme={theme} width={`${Math.floor(Math.min(vp.w, vp.h * pAspect))}px`} />
          <button type="button" onClick={() => setPresenting(false)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white" aria-label="Exit full screen"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}

export default function OpenHomeSignPage() {
  return <Suspense fallback={null}><SignStudio /></Suspense>;
}
