'use client';

/* eslint-disable @next/next/no-img-element -- demo listing photos are local static files shown at small fixed sizes */
import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Lock, Mail, Phone, User, House, Clock, Loader2 } from 'lucide-react';
import PriceOpinionSlider from '../../../components/PriceOpinionSlider';
import BrandLockup from './BrandLockup';
import { INTEREST_OPTIONS } from '../_lib/attendanceStore';
import { money, compactMoney, timeOfDay } from '../_lib/format';

/**
 * The buyer's four open-home screens, presentational only (state and data live in BuyerJourney.js). Mobile-first at
 * an iPhone's 390px width; brand colours come from the same --brand-* custom properties the buyer property page uses.
 */

const SERIF = { fontFamily: 'var(--font-playfair, Georgia, serif)' };

function Chip({ icon: Icon = Check, children, tone = 'green' }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
    slate: 'bg-slate-100 text-slate-600 ring-slate-900/5',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ${tones[tone]}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      {children}
    </span>
  );
}

function Header({ partner, tone = 'light' }) {
  return (
    <header className="flex items-center justify-between px-5 pb-3 pt-3">
      <BrandLockup partner={partner} tone={tone} height="21px" />
    </header>
  );
}

export function PrimaryButton({ children, busy = false, disabled = false, className = '', ...props }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary,#c2410c)] px-5 text-[17px] font-semibold text-[var(--brand-text-on-primary,#fff)] shadow-[0_12px_24px_-12px_rgba(15,23,42,0.6)] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${className}`}
      {...props}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : children}
    </button>
  );
}

function SecondaryButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`flex h-12 w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-[15px] font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.99] ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function PrivacyLine({ children }) {
  return (
    <p className="flex items-start justify-center gap-2 text-center text-[12.5px] leading-snug text-slate-500">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function PropertyCard({ property, partner }) {
  return (
    <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5">
      {property.imageUrl
        ? <img src={property.imageUrl} alt="" className="h-[60px] w-[76px] shrink-0 rounded-xl object-cover" />
        : <span className="grid h-[60px] w-[76px] shrink-0 place-items-center rounded-xl bg-slate-200 text-slate-500"><House className="h-6 w-6" aria-hidden="true" /></span>}
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-slate-900">{property.street}</p>
        <p className="truncate text-[13px] text-slate-500">{property.suburb} {property.state}</p>
        <p className="mt-0.5 truncate text-[12px] text-slate-500">
          Hosted by {property.agentName}{partner ? ` · ${partner.shortName}` : ''}
        </p>
      </div>
    </div>
  );
}

function Field({ label, icon: Icon, error, id, ...input }) {
  const errId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-slate-700">{label}</label>
      <div className="relative">
        <Icon className={`pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 ${error ? 'text-red-500' : 'text-slate-400'}`} aria-hidden="true" />
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className={`h-12 w-full rounded-xl border bg-white pl-11 pr-3 text-[16px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-4 ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : 'border-slate-300 focus:border-[var(--brand-primary,#c2410c)] focus:ring-[color-mix(in_srgb,var(--brand-primary,#c2410c)_18%,transparent)]'}`}
          {...input}
        />
      </div>
      {error && <p id={errId} className="mt-1.5 text-[13px] text-red-600">{error}</p>}
    </div>
  );
}

/* ── 1. Arrival and check-in ─────────────────────────────────────────────────────────────── */
export function CheckInScreen({ property, partner, form, errors = {}, formError = '', busy = false, onChange, onSubmit, formRef }) {
  const uid = useId();
  const set = (k) => (e) => onChange?.({ ...form, [k]: k === 'updatesOptIn' ? e.target.checked : e.target.value });
  return (
    <div className="flex min-h-full flex-1 flex-col bg-white text-slate-900" data-stage="check-in">
      <Header partner={partner} />
      <div className="flex flex-1 flex-col px-5 pb-8">
        <div className="mt-2"><Chip>Open home check-in</Chip></div>
        <h1 className="mt-3 text-[31px] font-semibold leading-[1.08] tracking-tight" style={SERIF}>Welcome to your inspection.</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-600">
          Check in once, enjoy the home, and share your anonymous price opinion before you leave.
        </p>
        <PropertyCard property={property} partner={partner} />

        <form
          ref={formRef}
          noValidate
          className="mt-5 space-y-3.5"
          onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}
          data-sentry-mask
        >
          <Field id={`${uid}-name`} label="Full name" icon={User} name="name" autoComplete="name" autoCapitalize="words" placeholder="Your name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
          <Field id={`${uid}-mobile`} label="Mobile number" icon={Phone} name="tel" type="tel" inputMode="tel" autoComplete="tel" placeholder="0412 345 678" value={form.mobile} onChange={set('mobile')} error={errors.mobile} />
          <Field id={`${uid}-email`} label="Email address" icon={Mail} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" value={form.email} onChange={set('email')} error={errors.email} />
          <label className="flex items-start gap-3 pt-1 text-[13.5px] leading-snug text-slate-600">
            <input type="checkbox" checked={!!form.updatesOptIn} onChange={set('updatesOptIn')} className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-[var(--brand-primary,#c2410c)]" />
            <span>Optional: send me updates about similar properties from {property.agentName}.</span>
          </label>
          {formError && <p className="text-center text-[13px] text-red-600" role="alert">{formError}</p>}
          <div className="pt-2">
            <PrimaryButton type="submit" busy={busy}>
              Check in <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </PrimaryButton>
          </div>
        </form>

        <p className="mt-5 flex gap-2 text-[12px] leading-relaxed text-slate-500" data-testid="collection-notice">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Your details go to {property.agentName}{partner ? ` at ${partner.name}` : ''} to record who attended this open home and to
            follow up with you about this property. Premarket keeps them securely on their behalf. They are never attached to your
            price opinion. No account or app needed.{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-slate-700 underline underline-offset-2">Privacy policy</a>
          </span>
        </p>
      </div>
    </div>
  );
}

function Progress({ opinionDone }) {
  return (
    <ol className="mt-3 space-y-3">
      <li className="flex items-center gap-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white"><Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /></span>
        <span className="text-[15px] font-semibold text-emerald-700">Check-in complete</span>
      </li>
      <li className="flex items-center gap-3">
        {opinionDone ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white"><Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /></span>
        ) : (
          <span className="h-6 w-6 rounded-full border-2 border-slate-300" aria-hidden="true" />
        )}
        <span className="text-[15px] text-slate-700">Anonymous price opinion <span className="text-slate-400">· a few seconds</span></span>
      </li>
    </ol>
  );
}

/* ── 2. Checked in ───────────────────────────────────────────────────────────────────────── */
export function CheckedInScreen({ property, partner, firstName, checkedInAt, onOpinion, interestSlot }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex min-h-full flex-1 flex-col bg-white text-slate-900" data-stage="checked-in">
      <Header partner={partner} />
      <div className="flex flex-1 flex-col px-4 pb-6">
        <section className="mt-1 rounded-[28px] border border-emerald-100 bg-gradient-to-b from-emerald-50 to-emerald-50/40 px-5 pb-6 pt-7 text-center" aria-live="polite">
          <motion.div
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="mx-auto grid h-[68px] w-[68px] place-items-center rounded-full bg-emerald-500 shadow-[0_14px_30px_-10px_rgba(16,185,129,0.75)]"
          >
            <Check className="h-9 w-9 text-white" strokeWidth={3} aria-hidden="true" />
          </motion.div>
          <h1 className="mt-4 text-[29px] font-semibold tracking-tight text-emerald-950">You&rsquo;re checked in!</h1>
          <p className="mt-1 text-[16px] text-emerald-800">Enjoy exploring the property.</p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-emerald-700/90">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {firstName ? `${firstName}, checked in` : 'Checked in'}{checkedInAt ? ` at ${timeOfDay(checkedInAt)}` : ''} · {property.street}
          </p>
        </section>

        <section className="mt-4 rounded-2xl border border-slate-200 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Your visit</p>
          <Progress opinionDone={false} />
        </section>

        <p className="mt-4 px-1 text-[15px] leading-relaxed text-slate-600">
          Take your time looking around. When you&rsquo;re ready, tell us what you think it&rsquo;s worth. You can leave this page
          open, or scan the sign again to come back to it.
        </p>

        <div className="mt-auto space-y-3 pt-6">
          <PrimaryButton onClick={onOpinion}>
            Leave my anonymous opinion <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </PrimaryButton>
          {interestSlot}
          <PrivacyLine>Your opinion is never linked to your check-in details.</PrivacyLine>
        </div>
      </div>
    </div>
  );
}

/* ── 3. Anonymous price opinion ──────────────────────────────────────────────────────────── */
/**
 * `notice`: what the agent will see, which sets the privacy wording beside the slider.
 *   'after-end' (live pilot from 25 Nov 2026): every amount once the open home ends, never who gave which.
 *   anything else (concept demo, earlier pilot open homes): combined results only.
 */
function OpinionNotice({ notice, agentName }) {
  if (notice === 'after-end') {
    return (
      <div data-testid="opinion-notice" data-notice="after-end">
        <p className="text-[14px] font-semibold text-emerald-900">Anonymous: your name isn&rsquo;t attached.</p>
        <p className="mt-0.5 text-[13px] leading-snug text-emerald-800/90">
          Your opinion is sent on its own, with no name, number, email or time. When the open home ends, {agentName} sees
          each amount given, lowest to highest, but never who gave which. If only a few people visit, they may be able to guess.
        </p>
      </div>
    );
  }
  return (
    <div data-testid="opinion-notice" data-notice="combined">
      <p className="text-[14px] font-semibold text-emerald-900">Completely anonymous.</p>
      <p className="mt-0.5 text-[13px] leading-snug text-emerald-800/90">
        Your opinion is sent on its own, with no name, number, email or time attached. {agentName} only ever sees
        combined results, after the open home.
      </p>
    </div>
  );
}

export function OpinionScreen({ property, partner, range, value, hasInteracted, busy = false, error, notice, onChange, onSlideStart, onSubmit, onDecline }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-white text-slate-900" data-stage="opinion">
      <Header partner={partner} />
      <div className="flex flex-1 flex-col px-5 pb-6" data-sentry-block>
        <div className="mt-2"><Chip icon={Lock}>Anonymous feedback</Chip></div>
        <h1 className="mt-3 text-[31px] font-semibold leading-[1.08] tracking-tight" style={SERIF}>What&rsquo;s this home worth to you?</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-600">
          There&rsquo;s no right or wrong answer. Slide to the price you think {property.street} is worth.
        </p>

        <div className="mt-5 rounded-3xl border border-slate-200 bg-white px-5 pb-5 pt-4 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)]">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Your price opinion</p>
          <div className="mt-1 flex h-[52px] items-center justify-center" aria-live="polite">
            {hasInteracted ? (
              <span className="text-[38px] font-semibold tabular-nums tracking-tight text-[var(--brand-primary,#c2410c)]" data-testid="opinion-value">{money(value)}</span>
            ) : (
              <span className="text-[17px] font-medium text-slate-400">Slide to choose a price</span>
            )}
          </div>
          <div className="mt-3">
            <PriceOpinionSlider
              min={range.min}
              max={range.max}
              value={value}
              onChange={onChange}
              onSlideStart={onSlideStart}
              invitePulse={!hasInteracted}
              ariaLabel="Price opinion"
              className="slider-thumb h-2 w-full cursor-pointer appearance-none rounded-full"
            />
            <div className="mt-2.5 flex justify-between text-[12px] font-medium tabular-nums text-slate-400">
              <span>{compactMoney(range.min)}</span>
              <span>{compactMoney(range.max)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
          <Lock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald-700" aria-hidden="true" />
          <OpinionNotice notice={notice} agentName={property.agentName} />
        </div>

        {error && <p className="mt-3 text-center text-[13px] text-red-600" role="alert">{error}</p>}

        <div className="mt-auto space-y-3 pt-6">
          <PrimaryButton onClick={onSubmit} disabled={!hasInteracted} busy={busy}>
            Submit anonymous opinion <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </PrimaryButton>
          <SecondaryButton onClick={onDecline}>I&rsquo;d prefer not to give an opinion</SecondaryButton>
        </div>
      </div>
    </div>
  );
}

/* ── Register interest (identity side; never carries an opinion) ─────────────────────────── */
export function InterestPanel({ property, state = 'idle', wants = [], onStart, onToggle, onSend, onCancel, compact = false }) {
  if (state === 'done') {
    return (
      <div className="flex items-start gap-3" aria-live="polite" data-testid="interest-done">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" /></span>
        <div>
          <p className="text-[15px] font-semibold text-slate-900">Interest registered</p>
          <p className="text-[13.5px] text-slate-600">{property.agentName} will be in touch using the details you checked in with.</p>
        </div>
      </div>
    );
  }
  if (state === 'form' || state === 'sending') {
    return (
      <div>
        <p className="text-[15px] font-semibold text-slate-900">Register your interest</p>
        <p className="mt-1 text-[13.5px] leading-snug text-slate-600">
          We&rsquo;ll send {property.agentName} the details you checked in with. Any price opinion stays anonymous and is never included.
        </p>
        <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">Anything that would help? (optional)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map((o) => {
            const on = wants.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle?.(o.id)}
                className={`rounded-full border px-3.5 py-2 text-[13.5px] font-medium transition ${on ? 'border-[var(--brand-primary,#c2410c)] bg-[var(--brand-primary,#c2410c)] text-white' : 'border-slate-300 bg-white text-slate-700'}`}
              >
                {on && <Check className="-ml-0.5 mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}
                {o.label}
              </button>
            );
          })}
        </div>
        <div className="mt-4 space-y-2">
          <PrimaryButton onClick={onSend} busy={state === 'sending'}>Send to {property.agentName.split(' ')[0]}</PrimaryButton>
          {onCancel && <button type="button" onClick={onCancel} className="w-full py-2 text-[14px] font-medium text-slate-500">Not now</button>}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700"><House className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <p className="text-[15px] font-semibold text-slate-900">Interested in this property?</p>
          <p className="mt-0.5 text-[13.5px] leading-snug text-slate-600">
            Register your interest and {property.agentName} will be in touch. Any price opinion stays anonymous and is never included.
          </p>
        </div>
      </div>
      <SecondaryButton onClick={onStart} className={compact ? 'mt-3' : 'mt-4'}>Register my interest</SecondaryButton>
    </div>
  );
}

/* ── 4. Completion: word for word the same whether or not an opinion was given ───────────── */
export function CompleteScreen({ partner, interest }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex min-h-full flex-1 flex-col bg-gradient-to-b from-emerald-500 via-emerald-600 to-emerald-700 text-white" data-stage="complete">
      <Header partner={partner} tone="dark" />
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-8 pt-4 text-center" aria-live="polite">
        <motion.div
          initial={reduce ? false : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 16 }}
          className="grid h-[132px] w-[132px] place-items-center rounded-full border-[6px] border-white/95 bg-white/10 shadow-[0_0_0_14px_rgba(255,255,255,0.08)]"
        >
          <svg viewBox="0 0 52 52" className="h-[72px] w-[72px]" aria-hidden="true">
            <motion.path
              d="M14 27 l8 8 l17 -18"
              fill="none"
              stroke="white"
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.25, duration: 0.45, ease: 'easeOut' }}
            />
          </svg>
        </motion.div>
        <h1 className="mt-7 text-[36px] font-semibold leading-tight tracking-tight">You&rsquo;re all done!</h1>
        <p className="mt-2 text-[17px] text-white/90">Thanks for visiting today.</p>
        <div className="mt-7 inline-flex items-center gap-2.5 rounded-2xl border-[2.5px] border-white px-6 py-3.5 text-[16px] font-bold tracking-[0.2em]">
          <Check className="h-5 w-5" strokeWidth={3.5} aria-hidden="true" /> VISIT COMPLETE
        </div>
      </div>
      <div className="rounded-t-[30px] bg-white px-5 pb-8 pt-6 text-slate-900">
        {interest}
      </div>
    </div>
  );
}

/* ── The open home has finished (the session was ended before this phone checked in) ─────── */
export function EndedScreen({ property, partner }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-white text-slate-900" data-stage="ended">
      <Header partner={partner} />
      <div className="flex flex-1 flex-col justify-center px-6 pb-16 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-600"><Clock className="h-7 w-7" aria-hidden="true" /></span>
        <h1 className="mt-5 text-[26px] font-semibold tracking-tight" style={SERIF}>This open home has finished.</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
          Thanks for your interest in {property.street}. Contact {property.agentName} to arrange another time to inspect.
        </p>
      </div>
    </div>
  );
}
