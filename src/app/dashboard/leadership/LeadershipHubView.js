'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { Trophy, ArrowUpDown, ArrowLeft, Info, User, FileText, LogOut } from 'lucide-react';
import { ORANGE, CHARCOAL, fmtInt, fmtPrice, fmtDate, fmtMonth, initials, STATUS_LABEL } from './format';

const PERIODS = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
];

export const card = 'bg-white rounded-md border border-stone-200';
export const eyebrow = 'text-[10px] uppercase tracking-[0.16em] text-stone-400';

export function Avatar({ name, src, size = 'w-10 h-10', text = 'text-xs' }) {
  return src ? (
    <img src={src} alt="" className={`${size} rounded-full object-cover shrink-0 ring-1 ring-stone-200`} />
  ) : (
    <div className={`${size} ${text} rounded-full bg-stone-100 ring-1 ring-stone-200 flex items-center justify-center shrink-0 font-medium text-stone-500`}>
      {name ? initials(name) : <User className="w-4 h-4" strokeWidth={1.5} />}
    </div>
  );
}

export function Section({ title, subtitle, right, children, id }) {
  return (
    <section id={id} className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="font-serif text-2xl text-stone-900">{title}</h2>
          {subtitle && <p className="text-sm text-stone-500 mt-1 max-w-2xl">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-md border border-stone-200 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`px-4 py-1.5 text-[13px] font-medium tracking-wide rounded transition-colors ${
            value === o.id ? 'bg-[#e38100] text-white' : 'text-stone-500 hover:text-stone-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, hint }) {
  return (
    <div className={`${card} p-5`}>
      <p className={eyebrow}>{label}</p>
      <p className="mt-2 font-serif text-3xl sm:text-4xl leading-none text-stone-900 tabular-nums">{value}</p>
      {hint && <p className="mt-2 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

/* ───────────────────────────── Leaderboard ───────────────────────────── */

const MEDAL = {
  1: { ring: 'ring-2 ring-[#e38100]', chip: 'bg-[#e38100] text-white', row: 'bg-[#fdf6ec]' },
  2: { ring: 'ring-2 ring-stone-400', chip: 'bg-stone-500 text-white', row: 'bg-stone-50' },
  3: { ring: 'ring-2 ring-[#c9a27a]', chip: 'bg-[#b98a5e] text-white', row: 'bg-[#faf5ef]' },
};

function Leaderboard({ data, hrefFor }) {
  const [period, setPeriod] = useState('all');
  const rows = data.leaderboard[period] || [];
  const max = Math.max(1, ...rows.map((r) => r.opinions));
  const rangeLabel = {
    all: 'All opinions to date',
    month: `Opinions submitted since ${fmtDate(data.periods.month, data.timezone)}`,
    week: `Opinions submitted since ${fmtDate(data.periods.week, data.timezone)} (week starts Monday)`,
  }[period];

  return (
    <Section
      id="leaderboard"
      title="Opinion Leaderboard"
      subtitle="Ranked by buyer opinions collected, credited to the listing agent."
      right={<Segmented label="Leaderboard period" options={PERIODS} value={period} onChange={setPeriod} />}
    >
      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center gap-2 px-5 sm:px-6 py-3 border-b border-stone-200 bg-[#fdfcfb]">
          <Trophy className="w-4 h-4 text-[#e38100]" strokeWidth={1.5} />
          <p className="text-xs text-stone-500">{rangeLabel}</p>
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-stone-500">No activated agents yet.</p>
        ) : (
          <ol>
            {rows.map((r) => {
              const medal = r.opinions > 0 ? MEDAL[r.rank] : null;
              return (
                <li key={r.uid} className={`px-5 sm:px-6 py-4 border-b border-stone-100 last:border-b-0 ${medal ? medal.row : ''}`}>
                  <div className="flex items-center gap-4">
                    <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center font-serif text-lg tabular-nums ${medal ? medal.chip : 'text-stone-400'}`}>
                      {r.rank}
                    </span>
                    <div className={`rounded-full ${medal ? medal.ring : ''}`}>
                      <Avatar name={r.name} src={r.avatar} size="w-11 h-11" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={hrefFor(r.uid)} className={`block truncate font-serif ${r.rank <= 3 && r.opinions > 0 ? 'text-xl' : 'text-lg'} text-stone-900 hover:text-[#c64500] transition-colors`}>{r.name}</Link>
                      <div className="mt-1.5 h-1.5 rounded-full bg-stone-100 overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full bg-[#e38100]" style={{ width: `${(r.opinions / max) * 100}%` }} />
                      </div>
                    </div>
                    <dl className="hidden sm:flex items-center gap-8 text-right shrink-0">
                      <div><dt className={eyebrow}>Campaigns</dt><dd className="font-serif text-xl tabular-nums text-stone-700">{fmtInt(r.campaigns)}</dd></div>
                      <div><dt className={eyebrow}>Registered</dt><dd className="font-serif text-xl tabular-nums text-stone-700">{fmtInt(r.registrations)}</dd></div>
                      <div><dt className={eyebrow}>Opinions</dt><dd className="font-serif text-3xl tabular-nums text-stone-900">{fmtInt(r.opinions)}</dd></div>
                    </dl>
                    <p className="sm:hidden font-serif text-2xl tabular-nums text-stone-900">{fmtInt(r.opinions)}</p>
                  </div>
                  <p className="sm:hidden mt-2 pl-[52px] text-xs text-stone-500">
                    {fmtInt(r.campaigns)} campaigns · {fmtInt(r.registrations)} registered
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <p className="mt-2 text-xs text-stone-400">
        Ties on opinions are separated by registered interest, then campaigns, then name; agents level on all three share a position.
        Campaigns are all-time. Only activated agents are ranked.
      </p>
    </Section>
  );
}

/* ───────────────────────── Adoption / performance ───────────────────────── */

const COLUMNS = [
  { key: 'name', label: 'Agent', get: (a) => a.name.toLowerCase(), align: 'left' },
  { key: 'activated', label: 'Status', get: (a) => (a.activated ? 1 : 0), align: 'left' },
  { key: 'campaigns', label: 'Campaigns', get: (a) => a.campaigns },
  { key: 'activeCampaigns', label: 'Active', get: (a) => a.activeCampaigns },
  { key: 'opinions', label: 'Opinions', get: (a) => a.opinions },
  { key: 'registrations', label: 'Registered', get: (a) => a.registrations },
  { key: 'views', label: 'Views', get: (a) => a.views },
  { key: 'latestCampaignAt', label: 'Latest campaign', get: (a) => a.latestCampaignAt || '', align: 'left' },
  { key: 'lastSignInAt', label: 'Last sign-in', get: (a) => a.lastSignInAt || '', align: 'left' },
];

function AttentionCard({ title, note, agents, empty, tone, hrefFor }) {
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-lg text-stone-900">{title}</h3>
        <span className={`font-serif text-2xl tabular-nums ${tone}`}>{agents.length}</span>
      </div>
      <p className="text-xs text-stone-500 mt-1">{note}</p>
      <ul className="mt-3 space-y-1.5">
        {agents.length === 0 && <li className="text-sm text-stone-400">{empty}</li>}
        {agents.map((a) => (
          <li key={a.key} className="flex items-center gap-2.5 text-sm text-stone-800">
            <Avatar name={a.name} src={a.avatar} size="w-6 h-6" text="text-[9px]" />
            {a.href ? <Link href={a.href} className="truncate hover:text-[#c64500] transition-colors">{a.name}</Link> : <span className="truncate">{a.name}</span>}
            {a.detail && <span className="ml-auto text-xs text-stone-400 shrink-0">{a.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentSection({ data, hrefFor }) {
  const [sort, setSort] = useState({ key: 'opinions', dir: 'desc' });
  const byUid = useMemo(() => new Map(data.agents.map((a) => [a.uid, a])), [data.agents]);
  const pendingByUid = useMemo(() => new Map(data.pendingInvites.map((p) => [p.uid, p])), [data.pendingInvites]);

  const rows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...data.agents].sort((a, b) => {
      const x = col.get(a); const y = col.get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name) || (a.uid < b.uid ? -1 : 1);
    });
  }, [data.agents, sort]);

  const pick = (uids) => uids.map((uid) => {
    const a = byUid.get(uid) || pendingByUid.get(uid);
    return a ? { key: uid, name: a.name || 'Invited agent', avatar: a.avatar || null, a, href: byUid.has(uid) ? hrefFor(uid) : null } : null;
  }).filter(Boolean);

  const notActivated = pick(data.attention.notActivated).map((x) => ({ ...x, detail: x.a.invitedAt ? `invited ${fmtDate(x.a.invitedAt, data.timezone)}` : 'invited' }));
  const noCampaign = pick(data.attention.activatedNoCampaign).map((x) => ({ ...x, detail: x.a.activatedAt ? `since ${fmtDate(x.a.activatedAt, data.timezone)}` : null }));
  const strong = pick(data.attention.strongEngagement).map((x) => ({ ...x, detail: `${fmtInt(x.a.last30Opinions ?? 0)} in 30 days` }));

  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  return (
    <Section
      id="adoption"
      title="Agent Performance & Adoption"
      subtitle="Who has activated, who has campaigns, and who is generating buyer engagement. Sign-in is shown for information only — it is never used to label anyone inactive."
    >
      <div className="grid md:grid-cols-3 gap-4">
        <AttentionCard title="Not yet activated" note="Invited but haven't completed activation." agents={notActivated} empty="Everyone invited has activated." tone="text-stone-900" />
        <AttentionCard title="Activated, no campaign yet" note="Active accounts that haven't created a campaign." agents={noCampaign} empty="Every activated agent has a campaign." tone="text-[#c64500]" />
        <AttentionCard title="Strongest buyer engagement" note="Top three by opinions submitted in the last 30 days." agents={strong} empty="No opinions in the last 30 days." tone="text-[#e38100]" />
      </div>

      <div className={`${card} mt-4 overflow-x-auto`}>
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-stone-200 bg-[#fdfcfb]">
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`px-4 py-3 font-medium ${c.align === 'left' ? 'text-left' : 'text-right'}`}>
                  <button onClick={() => toggle(c.key)} className={`inline-flex items-center gap-1 ${eyebrow} hover:text-stone-900 ${sort.key === c.key ? '!text-stone-900' : ''}`}>
                    {c.label}<ArrowUpDown className="w-3 h-3" strokeWidth={1.5} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.uid} className="border-b border-stone-100 last:border-b-0 hover:bg-stone-50/60">
                <td className="px-4 py-3"><div className="flex items-center gap-2.5"><Avatar name={a.name} src={a.avatar} size="w-7 h-7" text="text-[10px]" /><Link href={hrefFor(a.uid)} className="text-stone-900 hover:text-[#c64500] transition-colors">{a.name}</Link></div></td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${a.activated ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{a.activated ? 'Activated' : 'Invited'}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtInt(a.campaigns)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtInt(a.activeCampaigns)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-stone-900">{fmtInt(a.opinions)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtInt(a.registrations)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtInt(a.views)}</td>
                <td className="px-4 py-3 text-stone-600">{fmtDate(a.latestCampaignAt, data.timezone)}</td>
                <td className="px-4 py-3 text-stone-600">{a.lastSignInAt ? fmtDate(a.lastSignInAt, data.timezone) : <span className="text-stone-400">Not available</span>}</td>
              </tr>
            ))}
            {data.pendingInvites.map((p, i) => (
              <tr key={`pending-${p.uid || i}`} className="border-b border-stone-100 last:border-b-0 text-stone-500">
                <td className="px-4 py-3"><div className="flex items-center gap-2.5"><Avatar name={p.name} size="w-7 h-7" text="text-[10px]" /><span>{p.name || 'Invited agent'}</span></div></td>
                <td className="px-4 py-3"><span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700">Invited (existing account)</span></td>
                <td className="px-4 py-3 text-right" colSpan={7}>Hasn't joined the office yet</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* ───────────────────────────── Portfolio ───────────────────────────── */

const STATUS_STYLE = {
  live: 'bg-emerald-50 text-emerald-700', hidden: 'bg-stone-100 text-stone-600',
  sold: 'bg-[#fdf1df] text-[#a85f00]', archived: 'bg-stone-100 text-stone-500',
};
const RANGES = [
  { id: 'all', label: 'Any date', days: null },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last 12 months', days: 365 },
];
const PAGE = 24;

function Portfolio({ data, reportBase, sample }) {
  const [agent, setAgent] = useState('all');
  const [status, setStatus] = useState('all');
  const [range, setRange] = useState('all');
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    const days = RANGES.find((r) => r.id === range).days;
    const since = days ? new Date(new Date(data.generatedAt).getTime() - days * 86400000).toISOString() : null;
    return data.properties.filter((p) => (
      (agent === 'all' || p.agentUid === agent)
      && (status === 'all' || p.status === status)
      && (!since || (p.createdAt && p.createdAt >= since))
    ));
  }, [data, agent, status, range]);

  const select = 'text-[13px] rounded-md border border-stone-200 bg-white px-3 py-2 text-stone-700 focus:outline-none focus:border-[#e38100]';

  return (
    <Section id="portfolio" title="Office Portfolio" subtitle="Every campaign across the agency, credited to the original listing agent. Reports are read-only and never show buyer names or contact details.">
      <div className="flex flex-wrap gap-2 mb-4">
        <select aria-label="Agent" className={select} value={agent} onChange={(e) => { setAgent(e.target.value); setShown(PAGE); }}>
          <option value="all">All agents</option>
          {data.agents.filter((a) => a.campaigns > 0).map((a) => <option key={a.uid} value={a.uid}>{a.name}</option>)}
        </select>
        <select aria-label="Status" className={select} value={status} onChange={(e) => { setStatus(e.target.value); setShown(PAGE); }}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Created" className={select} value={range} onChange={(e) => { setRange(e.target.value); setShown(PAGE); }}>
          {RANGES.map((r) => <option key={r.id} value={r.id}>Created: {r.label}</option>)}
        </select>
        <p className="self-center text-xs text-stone-500 ml-1">{fmtInt(filtered.length)} campaign{filtered.length === 1 ? '' : 's'}</p>
      </div>

      {filtered.length === 0 ? (
        <div className={`${card} p-10 text-center text-sm text-stone-500`}>No campaigns match these filters.</div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.slice(0, shown).map((p) => {
            const body = (
              <div className={`${card} overflow-hidden h-full hover:border-stone-300 transition-colors`}>
                <div className="relative h-36 bg-stone-100">
                  {p.thumbnail ? <img src={p.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-stone-300"><FileText className="w-8 h-8" strokeWidth={1} /></div>}
                  <span className={`absolute top-3 left-3 px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                </div>
                <div className="p-4">
                  <p className="font-serif text-lg leading-snug text-stone-900 line-clamp-2">{p.address || 'Address unavailable'}</p>
                  <p className="text-xs text-stone-500 mt-1">{p.agentName} · {p.listingStatus === 'on-market' ? 'On market' : 'Pre-market'} · {fmtDate(p.createdAt, data.timezone)}</p>
                  <p className="font-serif text-xl text-stone-900 mt-2">{fmtPrice(p.status === 'sold' && p.soldPrice ? p.soldPrice : p.price)}</p>
                  <dl className="mt-3 pt-3 border-t border-stone-100 grid grid-cols-3 text-center">
                    <div><dd className="font-serif text-lg tabular-nums">{fmtInt(p.opinions)}</dd><dt className={eyebrow}>Opinions</dt></div>
                    <div><dd className="font-serif text-lg tabular-nums">{fmtInt(p.registrations)}</dd><dt className={eyebrow}>Registered</dt></div>
                    <div><dd className="font-serif text-lg tabular-nums">{fmtInt(p.views)}</dd><dt className={eyebrow}>Views</dt></div>
                  </dl>
                </div>
              </div>
            );
            return sample ? <div key={p.id}>{body}</div> : <Link key={p.id} href={`${reportBase}/${p.id}`}>{body}</Link>;
          })}
        </div>
      )}
      {filtered.length > shown && (
        <div className="text-center mt-5">
          <button onClick={() => setShown((n) => n + PAGE)} className="px-5 py-2 text-sm rounded-md border border-stone-200 bg-white text-stone-700 hover:border-stone-300">Show more</button>
        </div>
      )}
    </Section>
  );
}

/* ───────────────────────────── Trends ───────────────────────────── */

export function ChartCard({ title, definition, children, table }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg text-stone-900">{title}</h3>
          <p className="text-xs text-stone-500 mt-0.5">{definition}</p>
        </div>
        <button onClick={() => setAsTable((v) => !v)} className="text-xs text-stone-500 hover:text-stone-900 underline underline-offset-2 shrink-0">{asTable ? 'Chart' : 'Table'}</button>
      </div>
      <div className="mt-4 h-64">
        {asTable ? <div className="h-full overflow-auto">{table}</div> : children}
      </div>
    </div>
  );
}

export const tooltipStyle = { borderRadius: 6, border: '1px solid #e7e5e4', boxShadow: 'none', fontSize: 12 };

export function SimpleTable({ rows, cols }) {
  return (
    <table className="w-full text-sm">
      <thead><tr>{cols.map((c) => <th key={c.key} className={`${eyebrow} text-left font-medium pb-2`}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.month} className="border-t border-stone-100">{cols.map((c) => <td key={c.key} className="py-1.5 tabular-nums">{c.key === 'month' ? fmtMonth(r.month) : fmtInt(r[c.key])}</td>)}</tr>)}</tbody>
    </table>
  );
}

function Trends({ data }) {
  const trends = data.trends.map((t) => ({ ...t, label: fmtMonth(t.month) }));
  const adoption = data.adoption.map((t) => ({ ...t, label: fmtMonth(t.month) }));
  const range = trends.length ? `${trends[0].label} – ${trends[trends.length - 1].label}` : 'no data yet';
  const axis = { stroke: '#a8a29e', fontSize: 12, tickLine: false, axisLine: false };
  const grid = <CartesianGrid stroke="#f0eeec" vertical={false} />;

  return (
    <Section id="trends" title="Buyer Engagement & Trends" subtitle={`Monthly, in ${data.timezone.replace('_', ' ')} time. Range shown: ${range}. Real records only — months with no activity simply have no point.`}>
      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Opinions & registered interest" definition="Opinions by the month they were submitted. Registered interest is the subset with contact details left."
          table={<SimpleTable rows={trends} cols={[{ key: 'month', label: 'Month' }, { key: 'opinions', label: 'Opinions' }, { key: 'registrations', label: 'Registered' }]} />}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trends} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              {grid}<XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line isAnimationActive={false} type="monotone" name="Opinions" dataKey="opinions" stroke={ORANGE} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
              <Line isAnimationActive={false} type="monotone" name="Registered interest" dataKey="registrations" stroke={CHARCOAL} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Campaigns created" definition="Campaigns by the month they were created, for agents currently in the office."
          table={<SimpleTable rows={trends} cols={[{ key: 'month', label: 'Month' }, { key: 'campaigns', label: 'Campaigns' }]} />}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trends} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              {grid}<XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f5f5f4' }} />
              <Bar isAnimationActive={false} name="Campaigns" dataKey="campaigns" fill={ORANGE} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="lg:col-span-2">
          <ChartCard title="Agents activated over time" definition="Activations recorded when an invited agent first signed in (activation dates are not recorded for agents who joined another way, or before activation tracking began)."
            table={<SimpleTable rows={adoption} cols={[{ key: 'month', label: 'Month' }, { key: 'activations', label: 'Activated' }, { key: 'cumulative', label: 'Running total' }]} />}>
            {adoption.length === 0 ? (
              <p className="h-full flex items-center justify-center text-sm text-stone-400">No recorded activations yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={adoption} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  {grid}<XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f5f5f4' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar isAnimationActive={false} name="Activated that month" dataKey="activations" fill={ORANGE} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Bar isAnimationActive={false} name="Running total" dataKey="cumulative" fill={CHARCOAL} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>
    </Section>
  );
}

/* ───────────────────────────── Shell ───────────────────────────── */

export default function LeadershipHubView({ data, sample = false, leadershipOnly = false, onSignOut, reportBase = '/dashboard/leadership/report', agentBase = '/dashboard/leadership/agent', agentQuery = '' }) {
  const hrefFor = (uid) => `${agentBase}/${uid}${agentQuery}`;
  const { overview: o, leader } = data;
  const [now] = useState(() => new Date(data.generatedAt));
  const stamp = new Intl.DateTimeFormat('en-AU', { timeZone: data.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(now);

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
            {!sample && !leadershipOnly && <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 text-[13px] text-stone-500 hover:text-stone-900"><ArrowLeft className="w-4 h-4" strokeWidth={1.5} />Dashboard</Link>}
            {!sample && <Link href="/dashboard/leadership/profile" className="flex items-center gap-2 px-3 py-2 text-[13px] text-stone-500 hover:text-stone-900"><User className="w-4 h-4" strokeWidth={1.5} />Profile</Link>}
            {onSignOut && <button onClick={onSignOut} className="flex items-center gap-2 px-3 py-2 text-[13px] text-stone-500 hover:text-stone-900"><LogOut className="w-4 h-4" strokeWidth={1.5} />Sign out</button>}
          </div>
        </div>
      </header>

      {sample && (
        <div role="note" className="bg-[#fdf1df] border-b border-[#f0d9b5] text-[#7a4500] text-xs text-center py-2 px-4">
          Preview with invented sample data — not real agents, campaigns or buyers.
        </div>
      )}

      <main className="max-w-[1400px] mx-auto px-4 sm:px-8 py-8 sm:py-10">
        {!sample && !leader.avatar && (
          <p className="mb-6 text-xs text-stone-500 rounded-md border border-stone-200 bg-white px-4 py-2.5">Add a profile photo so the Hub feels like yours. <Link href="/dashboard/leadership/profile" className="text-[#c64500] font-medium hover:text-[#a63a00]">Update your profile</Link></p>
        )}
        <div className="flex items-center gap-4">
          <Avatar name={leader.firstName} src={leader.avatar} size="w-14 h-14" text="text-base" />
          <div>
            <p className={eyebrow}>{data.office.name}</p>
            <h1 className="font-serif text-3xl sm:text-4xl leading-tight text-stone-900">Welcome back, {leader.firstName || 'there'}</h1>
          </div>
        </div>
        <div className="mt-6 h-px w-10 bg-[#e38100]" aria-hidden="true" />

        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="Total campaigns" value={fmtInt(o.campaigns)} />
          <Kpi label="Active campaigns" value={fmtInt(o.activeCampaigns)} hint="Not archived or sold" />
          <Kpi label="Buyer opinions" value={fmtInt(o.opinions)} />
          <Kpi label="Registered interest" value={fmtInt(o.registrations)} hint="Included in opinions" />
          <Kpi label="Agents activated" value={`${fmtInt(o.agentsActivated)} / ${fmtInt(o.agentsTotal)}`} />
          <Kpi label="Not yet activated" value={fmtInt(o.agentsNotActivated)} />
          <Kpi label="Agents with a campaign" value={fmtInt(o.agentsWithCampaigns)} />
          <Kpi label="Property views" value={fmtInt(o.views)} />
        </div>

        <Leaderboard data={data} hrefFor={hrefFor} />
        <AgentSection data={data} hrefFor={hrefFor} />
        <Trends data={data} />
        <Portfolio data={data} reportBase={reportBase} sample={sample} />

        <Section title="Definitions">
          <div className={`${card} p-5 text-sm text-stone-600 space-y-2`}>
            <p className="flex gap-2"><Info className="w-4 h-4 mt-0.5 text-stone-400 shrink-0" strokeWidth={1.5} /><span><b className="font-medium text-stone-800">Campaign</b> — a listing owned by a current member of the office and not removed by its agent. <b className="font-medium text-stone-800">Active</b> — not archived or sold.</span></p>
            <p className="pl-6"><b className="font-medium text-stone-800">Opinion</b> — one buyer price-opinion record, counted once and credited to the original listing agent. <b className="font-medium text-stone-800">Registered interest</b> — the opinions where the buyer also left their contact details; it is part of the opinion total, never added on top of it.</p>
            <p className="pl-6"><b className="font-medium text-stone-800">Time filters</b> — based on when the opinion was submitted, using calendar weeks (Monday start) and months in {data.timezone.replace('_', ' ')} time. <b className="font-medium text-stone-800">Last sign-in</b> — from the agent's login record where available; it is not a measure of activity.</p>
            <p className="pl-6 text-xs text-stone-400">Data refreshed {stamp}. Reload the page for the latest figures. Agents who have left the office are not included.</p>
          </div>
        </Section>
      </main>
    </div>
  );
}
