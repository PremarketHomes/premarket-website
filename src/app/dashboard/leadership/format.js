export const ORANGE = '#e38100';
export const CHARCOAL = '#44403c';

export const fmtInt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-AU') : '—');
export const fmtPrice = (n) => (n ? `$${Math.round(n).toLocaleString('en-AU')}` : '—');

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
