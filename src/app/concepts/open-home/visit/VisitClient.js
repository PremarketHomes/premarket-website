'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import BuyerJourney from '../_components/BuyerJourney';
import BrandLockup from '../_components/BrandLockup';
import { demoProperty } from '../_lib/demoProperties';
import { ensureVisitSession } from '../_lib/sessionStore';
import { forgetVisit } from '../_lib/visitState';
import { isSessionCode } from '../_lib/links';

export default function VisitClient() {
  const params = useSearchParams();
  const sessionId = params.get('session') || '';
  const property = demoProperty(params.get('property'));
  const valid = isSessionCode(sessionId) && !!property;
  const [ready, setReady] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (valid) ensureVisitSession(sessionId, property.id);
    setReady(true);
  }, [valid, sessionId, property]);

  if (!ready) return null;
  if (!valid) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <div className="flex justify-center"><BrandLockup height="24px" /></div>
          <h1 className="mt-8 text-xl font-semibold">This open-home link isn&rsquo;t complete</h1>
          <p className="mt-2 text-sm text-slate-600">Please scan the QR code at the entrance again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <div className="flex items-center justify-center gap-3 bg-amber-300 px-3 py-1.5 text-center text-[12px] font-semibold text-amber-950">
        <span>Concept demo · nothing leaves this phone</span>
        <button
          type="button"
          onClick={() => { forgetVisit(sessionId); setRound((r) => r + 1); }}
          className="rounded-full bg-amber-950/10 px-2.5 py-0.5 underline-offset-2 hover:underline"
        >
          Start again
        </button>
      </div>
      <BuyerJourney key={round} property={property} sessionId={sessionId} />
    </div>
  );
}
