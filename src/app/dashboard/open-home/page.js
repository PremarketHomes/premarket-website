'use client';

/* eslint-disable @next/next/no-img-element -- campaign photos come from the image CDN at small fixed sizes */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Copy, FlaskConical, HeartHandshake, Lock, Play, Printer, Radio, Square, Trash2, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { authFetch } from '../../utils/authFetch';
import { loginUrlForCurrentPage } from '../../utils/loginRedirect';
import QrCode from '../../components/QrCode';
import BrandLockup from '../../concepts/open-home/_components/BrandLockup';
import { AttendanceList, Card, Kpi, LivePill, OpinionLiveCard, OpinionResultsCard, PropertyHeading } from '../../concepts/open-home/_components/AgentDashboard';
import { LIVE_COUNT_STEP, MIN_OPINIONS_TO_SHOW } from '../../utils/openHome/opinionSummary';
import { RevealedOpinionsCard, SealedOpinionsCard } from './OpinionAmounts';
import { openHomeVisitUrl } from '../../utils/openHome/brand';
import { shortDay, timeOfDay } from '../../concepts/open-home/_lib/format';

/**
 * Open Home (pilot) for allowlisted agents. Every action is authorised on the server (api/services/openHomePilot.js);
 * this page only shows what the API returns: the attendance register and the anonymous opinion aggregate.
 */

async function api(path, options = {}) {
  const res = await authFetch(path, { cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status, code: data.code });
  return data;
}

function ModeBadge({ mode }) {
  return mode === 'test' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-wide text-amber-800" data-testid="mode-test"><FlaskConical className="h-3 w-3" aria-hidden="true" /> Test</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-600/15" data-testid="mode-live">Live</span>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Dashboard</Link>
            <span className="h-6 w-px bg-slate-200" />
            <BrandLockup height="20px" />
            <span className="text-[14px] font-semibold text-slate-700">Open Home</span>
          </div>
          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Pilot</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}

function Home({ onOpen }) {
  const [campaigns, setCampaigns] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(null);

  const load = useCallback(() => {
    setError('');
    Promise.all([api('/api/open-home/campaigns'), api('/api/open-home/sessions')])
      .then(([c, s]) => { setCampaigns(c.campaigns); setSessions(s.sessions); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const start = async (propertyId, mode) => {
    setStarting(`${propertyId}:${mode}`);
    try {
      const { session } = await api('/api/open-home/sessions', { method: 'POST', body: JSON.stringify({ propertyId, mode }) });
      onOpen(session.id);
    } catch (e) {
      setError(e.message);
      setStarting(null);
    }
  };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Run an open home</h1>
        <p className="mt-1.5 max-w-2xl text-[15px] text-slate-600">
          Choose one of your campaigns. Buyers scan the QR code at the door to check in on their own phone, and can leave an
          anonymous price opinion. Use <strong>Test</strong> to practise: test open homes are labelled on every screen and can be deleted.
        </p>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700" role="alert">{error}</p>}
      {!campaigns ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : campaigns.length === 0 ? (
        <Card className="p-8 text-center text-[14px] text-slate-600">You have no current campaigns to run an open home for.</Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="pilot-campaigns">
          {campaigns.map((c) => (
            <Card key={c.id} className="overflow-hidden" data-testid={`campaign-${c.id}`}>
              <div className="relative h-36 bg-slate-200">
                {c.imageUrl && <img src={c.imageUrl} alt="" className="h-full w-full object-cover" />}
                <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11.5px] font-semibold text-slate-700">{c.isPublic ? 'Public' : 'Private'}</span>
                {c.activeSession && <span className="absolute right-3 top-3"><LivePill /></span>}
              </div>
              <div className="p-4">
                <p className="truncate text-[16px] font-semibold">{c.street}</p>
                <p className="truncate text-[13px] text-slate-500">{c.suburb || ' '}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {c.activeSession ? (
                    <button type="button" onClick={() => onOpen(c.activeSession.id)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-[13px] font-semibold text-white hover:bg-emerald-700">
                      View {c.activeSession.mode === 'test' ? 'test' : 'live'} open home <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : (
                    <>
                      <button type="button" disabled={!!starting} onClick={() => start(c.id, 'live')} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50" data-testid={`start-live-${c.id}`}>
                        <Play className="h-4 w-4" aria-hidden="true" /> Start open home
                      </button>
                      <button type="button" disabled={!!starting} onClick={() => start(c.id, 'test')} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 text-[13px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50" data-testid={`start-test-${c.id}`}>
                        <FlaskConical className="h-4 w-4" aria-hidden="true" /> Test
                      </button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <div className="border-b border-slate-100 px-5 py-3.5"><h2 className="text-[15px] font-semibold">Recent open homes</h2></div>
        {sessions.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-slate-500">Your open homes will appear here.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sessions.map((s) => {
              const c = campaigns?.find((x) => x.id === s.propertyId);
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50">
                    <ModeBadge mode={s.mode} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c ? c.street : 'Campaign'}</span>
                    <span className="text-[13px] text-slate-500">{s.startedAt ? `${shortDay(s.startedAt)} · ${timeOfDay(s.startedAt)}` : ''}</span>
                    <span className="hidden text-[13px] text-slate-500 sm:inline">{s.checkIns} checked in</span>
                    {s.state === 'active' ? <LivePill /> : <span className="text-[12px] text-slate-400">Ended</span>}
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

function SessionView({ id, onBack }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // 'end' | 'delete'
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => api(`/api/open-home/sessions/${id}`).then((r) => { setReport(r); setError(''); setNow(Date.now()); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const live = report?.session.state === 'active';
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(load, 6000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [live, load]);

  if (!report) {
    return error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700" role="alert">{error}</p> : <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />;
  }

  const { session, property, attendance, opinions } = report;
  const url = openHomeVisitUrl(session.id);
  const rows = attendance.map((a, i) => ({ ...a, ref: `${i}` }));
  const interested = attendance.filter((a) => a.interest).length;
  const heading = { ...property, state: '', postcode: '' };
  const sessionForHeading = { id: session.id, startedAt: session.startedAt, endedAt: session.endedAt };
  // 'after-end' (open homes from 25 Nov 2026): nothing while live, every amount after. Older open homes keep the
  // combined-from-5 rule their buyers were shown.
  const afterEnd = opinions.rule === 'after-end';
  const opinionKpi = afterEnd
    ? { value: live ? 'Sealed' : opinions.count, sub: live ? 'Shown when you end' : undefined }
    : {
      value: opinions.state === 'live' ? opinions.live.label : opinions.state === 'ready' ? opinions.count : `Fewer than ${MIN_OPINIONS_TO_SHOW}`,
      sub: live ? `Shown in steps of ${LIVE_COUNT_STEP}` : undefined,
    };

  const end = async () => { await api(`/api/open-home/sessions/${id}/end`, { method: 'POST', body: '{}' }).catch((e) => setError(e.message)); setConfirm(null); load(); };
  const remove = async () => { try { await api(`/api/open-home/sessions/${id}`, { method: 'DELETE' }); onBack(); } catch (e) { setError(e.message); setConfirm(null); } };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };

  const actions = (
    <div className="flex flex-wrap gap-2 sm:justify-end">
      <Link href={`/dashboard/open-home/sign?session=${session.id}`} target="_blank" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
        <Printer className="h-4 w-4" aria-hidden="true" /> QR sign
      </Link>
      {live && (confirm === 'end' ? (
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 p-1 pl-3 text-[13px] font-medium text-red-800">
          {afterEnd ? 'End? Check-in and opinions close.' : 'End and close check-in?'}
          <button type="button" onClick={end} className="h-7 rounded-lg bg-red-600 px-2.5 text-[12.5px] font-semibold text-white" data-testid="confirm-end">End now</button>
          <button type="button" onClick={() => setConfirm(null)} className="h-7 rounded-lg px-2 text-[12.5px] font-semibold text-red-800">Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirm('end')} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[13px] font-semibold text-white" data-testid="end-session">
          <Square className="h-3.5 w-3.5" aria-hidden="true" /> End open home
        </button>
      ))}
      {session.mode === 'test' && (confirm === 'delete' ? (
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 p-1 pl-3 text-[13px] font-medium text-red-800">
          Delete this test and everything in it?
          <button type="button" onClick={remove} className="h-7 rounded-lg bg-red-600 px-2.5 text-[12.5px] font-semibold text-white" data-testid="confirm-delete">Delete</button>
          <button type="button" onClick={() => setConfirm(null)} className="h-7 rounded-lg px-2 text-[12.5px] font-semibold text-red-800">Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirm('delete')} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 text-[13px] font-semibold text-red-700" data-testid="delete-test">
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete test
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-5" data-testid="pilot-session" data-state={session.state}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> All open homes</button>
        <ModeBadge mode={session.mode} />
      </div>
      {session.mode === 'test' && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900 ring-1 ring-amber-200">
          <strong>Test open home.</strong> Buyers&rsquo; phones show &ldquo;Test open home · practice only&rdquo;. Nothing here goes into your campaign&rsquo;s reports, and you can delete it.
        </p>
      )}
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700" role="alert">{error}</p>}
      <PropertyHeading property={heading} session={sessionForHeading} ended={!live} now={now} right={actions} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Users} label={live ? 'Checked in' : 'Attended'} value={attendance.length} sub={live ? 'Updates live' : undefined} tone="green" testId="kpi-checked-in" />
        <Kpi icon={HeartHandshake} label="Registered interest" value={interested} tone="blue" testId="kpi-interest" />
        <Kpi icon={Lock} label="Anonymous opinions" value={opinionKpi.value} sub={opinionKpi.sub} tone="amber" testId="kpi-opinions" />
        <Kpi icon={Radio} label="Status" value={live ? 'Active' : 'Ended'} sub={live ? `Since ${timeOfDay(session.startedAt)}` : undefined} />
      </div>
      {!live && (afterEnd ? <RevealedOpinionsCard results={opinions} /> : <OpinionResultsCard results={opinions} />)}
      <div className={`grid gap-5 ${live ? 'lg:grid-cols-3' : ''}`}>
        <Card className={live ? 'lg:col-span-2' : ''}>
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-[15px] font-semibold">{live ? 'Attendance' : 'Attendance register'}</h3>
            <p className="text-[12.5px] text-slate-500">Who checked in. Price opinions are kept separately and never shown here.</p>
          </div>
          <AttendanceList rows={rows} newestFirst={live} />
        </Card>
        {live && (
          <div className="space-y-5">
            <Card className="p-5 text-center">
              <h3 className="text-[15px] font-semibold">Entrance QR</h3>
              <div className="mx-auto mt-3 w-44 rounded-2xl border border-slate-200 p-2" data-testid="pilot-qr">
                <QrCode value={url} ecc="Q" border={2} title="Open home check-in QR code" className="h-auto w-full" />
              </div>
              <button type="button" onClick={copy} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-600 hover:text-slate-900">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied ? 'Link copied' : 'Copy check-in link'}
              </button>
            </Card>
            {afterEnd ? <SealedOpinionsCard /> : <OpinionLiveCard results={opinions} />}
          </div>
        )}
      </div>
    </div>
  );
}

export default function OpenHomePilotPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [enabled, setEnabled] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => { if (!loading && !user) router.replace(loginUrlForCurrentPage()); }, [loading, user, router]);
  useEffect(() => {
    if (!user) return;
    api('/api/open-home/pilot').then((r) => setEnabled(r.enabled === true)).catch(() => setEnabled(false));
  }, [user]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [sessionId]);

  if (loading || !user || enabled === null) {
    return <div className="grid min-h-dvh place-items-center bg-slate-50"><div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-orange-500" aria-label="Loading" /></div>;
  }
  if (!enabled) {
    return (
      <Shell>
        <Card className="mx-auto max-w-md p-8 text-center" data-testid="pilot-unavailable">
          <h1 className="text-lg font-semibold">Open Home isn&rsquo;t available on your account yet</h1>
          <Link href="/dashboard" className="mt-5 inline-flex h-10 items-center rounded-xl bg-slate-900 px-4 text-[13.5px] font-semibold text-white">Back to dashboard</Link>
        </Card>
      </Shell>
    );
  }
  return <Shell>{sessionId ? <SessionView id={sessionId} onBack={() => setSessionId(null)} /> : <Home onOpen={setSessionId} />}</Shell>;
}
