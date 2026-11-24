'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Check, RotateCcw, Smartphone, UserPlus, Play, X } from 'lucide-react';
import PhoneFrame from '../_components/PhoneFrame';
import BuyerJourney from '../_components/BuyerJourney';
import BrandLockup from '../_components/BrandLockup';
import ConceptBadge from '../_components/ConceptBadge';
import { SessionPanel } from '../_components/AgentDashboard';
import QrCode from '../../../components/QrCode';
import { DEMO_PROPERTIES, demoProperty, partnerFor } from '../_lib/demoProperties';
import { activeSessionFor, getSession, seedDemoHistory, startSession } from '../_lib/sessionStore';
import { forgetVisit } from '../_lib/visitState';
import { clearDemoData, subscribe } from '../_lib/demoStorage';
import { CONCEPT_BASE, signPath, visitUrl } from '../_lib/links';

const STEPS = [
  { stage: 'check-in', label: 'Check in' },
  { stage: 'checked-in', label: 'Inspect' },
  { stage: 'opinion', label: 'Opinion' },
  { stage: 'complete', label: 'Done' },
];

function Stepper({ stage }) {
  const at = STEPS.findIndex((s) => s.stage === stage);
  return (
    <ol className="flex items-center gap-2" aria-label="Buyer journey progress">
      {STEPS.map((s, i) => {
        const done = at > i;
        const current = at === i;
        return (
          <li key={s.stage} className="flex items-center gap-2">
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold transition ${current ? 'bg-slate-900 text-white' : done ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-400 ring-1 ring-slate-200'}`} aria-current={current ? 'step' : undefined}>
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="tabular-nums">{i + 1}</span>}
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-slate-300" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

function usePhoneWidth() {
  const [w, setW] = useState(340);
  useEffect(() => {
    const on = () => setW(Math.round(Math.max(270, Math.min(370, (window.innerHeight - 250) * (414 / 868)))));
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export default function DemoClient() {
  const params = useSearchParams();
  const [propertyId, setPropertyId] = useState(demoProperty(params.get('property'))?.id || DEMO_PROPERTIES[0].id);
  const property = demoProperty(propertyId);
  const partner = partnerFor(property);
  const [sessionId, setSessionId] = useState(null);
  const [round, setRound] = useState(0);
  const [stage, setStage] = useState('check-in');
  const [qrOpen, setQrOpen] = useState(false);
  const [, setVersion] = useState(0);
  const scrollRef = useRef(null);
  const phoneW = usePhoneWidth();

  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    seedDemoHistory();
    setSessionId((activeSessionFor(propertyId) || startSession(propertyId)).id);
    setRound((r) => r + 1);
  }, [propertyId]);

  const session = sessionId ? getSession(sessionId) : null;
  const nextBuyer = () => { if (sessionId) forgetVisit(sessionId); setRound((r) => r + 1); };
  const newOpenHome = () => { setSessionId(startSession(propertyId).id); setRound((r) => r + 1); };
  const reset = () => { clearDemoData(); seedDemoHistory(); setSessionId(startSession(propertyId).id); setRound((r) => r + 1); };
  const green = stage === 'complete';

  return (
    <div className="min-h-dvh bg-[#f3f4f6]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
          <BrandLockup partner={partner} height="20px" />
          <span className="hidden h-6 w-px bg-slate-200 md:block" />
          <p className="text-[14px] font-semibold text-slate-800">Interactive demo</p>
          <ConceptBadge />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="demo-property">Property</label>
            <select
              id="demo-property"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700"
            >
              {DEMO_PROPERTIES.map((p) => (
                <option key={p.id} value={p.id}>{p.street}, {p.suburb} · {partnerFor(p) ? partnerFor(p).shortName : 'Premarket only'}</option>
              ))}
            </select>
            <button type="button" onClick={reset} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset
            </button>
            <nav className="flex items-center gap-4 text-[13px] font-medium text-slate-500">
              <Link href={CONCEPT_BASE} className="hover:text-slate-900">Pitch</Link>
              <Link href={`${CONCEPT_BASE}/agent`} className="hover:text-slate-900">Agent dashboard</Link>
              {session && <Link href={signPath(session.id, propertyId)} className="hover:text-slate-900">QR sign</Link>}
            </nav>
          </div>
        </div>
      </header>

      {session && (
        <main className="mx-auto grid max-w-[1440px] gap-8 px-5 py-6 lg:grid-cols-[auto_minmax(0,1fr)]">
          <section className="flex flex-col items-center gap-4 lg:sticky lg:top-6 lg:self-start" aria-label="Buyer's phone">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">Buyer&rsquo;s phone</p>
            <PhoneFrame ref={scrollRef} width={phoneW} dark={green} statusBg={green ? '#10b981' : '#ffffff'} label="Buyer's phone">
              <BuyerJourney key={`${session.id}-${round}`} property={property} sessionId={session.id} scrollRoot={scrollRef} onStage={setStage} />
            </PhoneFrame>
            <Stepper stage={stage} />
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={nextBuyer} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50" data-testid="next-buyer">
                <UserPlus className="h-4 w-4" aria-hidden="true" /> Next buyer
              </button>
              <button type="button" onClick={() => setQrOpen((o) => !o)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50" aria-expanded={qrOpen}>
                <Smartphone className="h-4 w-4" aria-hidden="true" /> Try it on your phone
              </button>
            </div>
            {qrOpen && (
              <div className="relative w-[300px] rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-lg">
                <button type="button" onClick={() => setQrOpen(false)} className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
                <QrCode value={visitUrl(session.id, propertyId)} ecc="M" className="mx-auto h-auto w-44" title="Open this demo on your phone" />
                <p className="mt-2 text-[12.5px] leading-snug text-slate-600">
                  Scan with your phone camera to run the buyer journey on your own phone. In this demo each phone keeps its own data:
                  live syncing to this dashboard comes with the production build.
                </p>
              </div>
            )}
          </section>

          <section className="min-w-0" aria-label="Agent's live dashboard">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">Agent&rsquo;s live dashboard</p>
              {session.endedAt && (
                <button type="button" onClick={newOpenHome} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[13px] font-semibold text-white hover:bg-slate-800" data-testid="new-open-home">
                  <Play className="h-4 w-4" aria-hidden="true" /> Start a new open home
                </button>
              )}
            </div>
            <SessionPanel sessionId={session.id} compact />
          </section>
        </main>
      )}
    </div>
  );
}
