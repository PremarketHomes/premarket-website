/**
 * Marketing Channel Performance: what the campaign report shows about Email / SMS / General links, and what it withholds.
 *
 * Inputs are counts only (see channelAttribution.js for how they are recorded):
 *   - per channel ('email', 'sms'): views (opens of that channel's link) and opinions (anonymous price opinions first
 *     submitted from a page opened through that link)
 *   - the campaign's own totals: stats.views (Total Views, as the dashboard shows it) and the report's price-opinion count
 *     (summary.priceCount: opinions with a price, excluding any Premarket excluded)
 * General / Unknown is the rest: total minus the channels. It holds the general link, older links, the iPad, and
 * everything from before channel links existed, so history is never re-labelled or guessed.
 *
 * Privacy (buyer price opinions stay anonymous):
 *   - No amounts, medians, times, dates or order are ever broken down by channel. Only counts.
 *   - A channel's opinion count is shown only when it is at least MIN_CHANNEL_OPINIONS (3). Below that, INCLUDING
 *     zero, it is withheld: otherwise an agent who sent one channel's link to a single buyer could watch that channel
 *     go from 0 to 1 and match the buyer to the new amount in the report's list.
 *   - Withheld channels are never left so that the total gives them away: if only one would be withheld, the next
 *     smallest is withheld with it, and withheld channels are shown only as one combined figure of at least 3.
 *     If that is not possible, every channel's opinions are withheld (the campaign total is still shown, as it always
 *     has been).
 *   - Views per channel are always shown: they are not linked to any price.
 * The rule is applied here, on the server; the browser never receives a withheld count.
 */
import { CHANNELS, GENERAL_CHANNEL, MIN_CHANNEL_OPINIONS } from '../../utils/campaignChannels';

// Which channel is withheld alongside another when two have the same number of opinions (General first: the catch-all).
const TIE_ORDER = [GENERAL_CHANNEL.key, ...CHANNELS.map((c) => c.key).reverse()];

const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Opinions per 100 views, as a whole percentage (null when there were no views). Capped at 100. */
export const conversionRate = (opinions, views) => (views > 0 ? Math.min(100, Math.round((opinions / views) * 100)) : null);

/**
 * @param {object} p
 * @param {object} [p.channelStats]   the campaignChannelStats document ({ email: { views, opinions }, sms: {...} })
 * @param {object} [p.propertyStats]  property.stats ({ views, ... })
 * @param {number} [p.priceCount]     summary.priceCount from opinionPrivacy.separateOpinions
 */
export function buildChannelReport({ channelStats, propertyStats, priceCount } = {}) {
  const K = MIN_CHANNEL_OPINIONS;
  const totalViews = count(propertyStats?.views);
  const totalOpinions = count(priceCount);

  const channels = CHANNELS.map((c) => ({
    key: c.key,
    label: c.label,
    views: count(channelStats?.[c.key]?.views),
    opinions: count(channelStats?.[c.key]?.opinions),
  }));
  const channelViews = channels.reduce((s, r) => s + r.views, 0);
  const channelOpinions = channels.reduce((s, r) => s + r.opinions, 0);
  // Channel opinions are counted when submitted; an opinion Premarket later excludes stays in its channel's count (by
  // design nothing records which channel an opinion came from). If that ever makes the channels exceed the total,
  // nothing is shown rather than numbers that don't add up.
  const inconsistent = channelOpinions > totalOpinions;
  const general = {
    key: GENERAL_CHANNEL.key,
    label: GENERAL_CHANNEL.label,
    views: Math.max(0, totalViews - channelViews),
    opinions: Math.max(0, totalOpinions - channelOpinions),
  };
  const rows = [...channels, general];
  const used = rows.filter((r) => r.views > 0 || r.opinions > 0);

  let hidden = new Set();
  let withheld = null; // null | 'small' | 'inconsistent'
  if (inconsistent) {
    hidden = new Set(used.map((r) => r.key));
    withheld = 'inconsistent';
  } else if (totalOpinions > 0) {
    hidden = new Set(used.filter((r) => r.opinions < K).map((r) => r.key));
    if (hidden.size === 1) {
      // One withheld figure alone could be worked out as total minus the others: withhold the next smallest with it.
      // Ties are broken by a FIXED order, never by views: views change all the time, and a grouping that flipped
      // back and forth with no new opinion would show each channel's exact count in turn.
      const next = used
        .filter((r) => !hidden.has(r.key))
        .sort((a, b) => a.opinions - b.opinions || TIE_ORDER.indexOf(a.key) - TIE_ORDER.indexOf(b.key))[0];
      if (next) hidden.add(next.key);
    }
    const hiddenSum = used.filter((r) => hidden.has(r.key)).reduce((s, r) => s + r.opinions, 0);
    if (hidden.size > 0 && hiddenSum < K) hidden = new Set(used.map((r) => r.key));
    if (hidden.size > 0 && hidden.size === used.length) withheld = 'small';
  }
  // With no opinions at all every count is 0, which the campaign total already says: nothing to withhold.

  const hiddenRows = rows.filter((r) => hidden.has(r.key));
  const combined = !withheld && hiddenRows.length >= 2
    ? {
      keys: hiddenRows.map((r) => r.key),
      labels: hiddenRows.map((r) => r.label),
      views: hiddenRows.reduce((s, r) => s + r.views, 0),
      opinions: hiddenRows.reduce((s, r) => s + r.opinions, 0),
    }
    : null;
  if (combined) combined.conversion = conversionRate(combined.opinions, combined.views);

  return {
    minOpinions: K,
    tracking: channelViews > 0 || channelOpinions > 0, // has any Email/SMS link been opened yet
    withheld,
    rows: rows.map((r) => {
      const isHidden = hidden.has(r.key);
      return {
        key: r.key,
        label: r.label,
        views: r.views,
        used: r.views > 0 || r.opinions > 0,
        opinionsHidden: isHidden,
        opinions: isHidden ? null : r.opinions,
        conversion: isHidden ? null : conversionRate(r.opinions, r.views),
      };
    }),
    combined,
    total: { views: totalViews, opinions: totalOpinions, conversion: conversionRate(totalOpinions, totalViews) },
  };
}
