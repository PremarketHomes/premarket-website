/**
 * Buyer opinions a Premarket administrator has excluded from a campaign's ACTIVE results.
 *
 * The opinion document is never changed or deleted: every original field (amount, dates, session) stays exactly as
 * the buyer submitted it. An excluded opinion only gains
 *   reportExclusion: { excluded: true, reason, excludedAt, excludedByUid, auditId }
 * written server-side by a platform administrator. firestore.rules list it in neither offerCreateKeys nor
 * offerUpdateKeys, so no browser (buyer, agent or office) can ever set or clear it. The original values are also
 * copied into officeCampaignAudit (action 'opinion.excludedFromReports', server-only) at the time of exclusion.
 *
 * Every count, median, range, report and score leaves excluded opinions out (withoutExcluded), and every report that
 * shows this campaign's opinions states how many were excluded, when, and why (exclusionSummary / exclusionNotice),
 * so a smaller set of results is never presented as the complete picture.
 *
 * Plain JS with no imports: shared by API services and client pages alike.
 */

export const isExcludedOpinion = (o) => o?.reportExclusion?.excluded === true;

/** The opinions that count: everything except excluded ones. Non-arrays give []. */
export const withoutExcluded = (list) => (Array.isArray(list) ? list.filter((o) => o && !isExcludedOpinion(o)) : []);

const toIso = (t) => {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate().toISOString();
  if (typeof t._seconds === 'number') return new Date(t._seconds * 1000).toISOString();
  if (typeof t.seconds === 'number') return new Date(t.seconds * 1000).toISOString();
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * What a report must disclose about excluded opinions among `docs` (opinion documents; other types ignored):
 * { count, reasons, excludedAt } with the latest exclusion time, or null when nothing was excluded.
 * Never any amount, buyer or per-opinion detail of the excluded opinions.
 */
export function exclusionSummary(docs) {
  const excluded = (Array.isArray(docs) ? docs : []).filter((o) => o && o.type === 'opinion' && isExcludedOpinion(o));
  if (!excluded.length) return null;
  const reasons = [...new Set(excluded.map((o) => String(o.reportExclusion.reason || '').trim()).filter(Boolean))];
  const times = excluded.map((o) => toIso(o.reportExclusion.excludedAt)).filter(Boolean).sort();
  return { count: excluded.length, reasons, excludedAt: times.length ? times[times.length - 1] : null };
}

const BNE_OFFSET_MS = 10 * 60 * 60 * 1000; // Queensland: UTC+10, no daylight saving
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const brisbaneDate = (iso) => {
  const ms = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + BNE_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** The one disclosure sentence every report shows, or null when nothing was excluded. */
export function exclusionNotice(summary) {
  if (!summary || !summary.count) return null;
  const n = summary.count;
  const what = n === 1 ? '1 buyer price opinion was' : `${n} buyer price opinions were`;
  const when = brisbaneDate(summary.excludedAt);
  const reason = Array.isArray(summary.reasons) && summary.reasons.length ? ` Reason: ${summary.reasons.join('; ')}` : '';
  const tail = reason && !/[.!?]$/.test(reason) ? '.' : '';
  return `${what} excluded from these results by Premarket${when ? ` on ${when}` : ''}. The figures shown do not include ${n === 1 ? 'it' : 'them'}.${reason}${tail}`;
}
