export const ORANGE = '#e38100';
export const CHARCOAL = '#44403c';

export const fmtInt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-AU') : '—');
export const PRICE_NOT_PROVIDED = 'Price not provided';

/*
 * Prices are stored inconsistently across the platform: the Add Property form saves a digit string
 * ("950000"), other sources may save a number, a formatted string ("$1,200,000"), shorthand ("$1.2m",
 * "900k"), a range ("$900,000 - $950,000", "900-950k") or words ("Contact agent", "POA"). This reads any
 * of them for DISPLAY ONLY — it never writes anything back — and never produces NaN.
 *
 *   single  -> one amount            range -> { min, max }          none -> nothing safe to show
 * A figure under $1,000 with no k/m is not treated as a price (so "950" or "3 bed" are ignored), and
 * anything ambiguous (three or more figures, or two where one is not a price) shows as none.
 */
const MULTIPLIER = { k: 1e3, thousand: 1e3, m: 1e6, mil: 1e6, million: 1e6 };
const MIN_PRICE = 1000;
const MAX_PRICE = 1e10;
const TOKEN = /(\d[\d,]*(?:\.\d+)?)\s*(million|thousand|mil|m|k)?(?![a-z])/gi;
const validAmount = (n) => Number.isFinite(n) && n >= MIN_PRICE && n <= MAX_PRICE;

export function parsePriceValue(value) {
  if (typeof value === 'number') return validAmount(value) ? { kind: 'single', amount: Math.round(value) } : { kind: 'none' };

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const lo = parsePriceValue(value.min ?? value.from ?? value.low);
    const hi = parsePriceValue(value.max ?? value.to ?? value.high);
    if (lo.kind === 'single' && hi.kind === 'single') {
      const [min, max] = lo.amount <= hi.amount ? [lo.amount, hi.amount] : [hi.amount, lo.amount];
      return min === max ? { kind: 'single', amount: min } : { kind: 'range', min, max };
    }
    return { kind: 'none' };
  }

  if (typeof value !== 'string') return { kind: 'none' };
  const found = [...value.matchAll(TOKEN)];
  const tokens = found.map((m) => ({ n: parseFloat(m[1].replace(/,/g, '')), mult: m[2] ? MULTIPLIER[m[2].toLowerCase()] : null }));
  // "900-950k": the shorthand on the second figure applies to the first, but only across a range separator
  // (so "3 bed home $900k" is not read as "3k to 900k").
  if (found.length === 2 && tokens[0].mult == null && tokens[1].mult != null && tokens[0].n < MIN_PRICE) {
    const between = value.slice(found[0].index + found[0][0].length, found[1].index);
    if (/^\s*(?:-|\u2013|\u2014|to)\s*\$?\s*$/i.test(between)) tokens[0].mult = tokens[1].mult;
  }
  const amounts = tokens.map((t) => t.n * (t.mult || 1)).filter(validAmount).map(Math.round);

  if (amounts.length === 1) return { kind: 'single', amount: amounts[0] };
  if (amounts.length === 2 && tokens.length === 2) {
    const [min, max] = amounts[0] <= amounts[1] ? amounts : [amounts[1], amounts[0]];
    return min === max ? { kind: 'single', amount: min } : { kind: 'range', min, max };
  }
  return { kind: 'none' };
}

const money = (n) => `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;

/** Display text for a stored price, or `fallback` when there is no valid price. */
export function fmtPrice(value, fallback = PRICE_NOT_PROVIDED) {
  const p = parsePriceValue(value);
  if (p.kind === 'single') return money(p.amount);
  if (p.kind === 'range') return `${money(p.min)} \u2013 ${money(p.max)}`;
  return fallback;
}

/**
 * The price shown for a campaign: the sold price once sold (if it is a valid price), otherwise the listing
 * price. `provided` is false when there is nothing valid to show, so callers can style the fallback quietly.
 */
export function campaignPrice(p) {
  const sold = p?.status === 'sold' ? fmtPrice(p.soldPrice, null) : null;
  const text = sold ?? fmtPrice(p?.price, null);
  return text ? { text, provided: true } : { text: PRICE_NOT_PROVIDED, provided: false };
}

export function fmtDate(iso, tz = 'Australia/Sydney') {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-AU', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function fmtMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export const STATUS_LABEL = { live: 'Live', hidden: 'Hidden', sold: 'Sold', archived: 'Archived' };
