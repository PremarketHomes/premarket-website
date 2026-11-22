/**
 * Buyer privacy in every report: a buyer's identity is NEVER delivered together with their price opinion.
 *
 * A listing's opinions are split into two lists that share no key:
 *   priceOpinions  every price opinion, anonymous: { offerAmount } only, highest first. No id, buyer, seriousness,
 *                  badge or date, so no amount can be matched to a registration.
 *   registrations  the registered (serious) buyers: who they are and what they want, WITHOUT any price.
 * plus aggregate figures that never reduce to one buyer's price:
 *   - serious / passive medians only when BOTH groups have at least MIN_GROUP price opinions (with fewer, one group's
 *     median, or the other group's plus the combined median, would give away a registered buyer's price);
 *   - the price timeline only as weekly medians of weeks with at least MIN_GROUP price opinions, never single dated
 *     prices, so a price can't be matched to the day a buyer registered.
 *
 * Residual (stated to Premarket): with very few opinions overall (e.g. a single registered buyer and nothing else),
 * the one anonymous amount shown is still obviously theirs.
 */
import { resolveBuyerIdentity, profileForRegistration } from '../../utils/registrationIdentity';
import { isExcludedOpinion, exclusionSummary } from '../../utils/opinionExclusion';

export const MIN_GROUP = 3;

const amountOf = (o) => {
  const n = parseFloat(o?.offerAmount);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const millis = (t) => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  if (typeof t._seconds === 'number') return t._seconds * 1000;
  const n = new Date(t).getTime();
  return Number.isNaN(n) ? 0 : n;
};
const BNE_OFFSET_MS = 10 * 60 * 60 * 1000; // Queensland: UTC+10, no daylight saving
/** The Brisbane calendar day as 'YYYY-MM-DD' (registration dates are shown to the day, never the time). */
export const brisbaneDay = (t) => {
  const ms = millis(t);
  return ms ? new Date(ms + BNE_OFFSET_MS).toISOString().slice(0, 10) : null;
};
/** Monday (Brisbane calendar) of the week containing `t`, as 'YYYY-MM-DD'. */
const brisbaneWeek = (t) => {
  const ms = millis(t);
  if (!ms) return null;
  const d = new Date(ms + BNE_OFFSET_MS);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
};

export function median(values) {
  const a = values.filter((v) => v > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Split opinion documents (offers with type 'opinion'; other types are ignored) into the private report shape.
 * `buyers`: { [uid]: profile } for registered buyers with a linked account (optional).
 * `withIdentity`: false for viewers who may never see buyers (team colleagues, leadership): registrations keep only
 * what the buyer wants (no name, contact or preferences) and get positional ids.
 * Opinions a Premarket administrator excluded (utils/opinionExclusion.js) are left out of every list and figure, and
 * disclosed as `summary.excluded` ({ count, reasons, excludedAt } or null) for the report to state.
 */
export function separateOpinions(docs, { buyers = {}, withIdentity = true } = {}) {
  const excluded = exclusionSummary(docs);
  const opinions = (docs || []).filter((o) => o && o.type === 'opinion' && !isExcludedOpinion(o));
  const serious = opinions.filter((o) => o.serious === true);
  const passive = opinions.filter((o) => o.serious !== true);
  const amounts = opinions.map(amountOf).filter((a) => a > 0);
  const seriousAmounts = serious.map(amountOf).filter((a) => a > 0);
  const passiveAmounts = passive.map(amountOf).filter((a) => a > 0);
  const groupsLargeEnough = seriousAmounts.length >= MIN_GROUP && passiveAmounts.length >= MIN_GROUP;

  const priceOpinions = amounts.sort((a, b) => b - a).map((offerAmount) => ({ offerAmount }));

  const registrations = [...serious]
    .sort((a, b) => millis(b.createdAt) - millis(a.createdAt))
    .map((o, i) => {
      const row = {
        id: withIdentity ? o.id : `registration-${i + 1}`,
        serious: true,
        registeredOn: brisbaneDay(o.createdAt),
        nextAction: o.nextAction || null,
        timeframe: o.timeframe || null,
        buyerType: o.buyerType || null,
        seriousnessLevel: o.seriousnessLevel || null,
        isFirstHomeBuyer: !!o.isFirstHomeBuyer,
        isInvestor: !!o.isInvestor,
      };
      if (!withIdentity) return { ...row, name: `Registered buyer ${i + 1}` };
      const profile = o.userId ? buyers[o.userId] : null;
      const identity = resolveBuyerIdentity(o, profile);
      const prefs = profileForRegistration(o, profile)?.buyerPreferences || {};
      return {
        ...row,
        name: identity.name || null,
        email: identity.email || null,
        phone: identity.phone || null,
        preferredLocations: prefs.locations || [],
        preferredType: prefs.propertyType || null,
        minBedrooms: prefs.minBedrooms || null,
        minBudget: prefs.minBudget || null,
        maxBudget: prefs.maxBudget || null,
      };
    });

  const weeks = new Map();
  for (const o of opinions) {
    const a = amountOf(o);
    const w = brisbaneWeek(o.createdAt);
    if (a > 0 && w) weeks.set(w, [...(weeks.get(w) || []), a]);
  }
  const weekly = [...weeks.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([weekOf, list]) => ({ weekOf, count: list.length, median: list.length >= MIN_GROUP ? median(list) : null }));

  const levels = {};
  for (const o of opinions) {
    const level = o.seriousnessLevel || 'Unknown';
    levels[level] = (levels[level] || 0) + 1;
  }

  return {
    priceOpinions,
    registrations,
    summary: {
      opinions: opinions.length,
      serious: serious.length,
      passive: passive.length,
      priceCount: amounts.length,
      combinedMedian: median(amounts),
      seriousMedian: groupsLargeEnough ? median(seriousAmounts) : null,
      passiveMedian: groupsLargeEnough ? median(passiveAmounts) : null,
      priceMin: amounts.length ? amounts[amounts.length - 1] : null,
      priceMax: amounts.length ? amounts[0] : null,
      fhbCount: opinions.filter((o) => o.isFirstHomeBuyer).length,
      investorCount: opinions.filter((o) => o.isInvestor).length,
      seriousnessLevels: levels,
      weekly,
      minGroup: MIN_GROUP,
      excluded,
    },
  };
}
