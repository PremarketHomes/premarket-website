// Loading placeholders shaped like the page that is loading, used instead of full-screen spinners so the page's
// layout appears straight away. They contain no data at all (no names, numbers, photos or counts): nothing protected
// or belonging to another account can show before the page's own checks finish, and nothing suggests "0 properties"
// while the real list is still on its way.

function Block({ className = '', tone = 'stone' }) {
  const bg = tone === 'slate' ? 'bg-slate-200/80' : 'bg-stone-200/70';
  return <div aria-hidden="true" className={`rounded motion-safe:animate-pulse ${bg} ${className}`} />;
}

function Loading({ className, children }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" data-testid="page-skeleton" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

// --- Dashboard (agents and BSOs) ---

export function DashboardStatsSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-stone-200 border border-stone-200 rounded-md overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-white px-5 py-5 sm:px-7 sm:py-6">
          <Block className="h-3 w-24" />
          <Block className="mt-3 h-8 w-12" />
        </div>
      ))}
    </div>
  );
}

export function PropertyCardsSkeleton({ count = 3 }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-white border border-stone-200 rounded-md overflow-hidden flex flex-col">
          <div className="aspect-[4/3] bg-stone-100 motion-safe:animate-pulse" />
          <div className="p-5 space-y-3">
            <Block className="h-5 w-3/4" />
            <Block className="h-4 w-1/2" />
            <div className="flex gap-4 pt-2"><Block className="h-4 w-16" /><Block className="h-4 w-16" /><Block className="h-4 w-16" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CampaignRowsSkeleton({ count = 4 }) {
  return (
    <ul aria-hidden="true" className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
          <div className="w-16 h-12 rounded-lg bg-slate-100 shrink-0 motion-safe:animate-pulse" />
          <div className="flex-1 min-w-0 space-y-2"><Block tone="slate" className="h-4 w-2/3" /><Block tone="slate" className="h-3 w-1/3" /></div>
        </li>
      ))}
    </ul>
  );
}

/** Whole Dashboard while sign-in is being confirmed: sidebar, header, stats and cards, all empty. */
export function DashboardSkeleton() {
  return (
    <Loading className="min-h-screen bg-[#faf9f7]">
      <div aria-hidden="true" className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#fdfcfb] border-r border-stone-200 px-7 pt-8">
        <Block className="h-6 w-32" />
        <div className="mt-10 space-y-5">{[0, 1, 2, 3, 4].map((i) => <Block key={i} className="h-4 w-36" />)}</div>
      </div>
      <div className="lg:pl-64">
        <div aria-hidden="true" className="sticky top-0 z-20 bg-[#fdfcfb]/95 border-b border-stone-200 lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Block className="h-9 w-9 rounded-md" />
            <span className="font-serif text-lg text-stone-900">Dashboard</span>
            <Block className="h-9 w-9 rounded-md" />
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10 py-7 sm:py-10 space-y-8">
          <div aria-hidden="true" className="pb-7 border-b border-stone-200">
            <Block className="h-9 w-48" />
            <Block className="mt-3 h-4 w-64 hidden sm:block" />
          </div>
          <DashboardStatsSkeleton />
          <PropertyCardsSkeleton />
        </div>
      </div>
    </Loading>
  );
}

// --- Office pages (overview, Campaigns, Agents, Teams, Registrations) ---

/** Office pages while the office and its data load: back link, title and either rows or the overview cards. */
export function OfficePageSkeleton({ overview = false, rows = 6 }) {
  return (
    <Loading className="min-h-screen bg-slate-50 py-8 px-4">
      <div aria-hidden="true" className="max-w-5xl mx-auto">
        <Block tone="slate" className="h-4 w-36 mb-4" />
        <Block tone="slate" className="h-7 w-48" />
        <Block tone="slate" className="mt-2 h-4 w-72 max-w-full" />
        {overview ? (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => <div key={i} className="bg-white rounded-xl border border-slate-200 p-4"><Block tone="slate" className="h-3 w-20" /><Block tone="slate" className="mt-3 h-7 w-10" /></div>)}
            </div>
            {[0, 1].map((i) => <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3"><Block tone="slate" className="h-5 w-40" /><Block tone="slate" className="h-4 w-full" /><Block tone="slate" className="h-4 w-2/3" /></div>)}
          </div>
        ) : (
          <>
            <Block tone="slate" className="mt-6 h-10 w-full rounded-xl" />
            <div className="mt-4"><CampaignRowsSkeleton count={rows} /></div>
          </>
        )}
      </div>
    </Loading>
  );
}

// --- Campaign report (/dashboard/property/[id]) ---

export function ReportSkeleton() {
  return (
    <Loading className="min-h-screen bg-slate-50">
      <div aria-hidden="true" className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Block tone="slate" className="h-9 w-9 rounded-lg shrink-0" />
            <div className="space-y-1.5"><Block tone="slate" className="h-4 w-40" /><Block tone="slate" className="h-3 w-56 max-w-[50vw]" /></div>
          </div>
          <Block tone="slate" className="h-8 w-24 rounded-lg shrink-0" />
        </div>
      </div>
      <div aria-hidden="true" className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="bg-white rounded-xl border border-slate-200 p-4"><Block tone="slate" className="h-3 w-16" /><Block tone="slate" className="mt-3 h-7 w-12" /></div>)}
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-6"><Block tone="slate" className="h-5 w-44" /><Block tone="slate" className="mt-5 h-48 w-full" /></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3"><Block tone="slate" className="h-5 w-36" /><Block tone="slate" className="h-4 w-full" /><Block tone="slate" className="h-4 w-5/6" /></div>
      </div>
    </Loading>
  );
}

// --- Edit property ---

export function EditSkeleton() {
  return (
    <Loading className="min-h-screen bg-slate-50 flex flex-col">
      <div aria-hidden="true" className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Block tone="slate" className="h-9 w-9 rounded-xl" />
              <div className="space-y-1.5"><Block tone="slate" className="h-5 w-32" /><Block tone="slate" className="h-3 w-20" /></div>
            </div>
            <Block tone="slate" className="h-9 w-9 rounded-xl" />
          </div>
          <div className="mt-3 w-full h-1.5 bg-slate-200 rounded-full" />
        </div>
      </div>
      <div aria-hidden="true" className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-8 space-y-5">
        <Block tone="slate" className="h-7 w-56" />
        <Block tone="slate" className="h-4 w-72 max-w-full" />
        {[0, 1, 2].map((i) => <div key={i} className="space-y-2"><Block tone="slate" className="h-4 w-24" /><Block tone="slate" className="h-12 w-full rounded-xl" /></div>)}
      </div>
    </Loading>
  );
}
