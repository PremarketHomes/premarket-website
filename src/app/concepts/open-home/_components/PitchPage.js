'use client';

/* eslint-disable @next/next/no-img-element -- local decorative photo behind the hero */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowRight, Check, ChevronDown, ClipboardCheck, EyeOff, Lock, MonitorSmartphone, Printer, QrCode as QrIcon,
  ShieldCheck, Smartphone, Sparkles, TrendingUp, Users, Timer, Wrench,
} from 'lucide-react';
import PhoneFrame from './PhoneFrame';
import BrandLockup from './BrandLockup';
import ConceptBadge from './ConceptBadge';
import EntranceSign from './EntranceSign';
import { DashboardPreview } from './AgentDashboard';
import { CheckInScreen, CheckedInScreen, OpinionScreen, CompleteScreen, InterestPanel } from './BuyerScreens';
import { DEMO_PROPERTIES, brandStyleFor, opinionRangeFor, partnerFor } from '../_lib/demoProperties';
import { CONCEPT_BASE, visitUrl } from '../_lib/links';
import { roundToStep } from '../../../utils/priceOpinionStep';
import { OFFICES } from '../../../components/office-landing/offices';

const SERIF = { fontFamily: 'var(--font-playfair, Georgia, serif)' };
const noop = () => {};

/** One buyer screen with sample content, for display only (no state, nothing stored). */
function StaticScreen({ stage, property, partner, checkedInAt }) {
  const range = opinionRangeFor(property);
  let el = null;
  if (stage === 'check-in') {
    el = <CheckInScreen property={property} partner={partner} form={{ fullName: '', mobile: '', email: '', updatesOptIn: false }} onChange={noop} onSubmit={noop} />;
  } else if (stage === 'checked-in') {
    el = (
      <CheckedInScreen
        property={property}
        partner={partner}
        firstName="Olivia"
        checkedInAt={checkedInAt}
        onOpinion={noop}
        interestSlot={<p className="py-2 text-center text-[14.5px] font-semibold text-slate-600 underline underline-offset-4">Already know it&rsquo;s for you? Register your interest</p>}
      />
    );
  } else if (stage === 'opinion') {
    el = <OpinionScreen property={property} partner={partner} range={range} value={roundToStep(range.min + (range.max - range.min) * 0.58)} hasInteracted onChange={noop} onSubmit={noop} onDecline={noop} />;
  } else {
    el = <CompleteScreen property={property} partner={partner} outcome="opinion" interest={<InterestPanel property={property} state="idle" onStart={noop} />} />;
  }
  return <div className="flex min-h-full flex-1 flex-col" style={brandStyleFor(property)}>{el}</div>;
}

function StaticPhone({ stage, width, property, partner, checkedInAt, className = '', label }) {
  const green = stage === 'complete';
  return (
    <PhoneFrame width={width} inert dark={green} statusBg={green ? '#10b981' : '#ffffff'} className={className} label={label}>
      <StaticScreen stage={stage} property={property} partner={partner} checkedInAt={checkedInAt} />
    </PhoneFrame>
  );
}

function Eyebrow({ children, tone = 'light' }) {
  return <p className={`text-[12px] font-semibold uppercase tracking-[0.2em] ${tone === 'dark' ? 'text-(--accent)' : 'text-[#c64500]'}`}>{children}</p>;
}

function SectionTitle({ eyebrow, title, sub, tone = 'light', center = false }) {
  return (
    <div className={center ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h2 className={`mt-3 text-[34px] font-semibold leading-[1.1] tracking-tight sm:text-[44px] ${tone === 'dark' ? 'text-white' : 'text-slate-900'}`} style={SERIF}>{title}</h2>
      {sub && <p className={`mt-4 text-[17px] leading-relaxed ${tone === 'dark' ? 'text-white/75' : 'text-slate-600'}`}>{sub}</p>}
    </div>
  );
}

const JOURNEY = [
  { stage: 'check-in', title: 'Check in', body: 'Scan the sign at the door and enter name, mobile and email. No app, no account.' },
  { stage: 'checked-in', title: 'Inspect', body: 'A green confirmation, then the buyer explores the home at their own pace.' },
  { stage: 'opinion', title: 'Share an opinion', body: 'The property’s own Premarket slider. Anonymous, a few seconds, or skip it.' },
  { stage: 'complete', title: 'Complete', body: 'A full-screen green “Visit complete”, easy to spot from across the room.' },
];

function useSlides() {
  // Presenting from a laptop: arrow keys, Page Up/Down and Space move between sections.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      const next = ['ArrowDown', 'PageDown', ' ', 'ArrowRight'].includes(e.key);
      const prev = ['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key);
      if (!next && !prev) return;
      const slides = [...document.querySelectorAll('[data-slide]')];
      const y = window.scrollY + 80;
      const idx = slides.findIndex((s, i) => s.offsetTop <= y && (i === slides.length - 1 || slides[i + 1].offsetTop > y));
      const target = slides[Math.max(0, Math.min(slides.length - 1, idx + (next ? 1 : -1)))];
      if (!target) return;
      e.preventDefault();
      window.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function PitchPage() {
  const params = useSearchParams();
  const officeKey = OFFICES[params.get('office')] ? params.get('office') : 'hph';
  const property = useMemo(() => DEMO_PROPERTIES.find((p) => p.office === officeKey) || DEMO_PROPERTIES[0], [officeKey]);
  const partner = partnerFor(property);
  // Optional personal line for a meeting: ?for=<names>. Plain text from the link, never stored.
  const preparedFor = (params.get('for') || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  const [mounted, setMounted] = useState(false);
  const [checkedInAt, setCheckedInAt] = useState(null);
  useEffect(() => {
    const d = new Date();
    d.setHours(10, 4, 0, 0);
    setCheckedInAt(d.toISOString());
    setMounted(true);
  }, []);
  useSlides();

  const vars = { '--navy': partner?.navy || '#1d2027', '--accent': partner?.blue || '#e48900' };

  return (
    <div className="bg-white text-slate-900" style={vars}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section data-slide className="relative overflow-hidden bg-(--navy) text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <img src="/prototype-homepage/hero-exterior.jpg" alt="" className="absolute right-0 top-0 h-full w-full object-cover opacity-25 lg:w-[62%]" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--navy)_30%,color-mix(in_srgb,var(--navy)_70%,transparent)_65%,color-mix(in_srgb,var(--navy)_40%,transparent))]" />
          <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-(--accent) opacity-[0.12] blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 pb-20 pt-6 lg:pb-28">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <BrandLockup partner={partner} tone="dark" height="26px" gap="1em" />
            <div className="flex items-center gap-5">
              <nav className="hidden items-center gap-5 text-[13.5px] font-medium text-white/70 md:flex">
                <Link href={`${CONCEPT_BASE}/demo`} className="hover:text-white">Buyer demo</Link>
                <Link href={`${CONCEPT_BASE}/agent`} className="hover:text-white">Agent dashboard</Link>
                <Link href={`${CONCEPT_BASE}/sign`} className="hover:text-white">QR sign</Link>
              </nav>
              <ConceptBadge tone="dark">Proposed concept</ConceptBadge>
            </div>
          </div>

          <div className="mt-16 grid items-center gap-12 lg:mt-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div>
              <Eyebrow tone="dark">Open Home Experience</Eyebrow>
              <p className="mt-2 text-[14px] text-white/60">
                {preparedFor ? `Prepared for ${preparedFor}${partner ? ` · ${partner.name}` : ''}` : partner ? `Prepared for ${partner.name}` : 'A Premarket concept'}
              </p>
              <h1 className="mt-6 text-[44px] font-semibold leading-[1.04] tracking-tight sm:text-[64px]" style={SERIF}>
                Introducing the next evolution of the open home.
              </h1>
              <p className="mt-6 text-[20px] leading-relaxed text-white/80 sm:text-[22px]">One scan. One seamless inspection. Better buyer feedback.</p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link href={`${CONCEPT_BASE}/demo`} className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-5 text-[15px] font-semibold text-(--navy) shadow-lg hover:bg-white/90">
                  Try the buyer journey <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link href={`${CONCEPT_BASE}/agent`} className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/30 px-5 text-[15px] font-semibold text-white hover:bg-white/10">
                  See the agent dashboard
                </Link>
              </div>
              <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-white/70">
                {['No app download', 'No buyer account', 'One QR code per open home'].map((t) => (
                  <span key={t} className="inline-flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />{t}</span>
                ))}
              </p>
            </div>
            <div className="relative hidden h-[560px] lg:block" aria-hidden="true">
              {mounted && (
                <>
                  <div className="absolute left-[2%] top-10 -rotate-6 opacity-95">
                    <StaticPhone stage="check-in" width={250} property={property} partner={partner} checkedInAt={checkedInAt} />
                  </div>
                  <div className="absolute right-[2%] top-0 rotate-[4deg]">
                    <StaticPhone stage="complete" width={270} property={property} partner={partner} checkedInAt={checkedInAt} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <ChevronDown className="absolute bottom-6 left-1/2 hidden h-6 w-6 -translate-x-1/2 animate-bounce text-white/40 lg:block" aria-hidden="true" />
      </section>

      {/* ── The buyer journey: four screens ─────────────────────────────── */}
      <section data-slide className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionTitle
            center
            eyebrow="The buyer’s journey"
            title="One QR code. One phone. One seamless experience."
            sub="A buyer walks in, scans the sign, checks in, explores the home, leaves an anonymous price opinion and finishes on a big green screen. These are the real screens, running in the demo."
          />
          <div className="mt-14 flex snap-x snap-mandatory gap-6 overflow-x-auto pb-6 lg:grid lg:grid-cols-4 lg:overflow-visible">
            {JOURNEY.map((j, i) => (
              <div key={j.stage} className="flex shrink-0 snap-center flex-col items-center">
                {mounted ? (
                  <StaticPhone stage={j.stage} width={262} property={property} partner={partner} checkedInAt={checkedInAt} label={`Step ${i + 1}: ${j.title}`} />
                ) : (
                  <div style={{ width: 262, height: 555 }} />
                )}
                <div className="mt-6 flex max-w-[262px] gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500 text-[14px] font-bold text-white">{i + 1}</span>
                  <div>
                    <p className="text-[17px] font-semibold text-slate-900">{j.title}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-slate-600">{j.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href={`${CONCEPT_BASE}/demo`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-5 text-[14.5px] font-semibold text-white hover:bg-slate-800">
              Click through it yourself <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── The entrance sign ───────────────────────────────────────────── */}
      <section data-slide className="py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-16 px-6 lg:grid-cols-2">
          <div>
            <SectionTitle
              eyebrow="At the front door"
              title="It starts with one branded QR sign."
              sub="Each open home gets its own sign, so every check-in lands in the right place. The QR code is generated by Premarket itself and prints crisp at any size."
            />
            <ul className="mt-8 space-y-4">
              {[
                { Icon: Printer, t: 'A4 or A3 for the entry table, or a print-ready PDF for an A-frame' },
                { Icon: MonitorSmartphone, t: 'Full screen on an iPad at the door' },
                { Icon: QrIcon, t: `${partner ? `Premarket × ${partner.shortName}` : 'Premarket'} co-branding on every sign` },
              ].map(({ Icon, t }) => (
                <li key={t} className="flex items-start gap-3 text-[16px] text-slate-700">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                  <span className="pt-1.5">{t}</span>
                </li>
              ))}
            </ul>
            <Link href={`${CONCEPT_BASE}/sign`} className="mt-10 inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 px-5 text-[14.5px] font-semibold text-slate-800 hover:bg-slate-50">
              Open the printable sign <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="flex justify-center">
            {/* A-frame stand */}
            <div className="relative pb-16">
              <div aria-hidden="true" className="absolute -bottom-0 left-[8%] h-24 w-3 origin-top -rotate-[8deg] rounded-full bg-slate-800" />
              <div aria-hidden="true" className="absolute -bottom-0 right-[8%] h-24 w-3 origin-top rotate-[8deg] rounded-full bg-slate-800" />
              <div className="relative rounded-xl bg-slate-800 p-2.5 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.6)]">
                {mounted && (
                  <EntranceSign property={property} partner={partner} url={visitUrl('K7Q2XM', property.id)} format="aframe" theme="dark" width="380px" className="rounded-md" />
                )}
                {!mounted && <div style={{ width: 380, height: 570 }} />}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The agent's dashboard ───────────────────────────────────────── */}
      <section data-slide className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionTitle
            eyebrow="For the agent"
            title="Live attendance. Anonymous results."
            sub="Pick the property, start the open home and put the sign out. Check-ins appear the moment they happen. Price opinions arrive separately and are shown only as combined results once the open home ends."
          />
          <div className="mt-12 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_40px_80px_-40px_rgba(15,23,42,0.35)]">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3" aria-hidden="true">
              <span className="h-3 w-3 rounded-full bg-slate-300" /><span className="h-3 w-3 rounded-full bg-slate-300" /><span className="h-3 w-3 rounded-full bg-slate-300" />
              <span className="ml-3 rounded-md bg-white px-3 py-1 text-[12px] text-slate-400 ring-1 ring-slate-200">premarket.homes · Open homes</span>
            </div>
            <div className="bg-slate-50 p-5 sm:p-8" inert>
              {mounted && <DashboardPreview property={property} />}
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`${CONCEPT_BASE}/agent`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-5 text-[14.5px] font-semibold text-white hover:bg-slate-800">
              Open the agent dashboard <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Privacy by design ───────────────────────────────────────────── */}
      <section data-slide className="relative overflow-hidden bg-(--navy) py-24 text-white">
        <div aria-hidden="true" className="absolute -right-40 top-10 h-[480px] w-[480px] rounded-full bg-emerald-400 opacity-[0.08] blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-6">
          <SectionTitle tone="dark" eyebrow="Privacy by design" title="Anonymous means anonymous." sub="A buyer’s name and their price never meet: not on screen, and not in the data behind it." />

          <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-[0.8fr_1.4fr_1fr]">
            <div className="flex flex-col justify-center rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10">
              <Smartphone className="h-7 w-7 text-(--accent)" aria-hidden="true" />
              <p className="mt-3 text-[18px] font-semibold">The buyer&rsquo;s phone</p>
              <p className="mt-1 text-[14px] text-white/70">Sends two things, separately.</p>
            </div>
            <div className="grid gap-4">
              <div className="rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10">
                <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50">Flow 1 · Check-in</p>
                <p className="mt-2 text-[17px] font-semibold">Name, mobile, email</p>
                <p className="mt-1 text-[14px] text-white/70">Goes to the attendance register. Contains nothing about price.</p>
              </div>
              <div className="flex items-center gap-3 px-2 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                <span className="h-px flex-1 border-t border-dashed border-emerald-300/60" />
                No shared ID · no timestamps · no link
                <span className="h-px flex-1 border-t border-dashed border-emerald-300/60" />
              </div>
              <div className="rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10">
                <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50">Flow 2 · Opinion</p>
                <p className="mt-2 text-[17px] font-semibold">The amount, and nothing else</p>
                <p className="mt-1 text-[14px] text-white/70">No name, contact details, check-in reference or time travel with it.</p>
              </div>
            </div>
            <div className="grid gap-4">
              <div className="rounded-3xl bg-white p-6 text-slate-900">
                <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">The agent sees</p>
                <p className="mt-2 text-[16px] font-semibold">Who attended</p>
                <p className="mt-1 text-[13.5px] text-slate-600">The register, live, for follow-up.</p>
              </div>
              <div className="rounded-3xl bg-white p-6 text-slate-900">
                <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">The agent sees</p>
                <p className="mt-2 text-[16px] font-semibold">Combined opinions</p>
                <p className="mt-1 text-[13.5px] text-slate-600">After the open home, from 5 or more. Never one buyer&rsquo;s price.</p>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { Icon: Lock, t: 'Two separate flows', b: 'Check-in and opinion are sent separately. The opinion carries the amount only.' },
              { Icon: Users, t: 'No small samples', b: 'Results appear after the open home ends, and only from 5 opinions. With fewer, nothing is shown.' },
              { Icon: EyeOff, t: 'No timing clues', b: 'While live, the count moves in steps of 5. No per-buyer status, and “Visit complete” looks the same whether or not an opinion was given.' },
            ].map(({ Icon, t, b }) => (
              <div key={t} className="rounded-2xl p-5 ring-1 ring-white/10">
                <Icon className="h-6 w-6 text-emerald-300" aria-hidden="true" />
                <p className="mt-3 text-[16px] font-semibold">{t}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-white/70">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Benefits ────────────────────────────────────────────────────── */}
      <section data-slide className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionTitle center eyebrow="Why it matters" title="Better for everyone at the open home." />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { Icon: ClipboardCheck, who: 'For agents', b: 'Streamlined attendance, fewer manual steps, stronger engagement and more opportunities to collect anonymous feedback.' },
              { Icon: TrendingUp, who: 'For vendors', b: 'Clearer insight into how buyers perceive their property’s value after inspections.' },
              { Icon: Smartphone, who: 'For buyers', b: 'Fast check-in, an easy inspection experience and the opportunity to share their opinion privately.' },
              { Icon: Sparkles, who: partner ? `For ${partner.shortName}` : 'For your office', b: 'An opportunity to lead with a more modern, integrated open-home experience.', highlight: true },
            ].map(({ Icon, who, b, highlight }) => (
              <div key={who} className={`rounded-3xl p-7 ${highlight ? 'bg-(--navy) text-white' : 'border border-slate-200 bg-white'}`}>
                <span className={`grid h-11 w-11 place-items-center rounded-2xl ${highlight ? 'bg-white/10 text-(--accent)' : 'bg-orange-50 text-[#c64500]'}`}><Icon className="h-6 w-6" aria-hidden="true" /></span>
                <p className={`mt-5 text-[19px] font-semibold ${highlight ? 'text-white' : 'text-slate-900'}`}>{who}</p>
                <p className={`mt-2 text-[15px] leading-relaxed ${highlight ? 'text-white/75' : 'text-slate-600'}`}>{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Concept vs production ───────────────────────────────────────── */}
      <section data-slide className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionTitle
            eyebrow="Where it’s at"
            title="A working concept, ready to shape together."
            sub="This is a proposed concept, not a launched product. Everything below runs today in the demo, with demo data only. A live rollout needs the production work on the right."
          />
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-emerald-200 bg-white p-7">
              <p className="flex items-center gap-2 text-[16px] font-semibold text-emerald-800"><ShieldCheck className="h-5 w-5" aria-hidden="true" /> Working in the demo</p>
              <ul className="mt-5 space-y-3 text-[15px] text-slate-700">
                {[
                  'All four buyer screens, mobile-first, with check-in validation',
                  'The property’s existing Premarket price slider and range',
                  'Anonymous opinion, or skip it, with the same green finish',
                  'Register interest, kept apart from any opinion',
                  'Agent dashboard: start, live totals, end, summary',
                  'Printable QR signs: A4, A3, A-frame and iPad',
                  'Co-branding taken from each office’s brand settings',
                ].map((t) => <li key={t} className="flex gap-3"><Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />{t}</li>)}
              </ul>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-7">
              <p className="flex items-center gap-2 text-[16px] font-semibold text-slate-800"><Wrench className="h-5 w-5" aria-hidden="true" /> Needs building for a live rollout</p>
              <ul className="mt-5 space-y-3 text-[15px] text-slate-700">
                {[
                  'Secure server storage for check-ins and opinions, kept separate',
                  'Live updates across devices (the demo runs in one browser)',
                  'Open homes linked to real campaigns and agent accounts',
                  'Check-ins flowing to the agent’s contacts and reports',
                  'Privacy notice and consent wording reviewed before launch',
                  'A pilot at selected open homes before a wider release',
                ].map((t) => <li key={t} className="flex gap-3"><Timer className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />{t}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Close ───────────────────────────────────────────────────────── */}
      <section data-slide className="bg-(--navy) py-24 text-white">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="flex justify-center"><BrandLockup partner={partner} tone="dark" height="28px" gap="1em" /></div>
          <h2 className="mt-10 text-[36px] font-semibold leading-tight tracking-tight sm:text-[48px]" style={SERIF}>One scan. One seamless inspection. Better buyer feedback.</h2>
          <p className="mt-5 text-[18px] text-white/75">Proposed next step: shape it with {partner ? `${partner.shortName} agents` : 'agents'}, then pilot it at a handful of open homes.</p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href={`${CONCEPT_BASE}/demo`} className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-5 text-[15px] font-semibold text-(--navy) hover:bg-white/90">Try the buyer journey <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <Link href={`${CONCEPT_BASE}/agent`} className="inline-flex h-12 items-center rounded-xl border border-white/30 px-5 text-[15px] font-semibold text-white hover:bg-white/10">Agent dashboard</Link>
            <Link href={`${CONCEPT_BASE}/sign`} className="inline-flex h-12 items-center rounded-xl border border-white/30 px-5 text-[15px] font-semibold text-white hover:bg-white/10">Printable sign</Link>
          </div>
          <p className="mt-14 text-[12.5px] text-white/45">Proposed concept · not a launched product · demo data only · no real buyers, results or statistics are shown.</p>
        </div>
      </section>
    </div>
  );
}
