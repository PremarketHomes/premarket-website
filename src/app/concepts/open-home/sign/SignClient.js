'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, Maximize, X } from 'lucide-react';
import EntranceSign, { SIGN_FORMATS } from '../_components/EntranceSign';
import ConceptBadge from '../_components/ConceptBadge';
import { demoProperty, partnerFor, DEMO_PROPERTIES } from '../_lib/demoProperties';
import { activeSessionFor, getSession, seedDemoHistory, startSession } from '../_lib/sessionStore';
import { CONCEPT_BASE, isSessionCode, visitUrl } from '../_lib/links';

function useFitWidth(ref, aspect, ready) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ready) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setW(Math.max(200, Math.floor(Math.min(r.width, r.height * aspect))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, aspect, ready]);
  return w;
}

function Segmented({ value, options, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SignClient() {
  const params = useSearchParams();
  const property = demoProperty(params.get('property')) || DEMO_PROPERTIES[0];
  const partner = partnerFor(property);
  const [format, setFormat] = useState(SIGN_FORMATS[params.get('format')] ? params.get('format') : 'a4');
  const [theme, setTheme] = useState(params.get('theme') === 'light' ? 'light' : 'dark');
  const [showAddress, setShowAddress] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const [presenting, setPresenting] = useState(false);
  const stageRef = useRef(null);
  const presentRef = useRef(null);

  useEffect(() => {
    seedDemoHistory();
    const requested = params.get('session');
    const s = isSessionCode(requested) && getSession(requested) ? getSession(requested) : (activeSessionFor(property.id) || startSession(property.id));
    setSessionId(s.id);
  }, [params, property.id]);

  const f = SIGN_FORMATS[format];
  const aspect = f.mm[0] / f.mm[1];
  const fitW = useFitWidth(stageRef, aspect, !!sessionId);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  useEffect(() => {
    if (!presenting) return undefined;
    const el = presentRef.current;
    try { el?.requestFullscreen?.().catch(() => {}); } catch { /* not supported: the overlay still fills the window */ }
    const onKey = (e) => { if (e.key === 'Escape') setPresenting(false); };
    const onFs = () => { if (!document.fullscreenElement) setPresenting(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [presenting]);

  if (!sessionId) return null;
  const url = visitUrl(sessionId, property.id);
  const [mmW, mmH] = f.mm;
  const presentFormat = vp.w >= vp.h ? 'ipad' : 'a4';
  const pAspect = SIGN_FORMATS[presentFormat].mm[0] / SIGN_FORMATS[presentFormat].mm[1];
  const presentW = Math.floor(Math.min(vp.w, vp.h * pAspect));

  return (
    <div className="flex h-dvh flex-col bg-slate-100 print:block print:h-auto print:bg-white">
      <style>{`
        @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; }
          /* 0.6 mm short of the page: sub-pixel rounding at exactly the page height can spill a blank second page. */
          .oh-sign-print { width: ${mmW}mm !important; height: ${mmH - 0.6}mm !important; aspect-ratio: auto !important; font-size: calc(${mmW}mm / 100) !important; box-shadow: none !important; border-radius: 0 !important; break-inside: avoid; }
        }
      `}</style>

      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
          <Link href={`${CONCEPT_BASE}/agent`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Dashboard
          </Link>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-slate-900">Entrance QR sign</p>
            <p className="truncate text-xs text-slate-500">{property.street}, {property.suburb} · session {sessionId}</p>
          </div>
          <ConceptBadge />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Segmented
              label="Format"
              value={format}
              onChange={setFormat}
              options={Object.entries(SIGN_FORMATS).map(([value, o]) => ({ value, label: o.label, title: o.detail }))}
            />
            <Segmented label="Style" value={theme} onChange={setTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light', title: 'Uses less ink' }]} />
            <label className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-600">
              <input type="checkbox" checked={showAddress} onChange={(e) => setShowAddress(e.target.checked)} className="h-4 w-4 accent-slate-900" /> Address
            </label>
            <button type="button" onClick={() => setPresenting(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              <Maximize className="h-4 w-4" aria-hidden="true" /> Show full screen
            </button>
            <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3.5 text-[13px] font-semibold text-white hover:bg-slate-800">
              <Printer className="h-4 w-4" aria-hidden="true" /> Print or save PDF
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 p-6 print:p-0">
        <div ref={stageRef} className="flex h-full w-full items-center justify-center print:block print:h-auto">
          {fitW > 0 && (
            <EntranceSign
              className="oh-sign-print rounded-md shadow-[0_30px_60px_-30px_rgba(15,23,42,0.5)]"
              property={property}
              partner={partner}
              url={url}
              format={format}
              theme={theme}
              showAddress={showAddress}
              width={`${fitW}px`}
            />
          )}
        </div>
        <p className="mt-3 text-center text-xs text-slate-500 print:hidden">
          {f.label} · {f.detail}. The QR opens this open home&rsquo;s check-in{format === 'aframe' ? '. Send the PDF to a print shop for A-frame or corflute signs' : ''}.
        </p>
      </main>

      {presenting && vp.w > 0 && (
        <div ref={presentRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black print:hidden">
          <EntranceSign property={property} partner={partner} url={url} format={presentFormat} theme={theme} showAddress={showAddress} width={`${presentW}px`} />
          <button type="button" onClick={() => setPresenting(false)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25" aria-label="Exit full screen">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
