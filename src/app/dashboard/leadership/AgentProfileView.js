'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { ArrowLeft, ArrowUpDown, LogOut, MessageCircle, Star, AlertCircle, Info } from 'lucide-react';
import { ORANGE, CHARCOAL, fmtInt, campaignPrice, fmtDate, fmtMonth, STATUS_LABEL } from './format';
import { Avatar, Section, Kpi, ChartCard, SimpleTable, tooltipStyle, card, eyebrow } from './LeadershipHubView';

const STATUS_STYLE = {
  live: 'bg-emerald-50 text-emerald-700', hidden: 'bg-stone-100 text-stone-600',
  sold: 'bg-[#fdf1df] text-[#a85f00]', archived: 'bg-stone-100 text-stone-500',
};

const RANK_PERIODS = [['week', 'This week'], ['month', 'This month'], ['all', 'All time']];
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

function CoachingCard({ item, propertiesById, reportBase, sample }) {
  const attention = item.tone === 'attention';
  const Icon = attention ? AlertCircle : Star;
  const named = item.propertyIds.map((id) => propertiesById.get(id)).filter(Boolean);
  return (
    <li className={`${card} p-5 border-l-[3px] ${attention ? 'border-l-[#e38100]' : 'border-l-emerald-500'}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${attention ? 'text-[#e38100]' : 'text-emerald-600'}`} strokeWidth={1.5} />
        <div className="min-w-0">
          <h3 className="font-serif text-xl text-stone-900 leading-snug">{item.title}</h3>
          <p className="text-sm text-stone-600 mt-1">{item.detail}</p>
          {named.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {named.map((p) => {
                const chip = (
                  <span className="inline-block max-w-[260px] truncate px-2.5 py-1 rounded border border-stone-200 bg-[#faf9f7] text-xs text-stone-700 hover:border-stone-300">
                    {p.address || 'Address unavailable'} · {fmtInt(p.opinions)} opinion{p.opinions === 1 ? '' : 's'} · {fmtInt(p.views)} views
                  </span>
                );
                return <li key={p.id}>{sample ? chip : <Link href={`${reportBase}/${p.id}`}>{chip}</Link>}</li>;
              })}
            </ul>
          )}
          <p className="mt-3 flex gap-2 text-sm text-stone-700">
            <MessageCircle className="w-4 h-4 mt-0.5 text-stone-400 shrink-0" strokeWidth={1.5} />
            <span><span className="text-[10px] uppercase tracking-[0.16em] text-stone-400 mr-2">To discuss</span>{item.discuss}</span>
          </p>
        </div>
      </div>
    </li>
  );
}

const COLS = [
  { key: 'address', label: 'Property', get: (p) => (p.address || '').toLowerCase(), left: true },
  { key: 'status', label: 'Status', get: (p) => p.status, left: true },
  { key: 'createdAt', label: 'Created', get: (p) => p.createdAt || '', left: true },
  { key: 'views', label: 'Views', get: (p) => p.views },
  { key: 'opinions', label: 'Opinions', get: (p) => p.opinions },
  { key: 'registrations', label: 'Registered', get: (p) => p.registrations },
  { key: 'opinionsLast30', label: 'Last 30 days', get: (p) => p.opinionsLast30 },
  { key: 'lastOpinionAt', label: 'Latest opinion', get: (p) => p.lastOpinionAt || '', left: true },
];

const FILTERS = [
  ['all', 'All'],
  ['active', 'Active'],
  ['none', 'No opinions'],
  ['strong', 'Strong feedback'],
];

function PropertyTable({ data, reportBase, sample }) {
  const [sort, setSort] = useState({ key: 'opinions', dir: 'desc' });
  const [filter, setFilter] = useState('all');
  const T = data.thresholds;
  const isActive = (p) => p.status === 'live' || p.status === 'hidden';
  const isStrong = (p) => p.opinions >= T.strongOpinions || p.registrations >= T.strongRegistrations;

  const rows = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return data.properties
      .filter((p) => (filter === 'all' ? true : filter === 'active' ? isActive(p) : filter === 'none' ? isActive(p) && p.opinions === 0 : isStrong(p)))
      .sort((a, b) => {
        const x = col.get(a); const y = col.get(b);
        return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.id < b.id ? -1 : 1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.properties, sort, filter]);

  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: ['address', 'status'].includes(key) ? 'asc' : 'desc' }));

  return (
    <Section id="properties" title="Property by property" subtitle="Every campaign this agent has listed, with the buyer feedback each has received."
      right={
        <div role="tablist" aria-label="Filter properties" className="inline-flex rounded-md border border-stone-200 bg-white p-0.5">
          {FILTERS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
              className={`px-3.5 py-1.5 text-[13px] font-medium rounded transition-colors ${filter === id ? 'bg-[#e38100] text-white' : 'text-stone-500 hover:text-stone-900'}`}>{label}</button>
          ))}
        </div>
      }>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-stone-200 bg-[#fdfcfb]">
              {COLS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-4 py-3 font-medium ${c.left ? 'text-left' : 'text-right'}`}>
                  <button onClick={() => toggle(c.key)} className={`inline-flex items-center gap-1 ${eyebrow} hover:text-stone-900 ${sort.key === c.key ? '!text-stone-900' : ''}`}>{c.label}<ArrowUpDown className="w-3 h-3" strokeWidth={1.5} /></button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={COLS.length} className="px-4 py-10 text-center text-stone-400">No campaigns match this filter.</td></tr>}
            {rows.map((p) => {
              const title = (
                <div className="flex items-center gap-3 min-w-0">
                  {p.thumbnail ? <img src={p.thumbnail} alt="" className="w-10 h-10 rounded object-cover shrink-0" loading="lazy" /> : <div className="w-10 h-10 rounded bg-stone-100 shrink-0" />}
                  <div className="min-w-0">
                    <p className="truncate text-stone-900 max-w-[280px]">{p.address || 'Address unavailable'}</p>
                    <p className="text-xs text-stone-400">{campaignPrice(p).text}{p.daysLive != null ? ` · ${p.daysLive} day${p.daysLive === 1 ? '' : 's'} since created` : ''}</p>
                  </div>
                </div>
              );
              return (
                <tr key={p.id} id={`p-${p.id}`} className="border-b border-stone-100 last:border-b-0 hover:bg-stone-50/60">
                  <td className="px-4 py-3">{sample ? title : <Link href={`${reportBase}/${p.id}`} className="hover:text-[#c64500]">{title}</Link>}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span></td>
                  <td className="px-4 py-3 text-stone-600">{fmtDate(p.createdAt, data.timezone)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.views)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="tabular-nums font-medium text-stone-900">{fmtInt(p.opinions)}</span>
                    {isActive(p) && p.opinions === 0 && <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] bg-[#fdf1df] text-[#a85f00]">None yet</span>}
                    {isStrong(p) && <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700">Strong</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.registrations)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.opinionsLast30)}</td>
                  <td className="px-4 py-3 text-stone-600">{fmtDate(p.lastOpinionAt, data.timezone)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default function AgentProfileView({
  data, sample = false, onSignOut, hubHref = '/dashboard/leadership', reportBase = '/dashboard/leadership/report',
}) {
  const { agent: a, summary: s, ranks, periodTotals, leader } = data;
  const propertiesById = useMemo(() => new Map(data.properties.map((p) => [p.id, p])), [data.properties]);
  const axis = { stroke: '#a8a29e', fontSize: 12, tickLine: false, axisLine: false };
  const grid = <CartesianGrid stroke="#f0eeec" vertical={false} />;
  const monthly = data.trends.map((t) => ({ ...t, label: fmtMonth(t.month) }));
  const weekly = data.weekly.map((w) => ({ ...w, label: new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: data.timezone }).format(new Date(w.weekStart)) }));
  const T = data.thresholds;
  const attention = data.coaching.filter((c) => c.tone === 'attention');
  const positive = data.coaching.filter((c) => c.tone === 'positive');
  const stamp = new Intl.DateTimeFormat('en-AU', { timeZone: data.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt));

  return (
    <div className="min-h-screen bg-[#faf9f7] text-stone-900">
      <header className="border-b border-stone-200 bg-[#fdfcfb]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/"><Image src="https://premarketvideos.b-cdn.net/assets/logo.png" alt="Premarket" width={140} height={35} className="h-6 w-auto" unoptimized /></Link>
            <span className="hidden sm:block h-5 w-px bg-stone-200" />
            <span className="hidden sm:block text-[11px] uppercase tracking-[0.16em] text-stone-500">Leadership Hub</span>
          </div>
          <div className="flex items-center gap-1">
            <Link href={hubHref} className="flex items-center gap-2 px-3 py-2 text-[13px] text-stone-500 hover:text-stone-900"><ArrowLeft className="w-4 h-4" strokeWidth={1.5} />All agents</Link>
            {onSignOut && <button onClick={onSignOut} className="flex items-center gap-2 px-3 py-2 text-[13px] text-stone-500 hover:text-stone-900"><LogOut className="w-4 h-4" strokeWidth={1.5} />Sign out</button>}
          </div>
        </div>
      </header>

      {sample && <div role="note" className="bg-[#fdf1df] border-b border-[#f0d9b5] text-[#7a4500] text-xs text-center py-2 px-4">Preview with invented sample data — not a real agent, campaigns or buyers.</div>}

      <main className="max-w-[1400px] mx-auto px-4 sm:px-8 py-8 sm:py-10">
        <p className="text-xs text-stone-400 mb-4">Viewing as {leader.firstName || 'leader'} · {data.office.name}</p>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={a.name} src={a.avatar} size="w-16 h-16" text="text-lg" />
            <div>
              <h1 className="font-serif text-3xl sm:text-4xl leading-tight text-stone-900">{a.name}</h1>
              <p className="mt-1 text-sm text-stone-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${a.activated ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{a.activated ? 'Activated' : 'Invited'}</span>
                <span>Last sign-in: {a.lastSignInAt ? fmtDate(a.lastSignInAt, data.timezone) : 'not available'}</span>
                <span>Latest campaign: {fmtDate(a.latestCampaignAt, data.timezone)}</span>
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 h-px w-10 bg-[#e38100]" aria-hidden="true" />

        {/* The 30-second view */}
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Kpi label="Campaigns uploaded" value={fmtInt(s.campaigns)} hint={`${fmtInt(s.activeCampaigns)} active`} />
          <Kpi label="Buyer opinions" value={fmtInt(s.opinions)} hint={`${fmtInt(s.registrations)} registered interest`} />
          <Kpi label="Property views" value={fmtInt(s.views)} />
          <Kpi label="Campaigns with feedback" value={`${fmtInt(s.campaignsWithFeedback)} / ${fmtInt(s.campaigns)}`} hint={s.activeWithoutFeedback ? `${fmtInt(s.activeWithoutFeedback)} active with none yet` : 'Every active campaign has feedback'} />
          <Kpi label="Last 30 days" value={fmtInt(s.opinionsLast30)} hint={`${fmtInt(s.opinionsPrior30)} in the 30 days before`} />
        </div>
        {s.best && (
          <p className="mt-4 text-sm text-stone-600"><Star className="inline w-4 h-4 -mt-0.5 mr-1.5 text-[#e38100]" strokeWidth={1.5} />Most buyer opinions: <span className="text-stone-900">{s.best.address || 'Address unavailable'}</span> with {fmtInt(s.best.opinions)}.</p>
        )}

        {/* Coaching */}
        <Section id="coaching" title="Coaching Opportunities"
          subtitle="Factual observations from this agent's own records, each with a prompt for the conversation. They are not scores or ratings.">
          {data.coaching.length === 0 ? (
            <div className={`${card} p-8 text-center text-sm text-stone-500`}>Nothing stands out from the records right now — there isn't enough activity yet to highlight.</div>
          ) : (
            <div className="grid xl:grid-cols-2 gap-4 items-start">
              {[['Worth discussing', attention], ['Going well', positive]].map(([heading, items]) => (items.length > 0 && (
                <div key={heading}>
                  <p className={`${eyebrow} mb-2`}>{heading}</p>
                  <ul className="space-y-3">{items.map((c) => <CoachingCard key={c.id} item={c} propertiesById={propertiesById} reportBase={reportBase} sample={sample} />)}</ul>
                </div>
              )))}
            </div>
          )}
          <p className="mt-3 flex gap-2 text-xs text-stone-400"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={1.5} />
            <span>Rules used: “views” means {T.viewsMin}+ views; “few opinions” means {T.limitedMax} or fewer; “strong feedback” means {T.strongOpinions}+ opinions or {T.strongRegistrations}+ registrations; a campaign is “active” if it is live or hidden (not archived or sold); the trend compares the last 30 days with the 30 days before.</span></p>
        </Section>

        <PropertyTable data={data} reportBase={reportBase} sample={sample} />

        {/* Rankings */}
        <Section id="rankings" title="Leaderboard position" subtitle="Where this agent sits on the office opinion leaderboard.">
          <div className="grid sm:grid-cols-3 gap-4">
            {RANK_PERIODS.map(([id, label]) => (
              <div key={id} className={`${card} p-5`}>
                <p className={eyebrow}>{label}</p>
                {ranks[id] ? (
                  <>
                    <p className="mt-2 font-serif text-4xl leading-none text-stone-900">{ordinal(ranks[id].rank)}<span className="text-base text-stone-400"> of {ranks[id].of}</span></p>
                    <p className="mt-2 text-xs text-stone-500">{fmtInt(periodTotals[id].opinions)} opinion{periodTotals[id].opinions === 1 ? '' : 's'} · {fmtInt(periodTotals[id].registrations)} registered</p>
                  </>
                ) : <p className="mt-2 text-sm text-stone-400">Not ranked until activated</p>}
              </div>
            ))}
          </div>
        </Section>

        {/* Trends */}
        <Section id="trends" title="Engagement over time" subtitle={`Buyer opinions by the date they were submitted, in ${data.timezone.replace('_', ' ')} time. Real records only.`}>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Opinions per week" definition="The last 12 calendar weeks (Monday start); the final bar is the week so far."
              table={<table className="w-full text-sm"><thead><tr><th className={`${eyebrow} text-left font-medium pb-2`}>Week starting</th><th className={`${eyebrow} text-left font-medium pb-2`}>Opinions</th></tr></thead><tbody>{weekly.map((w) => <tr key={w.weekStart} className="border-t border-stone-100"><td className="py-1.5">{w.label}</td><td className="py-1.5 tabular-nums">{fmtInt(w.opinions)}</td></tr>)}</tbody></table>}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  {grid}<XAxis dataKey="label" {...axis} interval={1} /><YAxis allowDecimals={false} {...axis} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f5f5f4' }} labelFormatter={(l) => `Week of ${l}`} />
                  <Bar isAnimationActive={false} name="Opinions" dataKey="opinions" fill={ORANGE} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Opinions & registered interest by month" definition="Registered interest is the part of the opinions where the buyer left contact details."
              table={<SimpleTable rows={data.trends} cols={[{ key: 'month', label: 'Month' }, { key: 'opinions', label: 'Opinions' }, { key: 'registrations', label: 'Registered' }]} />}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  {grid}<XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
                  <Tooltip contentStyle={tooltipStyle} /><Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                  <Line isAnimationActive={false} type="monotone" name="Opinions" dataKey="opinions" stroke={ORANGE} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                  <Line isAnimationActive={false} type="monotone" name="Registered interest" dataKey="registrations" stroke={CHARCOAL} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <div className="lg:col-span-2">
              <ChartCard title="Campaigns created by month" definition="When this agent added each campaign."
                table={<SimpleTable rows={data.trends} cols={[{ key: 'month', label: 'Month' }, { key: 'campaigns', label: 'Campaigns' }]} />}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    {grid}<XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f5f5f4' }} />
                    <Bar isAnimationActive={false} name="Campaigns" dataKey="campaigns" fill={ORANGE} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
        </Section>

        <p className="mt-10 text-xs text-stone-400">Data refreshed {stamp}. Opinions are credited to the original listing agent. Read-only: buyer names and contact details are never shown.</p>
      </main>
    </div>
  );
}
