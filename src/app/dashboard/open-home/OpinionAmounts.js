'use client';

import { Info, Lock, ShieldCheck } from 'lucide-react';
import { Card } from '../../concepts/open-home/_components/AgentDashboard';
import { money } from '../../concepts/open-home/_lib/format';
import { sampleNote } from '../../utils/openHome/opinionReveal';

/**
 * The agent's view of anonymous price opinions for pilot open homes on the 'after-end' rule (utils/openHome/opinionReveal.js).
 * Renders only what the API sent: nothing while live; after the end the sorted amounts, count, average and range.
 */

export function SealedOpinionsCard() {
  return (
    <Card className="p-5" data-testid="opinions-sealed">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        <h3 className="text-[15px] font-semibold text-slate-900">Anonymous price opinions</h3>
      </div>
      <p className="mt-3 text-[22px] font-semibold leading-tight tracking-tight text-slate-900">Sealed until you end</p>
      <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
        Opinions aren&rsquo;t shown or counted while the open home is running, so none can be matched to the buyer who just
        left. When you end it you&rsquo;ll see every amount, lowest to highest, but never who gave it or when.
      </p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-slate-500">Opinions can&rsquo;t be added once you end.</p>
    </Card>
  );
}

function Stat({ label, value, testId }) {
  return (
    <div>
      <dt className="text-[12.5px] font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums" data-testid={testId}>{value}</dd>
    </div>
  );
}

export function RevealedOpinionsCard({ results }) {
  const { count, amounts, average, low, high } = results;
  return (
    <Card className="p-6" data-testid="opinion-amounts" data-count={count}>
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        <h3 className="text-[15px] font-semibold text-slate-900">Anonymous price opinions</h3>
      </div>

      {count === 0 ? (
        <p className="mt-4 text-[15px] font-medium text-slate-800" data-testid="opinion-none">No price opinions were given at this open home.</p>
      ) : (
        <>
          <dl className={`mt-5 grid gap-5 ${count === 1 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
            <Stat label="Opinions" value={count} testId="opinion-count" />
            {count === 1 ? (
              <Stat label="The opinion" value={money(amounts[0])} testId="opinion-average" />
            ) : (
              <>
                <Stat label="Average" value={money(average)} testId="opinion-average" />
                <Stat label="Range" value={`${money(low)} – ${money(high)}`} testId="opinion-range" />
              </>
            )}
          </dl>

          {count > 1 && (
            <div className="mt-6">
              <p className="text-[12.5px] font-medium text-slate-500">Every opinion, lowest to highest</p>
              <ul className="mt-2 flex flex-wrap gap-2" data-testid="opinion-list">
                {amounts.map((v, i) => (
                  // equal amounts can repeat, so the position is part of the key (the list is sorted, never arrival order)
                  <li key={`${v}-${i}`} className="rounded-full bg-slate-100 px-3 py-1.5 text-[14px] font-semibold tabular-nums text-slate-800" data-testid="opinion-amount">{money(v)}</li>
                ))}
              </ul>
            </div>
          )}

          <p className={`mt-5 flex items-start gap-2 rounded-xl p-3 text-[13px] leading-relaxed ${count < 5 ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`} data-testid="opinion-caveat">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {sampleNote(count)}
          </p>
        </>
      )}

      <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-slate-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
        {count > 1
          ? 'Listed lowest to highest, not in the order given, and never linked to who checked in. With only a few visitors it may be possible to guess who gave which, so please treat them as anonymous.'
          : 'Opinions are never linked to who checked in. With only a few visitors it may be possible to guess who gave one, so please treat it as anonymous.'}
      </p>
    </Card>
  );
}
