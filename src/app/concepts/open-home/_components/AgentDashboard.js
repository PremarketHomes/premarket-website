'use client';

/* eslint-disable @next/next/no-img-element -- demo listing photos are local static files */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Users, HeartHandshake, Lock, Radio, Printer, Monitor, Square, Play, Sparkles,
  Download, BedDouble, Bath, Car, ShieldCheck, Clock, RotateCcw,
} from 'lucide-react';
import QrCode from '../../../components/QrCode';
import BrandLockup from './BrandLockup';
import ConceptBadge from './ConceptBadge';
import { agentProperties, demoProperty, partnerFor, opinionRangeFor, DEMO_AGENT } from '../_lib/demoProperties';
import { activeSessionFor, endSession, getSession, listSessions, seedDemoHistory, startSession, DEMO_PEOPLE, demoOpinionAmounts } from '../_lib/sessionStore';
import { summarizeOpinions } from '../_lib/opinionSummary';
import { listAttendance, INTEREST_OPTIONS } from '../_lib/attendanceStore';
import { opinionResults } from '../_lib/opinionStore';
import { LIVE_COUNT_STEP, MIN_OPINIONS_TO_SHOW } from '../_lib/opinionSummary';
import { simulateVisitors } from '../_lib/simulator';
import { clearDemoData, subscribe } from '../_lib/demoStorage';
import { CONCEPT_BASE, signPath, visitUrl } from '../_lib/links';
import { compactMoney, dayLabel, localMobile, minutesBetween, money, shortDay, timeOfDay } from '../_lib/format';

/**
 * The agent's open-home dashboard (concept demo). What it shows, and deliberately does not:
 *   - attendance: the register of who checked in (identity side), live;
 *   - anonymous opinions: while live, only a count in steps of 5; after the open home ends, the combined picture,
 *     and only from 5 opinions up. Never an amount next to a person, never who did or didn't give an opinion,
 *     never when an opinion arrived.
 */

function useDemoVersion() {
  const [v, setV] = useState(0);
  useEffect(() => subscribe(() => setV((x) => x + 1)), []);
  return v;
}

function useNow(ms = 20000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const wantsLabel = (ids = []) => ids.map((id) => INTEREST_OPTIONS.find((o) => o.id === id)?.label).filter(Boolean).join(', ');

// The display pieces below are shared with the live pilot's dashboard (dashboard/open-home).
export function Card({ children, className = '', ...rest }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`} {...rest}>{children}</section>;
}

export function Kpi({ icon: Icon, label, value, sub, tone = 'slate', testId }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-sky-50 text-sky-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2.5">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-3 text-[28px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums" data-testid={testId}>{value}</p>
      {sub && <p className="mt-1.5 text-[12.5px] text-slate-500">{sub}</p>}
    </Card>
  );
}

export function LivePill({ ended }) {
  if (ended) {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-600"><Square className="h-3 w-3" aria-hidden="true" /> Ended</span>;
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15" data-testid="session-live">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
      Live
    </span>
  );
}

export function AttendanceList({ rows, newestFirst, compact }) {
  const list = newestFirst ? [...rows].reverse() : rows;
  if (!rows.length) {
    return (
      <div className="px-5 py-10 text-center">
        <Users className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
        <p className="mt-3 text-[14px] font-medium text-slate-700">No one has checked in yet</p>
        <p className="mt-1 text-[13px] text-slate-500">Buyers appear here the moment they scan the sign and check in.</p>
      </div>
    );
  }
  if (compact) {
    return (
      <ul className="divide-y divide-slate-100" data-testid="attendance-list">
        {list.map((a) => (
          <motion.li key={a.ref} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-slate-900">{a.fullName}</p>
              <p className="truncate text-[12.5px] text-slate-500">{localMobile(a.mobile)} · {a.email}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[12.5px] tabular-nums text-slate-500">{timeOfDay(a.checkedInAt)}</p>
              {a.interest && <p className="mt-0.5 text-[11.5px] font-semibold text-emerald-700">Interested</p>}
            </div>
          </motion.li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] whitespace-nowrap text-left text-[13.5px]" data-testid="attendance-list">
        <thead>
          <tr className="border-b border-slate-100 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <th className="px-5 py-2.5 font-semibold">Name</th>
            <th className="px-3 py-2.5 font-semibold">Mobile</th>
            <th className="px-3 py-2.5 font-semibold">Email</th>
            <th className="px-3 py-2.5 font-semibold">Checked in</th>
            <th className="px-5 py-2.5 font-semibold">Interest</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((a) => (
            <motion.tr key={a.ref} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-slate-700">
              <td className="px-5 py-3 font-semibold text-slate-900">{a.fullName}</td>
              <td className="px-3 py-3 tabular-nums">{localMobile(a.mobile)}</td>
              <td className="px-3 py-3">{a.email}</td>
              <td className="px-3 py-3 tabular-nums">{timeOfDay(a.checkedInAt)}</td>
              <td className="px-5 py-3">
                {a.interest ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">
                    Registered{a.interest.wants?.length ? ` · ${wantsLabel(a.interest.wants)}` : ''}
                  </span>
                ) : <span className="text-slate-300">—</span>}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OpinionLiveCard({ results }) {
  const atLeast = results.live.atLeast;
  const steps = [5, 10, 15, 20];
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        <h3 className="text-[15px] font-semibold text-slate-900">Anonymous opinions</h3>
      </div>
      <p className="mt-3 text-[30px] font-semibold leading-none tracking-tight text-slate-900" data-testid="live-opinions">{results.live.label}</p>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        {steps.map((s) => <span key={s} className={`h-1.5 flex-1 rounded-full ${atLeast >= s ? 'bg-emerald-500' : 'bg-slate-200'}`} />)}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
        While the open home is running the count moves in steps of {LIVE_COUNT_STEP}, so no opinion can be matched to the buyer who
        just left. Results appear when you end the open home, once at least {MIN_OPINIONS_TO_SHOW} are in.
      </p>
    </Card>
  );
}

function SpreadChart({ bands }) {
  const max = Math.max(1, ...bands.map((b) => b.count));
  return (
    <div>
      <div className="flex h-36 gap-2" role="img" aria-label={`Spread of opinions: ${bands.map((b) => `${compactMoney(b.from)} to ${compactMoney(b.to)}: ${b.count}`).join('; ')}`}>
        {bands.map((b) => (
          <div key={b.from} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="text-[12px] font-semibold tabular-nums text-slate-600">{b.count}</span>
            <div className="flex w-full flex-1 items-end">
              <div className="w-full rounded-t-lg bg-gradient-to-t from-[var(--brand-primary,#c2410c)] to-[color-mix(in_srgb,var(--brand-primary,#c2410c)_70%,white)]" style={{ height: `${Math.max(4, (b.count / max) * 100)}%`, opacity: b.count ? 1 : 0.18 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between border-t border-slate-200 pt-1.5 text-[11.5px] tabular-nums text-slate-500">
        <span>{compactMoney(bands[0].from)}</span>
        <span>{compactMoney(bands[bands.length - 1].to)}</span>
      </div>
      <p className="mt-0.5 text-center text-[11px] text-slate-400">Spread across the price range</p>
    </div>
  );
}

export function OpinionResultsCard({ results }) {
  if (results.state !== 'ready') {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2"><Lock className="h-4 w-4 text-slate-500" aria-hidden="true" /><h3 className="text-[15px] font-semibold text-slate-900">Anonymous opinions</h3></div>
        <p className="mt-4 text-[15px] font-medium text-slate-800">Not enough opinions to show</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-slate-600">
          Results need at least {MIN_OPINIONS_TO_SHOW} opinions. With fewer, a buyer&rsquo;s price could be worked out, so they stay private.
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-6" data-testid="opinion-results">
      <div className="flex items-center gap-2"><Lock className="h-4 w-4 text-emerald-700" aria-hidden="true" /><h3 className="text-[15px] font-semibold text-slate-900">Anonymous opinions</h3></div>
      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[12.5px] font-medium text-slate-500">Typical buyer opinion</p>
          <p className="mt-1 text-[34px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">{money(results.typical)}</p>
          <p className="mt-3 text-[12.5px] font-medium text-slate-500">Middle half of opinions</p>
          <p className="mt-1 text-[18px] font-semibold tabular-nums text-slate-800">{compactMoney(results.middle[0])} – {compactMoney(results.middle[1])}</p>
        </div>
        <SpreadChart bands={results.bands} />
      </div>
      <p className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
        Combined from {results.count} anonymous opinions. Individual amounts, who gave them and when are never shown, to you or anyone else.
      </p>
    </Card>
  );
}

function downloadCsv(rows, property, session) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Name', 'Mobile', 'Email', 'Checked in', 'Registered interest', 'Wants', 'Updates opt-in'].map(esc).join(',')];
  rows.forEach((a) => lines.push([a.fullName, localMobile(a.mobile), a.email, timeOfDay(a.checkedInAt), a.interest ? 'Yes' : 'No', wantsLabel(a.interest?.wants), a.updatesOptIn ? 'Yes' : 'No'].map(esc).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `open-home-attendance-${property.street.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${session.startedAt.slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function PropertyHeading({ property, session, ended, now, right }) {
  const mins = minutesBetween(session.startedAt, ended ? session.endedAt : now);
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <img src={property.imageUrl} alt="" className="h-20 w-28 shrink-0 rounded-xl object-cover" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <LivePill ended={ended} />
          <span className="text-[12.5px] text-slate-500">
            {ended ? `${dayLabel(session.startedAt)} · ${timeOfDay(session.startedAt)}–${timeOfDay(session.endedAt)} (${mins} min)` : `Started ${timeOfDay(session.startedAt)} · ${mins} min`}
          </span>
        </div>
        <h2 className="mt-1.5 truncate text-[22px] font-semibold tracking-tight text-slate-900">{property.street}</h2>
        <p className="text-[13.5px] text-slate-500">{[[property.suburb, property.state, property.postcode].filter(Boolean).join(' '), `Open home ${session.id}`].filter(Boolean).join(' · ')}</p>
      </div>
      {right}
    </Card>
  );
}

function LiveSession({ session, property, compact, now }) {
  const range = opinionRangeFor(property);
  const attendance = listAttendance(session.id);
  const interested = attendance.filter((a) => a.interest).length;
  const results = opinionResults(session.id, { range, ended: false });
  const [confirming, setConfirming] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const stopSim = useRef(null);
  useEffect(() => () => stopSim.current?.(), []);

  const toggleSim = () => {
    if (simulating) { stopSim.current?.(); stopSim.current = null; setSimulating(false); return; }
    stopSim.current = simulateVisitors(session, property);
    setSimulating(true);
    setTimeout(() => setSimulating(false), 1400 * 12);
  };
  const target = compact ? '_blank' : undefined;

  const actions = (
    <div className="flex flex-wrap gap-2 sm:justify-end">
      <Link href={signPath(session.id, property.id, 'ipad')} target={target} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
        <Monitor className="h-4 w-4" aria-hidden="true" /> QR on iPad
      </Link>
      <Link href={signPath(session.id, property.id, 'a4')} target={target} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
        <Printer className="h-4 w-4" aria-hidden="true" /> Print sign
      </Link>
      {confirming ? (
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 p-1 pl-3 text-[13px] font-medium text-red-800">
          End and close check-in?
          <button type="button" onClick={() => endSession(session.id)} className="h-7 rounded-lg bg-red-600 px-2.5 text-[12.5px] font-semibold text-white hover:bg-red-700" data-testid="confirm-end">End now</button>
          <button type="button" onClick={() => setConfirming(false)} className="h-7 rounded-lg px-2 text-[12.5px] font-semibold text-red-800 hover:bg-red-100">Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[13px] font-semibold text-white hover:bg-slate-800" data-testid="end-session">
          <Square className="h-3.5 w-3.5" aria-hidden="true" /> End open home
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <PropertyHeading property={property} session={session} ended={false} now={now} right={actions} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Users} label="Checked in" value={attendance.length} sub="Live" tone="green" testId="kpi-checked-in" />
        <Kpi icon={HeartHandshake} label="Registered interest" value={interested} sub="Want follow-up" tone="blue" testId="kpi-interest" />
        <Kpi icon={Lock} label="Anonymous opinions" value={results.live.label} sub={`Shown in steps of ${LIVE_COUNT_STEP}`} tone="amber" testId="kpi-opinions" />
        <Kpi icon={Radio} label="Session" value="Active" sub={`Since ${timeOfDay(session.startedAt)}`} />
      </div>
      <div className={`grid gap-5 ${compact ? '' : 'lg:grid-cols-3'}`}>
        <Card className={compact ? '' : 'lg:col-span-2'}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">Attendance</h3>
              <p className="text-[12.5px] text-slate-500">Who checked in. Price opinions are never shown here.</p>
            </div>
            <button type="button" onClick={toggleSim} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-[12.5px] font-semibold text-amber-800 hover:bg-amber-100" data-testid="simulate">
              {simulating ? <Square className="h-3.5 w-3.5" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              {simulating ? 'Stop' : 'Simulate visitors'}
            </button>
          </div>
          <AttendanceList rows={attendance} newestFirst compact={compact} />
        </Card>
        <div className="space-y-5">
          {!compact && (
            <Card className="p-5 text-center">
              <h3 className="text-[15px] font-semibold text-slate-900">Entrance QR</h3>
              <div className="mx-auto mt-3 w-44 rounded-2xl border border-slate-200 p-2">
                <QrCode value={visitUrl(session.id, property.id)} ecc="Q" border={2} title="Entrance QR code" className="h-auto w-full" />
              </div>
              <p className="mt-3 text-[13px] text-slate-600">Scan to check in · open home <span className="font-semibold tabular-nums">{session.id}</span></p>
            </Card>
          )}
          <OpinionLiveCard results={results} />
        </div>
      </div>
    </div>
  );
}

function SessionSummary({ session, property, compact }) {
  const range = opinionRangeFor(property);
  const attendance = listAttendance(session.id);
  const interested = attendance.filter((a) => a.interest).length;
  const results = opinionResults(session.id, { range, ended: true });
  const ready = results.state === 'ready';
  const tookPart = ready && attendance.length ? Math.min(100, Math.round((results.count / attendance.length) * 100)) : null;
  return (
    <div className="space-y-5" data-testid="session-summary">
      <PropertyHeading
        property={property}
        session={session}
        ended
        right={(
          <button type="button" onClick={() => downloadCsv(attendance, property, session)} className="inline-flex h-9 items-center gap-1.5 self-start rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 sm:self-center">
            <Download className="h-4 w-4" aria-hidden="true" /> Attendance CSV
          </button>
        )}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Users} label="Attended" value={attendance.length} tone="green" testId="summary-attended" />
        <Kpi icon={HeartHandshake} label="Registered interest" value={interested} tone="blue" />
        <Kpi icon={Lock} label="Anonymous opinions" value={ready ? results.count : `Fewer than ${MIN_OPINIONS_TO_SHOW}`} tone="amber" testId="summary-opinions" />
        <Kpi icon={Clock} label="Shared an opinion" value={tookPart == null ? '—' : `${tookPart}%`} sub={tookPart == null ? 'Shown from 5 opinions' : 'of people who checked in'} />
      </div>
      <OpinionResultsCard results={results} />
      <Card>
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-slate-900">Attendance register</h3>
          <p className="text-[12.5px] text-slate-500">{attendance.length} people checked in. Opinions are kept separately and can&rsquo;t be matched to anyone here.</p>
        </div>
        <AttendanceList rows={attendance} compact={compact} />
      </Card>
    </div>
  );
}

/** One open home, live or finished. Used by the full dashboard and the presenter's side-by-side demo. */
export function SessionPanel({ sessionId, compact = false }) {
  useDemoVersion();
  const now = useNow();
  const session = getSession(sessionId);
  const property = session ? demoProperty(session.propertyId) : null;
  if (!session || !property) return null;
  return (
    <div style={brandVars(property)}>
      {session.endedAt
        ? <SessionSummary session={session} property={property} compact={compact} />
        : <LiveSession session={session} property={property} compact={compact} now={now} />}
    </div>
  );
}

// Deterministic sample numbers for the pitch's dashboard preview (same picture on every load).
function seeded(seed) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A still of the dashboard for the pitch page, from sample data held in memory (nothing stored). Shows the two
 * moments side by side: during the open home (attendance live, opinions as a stepped count) and after it ends.
 * Render client-side only (it uses the viewer's clock and time zone).
 */
export function DashboardPreview({ property }) {
  const range = opinionRangeFor(property);
  const { rows, live, done, start } = useMemo(() => {
    const s = new Date();
    s.setHours(10, 0, 0, 0);
    const people = DEMO_PEOPLE.slice(0, 7).map((p, i) => ({
      ...p,
      ref: `preview-${i}`,
      checkedInAt: new Date(s.getTime() + (3 + i * 4) * 60000).toISOString(),
      interest: i === 1 || i === 5 ? { wants: ['call'] } : null,
    }));
    const amounts = demoOpinionAmounts(property, 12, seeded(11));
    return {
      rows: people,
      live: summarizeOpinions(amounts.slice(0, 6), { range, ended: false }),
      done: summarizeOpinions(amounts, { range, ended: true }),
      start: s,
    };
  }, [property, range]);
  const session = { id: 'K7Q2XM', startedAt: start.toISOString() };
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" style={brandVars(property)}>
      <div className="space-y-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">During the open home</p>
        <PropertyHeading property={property} session={session} ended={false} now={start.getTime() + 31 * 60000} />
        <div className="grid grid-cols-3 gap-3">
          <Kpi icon={Users} label="Checked in" value={rows.length} tone="green" />
          <Kpi icon={HeartHandshake} label="Interested" value={2} tone="blue" />
          <Kpi icon={Lock} label="Opinions" value={live.live.label} tone="amber" />
        </div>
        <Card>
          <div className="border-b border-slate-100 px-5 py-3"><h3 className="text-[14px] font-semibold text-slate-900">Attendance</h3></div>
          <AttendanceList rows={rows.slice(0, 4)} newestFirst compact />
        </Card>
      </div>
      <div className="space-y-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">After it ends</p>
        <OpinionResultsCard results={done} />
      </div>
    </div>
  );
}

function brandVars(property) {
  const partner = partnerFor(property);
  return partner ? { '--brand-primary': partner.navy } : { '--brand-primary': '#c2410c' };
}

function Home({ onOpen }) {
  useDemoVersion();
  const props = agentProperties();
  const past = listSessions().filter((s) => s.endedAt && props.some((p) => p.id === s.propertyId));
  return (
    <div className="space-y-10">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">Open homes</p>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight text-slate-900">Run your open home with Premarket</h1>
        <p className="mt-1.5 max-w-2xl text-[15px] text-slate-600">Choose a property and start the open home. Buyers scan the entrance QR to check in and share an anonymous price opinion.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {props.map((p) => {
          const live = activeSessionFor(p.id);
          return (
            <Card key={p.id} className="overflow-hidden">
              <div className="relative h-44">
                <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11.5px] font-semibold text-slate-700 backdrop-blur">Demo listing</span>
                {live && <span className="absolute right-3 top-3"><LivePill /></span>}
              </div>
              <div className="flex items-end justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-semibold text-slate-900">{p.street}</p>
                  <p className="text-[13.5px] text-slate-500">{p.suburb} {p.state} {p.postcode}</p>
                  <p className="mt-2 flex items-center gap-3 text-[12.5px] text-slate-500">
                    <span className="inline-flex items-center gap-1"><BedDouble className="h-4 w-4" aria-hidden="true" />{p.beds}</span>
                    <span className="inline-flex items-center gap-1"><Bath className="h-4 w-4" aria-hidden="true" />{p.baths}</span>
                    <span className="inline-flex items-center gap-1"><Car className="h-4 w-4" aria-hidden="true" />{p.cars}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpen((live || startSession(p.id)).id)}
                  className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-[13.5px] font-semibold text-white ${live ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-slate-800'}`}
                  data-testid={`start-${p.id}`}
                >
                  {live ? <>View live <ArrowRight className="h-4 w-4" aria-hidden="true" /></> : <><Play className="h-4 w-4" aria-hidden="true" /> Start open home</>}
                </button>
              </div>
            </Card>
          );
        })}
      </div>
      <Card>
        <div className="border-b border-slate-100 px-5 py-3.5"><h2 className="text-[15px] font-semibold text-slate-900">Recent open homes</h2></div>
        {past.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-slate-500">Finished open homes and their summaries appear here.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {past.map((s) => {
              const p = demoProperty(s.propertyId);
              const res = opinionResults(s.id, { range: opinionRangeFor(p), ended: true });
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50">
                    <img src={p.imageUrl} alt="" className="h-10 w-14 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-slate-900">{p.street}</p>
                      <p className="text-[12.5px] text-slate-500">{shortDay(s.startedAt)} · {timeOfDay(s.startedAt)}</p>
                    </div>
                    <span className="hidden text-[13px] text-slate-600 sm:block">{listAttendance(s.id).length} attended</span>
                    <span className="hidden text-[13px] text-slate-600 sm:block">{res.state === 'ready' ? `${res.count} opinions` : 'Too few opinions'}</span>
                    <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** The full agent dashboard page (header, property list, live session, summary). */
export default function AgentDashboard() {
  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const partner = useMemo(() => partnerFor({ office: DEMO_AGENT.office }), []);
  useEffect(() => { seedDemoHistory(); setReady(true); }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [sessionId]);

  const reset = () => { clearDemoData(); seedDemoHistory(); setSessionId(null); };

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex min-w-0 items-center gap-4">
            <BrandLockup partner={partner} height="20px" />
            <span className="hidden h-6 w-px bg-slate-200 sm:block" />
            <span className="hidden text-[14px] font-semibold text-slate-700 sm:block">Open homes</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline-flex"><ConceptBadge /></span>
            <Link href={CONCEPT_BASE} className="hidden text-[13px] font-medium text-slate-500 hover:text-slate-900 sm:block">Pitch</Link>
            <button type="button" onClick={reset} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset demo
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">
        {!ready ? null : sessionId ? (
          <div className="space-y-5">
            <button type="button" onClick={() => setSessionId(null)} className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-slate-500 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All properties
            </button>
            <SessionPanel sessionId={sessionId} />
          </div>
        ) : (
          <Home onOpen={setSessionId} />
        )}
        <p className="mt-10 text-center text-[12px] text-slate-400">
          Proposed concept. Demo listings and visitors only; nothing here is saved beyond this browser or sent to anyone.
        </p>
      </main>
    </div>
  );
}
