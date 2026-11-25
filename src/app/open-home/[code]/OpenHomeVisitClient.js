'use client';

import { useEffect, useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import BuyerJourney from '../../concepts/open-home/_components/BuyerJourney';
import BrandLockup from '../../concepts/open-home/_components/BrandLockup';
import { createLiveService } from '../liveService';
import { partnerFromBrand, brandStyleFromBrand } from '../../utils/openHome/brand';

function Message({ title, body, onRetry }) {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="flex justify-center"><BrandLockup height="24px" /></div>
        <h1 className="mt-8 text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-6 inline-flex h-11 items-center rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white">Try again</button>
        )}
      </div>
    </div>
  );
}

export default function OpenHomeVisitClient({ code }) {
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  const service = useMemo(() => createLiveService(code), [code]);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    fetch(`/api/open-home/visit/${encodeURIComponent(code)}`, { cache: 'no-store', credentials: 'omit' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setState({ data });
        else setState({ error: res.status === 404 ? 'invalid' : 'server', message: data.error });
      })
      .catch(() => { if (!cancelled) setState({ error: 'offline' }); });
    return () => { cancelled = true; };
  }, [code, attempt]);

  if (state.loading) {
    return <div className="grid min-h-dvh place-items-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" aria-label="Loading" /></div>;
  }
  if (state.error === 'invalid') {
    return <Message title="This open home link isn’t valid" body="Please scan the QR code at the entrance again, or ask the agent to check you in." />;
  }
  if (state.error) {
    return <Message title="We couldn’t load the open home" body="Please check your signal and try again." onRetry={() => setAttempt((a) => a + 1)} />;
  }

  const { data } = state;
  const property = {
    street: data.property.street,
    suburb: data.property.suburb,
    state: '',
    postcode: '',
    imageUrl: data.property.imageUrl,
    agentName: data.property.agentName,
  };

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      {data.mode === 'test' && (
        <div className="flex items-center justify-center gap-2 bg-amber-300 px-3 py-1.5 text-center text-[12px] font-semibold text-amber-950" data-testid="test-mode-banner">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
          Test open home · practice only, not kept with the campaign
        </div>
      )}
      <BuyerJourney
        property={property}
        sessionId={code}
        service={service}
        partner={partnerFromBrand(data.brand)}
        range={data.range}
        brandStyle={brandStyleFromBrand(data.brand)}
        ended={data.state === 'ended'}
        opinionNotice={data.opinionRule}
      />
    </div>
  );
}
