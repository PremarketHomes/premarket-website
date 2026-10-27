'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import KioskSlider from './KioskSlider';
import { createKioskController, KIOSK_TIMING } from '../../utils/kioskController';
import { createKioskOutbox } from '../../utils/kioskOutbox';
import {
  buildOpinionItem,
  buildRegistrationItem,
  generateOfferId,
  generateKioskSessionId,
  notifyKioskItem,
  safeLocalStorage,
  writeKioskItem,
} from '../../utils/kioskPersistence';
import { PRICE_OPINION_STEP, roundToStep } from '../../utils/priceOpinionStep';

const money = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v || 0);
const compact = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', notation: 'compact', maximumFractionDigits: 1 }).format(v || 0);

const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '' };
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Full-screen iPad open-home experience. ONE page: a buyer slides the price
 * opinion slider, lets go, and is asked "Happy with $X?" — their opinion is only
 * recorded once they approve it (walking away discards it). No welcome screen, no
 * steps. See utils/kioskController.js (when an opinion is recorded),
 * utils/kioskOutbox.js (durable, idempotent saving) and
 * utils/kioskPersistence.js (what is written).
 *
 * Honesty rule: the screen only says an opinion/registration is "saved" after
 * the server has acknowledged it. Otherwise it says it is stored on this iPad
 * and will upload when the connection returns.
 */
export default function OpenHomeKiosk({
  propertyId,
  title,
  addressLine,
  imageUrl,
  agentName,
  companyName,
  logoUrl,
  avatarUrl,
  brandStyle,
  minPrice,
  maxPrice,
  step = PRICE_OPINION_STEP,
  demoMode = false,        // preview/demo: the full flow runs but NOTHING is written
  timing = KIOSK_TIMING,
  onExit,
  onOpinionPersisted,      // (opinion) — after the server acknowledged it (analytics, view count)
  onRegistrationPersisted, // ({ docId }) — after the server acknowledged it
  getVisitorId = () => null,
}) {
  const baseline = useMemo(() => roundToStep((minPrice + maxPrice) / 2, step), [minPrice, maxPrice, step]);

  // ── per-visit data (not React state: must be exact inside timers/callbacks) ──
  const visit = useRef({ opinion: null, sessionId: null });
  const latest = useRef({});
  latest.current = { propertyId, demoMode, onOpinionPersisted, onRegistrationPersisted, getVisitorId };

  const [ui, setUi] = useState({ phase: 'idle', value: baseline, moved: false, committed: null, held: false });
  const [sync, setSync] = useState({ pending: 0, failing: 0, durable: true });
  const [opinionState, setOpinionState] = useState('none'); // none | pending | acked | queued | demo
  const [online, setOnline] = useState(true);

  // ── controller ───────────────────────────────────────────────────────
  const outboxRef = useRef(null);
  const ctrlRef = useRef(null);
  if (!ctrlRef.current) {
    ctrlRef.current = createKioskController({
      baseline,
      timing,
      newId: generateOfferId,
      onChange: (s) => {
        // A visit is over: nothing about it (opinion id, session) may leak to the next visitor,
        // or their registration would be tied to someone else's opinion.
        if (s.phase === 'idle' && !s.committed) {
          visit.current = { opinion: null, sessionId: null };
          setOpinionState('none');
        }
        setUi(s);
      },
      onCommit: (opinion) => {
        const { propertyId: pid, demoMode: demo, getVisitorId: vid } = latest.current;
        const sessionId = generateKioskSessionId();
        visit.current = { opinion, sessionId };
        if (demo) { setOpinionState('demo'); return; }
        setOpinionState('pending');
        const item = buildOpinionItem({ propertyId: pid, opinion, sessionId, visitorId: vid() });
        outboxRef.current?.enqueue(item);
        // Honest fallback wording if the server hasn't acknowledged quickly.
        setTimeout(() => setOpinionState((s) => (s === 'pending' ? 'queued' : s)), timing.queuedAfterMs);
      },
    });
  }
  const ctrl = ctrlRef.current;

  // New price range → new de-anchored starting point (only applied while idle).
  useEffect(() => { ctrl.setBaseline(baseline); }, [ctrl, baseline]);

  // ── outbox: durable queue, flushed on reload / reconnect / return to tab ──
  useEffect(() => {
    if (demoMode) return undefined;
    const outbox = createKioskOutbox({
      storage: safeLocalStorage(),
      write: writeKioskItem,
      notify: notifyKioskItem,
    });
    outboxRef.current = outbox;
    const unsub = outbox.subscribe((ev) => {
      if (ev.type === 'status') { setSync({ pending: ev.pending, failing: ev.failing, durable: ev.durable }); return; }
      if (ev.type !== 'acked') return;
      if (ev.kind === 'opinion') {
        const o = visit.current.opinion;
        if (o && o.id === ev.docId) setOpinionState('acked');
        latest.current.onOpinionPersisted?.({ id: ev.docId });
      } else if (ev.kind === 'registration') {
        setRegState((s) => (s.docId === ev.docId ? { ...s, acked: true } : s));
        latest.current.onRegistrationPersisted?.({ docId: ev.docId });
      }
    });
    const wake = () => { if (document.visibilityState !== 'hidden') outbox.flush({ force: true }); };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    outbox.flush(); // pick up anything left from before a reload
    setSync(outbox.status());
    return () => {
      unsub();
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      outbox.destroy();
      outboxRef.current = null;
    };
  }, [demoMode]);

  useEffect(() => {
    const update = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => () => ctrl.destroy(), [ctrl]);

  // ── kiosk hygiene: no page scroll/bounce/pinch, keep the screen awake ──
  useEffect(() => {
    const body = document.body;
    const prev = { overflow: body.style.overflow, overscroll: body.style.overscrollBehavior };
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    const stop = (e) => e.preventDefault();
    document.addEventListener('gesturestart', stop); // iOS Safari pinch-zoom
    let lock = null;
    const acquire = async () => {
      try { if (navigator.wakeLock && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch { /* unsupported or denied */ }
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      body.style.overflow = prev.overflow;
      body.style.overscrollBehavior = prev.overscroll;
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('visibilitychange', acquire);
      try { lock?.release?.(); } catch { /* ignore */ }
    };
  }, []);

  // ── register-interest modal ──────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [regState, setRegState] = useState({ submitted: false, docId: null, acked: false, slow: false });
  const modalRef = useRef(null);
  const openerRef = useRef(null);
  const idleTimer = useRef(null);
  const closeTimer = useRef(null);

  const clearIdle = () => { if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; } };
  const clearClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };

  // Wipe everything the visitor typed and close — used by the X, Esc, idle timeout and after submit.
  const closeModal = useCallback(({ resetVisit = false } = {}) => {
    clearIdle();
    clearClose();
    setModalOpen(false);
    setForm(EMPTY_FORM);
    setFormError('');
    setRegState({ submitted: false, docId: null, acked: false, slow: false });
    ctrl.release({ resetNow: resetVisit });
    openerRef.current?.focus?.();
  }, [ctrl]);

  const armIdle = useCallback(() => {
    clearIdle();
    idleTimer.current = setTimeout(() => closeModal({ resetVisit: true }), timing.modalIdleMs);
  }, [closeModal, timing.modalIdleMs]);

  const openModal = () => {
    ctrl.hold(); // keep this visit so a registration is tied to the opinion just given
    setModalOpen(true);
    armIdle();
  };

  useEffect(() => () => { clearIdle(); clearClose(); }, []);

  // Focus management + Esc + simple focus trap.
  useEffect(() => {
    if (!modalOpen) return undefined;
    const node = modalRef.current;
    node?.querySelector('input')?.focus();
    const onKey = (e) => {
      armIdle();
      if (e.key === 'Escape') { closeModal({ resetVisit: false }); return; }
      if (e.key !== 'Tab' || !node) return;
      const f = [...node.querySelectorAll('button, input, [href]')].filter((el) => !el.disabled);
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalOpen, armIdle, closeModal]);

  const submitRegistration = (e) => {
    e.preventDefault();
    const { firstName, lastName, email, phone } = form;
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      setFormError('Please add your name, email and phone so the agent can reach you.');
      return;
    }
    if (!EMAIL_OK.test(email.trim())) { setFormError('That email address doesn’t look right.'); return; }
    if (regState.submitted) return; // single-flight: ignore a double tap

    clearIdle();
    const { opinion, sessionId } = visit.current;
    const docId = opinion?.id || generateOfferId();
    const createdAtIso = new Date(opinion?.at || Date.now()).toISOString();
    setFormError('');
    setRegState({ submitted: true, docId, acked: false, slow: false });

    if (!latest.current.demoMode) {
      outboxRef.current?.enqueue(buildRegistrationItem({
        propertyId: latest.current.propertyId,
        docId,
        sessionId: sessionId || generateKioskSessionId(),
        visitorId: latest.current.getVisitorId(),
        amount: opinion?.amount,
        createdAtIso,
        buyer: form,
      }));
      setTimeout(() => setRegState((s) => (s.docId === docId && !s.acked ? { ...s, slow: true } : s)), timing.queuedAfterMs);
    }
    // Typed details are wiped from state immediately; they now only exist in the durable queue until acknowledged.
    setForm(EMPTY_FORM);
    clearClose();
    closeTimer.current = setTimeout(() => closeModal({ resetVisit: true }), 4000);
  };

  // ── staff exit: hidden 3-second long-press on the logo ────────────────
  const exitTimer = useRef(null);
  const exitHintTimer = useRef(null);
  const [exitProgress, setExitProgress] = useState(false);
  const startExit = () => {
    if (!onExit) return;
    cancelExit();
    exitHintTimer.current = setTimeout(() => setExitProgress(true), 600);
    exitTimer.current = setTimeout(() => { exitTimer.current = null; setExitProgress(false); onExit(); }, timing.exitHoldMs);
  };
  function cancelExit() {
    if (exitTimer.current) { clearTimeout(exitTimer.current); exitTimer.current = null; }
    if (exitHintTimer.current) { clearTimeout(exitHintTimer.current); exitHintTimer.current = null; }
    setExitProgress(false);
  }
  useEffect(() => cancelExit, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── wording (honest) ─────────────────────────────────────────────────
  const offline = !online;
  const thanksText = (() => {
    if (opinionState === 'demo') return 'Demo only — nothing is saved';
    if (opinionState === 'acked') return 'Thank you — your opinion is saved';
    if (opinionState === 'queued' || offline) return 'Thank you — stored on this iPad, it will upload when the connection returns';
    return 'Thank you — saving your opinion…';
  })();
  const regText = (() => {
    if (demoMode) return 'Demo only — nothing was sent';
    if (regState.acked) return `Thank you — your details are saved and ${agentName || 'the agent'} will be in touch`;
    if (regState.slow || offline) return 'Thank you — your details are stored on this iPad and will be sent when the connection returns';
    return 'Sending your details…';
  })();
  const syncText = (() => {
    if (demoMode || sync.pending === 0) return null;
    const n = sync.pending;
    if (offline || sync.failing > 0) return `Offline — ${n} waiting to upload`;
    return `Uploading ${n}…`;
  })();

  // ── render ───────────────────────────────────────────────────────────
  const showPrice = ui.moved || ui.phase === 'thanks';
  const confirming = ui.phase === 'confirming';
  const thanks = ui.phase === 'thanks';

  return (
    <div
      style={{ ...brandStyle, height: '100dvh', minHeight: '100vh', WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
      className="fixed inset-0 overflow-hidden bg-slate-900 text-white select-none"
      data-testid="open-home-kiosk"
    >
      {/* Photo + brand-tinted overlay */}
      <div className="absolute inset-0" aria-hidden="true">
        {imageUrl ? (
          <Image src={imageUrl} alt="" fill priority unoptimized sizes="100vw" className="object-cover" draggable={false} />
        ) : (
          <div className="h-full w-full" style={{ background: 'linear-gradient(135deg, var(--brand-primary-dark, #0f172a), var(--brand-primary, #334155))' }} />
        )}
        <div className="absolute inset-0 pm-kiosk-overlay" />
      </div>

      {demoMode && (
        <div className="absolute left-0 right-0 top-0 z-40 bg-amber-400 py-1.5 text-center text-xs font-semibold text-amber-950">
          Demo mode — the full flow runs but nothing is saved or sent
        </div>
      )}

      <main className="relative z-10 flex h-full flex-col px-[clamp(20px,5vw,72px)] pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
        {/* Header: office / agent branding. Long-press the logo for 3s = staff exit. */}
        <header className="flex items-center justify-between gap-4 pt-3">
          <div
            className="relative flex items-center gap-4"
            onPointerDown={startExit}
            onPointerUp={cancelExit}
            onPointerLeave={cancelExit}
            onPointerCancel={cancelExit}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
            data-testid="kiosk-logo"
          >
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={companyName || 'Agency logo'}
                width={200}
                height={80}
                unoptimized
                draggable={false}
                className="h-[clamp(44px,7vh,76px)] w-auto max-w-[44vw] rounded-xl bg-white/95 object-contain p-2 shadow-lg"
              />
            ) : companyName ? (
              <span className="text-[clamp(18px,2.6vw,30px)] font-bold tracking-tight drop-shadow">{companyName}</span>
            ) : null}
            {exitProgress && <span className="absolute -bottom-2 left-0 h-1 w-full animate-pulse rounded bg-white/70" aria-hidden="true" />}
          </div>

          {(agentName || avatarUrl) && (
            <div className="flex items-center gap-3">
              {avatarUrl && (
                <Image src={avatarUrl} alt="" width={56} height={56} unoptimized draggable={false} className="h-14 w-14 rounded-full border-2 border-white/80 object-cover shadow-lg" />
              )}
              {agentName && (
                <div className="text-right leading-tight">
                  <p className="text-[clamp(14px,1.8vw,20px)] font-semibold drop-shadow">{agentName}</p>
                  {companyName && logoUrl && <p className="text-xs text-white/80">{companyName}</p>}
                </div>
              )}
            </div>
          )}
        </header>

        {/* Centre: address, price, slider, assurance copy */}
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
          <p className="mb-3 rounded-full bg-white/15 px-4 py-1 text-xs font-bold uppercase tracking-[0.2em] backdrop-blur">Open home · Your price opinion</p>
          <h1 className="max-w-[18ch] text-balance text-[clamp(30px,5.4vw,68px)] font-bold leading-[1.05] drop-shadow-lg sm:max-w-[26ch]">
            {addressLine || title}
          </h1>

          <div className="my-[clamp(14px,3vh,36px)] flex min-h-[clamp(70px,12vh,130px)] items-center justify-center" aria-live="off">
            {showPrice ? (
              <p className={`text-[clamp(48px,9vw,120px)] font-extrabold leading-none tabular-nums drop-shadow-xl transition-opacity ${thanks ? 'opacity-70' : ''}`}>
                {money(ui.value)}
              </p>
            ) : (
              <p className="text-[clamp(22px,3.4vw,44px)] font-semibold text-white/90 drop-shadow">What do you think it’s worth?</p>
            )}
          </div>

          <div className="w-full max-w-[min(900px,90vw)]">
            <KioskSlider
              min={minPrice}
              max={maxPrice}
              step={step}
              value={ui.value}
              disabled={modalOpen}
              invite={ui.phase === 'idle' && !ui.moved}
              valueText={money(ui.value)}
              onGestureStart={() => ctrl.gestureStart()}
              onGestureMove={(v) => ctrl.gestureMove(v)}
              onGestureEnd={(r) => ctrl.gestureEnd(r)}
            />
            <div className="mt-1 flex justify-between text-sm font-medium text-white/80" aria-hidden="true">
              <span>{compact(minPrice)}</span>
              <span>{compact(maxPrice)}</span>
            </div>
          </div>

          {/* Either the anonymity assurance, or — after release — the approval question. Same box, so nothing jumps. */}
          <div className="mt-[clamp(14px,3vh,32px)] flex min-h-[clamp(104px,15vh,140px)] w-full max-w-[40rem] items-center justify-center">
            {confirming ? (
              <div role="group" aria-labelledby="kiosk-confirm-title" className="w-full rounded-3xl bg-white/95 p-4 text-slate-900 shadow-2xl" data-testid="kiosk-confirm">
                <p id="kiosk-confirm-title" className="text-[clamp(18px,2.4vw,26px)] font-bold leading-tight">
                  Happy with <span className="tabular-nums">{money(ui.value)}</span>?
                </p>
                <p className="mt-0.5 text-sm text-slate-600">Your opinion is anonymous and only counts once you approve it.</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => ctrl.approve()}
                    className="min-h-[56px] flex-1 rounded-2xl bg-[var(--brand-primary,#c2410c)] px-5 text-lg font-bold text-[var(--brand-text-on-primary,#fff)] shadow-lg transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/40"
                  >
                    Yes, record my opinion
                  </button>
                  <button
                    type="button"
                    onClick={() => ctrl.reset()}
                    className="min-h-[56px] rounded-2xl border border-slate-300 bg-white px-5 text-base font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/30"
                  >
                    Start again
                  </button>
                </div>
              </div>
            ) : (
              <p className="max-w-[40ch] text-center text-[clamp(14px,1.7vw,20px)] leading-snug text-white/90">
                <span className="font-semibold">Anonymous — no name, no sign-up.</span> Slide to show what you think this home is worth. Your opinion helps guide the owner.
              </p>
            )}
          </div>

          {/* Thank-you: a quiet pill, never a blocking screen */}
          <div className="mt-4 h-12" role="status" aria-live="polite">
            {thanks && !modalOpen && (
              <p className="inline-flex items-center gap-2 rounded-full bg-white/95 px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-xl" data-testid="kiosk-thanks">
                <svg className="h-5 w-5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                {thanksText}
              </p>
            )}
          </div>
        </section>

        {/* Footer: discreet Register interest + subtle Powered by Premarket */}
        <footer className="flex flex-col items-center gap-3 pb-2">
          <button
            ref={openerRef}
            type="button"
            onClick={openModal}
            className="min-h-[52px] rounded-full border border-white/60 bg-white/10 px-8 text-base font-semibold text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
          >
            Register interest
          </button>
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
            Powered by
            <Image src="https://premarketvideos.b-cdn.net/assets/logo.png" alt="Premarket" width={96} height={24} unoptimized draggable={false} className="h-4 w-auto opacity-70 brightness-0 invert" />
          </p>
        </footer>

        {syncText && (
          <p className="absolute bottom-3 left-4 text-[10px] font-medium text-white/50" data-testid="kiosk-sync">{syncText}</p>
        )}
      </main>

      {/* Register interest — modal on the SAME page */}
      {modalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onPointerDown={armIdle}>
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiosk-register-title"
            className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-7 text-slate-900 shadow-2xl"
            onInput={armIdle}
          >
            {regState.submitted ? (
              <div className="py-6 text-center" role="status" aria-live="polite" data-testid="kiosk-reg-done">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                  <svg className="h-7 w-7 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                </div>
                <h2 id="kiosk-register-title" className="text-xl font-bold">Thanks</h2>
                <p className="mt-2 text-sm text-slate-600">{regText}</p>
              </div>
            ) : (
              <form onSubmit={submitRegistration} noValidate>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 id="kiosk-register-title" className="text-xl font-bold">Register your interest</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      We’ll pass your details to {agentName || 'the listing agent'} so they can get in touch. Your price opinion stays anonymous.
                    </p>
                  </div>
                  <button type="button" onClick={() => closeModal({ resetVisit: false })} aria-label="Close" className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-medium">First name
                    <input name="firstName" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoComplete="off" autoCapitalize="words" className="mt-1 h-12 w-full rounded-xl border border-slate-300 px-3 text-base" />
                  </label>
                  <label className="block text-sm font-medium">Last name
                    <input name="lastName" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} autoComplete="off" autoCapitalize="words" className="mt-1 h-12 w-full rounded-xl border border-slate-300 px-3 text-base" />
                  </label>
                </div>
                <label className="mt-3 block text-sm font-medium">Email
                  <input name="email" type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" autoCapitalize="off" autoCorrect="off" className="mt-1 h-12 w-full rounded-xl border border-slate-300 px-3 text-base" />
                </label>
                <label className="mt-3 block text-sm font-medium">Mobile
                  <input name="phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" className="mt-1 h-12 w-full rounded-xl border border-slate-300 px-3 text-base" />
                </label>

                {formError && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{formError}</p>}

                <button type="submit" className="mt-5 min-h-[52px] w-full rounded-xl bg-[var(--brand-primary,#c2410c)] px-4 text-base font-bold text-[var(--brand-text-on-primary,#fff)] shadow-lg">
                  Send my details
                </button>
                <p className="mt-3 text-center text-xs text-slate-500">This form clears itself if left untouched for a minute.</p>
              </form>
            )}
          </div>
        </div>
      )}

      <style>{`
        .pm-kiosk-overlay {
          background:
            linear-gradient(180deg, rgba(2,6,23,.55) 0%, rgba(2,6,23,.5) 38%, rgba(2,6,23,.8) 100%);
        }
        @supports (background: color-mix(in srgb, red 50%, blue)) {
          .pm-kiosk-overlay {
            background:
              linear-gradient(180deg, color-mix(in srgb, var(--brand-primary, #334155) 42%, rgba(2,6,23,.55)) 0%, rgba(2,6,23,.5) 40%, color-mix(in srgb, var(--brand-primary-dark, #0f172a) 40%, rgba(2,6,23,.82)) 100%);
          }
        }
      `}</style>
    </div>
  );
}
