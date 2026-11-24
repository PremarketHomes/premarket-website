/** "Proposed concept" label used on every presenter page, so no screen can be mistaken for a launched product. */
export default function ConceptBadge({ tone = 'light', children = 'Proposed concept · demo data' }) {
  const cls = tone === 'dark'
    ? 'bg-amber-300/15 text-amber-200 ring-amber-200/30'
    : 'bg-amber-50 text-amber-800 ring-amber-600/20';
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      {children}
    </span>
  );
}
