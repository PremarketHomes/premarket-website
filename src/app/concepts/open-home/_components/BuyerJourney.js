'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckInScreen, CheckedInScreen, OpinionScreen, CompleteScreen, EndedScreen, InterestPanel } from './BuyerScreens';
import { partnerFor, opinionRangeFor, brandStyleFor } from '../_lib/demoProperties';
import { validateCheckIn, firstNameOf } from '../_lib/checkInForm';
import { createDemoService } from '../_lib/demoService';
import { roundToStep } from '../../../utils/priceOpinionStep';

const EMPTY_FORM = { fullName: '', mobile: '', email: '', updatesOptIn: false };

/**
 * The buyer's open-home visit on their own phone: check in → checked in → anonymous opinion → done.
 *
 * Two flows that never meet:
 *   - identity:  service.checkIn(details) and service.registerInterest(ref)   (who visited)
 *   - opinion:   service.submitOpinion(amount)                                (amount only)
 * The opinion call carries the amount and nothing else: not the check-in reference, the name or a timestamp. What this
 * phone remembers (service.loadVisit/saveVisit) is for this buyer only, to reopen where they left off.
 *
 * `service`: the concept demo's browser-local stores by default (_lib/demoService.js); the live pilot passes its
 * server-backed one (open-home/liveService.js) plus the real `partner`, `range`, `brandStyle` and `ended`.
 * `onStage(stage)`: lets a presenter view follow along. `scrollRoot`: the element that scrolls (the phone screen in a
 * framed demo; the window on a real phone).
 */
export default function BuyerJourney({ property, sessionId, onStage, scrollRoot, service: serviceProp, partner: partnerProp, range: rangeProp, brandStyle: brandStyleProp, ended: endedProp, opinionNotice }) {
  const partner = useMemo(() => (partnerProp !== undefined ? partnerProp : partnerFor(property)), [partnerProp, property]);
  const range = useMemo(() => rangeProp || opinionRangeFor(property), [rangeProp, property]);
  const service = useMemo(() => serviceProp || createDemoService(sessionId, range), [serviceProp, sessionId, range]);
  const baseline = useMemo(() => roundToStep((range.min + range.max) / 2), [range]);
  const reduce = useReducedMotion();

  const [ready, setReady] = useState(false);
  const [visit, setVisit] = useState(null);
  const [ended, setEnded] = useState(false);
  const [opinionOpen, setOpinionOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(baseline);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [opinionError, setOpinionError] = useState('');
  const [interest, setInterest] = useState({ state: 'idle', wants: [] });
  const formRef = useRef(null);

  useEffect(() => {
    const load = () => {
      setVisit(service.loadVisit());
      setEnded(endedProp !== undefined ? endedProp : service.isEnded());
    };
    load();
    setReady(true);
    return service.subscribe ? service.subscribe(load) : undefined;
  }, [service, endedProp]);

  const stage = !ready ? 'loading'
    : visit?.stage === 'complete' ? 'complete'
      : visit?.stage === 'checked-in' ? (opinionOpen ? 'opinion' : 'checked-in')
        : ended ? 'ended' : 'check-in';

  useEffect(() => {
    if (stage === 'loading') return;
    onStage?.(stage, visit?.outcome || null);
    const root = scrollRoot?.current;
    if (root) root.scrollTo({ top: 0 });
    else if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((next) => { service.saveVisit(next); setVisit(next); }, [service]);

  const submitCheckIn = async () => {
    if (busy) return;
    const v = validateCheckIn(form);
    setErrors(v.errors);
    setFormError('');
    if (!v.ok) {
      const firstBad = ['fullName', 'mobile', 'email'].find((k) => v.errors[k]);
      const idx = { fullName: 0, mobile: 1, email: 2 }[firstBad];
      formRef.current?.querySelectorAll('input')[idx]?.focus();
      return;
    }
    setBusy(true);
    const res = await service.checkIn(form);
    setBusy(false);
    if (!res.ok) {
      setErrors(res.errors || {});
      if (res.code === 'ended') setEnded(true);
      else if (!res.errors) setFormError(res.message || 'That didn’t go through. Please try again.');
      return;
    }
    update({ stage: 'checked-in', firstName: firstNameOf(v.value.fullName), ref: res.ref, checkedInAt: new Date().toISOString(), outcome: null, interest: false });
    setForm(EMPTY_FORM); // typed details don't linger in memory once sent
  };

  const sendOpinion = async () => {
    if (busy || !hasInteracted) return;
    setBusy(true);
    setOpinionError('');
    // The amount only. Deliberately NOT visit.ref, the buyer's name or the time.
    const res = await service.submitOpinion(value);
    setBusy(false);
    if (!res.ok) { setOpinionError(res.message || 'That didn’t send. Please try again.'); return; }
    update({ ...visit, stage: 'complete', outcome: 'opinion' });
  };

  const decline = () => update({ ...visit, stage: 'complete', outcome: 'declined' });

  const sendInterest = async () => {
    setInterest((s) => ({ ...s, state: 'sending' }));
    const res = await service.registerInterest(visit?.ref, interest.wants);
    if (!res.ok) { setInterest((s) => ({ ...s, state: 'form' })); return; }
    update({ ...(service.loadVisit() || visit), interest: true });
    setInterest({ state: 'done', wants: [] });
  };

  const interestState = visit?.interest ? 'done' : interest.state;
  const interestPanel = (compact) => (
    <InterestPanel
      property={property}
      state={interestState}
      wants={interest.wants}
      compact={compact}
      onStart={() => setInterest({ state: 'form', wants: [] })}
      onToggle={(id) => setInterest((s) => ({ ...s, wants: s.wants.includes(id) ? s.wants.filter((w) => w !== id) : [...s.wants, id] }))}
      onSend={sendInterest}
      onCancel={compact ? () => setInterest({ state: 'idle', wants: [] }) : undefined}
    />
  );

  const checkedInInterest = interestState === 'idle' ? (
    <button
      type="button"
      onClick={() => setInterest({ state: 'form', wants: [] })}
      className="w-full py-2 text-[14.5px] font-semibold text-slate-600 underline underline-offset-4 hover:text-slate-900"
    >
      Already know it&rsquo;s for you? Register your interest
    </button>
  ) : (
    <div className="rounded-2xl border border-slate-200 p-4">{interestPanel(true)}</div>
  );

  let screen = null;
  if (stage === 'check-in') {
    screen = <CheckInScreen property={property} partner={partner} form={form} errors={errors} formError={formError} busy={busy} onChange={(f) => { setForm(f); if (Object.keys(errors).length) setErrors({}); }} onSubmit={submitCheckIn} formRef={formRef} />;
  } else if (stage === 'checked-in') {
    screen = (
      <CheckedInScreen
        property={property}
        partner={partner}
        firstName={visit.firstName}
        checkedInAt={visit.checkedInAt}
        onOpinion={() => setOpinionOpen(true)}
        interestSlot={checkedInInterest}
      />
    );
  } else if (stage === 'opinion') {
    screen = (
      <OpinionScreen
        property={property}
        partner={partner}
        range={range}
        value={value}
        hasInteracted={hasInteracted}
        busy={busy}
        error={opinionError}
        notice={opinionNotice}
        onChange={(v) => { setValue(v); setHasInteracted(true); }}
        onSlideStart={() => setHasInteracted(true)}
        onSubmit={sendOpinion}
        onDecline={decline}
      />
    );
  } else if (stage === 'complete') {
    screen = <CompleteScreen partner={partner} interest={interestPanel(false)} />;
  } else if (stage === 'ended') {
    screen = <EndedScreen property={property} partner={partner} />;
  }

  return (
    <div className="relative flex min-h-full flex-1 flex-col" style={brandStyleProp || brandStyleFor(property)} data-journey-stage={stage}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stage}
          className="flex min-h-full flex-1 flex-col"
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -28 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        >
          {screen}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
